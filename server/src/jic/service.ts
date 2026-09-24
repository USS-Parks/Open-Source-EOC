import type { Sql } from "../db/client.js";
import {
  AuthError,
  principalForPerson,
  requireMember,
  requireWriter,
  type Principal,
} from "../auth/service.js";
import { hashToken } from "../auth/tokens.js";
import { withPerson } from "../db/context.js";
import {
  CURSOR_AT_FORMAT,
  DEFAULT_PAGE_LIMIT,
  cutPage,
  decodeCursor,
  type Page,
  type PageRequest,
} from "../db/cursor.js";
import { recordAudit } from "../audit/service.js";
import { authorAlert } from "../cap/service.js";
import { postAnnouncement } from "../collab/service.js";

/**
 * Joint Information Center (R4). Press releases route through a
 * configurable multi-agency approval chain before they can publish; the
 * chain is appended, never edited. Approvals come from local agencies and
 * from federation peers over a peer token. Publication fans out to the
 * public feed, to CAP where a draft is supplied, and to the collaboration
 * adapters. Media inquiries tie every answer to approved language.
 */

export interface DraftInput {
  readonly title: string;
  readonly body: string;
  readonly requiredAgencies: readonly string[];
  readonly incidentId?: string | undefined;
}

export async function draftRelease(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: DraftInput,
): Promise<{ id: string }> {
  requireWriter(actor, jurisdictionId);
  const [row] = await sql`
    insert into press_releases
      (jurisdiction_id, incident_id, title, body, required_agencies, created_by, created_by_position)
    values
      (${jurisdictionId}, ${input.incidentId ?? null}, ${input.title}, ${input.body},
       ${input.requiredAgencies as string[]}, ${actor.person.id},
       ${actor.position?.id ?? null})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    category: "jic.release_drafted",
    subjectTable: "press_releases",
    subjectId: id,
    payload: { title: input.title, requiredAgencies: input.requiredAgencies },
  });
  return { id };
}

export async function submitRelease(sql: Sql, actor: Principal, releaseId: string): Promise<void> {
  const rel = await loadRelease(sql, releaseId);
  requireWriter(actor, rel.jurisdiction_id);
  if (rel.status !== "draft") throw new AuthError(409, "only a draft can be submitted");
  await sql`update press_releases set status = 'pending', submitted_at = now() where id = ${releaseId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: rel.jurisdiction_id,
    category: "jic.release_submitted",
    subjectTable: "press_releases",
    subjectId: releaseId,
  });
}

/** A local agency's decision, attributed to the deciding PIO. */
export async function decideLocal(
  sql: Sql,
  actor: Principal,
  releaseId: string,
  agency: string,
  decision: "approve" | "reject",
  note?: string,
): Promise<{ status: string }> {
  const rel = await loadRelease(sql, releaseId);
  requireWriter(actor, rel.jurisdiction_id);
  if (!rel.required_agencies.includes(agency))
    throw new AuthError(403, "agency is not in this release's approval chain");
  const [peerAgency] = await sql`
    select 1 from peers where jurisdiction_id = ${rel.jurisdiction_id} and name = ${agency}`;
  if (peerAgency) throw new AuthError(403, "that agency must approve over its peer token");
  const [prior] = await sql`
    select 1 from press_release_approvals
    where release_id = ${releaseId} and decided_by_person = ${actor.person.id}`;
  if (prior) throw new AuthError(409, "this person already recorded a decision on this release");
  await recordDecision(sql, releaseId, agency, decision, note, actor.person.id, null);
  const status = await recomputeStatus(sql, releaseId);
  await recordAudit(sql, actor, {
    jurisdictionId: rel.jurisdiction_id,
    category: "jic.release_decided",
    subjectTable: "press_releases",
    subjectId: releaseId,
    payload: { agency, decision, status },
  });
  return { status };
}

/**
 * A federation peer's decision, authenticated by its token. It runs under
 * the receiving jurisdiction's registrar so RLS and attribution hold; the
 * agency is the peer's name.
 */
