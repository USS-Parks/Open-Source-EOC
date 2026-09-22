import type { Sql } from "../db/client.js";
import { AuthError, requireAdmin, requireMember, type Principal } from "../auth/service.js";
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
  readonly recipients: readonly ThreadRecipient[];
}

export async function listThreads(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<ThreadSummary[]> {
  requireMemberOrGuest(actor, jurisdictionId);
  const rows = await sql`
    select id, kind, title, incident_id from threads
    where jurisdiction_id = ${jurisdictionId} and is_thread_participant(id)
    order by created_at desc`;
  if (rows.length === 0) return [];
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
  return rows.map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    title: row.title as string,
    incidentId: (row.incident_id as string | null) ?? null,
    recipients: members.filter((member) => member.thread_id === row.id).map((member) => ({
      kind: member.member_kind as "person" | "position",
      id: member.recipient_id as string,
      label: member.recipient_label as string,
      currentHolders: member.current_holders as string[],
    })),
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

function requireMemberOrGuest(actor: Principal, jurisdictionId: string): void {
  const member = actor.memberships.some((m) => m.jurisdictionId === jurisdictionId);
  const guest = actor.guests.some(
    (g) => g.jurisdictionId === jurisdictionId && g.expiresAt.getTime() > Date.now(),
  );
  if (!member && !guest) throw new AuthError(403, "no access to this jurisdiction");
}
