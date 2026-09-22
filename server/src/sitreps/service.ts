import {
  COMMUNITY_LIFELINES,
  LIFELINE_STATUS,
  SitrepContentSchema,
  type BoardSummary,
  type LifelineCurrent,
  type SitrepContent,
  type SitrepRow,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { createRecord } from "../boards/service.js";
import { recordAudit } from "../audit/service.js";
import { listCurrentLifelineAssessments } from "../lifelines/service.js";
import { getIncidentAuthority } from "../incidents/participation.js";

/**
 * Situation reporting (VEOC-20, F8). Lifelines status entry remembers the
 * prior submission per lifeline (the Esri behavior worth keeping), so an
 * update edits one lifeline without retyping the rest. A sitrep composes
 * from current board state in one action and archives immutably; the
 * briefing view renders the frozen archive, never the live boards.
 */

const LIFELINE_STATUSES = new Set(LIFELINE_STATUS.values);

/** The jurisdiction's lifelines board, or null if none is instantiated. */
async function lifelinesBoard(sql: Sql, jurisdictionId: string): Promise<string | null> {
  const [row] = await sql`
    select id from boards
    where jurisdiction_id = ${jurisdictionId} and template_key = 'lifelines'
      and archived_at is null
    order by created_at limit 1`;
  return (row?.id as string | undefined) ?? null;
}

/**
 * Current condition per lifeline: the newest entry wins, and every one of
 * the eight lifelines appears (unknown when never entered) so the entry
 * form is always the full doctrine set, pre-filled.
 */
export async function currentLifelines(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<LifelineCurrent[]> {
  requireMember(actor, jurisdictionId);
  const boardId = await lifelinesBoard(sql, jurisdictionId);
  const latest = new Map<string, { status: string; note: string | null; at: string }>();
  if (boardId) {
    const rows = await sql`
      select g, v, note, at from (
        select data ->> 'lifeline' as g,
               data ->> 'status' as v,
               data ->> 'note' as note,
               coalesce(updated_at, created_at) as at,
               row_number() over (
                 partition by data ->> 'lifeline'
                 order by coalesce(updated_at, created_at) desc
               ) as rn
        from board_records
        where board_id = ${boardId} and data ? 'lifeline'
      ) t where rn = 1`;
    for (const r of rows) {
      latest.set(r.g as string, {
        status: r.v as string,
        note: (r.note as string | null) ?? null,
        at: new Date(r.at as string).toISOString(),
      });
    }
  }
  return COMMUNITY_LIFELINES.values.map((lifeline) => {
    const current = latest.get(lifeline);
    return {
      lifeline,
      status: current?.status ?? "unknown",
      note: current?.note ?? null,
      at: current?.at ?? null,
    } satisfies LifelineCurrent;
  });
}

/**
 * Set one lifeline's condition: a new entry on the lifelines board, which
 * leaves every other lifeline's prior submission exactly as it was. This
 * is the "edit one without retyping the rest" behavior.
 */
export async function setLifeline(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: { lifeline: string; status: string; note?: string | undefined },
): Promise<LifelineCurrent[]> {
  requireWriter(actor, jurisdictionId);
  if (!COMMUNITY_LIFELINES.values.includes(input.lifeline))
    throw new AuthError(400, "unknown lifeline");
  if (!LIFELINE_STATUSES.has(input.status)) throw new AuthError(400, "unknown lifeline status");
  const boardId = await lifelinesBoard(sql, jurisdictionId);
  if (!boardId) throw new AuthError(409, "jurisdiction has no lifelines board");
  await createRecord(sql, actor, boardId, {
    lifeline: input.lifeline,
    status: input.status,
    ...(input.note !== undefined ? { note: input.note } : {}),
  });
  return currentLifelines(sql, actor, jurisdictionId);
}

/**
 * Compose a sitrep from current board state in one action and archive it
 * immutably. The content is a snapshot: what the picture WAS at compose
 * time, frozen, so the briefing reads history, not the moving present.
 */
export async function composeSitrep(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: { period: string; incidentId?: string | undefined },
): Promise<SitrepRow> {
  requireWriter(actor, jurisdictionId);
  const composedAt = new Date().toISOString();
  if (input.incidentId) {
    const authority = await getIncidentAuthority(sql, actor, input.incidentId);
    if (authority.jurisdictionId !== jurisdictionId) throw new AuthError(400, "incident belongs to another jurisdiction");
  }
  const lifelines = input.incidentId
    ? (await listCurrentLifelineAssessments(sql, actor, input.incidentId)).map((state): LifelineCurrent => {
      const report = state.decision
        ? state.reports.find((candidate) => candidate.id === state.decision!.selectedAssessmentId)
        : state.condition === null ? undefined : state.reports[0];
      return {
        lifeline: state.lifeline,
        status: state.condition ?? "unknown",
        note: report && typeof report.payload.impactStatement === "string" ? report.payload.impactStatement : null,
        at: report?.assessedAt ?? null,
        conflict: state.conflict && !state.decision,
        ...(report ? { assessment: {
          id: report.id, person: report.attribution.personName,
          position: report.attribution.positionTitle, organization: report.attribution.homeOrganizationName,
          recordedAt: report.attribution.recordedAt, payload: report.payload,
        } } : {}),
      };
    })
    : await currentLifelines(sql, actor, jurisdictionId);
  const boards = await summarizeBoards(sql, jurisdictionId);
  const significantEvents = await recentSignificantEvents(sql, jurisdictionId);
  const rumorControl = await recentRumorControl(sql, jurisdictionId);
  const content: SitrepContent = SitrepContentSchema.parse({
    period: input.period,
    composedAt,
    lifelines,
    boards,
    significantEvents,
    rumorControl,
  });
  const [row] = await sql`
    insert into sitreps
      (jurisdiction_id, incident_id, period, content, composed_by, composed_by_position)
    values
      (${jurisdictionId}, ${input.incidentId ?? null}, ${input.period},
       ${sql.json(content as never)}, ${actor.person.id}, ${actor.position?.id ?? null})
    returning id, composed_at`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(input.incidentId !== undefined ? { incidentId: input.incidentId } : {}),
    category: "sitrep.composed",
    subjectTable: "sitreps",
    subjectId: id,
    payload: { period: input.period },
  });
  return {
    id,
    period: input.period,
    composedAt: new Date(row!.composed_at as string).toISOString(),
    composedBy: actor.person.displayName,
    content,
  };
}