export async function receivePeerDecision(
  sql: Sql,
  peerToken: string,
  releaseId: string,
  decision: "approve" | "reject",
  note?: string,
): Promise<{ status: string }> {
  const [peer] = await sql`
    select id, name, jurisdiction_id, created_by from peers where token_hash = ${hashToken(peerToken)}`;
  if (!peer) throw new AuthError(401, "unknown peer");
  const local = await principalForPerson(sql, peer.created_by as string);
  return withPerson(sql, local.person.id, async (tx) => {
    const [rel] = await tx`
      select jurisdiction_id, required_agencies from press_releases where id = ${releaseId}`;
    if (!rel) throw new AuthError(404, "release not found");
    if ((rel.jurisdiction_id as string) !== (peer.jurisdiction_id as string))
      throw new AuthError(403, "release belongs to another jurisdiction");
    const required = (rel.required_agencies as string[]) ?? [];
    if (!required.includes(peer.name as string))
      throw new AuthError(403, "this peer is not in the release approval chain");
    await recordDecision(tx, releaseId, peer.name as string, decision, note, null, peer.name as string);
    const status = await recomputeStatus(tx, releaseId);
    await recordAudit(tx, local, {
      jurisdictionId: peer.jurisdiction_id as string,
      category: "jic.release_decided",
      subjectTable: "press_releases",
      subjectId: releaseId,
      payload: { agency: peer.name as string, decision, status, viaPeer: true },
    });
    return { status };
  });
}

export interface PublishOptions {
  readonly toPublicFeed?: boolean;
  readonly capDraft?: unknown;
}

export async function publishRelease(
  sql: Sql,
  actor: Principal,
  releaseId: string,
  options: PublishOptions = {},
): Promise<{ status: string; channels: string[] }> {
  const rel = await loadRelease(sql, releaseId);
  requireWriter(actor, rel.jurisdiction_id);
  if (rel.status !== "approved")
    throw new AuthError(409, "only an approved release can publish");

  const channels: string[] = [];
  if (options.toPublicFeed !== false) {
    await sql`
      insert into public_messages (jurisdiction_id, release_id, title, body)
      values (${rel.jurisdiction_id}, ${releaseId}, ${rel.title}, ${rel.body})`;
    await recordPublication(sql, releaseId, "public_feed", null);
    channels.push("public_feed");
  }

  if (options.capDraft !== undefined) {
    const authored = await authorAlert(
      sql,
      actor,
      rel.jurisdiction_id,
      options.capDraft,
      rel.incident_id ?? undefined,
    );
    await sql`update press_releases set cap_alert_id = ${authored.id} where id = ${releaseId}`;
    await recordPublication(sql, releaseId, "cap", authored.identifier);
    channels.push("cap");
  }

  await sql`update press_releases set status = 'published', published_at = now() where id = ${releaseId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: rel.jurisdiction_id,
    ...(rel.incident_id ? { incidentId: rel.incident_id } : {}),
    category: "jic.release_published",
    subjectTable: "press_releases",
    subjectId: releaseId,
    payload: { channels },
  });
  return { status: "published", channels };
}

/**
 * Announce a published release in its incident's collaboration channels,
 * after publication has committed. `sql` is the pool: the backend is called
 * with no transaction open. Collaboration is a best-effort outlet, so a
 * failure answers false and publication stands.
 */
export async function announceRelease(sql: Sql, actor: Principal, releaseId: string): Promise<boolean> {
  try {
    const rel = await withPerson(sql, actor.person.id, (tx) => loadRelease(tx, releaseId));
    if (rel.status !== "published" || !rel.incident_id) return false;
    await postAnnouncement(sql, actor, rel.incident_id, null, `${rel.title}\n\n${rel.body}`);
    await withPerson(sql, actor.person.id, (tx) => recordPublication(tx, releaseId, "collab", null));
    return true;
  } catch {
    return false;
  }
}

export async function logInquiry(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: { outlet: string; subject: string; question: string; incidentId?: string | undefined },
): Promise<{ id: string }> {
  requireWriter(actor, jurisdictionId);
  const [row] = await sql`
    insert into media_inquiries
      (jurisdiction_id, incident_id, outlet, subject, question, created_by)
    values
      (${jurisdictionId}, ${input.incidentId ?? null}, ${input.outlet}, ${input.subject},
       ${input.question}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "jic.inquiry_logged",
    subjectTable: "media_inquiries",
    subjectId: id,
    payload: { outlet: input.outlet },
  });
  return { id };
}

