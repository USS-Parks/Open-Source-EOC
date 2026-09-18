import type { Sql } from "../db/client.js";
import { AuthError, principalForPerson, type Principal } from "../auth/service.js";
import { hashToken } from "../auth/tokens.js";
import { withPerson } from "../db/context.js";
import { recordAudit } from "../audit/service.js";
import { authorAlert } from "../cap/service.js";
import { postAnnouncement } from "../collab/service.js";

/**
 * Joint Information Center (VEOC-33A, R4). Press releases route through a
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
  requireMember(actor, jurisdictionId);
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
  requireMember(actor, rel.jurisdiction_id);
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
  requireMember(actor, rel.jurisdiction_id);
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
    const [rel] = await tx`select jurisdiction_id from press_releases where id = ${releaseId}`;
    if (!rel) throw new AuthError(404, "release not found");
    if ((rel.jurisdiction_id as string) !== (peer.jurisdiction_id as string))
      throw new AuthError(403, "release belongs to another jurisdiction");
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
  readonly toCollab?: boolean;
  readonly capDraft?: unknown;
}

export async function publishRelease(
  sql: Sql,
  actor: Principal,
  releaseId: string,
  options: PublishOptions = {},
): Promise<{ status: string; channels: string[] }> {
  const rel = await loadRelease(sql, releaseId);
  requireMember(actor, rel.jurisdiction_id);
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

  if (options.toCollab && rel.incident_id) {
    try {
      await postAnnouncement(sql, actor, rel.incident_id, null, `${rel.title}\n\n${rel.body}`);
      await recordPublication(sql, releaseId, "collab", null);
      channels.push("collab");
    } catch {
      // Collaboration is a best-effort outlet; publication does not fail on it.
    }
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

export async function logInquiry(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: { outlet: string; subject: string; question: string; incidentId?: string | undefined },
): Promise<{ id: string }> {
  requireMember(actor, jurisdictionId);
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
  requireMember(actor, inq.jurisdiction_id as string);
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
  requireMember(actor, inq.jurisdiction_id as string);
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

interface ReleaseRow {
  jurisdiction_id: string;
  incident_id: string | null;
  title: string;
  body: string;
  status: string;
}

async function loadRelease(sql: Sql, releaseId: string): Promise<ReleaseRow> {
  const [row] = (await sql`
    select jurisdiction_id, incident_id, title, body, status from press_releases
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
  if ([...byAgency.values()].includes("reject")) status = "rejected";
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

function requireMember(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((x) => x.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
}
