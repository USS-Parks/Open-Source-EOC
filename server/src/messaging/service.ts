import type { Sql } from "../db/client.js";
import { AuthError, requireAdmin, requireMember, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import {
  CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, readAllPages, type Page, type PageRequest,
} from "../db/cursor.js";

/**
 * Native messaging (R6, INV-3): direct and group threads with person and
 * position members, no external backend anywhere. Message traffic is
 * operational record; incident-thread traffic lands in the chronology
 * when the jurisdiction's records policy says so (the default).
 */

export interface ThreadMemberInput {
  readonly kind: "person" | "position";
  readonly id: string;
}

export async function createThread(
  sql: Sql,
  actor: Principal,
  input: {
    jurisdictionId: string;
    kind: "direct" | "group";
    title?: string | undefined;
    incidentId?: string | undefined;
    /** Members only (the default), or everyone who can read the incident. */
    audience?: "members" | "incident" | undefined;
    members: readonly ThreadMemberInput[];
  },
): Promise<string> {
  if (input.audience === "incident") return createIncidentThread(sql, input);
  requireMember(actor, input.jurisdictionId);
  if (input.members.length === 0) throw new AuthError(400, "a thread needs members");
  if (input.kind === "direct" && input.members.length !== 1)
    throw new AuthError(400, "a direct thread has exactly one member besides its creator");
  if (input.incidentId) {
    const [incident] = await sql`
      select id from incidents
      where id = ${input.incidentId} and jurisdiction_id = ${input.jurisdictionId}`;
    if (!incident) throw new AuthError(400, "incident not found in this jurisdiction");
  }
  await assertMembersInJurisdiction(sql, input.jurisdictionId, input.members);
  const [thread] = await sql`
    insert into threads (jurisdiction_id, kind, incident_id, title, created_by)
    values (${input.jurisdictionId}, ${input.kind}, ${input.incidentId ?? null},
            ${input.title ?? ""}, ${actor.person.id})
    returning id`;
  const threadId = thread!.id as string;
  const all: ThreadMemberInput[] = [{ kind: "person", id: actor.person.id }, ...input.members];
  for (const m of all) {
    await sql`
      insert into thread_members (thread_id, member_kind, person_id, position_id, added_by)
      values (${threadId}, ${m.kind}, ${m.kind === "person" ? m.id : null},
              ${m.kind === "position" ? m.id : null}, ${actor.person.id})`;
  }
  return threadId;
}

/**
 * An incident-wide thread belongs to the incident's owner and has no member
 * list: everyone who can read the incident reads it, and the owner's writers
 * and the incident's contributors and coordinators post and start one.
 */
async function createIncidentThread(
  sql: Sql,
  input: { jurisdictionId: string; kind: string; title?: string | undefined; incidentId?: string | undefined; members: readonly ThreadMemberInput[] },
): Promise<string> {
  if (!input.incidentId) throw new AuthError(400, "an incident-wide thread names its incident");
  if (input.kind !== "group" || input.members.length > 0)
    throw new AuthError(400, "an incident-wide thread is a group thread with no member list");
  const [incident] = await sql`select jurisdiction_id, closed_at from incidents where id = ${input.incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  if (incident.jurisdiction_id !== input.jurisdictionId)
    throw new AuthError(400, "incident not found in this jurisdiction");
  if (incident.closed_at) throw new AuthError(409, "incident is closed");
  const [row] = await sql`select public.create_incident_thread(${input.incidentId}, ${input.title ?? ""}) as id`;
  if (!row?.id) throw new AuthError(403, "requires incident contribution authority");
  return row.id as string;
}

export async function postMessage(
  sql: Sql,
  actor: Principal,
  threadId: string,
  body: string,
  clientMessageId?: string,
): Promise<{ id: string; deduplicated: boolean }> {
  const [thread] = await sql`
    select jurisdiction_id, incident_id, audience from threads where id = ${threadId}`;
  if (!thread) throw new AuthError(404, "thread not found");
  if (thread.audience === "incident") await requireIncidentWideAccess(sql, thread.incident_id as string, true);
  if (clientMessageId) {
    const [existing] = await sql`
      select id from messages
      where thread_id = ${threadId} and sender_person = ${actor.person.id}
        and client_message_id = ${clientMessageId}`;
    if (existing) return { id: existing.id as string, deduplicated: true };
  }
  if (thread.audience === "incident") {
    // The database function posts, and records message.sent in the owner's record.
    const [posted] = await sql`
      select public.post_incident_message(${threadId}, ${clientMessageId ?? null}, ${body},
        ${actor.position?.id ?? null}) as id`;
    if (!posted?.id) throw new AuthError(403, "requires incident contribution authority");
    return { id: posted.id as string, deduplicated: false };
  }
  const [row] = await sql`
    insert into messages (thread_id, client_message_id, sender_person, sender_position, body)
    values (${threadId}, ${clientMessageId ?? null}, ${actor.person.id},
            ${actor.position?.id ?? null}, ${body})
    returning id`;
  const id = row!.id as string;

  const incidentId = thread.incident_id as string | null;
  if (incidentId) {
    const [settings] = await sql`
      select messages_in_incident_record from jurisdiction_settings
      where jurisdiction_id = ${thread.jurisdiction_id as string}`;
    const inRecord = settings ? Boolean(settings.messages_in_incident_record) : true;
    if (inRecord) {
      await recordAudit(sql, actor, {
        jurisdictionId: thread.jurisdiction_id as string,
        incidentId,
        category: "message.sent",
        subjectTable: "messages",
        subjectId: id,
        payload: { thread: threadId, length: body.length },
      });
    }
  }
  return { id, deduplicated: false };
}

export interface MessageRow {
  readonly id: string;
  readonly seq: number;
  readonly sender: string;
  readonly senderPosition: string | null;
  /** The organization the sender wrote for: its incident grant's, else the thread owner's. */
  readonly senderOrganization: string;
  readonly body: string;
  readonly at: string;
}

/**
 * Read a thread in sequence order, from `after` or the page cursor. RLS
 * already gates participation; the retention window additionally hides
 * messages older than the jurisdiction's policy.
 */
export async function listMessages(
  sql: Sql,
  actor: Principal,
  threadId: string,
  page: PageRequest & { readonly after?: number | undefined },
): Promise<Page<MessageRow>> {
  const [thread] = await sql`select incident_id, audience from threads where id = ${threadId}`;
  if (!thread) throw new AuthError(404, "thread not found");
  if (thread.audience === "incident") await requireIncidentWideAccess(sql, thread.incident_id as string, false);
  const cursor = decodeCursor(page.cursor, ["seq"]);
  const afterSeq = cursor ? cursor[0]! : String(page.after ?? 0);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select m.id, m.seq, m.body, m.created_at, p.display_name as sender,
           pos.title as sender_position,
           coalesce(sender_grant.organization_name, home.name) as sender_organization
    from messages m
    join threads t on t.id = m.thread_id
    join jurisdictions home on home.id = t.jurisdiction_id
    join persons p on p.id = m.sender_person
    left join positions pos on pos.id = m.sender_position
    left join lateral (
      select org.name as organization_name
      from incident_participants ip join jurisdictions org on org.id = ip.organization_id
      where ip.incident_id = t.incident_id and ip.person_id = m.sender_person and m.sender_position is null
      order by ip.created_at <= m.created_at desc, ip.created_at desc, ip.id desc limit 1) sender_grant on true
    where m.thread_id = ${threadId} and m.seq > ${afterSeq}::bigint
      -- A subquery, so the retention is looked up once and not for every message.
      and m.created_at > (select now() - make_interval(days => coalesce(public.thread_retention_days(${threadId}), 36500)))
    order by m.seq limit ${limit + 1}`;
  const { items, nextCursor } = cutPage(rows, limit, (r) => [String(r.seq)]);
  return {
    items: items.map((r) => ({
      id: r.id as string,
      seq: Number(r.seq),
      sender: r.sender as string,
      senderPosition: (r.sender_position as string | null) ?? null,
      senderOrganization: r.sender_organization as string,
      body: r.body as string,
      at: new Date(r.created_at as string).toISOString(),
    })),
    nextCursor,
  };
}

export interface ThreadRecipient {
  readonly kind: "person" | "position";
  readonly id: string;
  readonly label: string;
  readonly currentHolders: readonly string[];
}

export interface ThreadSummary {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly incidentId: string | null;
  /** Its members only, or everyone who can read its incident. */
  readonly audience: "members" | "incident";
  readonly recipients: readonly ThreadRecipient[];
}

export async function listThreads(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  page: PageRequest,
): Promise<Page<ThreadSummary>> {
  requireMemberOrGuest(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const fetched = await sql`
    select id, kind, title, incident_id, audience,
      to_char(created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from threads
    where jurisdiction_id = ${jurisdictionId}
      and (is_thread_participant(id) or (audience = 'incident' and can_read_incident(incident_id)))
      ${after ? sql`and (created_at, id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by created_at desc, id desc limit ${limit + 1}`;
  return summarizeThreads(sql, fetched, limit);
}

/**
 * An incident's threads for anyone who can read the incident: its
 * incident-wide threads and the member threads the reader is in.
 */
export async function listIncidentThreads(
  sql: Sql,
  incidentId: string,
  page: PageRequest,
): Promise<Page<ThreadSummary>> {
  const [access] = await sql`select public.can_read_incident(${incidentId}) as readable`;
  if (access?.readable !== true) throw new AuthError(404, "incident not found");
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const fetched = await sql`
    select id, kind, title, incident_id, audience,
      to_char(created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from threads
    where incident_id = ${incidentId} and (audience = 'incident' or is_thread_participant(id))
      ${after ? sql`and (created_at, id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by created_at desc, id desc limit ${limit + 1}`;
  return summarizeThreads(sql, fetched, limit);
}

async function summarizeThreads(
  sql: Sql,
  fetched: readonly Record<string, unknown>[],
  limit: number,
): Promise<Page<ThreadSummary>> {
  const { items: rows, nextCursor } = cutPage(fetched, limit, (row) => [row.page_at as string, row.id as string]);
  if (rows.length === 0) return { items: [], nextCursor };
  const threadIds = rows.map((row) => row.id as string);
  const members = await sql`
    select m.thread_id, m.member_kind,
           coalesce(m.person_id, m.position_id) as recipient_id,
           coalesce(person.display_name, position.title) as recipient_label,
           coalesce(holder.names, array[]::text[]) as current_holders
    from thread_members m
    left join persons person on m.member_kind = 'person' and person.id = m.person_id
    left join positions position on m.member_kind = 'position' and position.id = m.position_id
    left join lateral (
      select array_agg(p.display_name order by p.display_name) as names
      from position_assignments assignment
      join persons p on p.id = assignment.person_id
      where assignment.position_id = m.position_id and assignment.revoked_at is null
    ) holder on true
    where m.thread_id in ${sql(threadIds)} and m.removed_at is null
    order by m.added_at, m.id`;
  return {
    items: rows.map((row) => ({
      id: row.id as string,
      kind: row.kind as string,
      title: row.title as string,
      incidentId: (row.incident_id as string | null) ?? null,
      audience: row.audience as "members" | "incident",
      recipients: members.filter((member) => member.thread_id === row.id).map((member) => ({
        kind: member.member_kind as "person" | "position",
        id: member.recipient_id as string,
        label: member.recipient_label as string,
        currentHolders: member.current_holders as string[],
      })),
    })),
    nextCursor,
  };
}

/** Export a thread as ordered record lines (the incident-record view). */
export async function exportThread(
  sql: Sql,
  actor: Principal,
  threadId: string,
): Promise<string[]> {
  const messages = await readAllPages((page) => listMessages(sql, actor, threadId, page));
  return messages.map((m) => {
    const who = m.senderPosition ? `${m.sender} (${m.senderPosition})` : m.sender;
    return `${m.at} ${who}: ${m.body}`;
  });
}

export async function setMessagingSettings(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: { retentionDays?: number | null | undefined; inIncidentRecord?: boolean | undefined },
): Promise<void> {
  requireAdmin(actor, jurisdictionId);
  await sql`
    insert into jurisdiction_settings
      (jurisdiction_id, message_retention_days, messages_in_incident_record, updated_by)
    values (${jurisdictionId}, ${input.retentionDays ?? null},
            ${input.inIncidentRecord ?? true}, ${actor.person.id})
    on conflict (jurisdiction_id) do update set
      message_retention_days = ${input.retentionDays ?? null},
      messages_in_incident_record = ${input.inIncidentRecord ?? true},
      updated_by = ${actor.person.id},
      updated_at = now()`;
}

async function assertMembersInJurisdiction(
  sql: Sql,
  jurisdictionId: string,
  members: readonly ThreadMemberInput[],
): Promise<void> {
  for (const member of members) {
    if (member.kind === "person") {
      const [row] = await sql`
        select 1 from jurisdiction_memberships
        where person_id = ${member.id} and jurisdiction_id = ${jurisdictionId}
        union
        select 1 from guest_grants
        where person_id = ${member.id} and jurisdiction_id = ${jurisdictionId}
          and revoked_at is null and expires_at > now()`;
      if (!row) throw new AuthError(403, "member is not in this jurisdiction");
      continue;
    }
    const [row] = await sql`
      select 1 from positions
      where id = ${member.id} and jurisdiction_id = ${jurisdictionId}`;
    if (!row) throw new AuthError(403, "position is not in this jurisdiction");
  }
}

/**
 * An incident-wide thread is reached only while its incident can be read, so
 * a revoked partner that started one no longer finds it; posting also needs
 * the incident open.
 */
async function requireIncidentWideAccess(sql: Sql, incidentId: string, posting: boolean): Promise<void> {
  const [incident] = await sql`
    select public.can_read_incident(${incidentId}) as readable, closed_at from incidents where id = ${incidentId}`;
  if (incident?.readable !== true) throw new AuthError(404, "thread not found");
  if (posting && incident.closed_at) throw new AuthError(409, "incident is closed");
}

function requireMemberOrGuest(actor: Principal, jurisdictionId: string): void {
  const member = actor.memberships.some((m) => m.jurisdictionId === jurisdictionId);
  const guest = actor.guests.some(
    (g) => g.jurisdictionId === jurisdictionId && g.expiresAt.getTime() > Date.now(),
  );
  if (!member && !guest) throw new AuthError(403, "no access to this jurisdiction");
}