export async function assignInquiry(
  sql: Sql,
  actor: Principal,
  inquiryId: string,
  positionId: string,
): Promise<void> {
  const [inq] = await sql`select jurisdiction_id from media_inquiries where id = ${inquiryId}`;
  if (!inq) throw new AuthError(404, "inquiry not found");
  requireWriter(actor, inq.jurisdiction_id as string);
  await sql`
    update media_inquiries set assigned_position = ${positionId}, status = 'assigned'
    where id = ${inquiryId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: inq.jurisdiction_id as string,
    category: "jic.inquiry_assigned",
    subjectTable: "media_inquiries",
    subjectId: inquiryId,
  });
}

/** Answer an inquiry with a reference to approved language. */
export async function answerInquiry(
  sql: Sql,
  actor: Principal,
  inquiryId: string,
  responseReleaseId: string,
): Promise<void> {
  const [inq] = await sql`
    select jurisdiction_id from media_inquiries where id = ${inquiryId}`;
  if (!inq) throw new AuthError(404, "inquiry not found");
  requireWriter(actor, inq.jurisdiction_id as string);
  const [rel] = await sql`
    select jurisdiction_id, status from press_releases where id = ${responseReleaseId}`;
  if (!rel) throw new AuthError(404, "response release not found");
  if ((rel.jurisdiction_id as string) !== (inq.jurisdiction_id as string))
    throw new AuthError(403, "response release belongs to another jurisdiction");
  if (rel.status !== "approved" && rel.status !== "published")
    throw new AuthError(409, "a response must cite approved language");
  await sql`
    update media_inquiries
    set response_release_id = ${responseReleaseId}, status = 'answered',
        answered_by = ${actor.person.id}, answered_at = now()
    where id = ${inquiryId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: inq.jurisdiction_id as string,
    category: "jic.inquiry_answered",
    subjectTable: "media_inquiries",
    subjectId: inquiryId,
    payload: { responseReleaseId },
  });
}

