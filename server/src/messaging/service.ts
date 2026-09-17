import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";

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
    members: readonly ThreadMemberInput[];
  },
): Promise<string> {
  requireMember(actor, input.jurisdictionId);
  if (input.members.length === 0) throw new AuthError(400, "a thread needs members");
  if (input.kind === "direct" && input.members.length !== 1)
    throw new AuthError(400, "a direct thread has exactly one member besides its creator");
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

export async function postMessage(
  sql: Sql,
  actor: Principal,
  threadId: string,
  body: string,
  clientMessageId?: string,
): Promise<{ id: string; deduplicated: boolean }> {
  const [thread] = await sql`
    select jurisdiction_id, incident_id from threads where id = ${threadId}`;
  if (!thread) throw new AuthError(404, "thread not found");
  if (clientMessageId) {
    const [existing] = await sql`
      select id from messages
      where thread_id = ${threadId} and sender_person = ${actor.person.id}
        and client_message_id = ${clientMessageId}`;
    if (existing) return { id: existing.id as string, deduplicated: true };
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
  readonly body: string;
  readonly at: string;
}

/**
 * Read a thread. RLS already gates participation; the retention window
 * additionally hides messages older than the jurisdiction's policy.
 */
export async function listMessages(
  sql: Sql,
  actor: Principal,
  threadId: string,
  afterSeq = 0,
): Promise<MessageRow[]> {
  const [thread] = await sql`select jurisdiction_id from threads where id = ${threadId}`;
  if (!thread) throw new AuthError(404, "thread not found");
  const rows = await sql`
    select m.id, m.seq, m.body, m.created_at, p.display_name as sender,
           pos.title as sender_position
    from messages m
    join persons p on p.id = m.sender_person
    left join positions pos on pos.id = m.sender_position
    where m.thread_id = ${threadId} and m.seq > ${afterSeq}
      and m.created_at > now() - make_interval(days => coalesce(
        (select message_retention_days from jurisdiction_settings
         where jurisdiction_id = ${thread.jurisdiction_id as string}), 36500))
    order by m.seq`;
  return rows.map((r) => ({
    id: r.id as string,
    seq: Number(r.seq),
    sender: r.sender as string,
    senderPosition: (r.sender_position as string | null) ?? null,
    body: r.body as string,
    at: new Date(r.created_at as string).toISOString(),
  }));
}

export async function listThreads(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<Array<{ id: string; kind: string; title: string; incidentId: string | null }>> {
  requireMemberOrGuest(actor, jurisdictionId);
  const rows = await sql`
    select id, kind, title, incident_id from threads
    where jurisdiction_id = ${jurisdictionId} and is_thread_participant(id)
    order by created_at desc`;
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    title: r.title as string,
    incidentId: (r.incident_id as string | null) ?? null,
  }));
}

/** Export a thread as ordered record lines (the incident-record view). */
export async function exportThread(
  sql: Sql,
  actor: Principal,
  threadId: string,
): Promise<string[]> {
  const messages = await listMessages(sql, actor, threadId);
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

function requireMember(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((m) => m.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
}

function requireMemberOrGuest(actor: Principal, jurisdictionId: string): void {
  const member = actor.memberships.some((m) => m.jurisdictionId === jurisdictionId);
  const guest = actor.guests.some(
    (g) => g.jurisdictionId === jurisdictionId && g.expiresAt.getTime() > Date.now(),
  );
  if (!member && !guest) throw new AuthError(403, "no access to this jurisdiction");
}

function requireAdmin(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
}
