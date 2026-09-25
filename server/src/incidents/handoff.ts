import { requestStage, type HandoffChange, type ShiftHandoff } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { getIncidentAuthority } from "./participation.js";

/** The changes a handoff reports: records, requests, tasks and the incident's own shape and membership. */
const MATERIAL_CATEGORIES = [
  "board.record.created", "board.record.updated",
  "rr.submitted", "rr.transition", "rr.escalated", "rr.peer_report",
  "checklist.task.created", "checklist.task.updated", "checklist.completed",
  "incident.area.revised", "incident.participant.granted", "incident.participant.revoked",
  "sitrep.composed", "jic.release_decided",
];

/** The fields that name a record, in the order a handoff line prefers them. */
const NAME_FIELDS = ["summary", "name", "title", "road", "item", "entry"];

function iso(value: unknown): string {
  return new Date(value as string).toISOString();
}

function recordName(data: Record<string, unknown> | null): string {
  for (const key of NAME_FIELDS) if (typeof data?.[key] === "string" && data[key]) return data[key] as string;
  return "a record";
}

function describe(row: Record<string, unknown>): Pick<HandoffChange, "summary" | "subject"> {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const request = row.request_number ? `REQ-${row.request_number} ${row.request_item as string}` : "a resource request";
  const task = row.task_number ? `TASK-${row.task_number} ${row.task_item as string}` : "a task";
  const record = `${recordName(row.record as Record<string, unknown> | null)} on ${(row.board_title as string | null) ?? "a board"}`;
  const subjectId = row.subject_id as string | null;
  switch (row.category) {
    case "board.record.created":
      return { summary: `Added ${record}`, subject: row.board_id && subjectId ? { kind: "record", boardId: row.board_id as string, id: subjectId } : { kind: "incident" } };
    case "board.record.updated": {
      const fields = Object.keys((payload.patch ?? {}) as Record<string, unknown>);
      return {
        summary: `Updated ${record}${fields.length ? ` (${fields.join(", ")})` : ""}`,
        subject: row.board_id && subjectId ? { kind: "record", boardId: row.board_id as string, id: subjectId } : { kind: "incident" },
      };
    }
    case "rr.submitted": return { summary: `Submitted ${request}`, subject: subjectId ? { kind: "request", id: subjectId } : { kind: "incident" } };
    case "rr.transition":
      return {
        summary: `${request}: ${requestStage(String(payload.from ?? ""))} → ${requestStage(String(payload.to ?? ""))}`,
        subject: subjectId ? { kind: "request", id: subjectId } : { kind: "incident" },
      };
    case "rr.escalated": return { summary: `Escalated ${request} to another tier`, subject: subjectId ? { kind: "request", id: subjectId } : { kind: "incident" } };
    case "rr.peer_report": return { summary: `Another tier reported on ${request}`, subject: subjectId ? { kind: "request", id: subjectId } : { kind: "incident" } };
    case "checklist.task.created": return { summary: `Added ${task}`, subject: subjectId ? { kind: "task", id: subjectId } : { kind: "incident" } };
    case "checklist.task.updated": return { summary: `Updated ${task}`, subject: subjectId ? { kind: "task", id: subjectId } : { kind: "incident" } };
    case "checklist.completed": return { summary: `Completed ${task}`, subject: subjectId ? { kind: "task", id: subjectId } : { kind: "incident" } };
    case "incident.area.revised": return { summary: "Revised the incident area or operational period", subject: { kind: "incident" } };
    case "incident.participant.granted": return { summary: "Added a participating organization's person to the incident", subject: { kind: "incident" } };
    case "incident.participant.revoked": return { summary: "Ended a participant's access to the incident", subject: { kind: "incident" } };
    case "sitrep.composed": return { summary: "Composed a situation report", subject: { kind: "incident" } };
    case "jic.release_decided": return { summary: "Decided a public information release", subject: { kind: "incident" } };
    default: return { summary: String(row.category), subject: { kind: "incident" } };
  }
}

/**
 * A shift handoff for the reader. The reader's last shift ended at the later
 * of their last sign-out and their last position sign-out; with neither, the
 * current operational period's start stands in, and with no period, the
 * incident's activation. The changes since then come from the owning
 * organization's record of events, newest first, each naming its source
 * record.
 */
export async function getShiftHandoff(sql: Sql, actor: Principal, incidentId: string, limit = 100): Promise<ShiftHandoff> {
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  const [incident] = await sql`select id, jurisdiction_id, activated_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  const [period] = await sql`
    select period_label, period_starts_at, period_ends_at from incident_area_revisions
    where incident_id = ${incidentId} order by revision desc limit 1`;
  const [shift] = await sql`
    select
      (select max(ended_at) from auth_sessions where person_id = ${actor.person.id} and id <> ${actor.sessionId}) as signed_out,
      (select max(signed_out_at) from position_signins where person_id = ${actor.person.id}) as left_position`;
  const signedOut = shift?.signed_out ? new Date(shift.signed_out as string) : null;
  const leftPosition = shift?.left_position ? new Date(shift.left_position as string) : null;
  const periodStart = period?.period_label && period.period_starts_at ? new Date(period.period_starts_at as string) : null;
  const [since, basis]: [Date, ShiftHandoff["basis"]] = signedOut || leftPosition
    ? (leftPosition && (!signedOut || leftPosition > signedOut) ? [leftPosition, "position"] : [signedOut!, "sign-out"])
    : periodStart ? [periodStart, "period"] : [new Date(incident.activated_at as string), "activation"];
  const reported = period?.period_label
    ? { label: period.period_label as string, startsAt: iso(period.period_starts_at), endsAt: iso(period.period_ends_at) }
    : null;
  const owner = actor.memberships.some((membership) => membership.jurisdictionId === authority.jurisdictionId);
  if (!owner) return { since: since.toISOString(), basis, period: reported, changes: null, total: 0 };

  const rows = await sql`
    select e.id, e.created_at, e.category, e.subject_id, e.payload, count(*) over () as total,
      p.display_name as person, pos.title as position_title,
      coalesce(participant_org.name, home.name) as organization,
      r.data as record, r.board_id, b.title as board_title,
      rr.number as request_number, rr.item as request_item,
      c.number as task_number, c.item as task_item
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
    left join boards b on b.id = r.board_id
    left join resource_requests rr on e.subject_table = 'resource_requests' and rr.id = e.subject_id
    left join checklist_items c on e.subject_table = 'checklist_items' and c.id = e.subject_id
    where e.jurisdiction_id = ${incident.jurisdiction_id as string} and e.incident_id = ${incidentId}
      and e.created_at > ${since} and e.category = any(${MATERIAL_CATEGORIES}::text[])
      -- A sync write that changed no field is not a change.
      and not (e.category = 'board.record.updated' and e.payload -> 'patch' = '{}'::jsonb)
    order by e.seq desc
    limit ${limit}`;
  return {
    since: since.toISOString(),
    basis,
    period: reported,
    total: rows.length ? Number(rows[0]!.total) : 0,
    changes: rows.map((row) => ({
      id: row.id as string,
      at: iso(row.created_at),
      category: row.category as string,
      person: row.person as string,
      position: (row.position_title as string | null) ?? null,
      organization: (row.organization as string | null) ?? null,
      ...describe(row as Record<string, unknown>),
    })),
  };
}
