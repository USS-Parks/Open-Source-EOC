import {
  RESOURCE_REQUEST_STATES,
  nextStates,
  type IncidentActivityEntry,
  type IncidentOverviewSummary,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireMember, type Principal } from "../auth/service.js";

/** Request states with no way out; every other state except a draft is open work. */
const FINISHED_REQUEST_STATES = RESOURCE_REQUEST_STATES.values.filter((state) => nextStates(state).length === 0);

function iso(value: unknown): string {
  return new Date(value as string).toISOString();
}

/**
 * The incident overview's counts for one operational period: open and urgent
 * requests, active shelters and their occupants, field reports and how many
 * are unverified, tasks due in the period, and participating organizations.
 * Every count runs under the reader's row-level security, so it counts only
 * what the reader may see. Without a revision the current period is used.
 */
export async function getIncidentSummary(
  sql: Sql,
  _actor: Principal,
  incidentId: string,
  periodRevision: number | null,
): Promise<IncidentOverviewSummary> {
  const [incident] = await sql`select id from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  const [period] = periodRevision === null
    ? await sql`
        select revision, period_label, period_starts_at, period_ends_at from incident_area_revisions
        where incident_id = ${incidentId} order by revision desc limit 1`
    : await sql`
        select revision, period_label, period_starts_at, period_ends_at from incident_area_revisions
        where incident_id = ${incidentId} and revision = ${periodRevision}`;
  if (periodRevision !== null && !period) throw new AuthError(404, "operational period not found");
  const hasPeriod = Boolean(period?.period_label);
  const [counts] = await sql`
    with records as (
      select b.template_key, r.data from incident_boards ib
      join boards b on b.id = ib.board_id
      join board_records r on r.board_id = ib.board_id
      where ib.incident_id = ${incidentId} and r.deleted_at is null and r.archived_at is null
        and b.template_key in ('shelters', 'field_reports')
    )
    select
      (select count(*)::int from resource_requests
        where incident_id = ${incidentId} and state <> 'draft'
          and state <> all(${FINISHED_REQUEST_STATES as string[]})) as open_requests,
      (select count(*)::int from resource_requests
        where incident_id = ${incidentId} and state <> 'draft' and priority = 'immediate'
          and state <> all(${FINISHED_REQUEST_STATES as string[]})) as urgent_requests,
      (select count(*)::int from records
        where template_key = 'shelters' and coalesce(data->>'status', '') <> 'closed'
          and coalesce(data->>'planned', 'false') <> 'true') as active_shelters,
      (select coalesce(sum((data->>'occupancy')::numeric), 0)::int from records
        where template_key = 'shelters' and coalesce(data->>'status', '') <> 'closed'
          and coalesce(data->>'planned', 'false') <> 'true'
          and jsonb_typeof(data->'occupancy') = 'number') as shelter_occupants,
      (select count(*)::int from records where template_key = 'field_reports') as field_reports,
      (select count(*)::int from records
        where template_key = 'field_reports' and coalesce(data->>'verified', 'false') <> 'true') as unverified_field_reports,
      (select count(*)::int from checklist_items
        where incident_id = ${incidentId} and status <> 'completed'
          and due_at >= ${hasPeriod ? period!.period_starts_at as string : null}::timestamptz
          and due_at < ${hasPeriod ? period!.period_ends_at as string : null}::timestamptz) as tasks_due,
      (select count(distinct organization_id)::int from incident_participants
        where incident_id = ${incidentId} and revoked_at is null and expires_at > now()) as organizations`;
  return {
    incidentId,
    period: hasPeriod ? {
      revision: Number(period!.revision),
      label: period!.period_label as string,
      startsAt: iso(period!.period_starts_at),
      endsAt: iso(period!.period_ends_at),
    } : null,
    openRequests: Number(counts!.open_requests),
    urgentRequests: Number(counts!.urgent_requests),
    activeShelters: Number(counts!.active_shelters),
    shelterOccupants: Number(counts!.shelter_occupants),
    fieldReports: Number(counts!.field_reports),
    unverifiedFieldReports: Number(counts!.unverified_field_reports),
    tasksDue: hasPeriod ? Number(counts!.tasks_due) : null,
    participatingOrganizations: Number(counts!.organizations),
  };
}

/** The record-event and request categories the overview's recent activity reads. */
const ACTIVITY_CATEGORIES = ["board.record.created", "board.record.updated", "rr.submitted", "message.sent"];

/**
 * The incident's recent operational activity, newest first: records written
 * to its boards and requests submitted, each with who wrote it, their
 * organization on this incident and, for a record, its current fields. It
 * reads the owning jurisdiction's record of events, so it is for that
 * jurisdiction's members, as the chronology is.
 */
export async function listIncidentActivity(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  limit: number,
): Promise<readonly IncidentActivityEntry[]> {
  const [incident] = await sql`select id, jurisdiction_id from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  requireMember(actor, incident.jurisdiction_id as string);
  const rows = await sql`
    select e.id, e.created_at, e.category, e.subject_table, e.subject_id, e.payload,
      p.display_name as person, pos.title as position_title,
      coalesce(participant_org.name, home.name) as organization,
      r.data as record, m.body as message_body, t.title as thread_title
    from audit_events e
    join persons p on p.id = e.person_id
    left join positions pos on pos.id = e.position_id
    left join lateral (
      select j.name from incident_participants ip join jurisdictions j on j.id = ip.organization_id
      where ip.incident_id = e.incident_id and ip.person_id = e.person_id
      order by ip.created_at desc limit 1
    ) participant_org on true
    left join jurisdictions home on home.id = e.jurisdiction_id
    left join board_records r on e.subject_table = 'board_records' and r.id = e.subject_id and r.deleted_at is null
    left join messages m on e.subject_table = 'messages' and m.id = e.subject_id
    left join threads t on t.id = m.thread_id
    where e.jurisdiction_id = ${incident.jurisdiction_id as string} and e.incident_id = ${incidentId}
      and e.category = any(${ACTIVITY_CATEGORIES}::text[])
    order by e.seq desc
    limit ${limit}`;
  return rows.map((row) => ({
    id: row.id as string,
    at: iso(row.created_at),
    category: row.category as string,
    subjectTable: (row.subject_table as string | null) ?? null,
    subjectId: (row.subject_id as string | null) ?? null,
    person: row.person as string,
    position: (row.position_title as string | null) ?? null,
    organization: (row.organization as string | null) ?? null,
    payload: row.payload as Record<string, unknown>,
    record: (row.record as Record<string, unknown> | null) ?? null,
    message: typeof row.message_body === "string"
      ? { body: row.message_body, thread: (row.thread_title as string | null) ?? "" }
      : null,
  }));
}