export async function listPublicFeed(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<Array<{ id: string; title: string; body: string; publishedAt: string }>> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select id, title, body, published_at from public_messages
    where jurisdiction_id = ${jurisdictionId} order by published_at desc limit 100`;
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    body: r.body as string,
    publishedAt: (r.published_at as Date).toISOString(),
  }));
}

export interface ListFilter {
  readonly statuses?: readonly string[] | undefined;
  readonly incidentId?: string | undefined;
}

export interface ReleaseListItem {
  readonly id: string;
  readonly incidentId: string | null;
  readonly title: string;
  readonly body: string;
  readonly status: string;
  readonly requiredAgencies: string[];
  readonly decisions: Array<{ agency: string; decision: string; note: string | null; decidedAt: string }>;
  /** Whether the reader already recorded a decision; each person decides once per release. */
  readonly decidedByMe: boolean;
  readonly createdAt: string;
  readonly submittedAt: string | null;
}

/**
 * A jurisdiction's releases, newest first, with each approval chain so far.
 * With status "pending" it is the review queue a second approver works from.
 */
export async function listReleases(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  filter: ListFilter,
  page: PageRequest,
): Promise<Page<ReleaseListItem>> {
  requireMember(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select r.id, r.incident_id, r.title, r.body, r.status, r.required_agencies, r.created_at,
           r.submitted_at,
           coalesce((select json_agg(json_build_object('agency', a.agency, 'decision', a.decision,
                                                       'note', a.note, 'decidedAt', a.decided_at)
                                     order by a.decided_at)
                     from press_release_approvals a where a.release_id = r.id), '[]') as decisions,
           exists (select 1 from press_release_approvals a
                   where a.release_id = r.id and a.decided_by_person = ${actor.person.id}) as decided_by_me,
           to_char(r.created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from press_releases r
    where r.jurisdiction_id = ${jurisdictionId}
      ${filter.statuses ? sql`and r.status = any(${filter.statuses as string[]})` : sql``}
      ${filter.incidentId ? sql`and r.incident_id = ${filter.incidentId}` : sql``}
      ${after ? sql`and (r.created_at, r.id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by r.created_at desc, r.id desc limit ${limit + 1}`;
  const { items, nextCursor } = cutPage(rows, limit, (r) => [r.page_at as string, r.id as string]);
  return {
    items: items.map((r) => ({
      id: r.id as string,
      incidentId: (r.incident_id as string | null) ?? null,
      title: r.title as string,
      body: r.body as string,
      status: r.status as string,
      requiredAgencies: r.required_agencies as string[],
      decisions: r.decisions as ReleaseListItem["decisions"],
      decidedByMe: r.decided_by_me as boolean,
      createdAt: (r.created_at as Date).toISOString(),
      submittedAt: r.submitted_at ? (r.submitted_at as Date).toISOString() : null,
    })),
    nextCursor,
  };
}

export interface InquiryListItem {
  readonly id: string;
  readonly incidentId: string | null;
  readonly outlet: string;
  readonly subject: string;
  readonly question: string;
  readonly status: string;
  readonly assignedPositionId: string | null;
  readonly responseReleaseId: string | null;
  readonly createdAt: string;
  readonly answeredAt: string | null;
}

/** A jurisdiction's media inquiries, newest first. */
export async function listInquiries(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  filter: ListFilter,
  page: PageRequest,
): Promise<Page<InquiryListItem>> {
  requireMember(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select id, incident_id, outlet, subject, question, status, assigned_position,
           response_release_id, created_at, answered_at,
           to_char(created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from media_inquiries
    where jurisdiction_id = ${jurisdictionId}
      ${filter.statuses ? sql`and status = any(${filter.statuses as string[]})` : sql``}
      ${filter.incidentId ? sql`and incident_id = ${filter.incidentId}` : sql``}
      ${after ? sql`and (created_at, id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by created_at desc, id desc limit ${limit + 1}`;
  const { items, nextCursor } = cutPage(rows, limit, (r) => [r.page_at as string, r.id as string]);
  return {
    items: items.map((r) => ({
      id: r.id as string,
      incidentId: (r.incident_id as string | null) ?? null,
      outlet: r.outlet as string,
      subject: r.subject as string,
      question: r.question as string,
      status: r.status as string,
      assignedPositionId: (r.assigned_position as string | null) ?? null,
      responseReleaseId: (r.response_release_id as string | null) ?? null,
      createdAt: (r.created_at as Date).toISOString(),
      answeredAt: r.answered_at ? (r.answered_at as Date).toISOString() : null,
    })),
    nextCursor,
  };
}

interface ReleaseRow {
  jurisdiction_id: string;
  incident_id: string | null;
  title: string;
  body: string;
  status: string;
  required_agencies: string[];
}

async function loadRelease(sql: Sql, releaseId: string): Promise<ReleaseRow> {
  const [row] = (await sql`
    select jurisdiction_id, incident_id, title, body, status, required_agencies
    from press_releases
    where id = ${releaseId}`) as unknown as ReleaseRow[];
  if (!row) throw new AuthError(404, "release not found");
  return row;
}

async function recordDecision(
  sql: Sql,
  releaseId: string,
  agency: string,
  decision: "approve" | "reject",
  note: string | undefined,
  personId: string | null,
  peerName: string | null,
): Promise<void> {
  await sql`
    insert into press_release_approvals
      (release_id, agency, decision, note, decided_by_person, decided_by_peer)
    values (${releaseId}, ${agency}, ${decision}, ${note ?? null}, ${personId}, ${peerName})
    on conflict (release_id, agency) do nothing`;
}

/** A release is approved only when every required agency has approved. */
async function recomputeStatus(sql: Sql, releaseId: string): Promise<string> {
  const [rel] = await sql`
    select required_agencies, status from press_releases where id = ${releaseId}`;
  // A published release is settled; late decisions never downgrade it.
  if ((rel!.status as string) === "published") return "published";
  const required = (rel!.required_agencies as string[]) ?? [];
  const approvals = await sql`
    select agency, decision from press_release_approvals where release_id = ${releaseId}`;
  const byAgency = new Map(approvals.map((a) => [a.agency as string, a.decision as string]));
  let status: string;
  // Only required agencies can settle the chain. An invented name, or a
  // registered peer that is not on this release, must not veto or approve it.
  if (required.some((a) => byAgency.get(a) === "reject")) status = "rejected";
  else if (required.length > 0 && required.every((a) => byAgency.get(a) === "approve"))
    status = "approved";
  else status = "pending";
  const approvedAt = status === "approved" ? "now()" : null;
  if (approvedAt)
    await sql`update press_releases set status = ${status}, approved_at = now() where id = ${releaseId}`;
  else await sql`update press_releases set status = ${status} where id = ${releaseId}`;
  return status;
}

async function recordPublication(
  sql: Sql,
  releaseId: string,
  channel: string,
  ref: string | null,
): Promise<void> {
  await sql`
    insert into press_release_publications (release_id, channel, ref)
    values (${releaseId}, ${channel}, ${ref})`;
}