async function summarizeBoards(sql: Sql, jurisdictionId: string): Promise<BoardSummary[]> {
  const boards = await sql`
    select id, template_key, title from boards
    where jurisdiction_id = ${jurisdictionId} and archived_at is null
    order by title`;
  const summaries: BoardSummary[] = [];
  for (const b of boards) {
    const rows = await sql`
      select coalesce(data ->> 'status', '') as status, count(*)::int as n
      from board_records where board_id = ${b.id as string}
      group by 1`;
    let total = 0;
    const byStatus: Record<string, number> = {};
    for (const r of rows) {
      const n = r.n as number;
      total += n;
      if (r.status) byStatus[r.status as string] = n;
    }
    summaries.push({
      key: b.template_key as string,
      title: b.title as string,
      records: total,
      byStatus,
    });
  }
  return summaries;
}

async function recentSignificantEvents(
  sql: Sql,
  jurisdictionId: string,
): Promise<SitrepContent["significantEvents"]> {
  const rows = await sql`
    select r.data from board_records r
    join boards b on b.id = r.board_id
    where b.jurisdiction_id = ${jurisdictionId} and b.template_key = 'significant_events'
      and b.archived_at is null
    order by coalesce(r.data ->> 'occurred_at', r.created_at::text) desc
    limit 20`;
  return rows.map((r) => {
    const data = r.data as Record<string, unknown>;
    return {
      occurredAt: String(data.occurred_at ?? ""),
      summary: String(data.summary ?? ""),
      severity: data.severity ? String(data.severity) : null,
    };
  });
}

/** Rumor-control entries from the JIC board, surfaced on the briefing view. */
async function recentRumorControl(
  sql: Sql,
  jurisdictionId: string,
): Promise<SitrepContent["rumorControl"]> {
  const rows = await sql`
    select r.data from board_records r
    join boards b on b.id = r.board_id
    where b.jurisdiction_id = ${jurisdictionId} and b.template_key = 'rumor_control'
      and b.archived_at is null
    order by r.created_at desc
    limit 20`;
  return rows.map((r) => {
    const data = r.data as Record<string, unknown>;
    return {
      rumor: String(data.rumor ?? ""),
      status: String(data.status ?? ""),
      response: data.response ? String(data.response) : null,
    };
  });
}

export async function listSitreps(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<Array<{ id: string; period: string; composedAt: string; composedBy: string }>> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select s.id, s.period, s.composed_at, p.display_name
    from sitreps s join persons p on p.id = s.composed_by
    where s.jurisdiction_id = ${jurisdictionId}
    order by s.composed_at desc`;
  return rows.map((r) => ({
    id: r.id as string,
    period: r.period as string,
    composedAt: new Date(r.composed_at as string).toISOString(),
    composedBy: r.display_name as string,
  }));
}

/** The briefing view's source: one archived sitrep, exactly as composed. */
export async function getSitrep(sql: Sql, actor: Principal, sitrepId: string): Promise<SitrepRow> {
  const [row] = await sql`
    select s.id, s.jurisdiction_id, s.period, s.content, s.composed_at, p.display_name
    from sitreps s join persons p on p.id = s.composed_by
    where s.id = ${sitrepId}`;
  if (!row) throw new AuthError(404, "sitrep not found");
  requireMember(actor, row.jurisdiction_id as string);
  return {
    id: row.id as string,
    period: row.period as string,
    composedAt: new Date(row.composed_at as string).toISOString(),
    composedBy: row.display_name as string,
    content: SitrepContentSchema.parse(row.content),
  };
}

function requireMember(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((x) => x.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
}

function requireWriter(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || (m.role !== "admin" && m.role !== "member"))
    throw new AuthError(403, "requires write access to this jurisdiction");
}
