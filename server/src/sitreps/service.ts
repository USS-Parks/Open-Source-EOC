import {
  COMMUNITY_LIFELINES,
  LIFELINE_STATUS,
  SitrepContentSchema,
  type BoardSummary,
  type EsfCurrentLine,
  type LifelineCurrent,
  type SitrepContent,
  type SitrepRow,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireMember, requireWriter, type Principal } from "../auth/service.js";
import {
  createRecord,
  getIncidentBoardReadShape,
  visibleFields,
} from "../boards/service.js";
import { recordAudit } from "../audit/service.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, type Page, type PageRequest } from "../db/cursor.js";
import { listCurrentLifelineAssessments } from "../lifelines/service.js";
import { getIncidentAuthority, lockIncidentMutation } from "../incidents/participation.js";
import { listCurrentEsfAssessments } from "../esf/service.js";

/**
 * Situation reporting (F8). Lifelines status entry remembers the
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
  const writerRole = requireWriter(actor, jurisdictionId);
  const composedAt = new Date().toISOString();
  let incident: { id: string; name: string } | null = null;
  let revision = 1;
  if (input.incidentId) {
    const authority = await getIncidentAuthority(sql, actor, input.incidentId);
    if (authority.jurisdictionId !== jurisdictionId) throw new AuthError(400, "incident belongs to another jurisdiction");
    await lockIncidentMutation(sql, input.incidentId);
    const [locked] = await sql`
      select id, name from incidents where id = ${input.incidentId}`;
    if (!locked) throw new AuthError(404, "incident not found");
    incident = { id: locked.id as string, name: locked.name as string };
    const [prior] = await sql`
      select count(*)::int as n from sitreps
      where incident_id = ${input.incidentId} and period = ${input.period}`;
    revision = Number(prior?.n ?? 0) + 1;
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
  const esfs = input.incidentId
    ? await currentEsfs(sql, actor, input.incidentId)
    : [];
  const scopedBoards = input.incidentId
    ? await summarizeIncidentBoards(sql, actor, input.incidentId)
    : null;
  const boards = scopedBoards?.boards ?? await summarizeBoards(sql, jurisdictionId);
  const significantEvents = scopedBoards?.significantEvents ?? await recentSignificantEvents(sql, jurisdictionId);
  const rumorControl = scopedBoards?.rumorControl ?? await recentRumorControl(sql, jurisdictionId);
  const talkingPoints = scopedBoards?.talkingPoints ?? [];
  const sourceTime = latestSourceTime([
    ...lifelines.flatMap((line) => [line.at, line.assessment?.recordedAt]),
    ...esfs.flatMap((line) => [line.assessedAt, line.assessment?.recordedAt]),
    ...boards.map((board) => board.sourceTime),
    ...significantEvents.map((event) => event.occurredAt),
    ...rumorControl.map((rumor) => rumor.recordedAt),
    ...talkingPoints.map((point) => point.recordedAt),
  ]) ?? composedAt;
  const content: SitrepContent = SitrepContentSchema.parse({
    period: input.period,
    composedAt,
    incident,
    revision,
    sourceTime,
    archiveReaderLevel: writerRole,
    lifelines,
    esfs,
    boards,
    significantEvents,
    rumorControl,
    talkingPoints,
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
    incidentId: incident?.id ?? null,
    incidentName: incident?.name ?? null,
    revision,
    sourceTime,
  };
}

async function currentEsfs(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<EsfCurrentLine[]> {
  const states = await listCurrentEsfAssessments(sql, actor, incidentId);
  return states.map((state) => {
    const report = state.decision
      ? state.reports.find((candidate) => candidate.id === state.decision!.selectedAssessmentId)
      : state.activation === null || state.capacity === null ? undefined : state.reports[0];
    return {
      framework: state.framework,
      esf: state.esf,
      activation: state.activation,
      capacity: state.capacity,
      situation: report && typeof report.payload.situation === "string"
        ? report.payload.situation : null,
      assessedAt: report?.assessedAt ?? null,
      conflict: state.conflict && !state.decision,
      ...(report ? { assessment: {
        id: report.id,
        person: report.attribution.personName,
        position: report.attribution.positionTitle,
        organization: report.attribution.homeOrganizationName,
        recordedAt: report.attribution.recordedAt,
        payload: report.payload,
      } } : {}),
    };
  });
}

interface IncidentBoardSnapshot {
  readonly boards: BoardSummary[];
  readonly significantEvents: SitrepContent["significantEvents"];
  readonly rumorControl: SitrepContent["rumorControl"];
  readonly talkingPoints: NonNullable<SitrepContent["talkingPoints"]>;
}

async function summarizeIncidentBoards(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<IncidentBoardSnapshot> {
  const boardRows = await sql`
    select b.id, b.template_key, b.title
    from incident_boards ib join boards b on b.id = ib.board_id
    where ib.incident_id = ${incidentId} and b.archived_at is null
    order by b.title`;
  const result: IncidentBoardSnapshot = {
    boards: [], significantEvents: [], rumorControl: [], talkingPoints: [],
  };
  for (const boardRow of boardRows) {
    const boardId = boardRow.id as string;
    const shape = await getIncidentBoardReadShape(sql, actor, incidentId, boardId);
    const readable = new Set(visibleFields(shape).map((field) => field.key));
    const records = await sql`
      select data, coalesce(updated_at, created_at) as source_time
      from board_records
      where board_id = ${boardId} and incident_id = ${incidentId}
      order by coalesce(updated_at, created_at) desc, id desc`;
    const sourceTime = records[0]
      ? new Date(records[0].source_time as string).toISOString() : null;
    const byStatus: Record<string, number> = {};
    if (readable.has("status")) {
      for (const row of records) {
        const status = String((row.data as Record<string, unknown>).status ?? "");
        if (status) byStatus[status] = (byStatus[status] ?? 0) + 1;
      }
    }
    result.boards.push({
      key: boardRow.template_key as string,
      title: boardRow.title as string,
      records: records.length,
      byStatus,
      sourceTime,
    });
    const templateKey = boardRow.template_key as string;
    for (const row of records) {
      const data = row.data as Record<string, unknown>;
      const recordedAt = new Date(row.source_time as string).toISOString();
      if (templateKey === "significant_events"
        && readable.has("summary") && readable.has("occurred_at")) {
        result.significantEvents.push({
          occurredAt: String(data.occurred_at ?? recordedAt),
          summary: String(data.summary ?? ""),
          severity: readable.has("severity") && data.severity ? String(data.severity) : null,
        });
      } else if (templateKey === "rumor_control"
        && readable.has("rumor") && readable.has("status")) {
        result.rumorControl.push({
          rumor: String(data.rumor ?? ""),
          status: String(data.status ?? ""),
          response: readable.has("response") && data.response ? String(data.response) : null,
          recordedAt,
        });
      } else if (templateKey === "talking_points"
        && readable.has("topic") && readable.has("point") && data.approved === true) {
        result.talkingPoints.push({
          topic: String(data.topic ?? ""),
          point: String(data.point ?? ""),
          recordedAt,
        });
      }
    }
  }
  result.significantEvents.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return result;
}

function latestSourceTime(values: readonly (string | null | undefined)[]): string | null {
  let latest: number | null = null;
  for (const value of values) {
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isFinite(time) && (latest === null || time > latest)) latest = time;
  }
  return latest === null ? null : new Date(latest).toISOString();
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
      sourceTime: null,
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
      recordedAt: null,
    };
  });
}

export async function listSitreps(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  incidentId: string | undefined,
  page: PageRequest,
): Promise<Page<{ id: string; period: string; composedAt: string; composedBy: string;
  incidentId: string | null; incidentName: string | null; revision: number; sourceTime: string }>> {
  requireMember(actor, jurisdictionId);
  if (incidentId) {
    const authority = await getIncidentAuthority(sql, actor, incidentId);
    if (authority.jurisdictionId !== jurisdictionId)
      throw new AuthError(400, "incident belongs to another jurisdiction");
  }
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select s.id, s.period, s.composed_at, s.incident_id, s.content,
      p.display_name, i.name as incident_name,
      to_char(s.composed_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from sitreps s join persons p on p.id = s.composed_by
    left join incidents i on i.id = s.incident_id
    where s.jurisdiction_id = ${jurisdictionId}
      ${incidentId ? sql`and s.incident_id = ${incidentId}` : sql``}
      ${after ? sql`and (s.composed_at, s.id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by s.composed_at desc, s.id desc limit ${limit + 1}`;
  const { items, nextCursor } = cutPage(rows, limit, (r) => [r.page_at as string, r.id as string]);
  return {
    items: items.map((r) => {
      const content = SitrepContentSchema.parse(r.content);
      const composedAt = new Date(r.composed_at as string).toISOString();
      return {
        id: r.id as string,
        period: r.period as string,
        composedAt,
        composedBy: r.display_name as string,
        incidentId: (r.incident_id as string | null) ?? null,
        incidentName: content.incident?.name ?? (r.incident_name as string | null) ?? null,
        revision: content.revision ?? 1,
        sourceTime: content.sourceTime ?? composedAt,
      };
    }),
    nextCursor,
  };
}

/** The briefing view's source: one archived sitrep, exactly as composed. */
export async function getSitrep(sql: Sql, actor: Principal, sitrepId: string): Promise<SitrepRow> {
  const [row] = await sql`
    select s.id, s.jurisdiction_id, s.incident_id, s.period, s.content, s.composed_at,
      p.display_name, i.name as incident_name
    from sitreps s join persons p on p.id = s.composed_by
    left join incidents i on i.id = s.incident_id
    where s.id = ${sitrepId}`;
  if (!row) throw new AuthError(404, "sitrep not found");
  requireMember(actor, row.jurisdiction_id as string);
  const content = SitrepContentSchema.parse(row.content);
  if (row.incident_id) {
    const authority = await getIncidentAuthority(sql, actor, row.incident_id as string);
    if (authority.jurisdictionId !== row.jurisdiction_id)
      throw new AuthError(404, "sitrep not found");
    const readerRole = actor.memberships.find(
      (membership) => membership.jurisdictionId === row.jurisdiction_id,
    )?.role;
    if ((content.archiveReaderLevel ?? "admin") === "admin" && readerRole !== "admin")
      throw new AuthError(403, "sitrep requires admin read access");
  }
  const composedAt = new Date(row.composed_at as string).toISOString();
  return {
    id: row.id as string,
    period: row.period as string,
    composedAt,
    composedBy: row.display_name as string,
    content,
    incidentId: (row.incident_id as string | null) ?? null,
    incidentName: content.incident?.name ?? (row.incident_name as string | null) ?? null,
    revision: content.revision ?? 1,
    sourceTime: content.sourceTime ?? composedAt,
  };
}
