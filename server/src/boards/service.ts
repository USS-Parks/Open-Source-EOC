import {
  applyView,
  BoardTemplateSchema,
  buildRecordSchema,
  deriveRecordValues,
  effectiveFields,
  geometryFieldKey,
  LocalFieldSchema,
  STANDARD_TEMPLATES,
  type BoardTemplate,
  type FieldDef,
  type FormLayout,
  type ViewDef,
} from "@openeoc/shared";
import { isDeepStrictEqual } from "node:util";
import { verifyPackage } from "./package.js";
import type { Sql } from "../db/client.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, decodeCursor, encodeCursor, type PageRequest } from "../db/cursor.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { getIncidentAuthority, lockIncidentMutation } from "../incidents/participation.js";

export type BoardRole = "admin" | "member" | "viewer" | "guest";

export interface EffectiveBoard {
  readonly id: string;
  readonly jurisdictionId: string;
  readonly title: string;
  readonly template: BoardTemplate;
  readonly fields: readonly FieldDef[];
  readonly role: BoardRole;
}

/** Ship the standard library into a fresh instance (idempotent). */
export async function ensureStandardTemplates(sql: Sql): Promise<void> {
  for (const template of STANDARD_TEMPLATES) {
    await sql`
      insert into board_templates (key, version, title, definition)
      values (${template.key}, ${template.version}, ${template.title}, ${sql.json(template)})
      on conflict (key, version) do nothing`;
  }
}

export async function registerTemplate(
  sql: Sql,
  actor: Principal,
  raw: unknown,
): Promise<{ key: string; version: number }> {
  if (!actor.isInstanceAdmin) throw new AuthError(403, "requires instance admin");
  const template = BoardTemplateSchema.parse(raw);
  const [latest] = await sql`
    select coalesce(max(version), 0)::int as version from board_templates where key = ${template.key}`;
  const expected = Number(latest!.version) + 1;
  if (template.version !== expected)
    throw new AuthError(409, `template version must be ${expected}`);
  await sql`
    insert into board_templates (key, version, title, definition)
    values (${template.key}, ${template.version}, ${template.title}, ${sql.json(template)})`;
  return { key: template.key, version: template.version };
}

export async function listTemplateVersions(
  sql: Sql,
  key: string,
): Promise<Array<{ key: string; version: number; title: string }>> {
  const rows = await sql`
    select key, version, title from board_templates where key = ${key} order by version`;
  return rows.map((row) => ({
    key: row.key as string,
    version: row.version as number,
    title: row.title as string,
  }));
}

export async function getTemplateVersion(
  sql: Sql,
  key: string,
  version: number,
): Promise<BoardTemplate> {
  const [row] = await sql`
    select definition from board_templates where key = ${key} and version = ${version}`;
  if (!row) throw new AuthError(404, "template version not found");
  return BoardTemplateSchema.parse(row.definition);
}

/** Import a signed regional package (instance admin; trusted keys only). */
export async function importTemplatePackage(
  sql: Sql,
  actor: Principal,
  raw: unknown,
  trustedKeys: readonly string[],
): Promise<number> {
  if (!actor.isInstanceAdmin) throw new AuthError(403, "requires instance admin");
  let templates: readonly BoardTemplate[];
  try {
    templates = verifyPackage(raw, trustedKeys);
  } catch (err) {
    throw new AuthError(400, err instanceof Error ? err.message : "invalid package");
  }
  let imported = 0;
  for (const template of templates) {
    const result = await sql`
      insert into board_templates (key, version, title, definition)
      values (${template.key}, ${template.version}, ${template.title}, ${sql.json(template)})
      on conflict (key, version) do nothing`;
    imported += result.count;
  }
  return imported;
}

export async function createBoard(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  templateKey: string,
  version?: number,
  title?: string,
): Promise<string> {
  requireRole(actor, jurisdictionId, "admin");
  const [template] = version
    ? await sql`select * from board_templates where key = ${templateKey} and version = ${version}`
    : await sql`
        select * from board_templates where key = ${templateKey}
        order by version desc limit 1`;
  if (!template) throw new AuthError(404, "template not found");
  const [row] = await sql`
    insert into boards (jurisdiction_id, template_key, template_version, title)
    values (${jurisdictionId}, ${template.key as string}, ${template.version as number},
            ${title ?? (template.title as string)})
    returning id`;
  return row!.id as string;
}

interface BoardShape {
  readonly id: string;
  readonly jurisdictionId: string;
  readonly title: string;
  readonly template: BoardTemplate;
  readonly fields: readonly FieldDef[];
}

/**
 * Load a board's shape under the caller's row-level security, without a
 * membership role. A caller with no read access (not a member, guest, or
 * participant of an incident the board serves) sees no row and gets a 404.
 */
async function loadBoardShape(sql: Sql, boardId: string): Promise<BoardShape> {
  const [board] = await sql`
    select b.id, b.jurisdiction_id, b.title, b.local_fields, t.definition
    from boards b join board_templates t
      on t.key = b.template_key and t.version = b.template_version
    where b.id = ${boardId} and b.archived_at is null`;
  if (!board) throw new AuthError(404, "board not found");
  const template = BoardTemplateSchema.parse(board.definition);
  const locals = (board.local_fields as FieldDef[]) ?? [];
  const { fields } = effectiveFields(template, locals);
  return {
    id: board.id as string,
    jurisdictionId: board.jurisdiction_id as string,
    title: board.title as string,
    template,
    fields,
  };
}

/**
 * Load the field-visible shape of a board attached to an incident. Incident
 * Local members retain their board role; named incident participants use the
 * established member field level. RLS and the explicit attachment check keep
 * the board bound to the requested incident.
 */
export async function getIncidentBoardReadShape(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  boardId: string,
): Promise<EffectiveBoard> {
  await getIncidentAuthority(sql, actor, incidentId);
  const [attached] = await sql`
    select 1 as ok from incident_boards
    where incident_id = ${incidentId} and board_id = ${boardId}`;
  if (!attached) throw new AuthError(400, "board is not part of this incident");
  const shape = await loadBoardShape(sql, boardId);
  const membership = actor.memberships.find((item) => item.jurisdictionId === shape.jurisdictionId);
  return { ...shape, role: membership ? membership.role as BoardRole : "member" };
}

export async function getBoardReadShape(
  sql: Sql,
  actor: Principal,
  boardId: string,
  incidentId?: string,
): Promise<{ board: EffectiveBoard; canContribute: boolean }> {
  if (!incidentId) {
    const board = await getEffectiveBoard(sql, actor, boardId);
    return { board, canContribute: board.role === "admin" || board.role === "member" };
  }
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  const board = await getIncidentBoardReadShape(sql, actor, incidentId, boardId);
  return { board, canContribute: authority.canContribute };
}

export async function getEffectiveBoard(
  sql: Sql,
  actor: Principal,
  boardId: string,
): Promise<EffectiveBoard> {
  const shape = await loadBoardShape(sql, boardId);
  const role = roleFor(actor, shape.jurisdictionId, boardId);
  if (!role) throw new AuthError(403, "no access to this board");
  return { ...shape, role };
}

export async function addLocalField(
  sql: Sql,
  actor: Principal,
  boardId: string,
  raw: unknown,
): Promise<void> {
  await lockBoardMutation(sql, boardId);
  const board = await getEffectiveBoard(sql, actor, boardId);
  requireRole(actor, board.jurisdictionId, "admin");
  const field = LocalFieldSchema.parse(raw);
  if (board.fields.some((f) => f.key === field.key))
    throw new AuthError(409, "field key already exists on this board");
  await sql`
    update boards
    set local_fields = local_fields || ${sql.json(field)}::jsonb
    where id = ${boardId}`;
}

/**
 * Template upgrade preserving customization (INV-5): records are untouched,
 * local x_ fields are kept, and locals that the new template now covers are
 * dropped in favor of the template (re-convergence).
 */
export async function upgradeBoard(
  sql: Sql,
  actor: Principal,
  boardId: string,
  toVersion: number,
): Promise<{ dropped: string[] }> {
  await lockBoardMutation(sql, boardId);
  const board = await getEffectiveBoard(sql, actor, boardId);
  requireRole(actor, board.jurisdictionId, "admin");
  if (toVersion <= board.template.version)
    throw new AuthError(409, "target template version must be newer than the board version");
  const [next] = await sql`
    select definition from board_templates
    where key = ${board.template.key} and version = ${toVersion}`;
  if (!next) throw new AuthError(404, "target template version not found");
  const nextTemplate = BoardTemplateSchema.parse(next.definition);
  const [current] = await sql`select local_fields from boards where id = ${boardId}`;
  const locals = (current!.local_fields as FieldDef[]) ?? [];
  const { fields, dropped } = effectiveFields(nextTemplate, locals);
  const keptLocals = fields.filter((f) => f.key.startsWith("x_"));
  const acceptedKeys = new Set(fields.filter((field) => !field.calculation).map((field) => field.key));
  const records = await sql`
    select id, data, incident_id from board_records where board_id = ${boardId} order by id`;
  const incompatible: Array<{ id: string; issues: string[] }> = [];
  const nextBoard: EffectiveBoard = { ...board, template: nextTemplate, fields };
  for (const row of records) {
    const data = row.data as Record<string, unknown>;
    const retained = Object.fromEntries(Object.entries(data).filter(([key]) => acceptedKeys.has(key)));
    const checked = buildRecordSchema(fields).safeParse(retained);
    if (!checked.success) {
      incompatible.push({
        id: row.id as string,
        issues: checked.error.issues.map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`),
      });
      continue;
    }
    try {
      await validateRecordReferences(
        sql,
        actor,
        nextBoard,
        checked.data,
        (row.incident_id as string | null) ?? undefined,
      );
    } catch (error) {
      incompatible.push({
        id: row.id as string,
        issues: [error instanceof Error ? error.message : "invalid record reference"],
      });
    }
  }
  if (incompatible.length)
    throw new AuthError(409, `template upgrade incompatible with records: ${JSON.stringify(incompatible)}`);
  await sql`
    update boards
    set template_version = ${toVersion}, local_fields = ${sql.json(keptLocals)}
    where id = ${boardId}`;
  return { dropped };
}

export interface RecordWriteResult {
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly previous?: Record<string, unknown> | undefined;
  readonly boardKey: string;
  readonly jurisdictionId: string;
  readonly changed: boolean;
}

export async function createRecord(
  sql: Sql,
  actor: Principal,
  boardId: string,
  data: Record<string, unknown>,
  incidentId?: string,
): Promise<RecordWriteResult> {
  let board: EffectiveBoard;
  if (incidentId) {
    // Incident contribution (VEOC-79B1): a contributor participant, or an
    // owner writer, adds a record to a board the incident uses. Source
    // ownership (the board's jurisdiction) is unchanged; the record is tagged
    // with the incident so it is shared to that incident and no other. A
    // participant acts as a non-admin writer, so admin-only fields stay closed.
    const authority = await getIncidentAuthority(sql, actor, incidentId);
    if (!authority.canContribute) throw new AuthError(403, "requires incident contributor");
    await lockIncidentMutation(sql, incidentId);
    await requireOpenIncident(sql, incidentId);
    await lockBoardMutation(sql, boardId);
    const [attached] = await sql`
      select 1 as ok from incident_boards
      where incident_id = ${incidentId} and board_id = ${boardId}`;
    if (!attached) throw new AuthError(400, "board is not part of this incident");
    board = await getIncidentBoardReadShape(sql, actor, incidentId, boardId);
  } else {
    await lockBoardMutation(sql, boardId);
    const effective = await getEffectiveBoard(sql, actor, boardId);
    requireWriter(effective.role);
    board = effective;
  }
  checkFieldWrites(board, Object.keys(data));
  const parsed = buildRecordSchema(board.fields).parse(data);
  await validateRecordReferences(sql, actor, board, parsed, incidentId);
  const [row] = await sql`
    insert into board_records
      (board_id, data, created_by, created_by_position, geom, incident_id)
    values (${boardId}, ${sql.json(parsed as never)}, ${actor.person.id},
            ${actor.position?.id ?? null}, ${geomExpr(sql, board.fields, parsed)},
            ${incidentId ?? null})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId: board.jurisdictionId,
    ...(incidentId ? { incidentId } : {}),
    category: "board.record.created",
    subjectTable: "board_records",
    subjectId: id,
    payload: { board: board.template.key, data: parsed },
  });
  return { id, data: parsed, boardKey: board.template.key,
    jurisdictionId: board.jurisdictionId, changed: true };
}

export async function updateRecord(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  patch: Record<string, unknown>,
  incidentId?: string,
): Promise<RecordWriteResult> {
  const [scope] = await sql`
    select incident_id from board_records where id = ${recordId} and board_id = ${boardId}
      and (${incidentId ?? null}::uuid is null or incident_id = ${incidentId ?? null})`;
  if (!scope) throw new AuthError(404, "record not found");
  const recordIncidentId = scope.incident_id as string | null;
  if (incidentId) {
    const authority = await getIncidentAuthority(sql, actor, incidentId);
    if (!authority.canContribute) throw new AuthError(403, "requires incident contributor");
  }
  if (recordIncidentId) {
    await lockIncidentMutation(sql, recordIncidentId);
    await requireOpenIncident(sql, recordIncidentId);
  }
  await lockBoardMutation(sql, boardId);
  let board: EffectiveBoard;
  if (incidentId) {
    board = await getIncidentBoardReadShape(sql, actor, incidentId, boardId);
  } else {
    board = await getEffectiveBoard(sql, actor, boardId);
    requireWriter(board.role);
  }
  checkFieldWrites(board, Object.keys(patch));
  const [existing] = await sql`
    select data, incident_id from board_records where id = ${recordId} and board_id = ${boardId}
      and (${incidentId ?? null}::uuid is null or incident_id = ${incidentId ?? null})`;
  if (!existing) throw new AuthError(404, "record not found");
  const previous = existing.data as Record<string, unknown>;
  const merged = { ...previous, ...patch };
  const accepted = new Set(board.fields.filter((field) => !field.calculation).map((field) => field.key));
  const rejectedKey = Object.keys(patch).find((key) => !accepted.has(key));
  if (rejectedKey) throw new AuthError(400, `unknown or computed field ${rejectedKey}`);
  const declared = Object.fromEntries(Object.entries(merged).filter(([key]) => accepted.has(key)));
  const parsed = buildRecordSchema(board.fields).parse(declared);
  const legacy = Object.fromEntries(Object.entries(previous).filter(([key]) => !accepted.has(key)));
  const persisted = { ...legacy, ...parsed };
  if ((existing.incident_id as string | null) !== recordIncidentId)
    throw new AuthError(409, "record incident scope changed during update");
  await validateRecordReferences(sql, actor, board, parsed, recordIncidentId ?? undefined);
  const actualPatch = Object.fromEntries(Object.keys(patch)
    .filter((key) => !isDeepStrictEqual(previous[key], persisted[key]))
    .map((key) => [key, persisted[key]]));
  if (Object.keys(actualPatch).length === 0) {
    return { id: recordId, data: persisted, previous, boardKey: board.template.key,
      jurisdictionId: board.jurisdictionId, changed: false };
  }
  await sql`
    update board_records
    set data = ${sql.json(persisted as never)}, updated_by = ${actor.person.id},
        updated_at = now(), geom = ${geomExpr(sql, board.fields, persisted)}
    where id = ${recordId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: board.jurisdictionId,
    ...(recordIncidentId ? { incidentId: recordIncidentId } : {}),
    category: "board.record.updated",
    subjectTable: "board_records",
    subjectId: recordId,
    payload: { board: board.template.key, patch: actualPatch },
  });
  return {
    id: recordId,
    data: persisted,
    previous,
    boardKey: board.template.key,
    jurisdictionId: board.jurisdictionId,
    changed: true,
  };
}

async function requireOpenIncident(sql: Sql, incidentId: string): Promise<void> {
  const [incident] = await sql`select closed_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  if (incident.closed_at) throw new AuthError(409, "incident is closed");
}

/** Read one record and its attributed history through the same field boundary
 * as its board view. Audit payloads expose changed field names, never raw data. */
export async function getBoardRecordDetail(
  sql: Sql, actor: Principal, boardId: string, recordId: string, incidentId?: string,
) {
  const shape = await getBoardReadShape(sql, actor, boardId, incidentId);
  const board = shape.board;
  const [row] = await sql`
    select r.*, creator.display_name as creator_name, creator_pos.title as creator_position,
           updater.display_name as updater_name
    from board_records r
    join persons creator on creator.id = r.created_by
    left join positions creator_pos on creator_pos.id = r.created_by_position
    left join persons updater on updater.id = r.updated_by
    where r.id = ${recordId} and r.board_id = ${boardId}
      and (${incidentId ?? null}::uuid is null or r.incident_id = ${incidentId ?? null})`;
  if (!row) throw new AuthError(404, "record not found in this view");
  const readable = new Set(visibleFields(board).map((field) => field.key));
  const values = deriveRecordValues(board.fields, row.data as Record<string, unknown>);
  const data = Object.fromEntries(Object.entries(values).filter(([key]) => readable.has(key)));
  const events = await sql`
    select e.id, e.created_at, e.category, e.payload, e.corrects, e.person_id,
           e.position_id, p.display_name, pos.title as position_title
    from audit_events e
    join persons p on p.id = e.person_id
    left join positions pos on pos.id = e.position_id
    where (e.subject_table = 'board_records' and e.subject_id = ${recordId})
       or e.corrects in (select original.id from audit_events original
          where original.subject_table = 'board_records' and original.subject_id = ${recordId})
    order by e.seq`;
  const history = events.map((event) => {
    const payload = event.payload as Record<string, unknown>;
    const changed = payload.patch ?? payload.data;
    const fields = changed && typeof changed === "object" && !Array.isArray(changed)
      ? Object.keys(changed).filter((key) => readable.has(key)) : [];
    return {
      id: event.id as string, at: new Date(event.created_at as string).toISOString(),
      category: event.category as string, corrects: event.corrects as string | null,
      actor: { personId: event.person_id as string, displayName: event.display_name as string,
        positionId: event.position_id as string | null, positionTitle: event.position_title as string | null },
      payload: { fields },
    };
  });
  const latestUpdate = [...history].reverse().find((event) =>
    event.category === "board.record.updated" && event.actor.personId === row.updated_by);
  return {
    id: row.id as string, incidentId: row.incident_id as string | null,
    data: { ...data, id: row.id as string },
    createdAt: new Date(row.created_at as string).toISOString(),
    createdBy: { personId: row.created_by as string, displayName: row.creator_name as string,
      positionId: row.created_by_position as string | null, positionTitle: row.creator_position as string | null },
    updatedAt: new Date((row.updated_at ?? row.created_at) as string).toISOString(),
    updatedBy: row.updated_by ? { personId: row.updated_by as string, displayName: row.updater_name as string,
      positionId: latestUpdate?.actor.positionId ?? null, positionTitle: latestUpdate?.actor.positionTitle ?? null } : null,
    canEdit: shape.canContribute,
    history,
  };
}

export interface ViewRecords {
  readonly view: string;
  readonly columns: readonly string[];
  readonly records: ReadonlyArray<Record<string, unknown> & { id: string }>;
  /** Opaque cursor for the next page; null on the last page. */
  readonly nextCursor: string | null;
}

/**
 * One page of a board view, newest first unless the view sorts. Filters and
 * the sort run in SQL over an index-ordered keyset, so the first page costs
 * the same on a board of 50 records or 50,000.
 */
export async function listViewRecords(
  sql: Sql,
  actor: Principal,
  boardId: string,
  viewKey: string,
  incidentId?: string,
  page: PageRequest = {},
): Promise<ViewRecords> {
  let board: EffectiveBoard;
  if (incidentId) {
    // Incident-scoped read (VEOC-79B2): an authorized participant, or a member,
    // views the records this incident holds on one of its boards. An authorized
    // participant reads at member field-level; row-level security still limits
    // them to the incident's readable records.
    await getIncidentAuthority(sql, actor, incidentId); // 404s if the actor cannot read the incident
    const [attached] = await sql`
      select 1 as ok from incident_boards
      where incident_id = ${incidentId} and board_id = ${boardId}`;
    if (!attached) throw new AuthError(400, "board is not part of this incident");
    board = { ...(await loadBoardShape(sql, boardId)), role: "member" };
  } else {
    board = await getEffectiveBoard(sql, actor, boardId);
  }
  const view = board.template.views.find((v) => v.key === viewKey);
  if (!view) throw new AuthError(404, "view not found");
  const readable = new Set(
    board.fields.filter((f) => canRead(board.role, f.read)).map((f) => f.key),
  );
  const calculated = new Set(board.fields.filter((f) => f.calculation).map((f) => f.key));
  // ponytail: a sort on a calculated field has no stored value to index, so
  // it orders within each page only; add a SQL expression if a template needs it.
  const sort = view.sort && readable.has(view.sort.field) && !calculated.has(view.sort.field)
    ? view.sort : null;
  const after = decodeCursor(page.cursor, ["key", "at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const sortKey = () => (sort ? sql`coalesce(data ->> ${sort.field}, '')` : sql`''`);
  const keyset = !after ? sql``
    : !sort ? sql`and (created_at, id) < (${after[1]!}::text::timestamptz, ${after[2]!}::uuid)`
      : sort.dir === "desc"
        ? sql`and (${sortKey()}, created_at, id) < (${after[0]!}, ${after[1]!}::text::timestamptz, ${after[2]!}::uuid)`
        : sql`and (${sortKey()} > ${after[0]!} or (${sortKey()} = ${after[0]!}
            and (created_at, id) < (${after[1]!}::text::timestamptz, ${after[2]!}::uuid)))`;
  const order = !sort ? sql`created_at desc, id desc`
    : sort.dir === "desc" ? sql`${sortKey()} desc, created_at desc, id desc`
      : sql`${sortKey()} asc, created_at desc, id desc`;
  const filters = view.filter.reduce(
    (clauses, filter) => sql`${clauses} ${viewFilterSql(sql, filter, readable, calculated)}`, sql``);
  const rows = await sql`
    select id, data, ${sortKey()} as page_key,
           to_char(created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from board_records
    where board_id = ${boardId}
      and (${incidentId ?? null}::uuid is null or incident_id = ${incidentId ?? null})
      ${filters} ${keyset}
    order by ${order}
    limit ${limit + 1}`;
  const pageRows = rows.slice(0, limit);
  const last = rows.length > limit ? pageRows.at(-1)! : null;
  const masked = pageRows.map((r) => {
    const data = deriveRecordValues(board.fields, r.data as Record<string, unknown>);
    const out: Record<string, unknown> & { id: string } = { id: r.id as string };
    for (const key of Object.keys(data)) if (readable.has(key)) out[key] = data[key];
    return out;
  });
  // One view semantics for server and browser (shared applyView): the SQL
  // above may admit extra rows, never fewer, and applyView has the last word.
  const records = applyView(view, masked);
  const columns = view.columns.filter((c) => readable.has(c));
  return {
    view: view.key,
    columns,
    records,
    nextCursor: last
      ? encodeCursor([last.page_key as string, last.page_at as string, last.id as string])
      : null,
  };
}

/**
 * One view filter as a SQL predicate. An unreadable field is masked before
 * applyView sees it, so it reads as absent here too. A calculated field has no
 * stored value; applyView alone decides it, which can leave a page short.
 * ponytail: `in` compares the stored value's text form, which differs from
 * applyView's String() only for objects and exotic numbers such as 1e21.
 */
function viewFilterSql(
  sql: Sql,
  filter: ViewDef["filter"][number],
  readable: ReadonlySet<string>,
  calculated: ReadonlySet<string>,
): never {
  const { field, op, value } = filter;
  const values = Array.isArray(value) ? value : null;
  if (calculated.has(field)) return sql`` as never;
  if (!readable.has(field)) {
    const keepsAbsent = op === "neq" || (op === "in" && Boolean(values?.includes("undefined")));
    return (keepsAbsent ? sql`` : sql`and false`) as never;
  }
  if (op === "eq") return (values ? sql`and false` : sql`and data -> ${field} = ${sql.json(value as never)}`) as never;
  if (op === "neq")
    return (values ? sql`` : sql`and data -> ${field} is distinct from ${sql.json(value as never)}`) as never;
  return (values?.length ? sql`and data ->> ${field} in ${sql(values)}` : sql`and false`) as never;
}

export interface BoardListItem {
  readonly id: string;
  readonly title: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  /** Whether the board carries a geometry field (so it appears on the COP). */
  readonly hasGeometry: boolean;
}

/**
 * The active boards in a jurisdiction the caller belongs to. Discovery for
 * the app shell's navigation: any membership role may list (viewers included),
 * and RLS is the second wall. `hasGeometry` mirrors the OGC collections rule
 * so the client can mark which boards also render as a COP layer.
 */
export async function listBoards(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<BoardListItem[]> {
  if (!actor.memberships.some((m) => m.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
  const rows = await sql`
    select b.id, b.title, b.template_key, b.template_version, b.local_fields, t.definition
    from boards b join board_templates t
      on t.key = b.template_key and t.version = b.template_version
    where b.jurisdiction_id = ${jurisdictionId} and b.archived_at is null
    order by b.title`;
  return rows.map((r) => {
    const template = BoardTemplateSchema.parse(r.definition);
    const locals = (r.local_fields as FieldDef[]) ?? [];
    const { fields } = effectiveFields(template, locals);
    return {
      id: r.id as string,
      title: r.title as string,
      templateKey: r.template_key as string,
      templateVersion: r.template_version as number,
      hasGeometry: geometryFieldKey(fields) !== null,
    };
  });
}

function roleFor(actor: Principal, jurisdictionId: string, boardId: string): BoardRole | null {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (m) return m.role as BoardRole;
  const guest = actor.guests.find(
    (g) =>
      g.jurisdictionId === jurisdictionId &&
      g.expiresAt.getTime() > Date.now() &&
      g.scopes.includes(`board:${boardId}:read`),
  );
  return guest ? "guest" : null;
}

function requireRole(actor: Principal, jurisdictionId: string, role: "admin"): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || m.role !== role) throw new AuthError(403, `requires jurisdiction ${role}`);
}

function requireWriter(role: BoardRole): void {
  if (role !== "admin" && role !== "member")
    throw new AuthError(403, "read-only access to this board");
}

function canRead(role: BoardRole, level: FieldDef["read"]): boolean {
  if (level === "any") return true;
  if (level === "member") return role === "member" || role === "admin";
  return role === "admin";
}

/** The field set as the acting role is allowed to see it. */
export function visibleFields(board: EffectiveBoard): FieldDef[] {
  return board.fields.filter((f) => canRead(board.role, f.read));
}

/** Remove unreadable field references from authoring layouts returned to a reader. */
export function visibleLayout(board: EffectiveBoard, layout: FormLayout | undefined): FormLayout | undefined {
  if (!layout) return undefined;
  const readable = new Set(visibleFields(board).map((field) => field.key));
  const sections = layout.sections
    .map((section) => ({ ...section, fields: section.fields.filter((key) => readable.has(key)) }))
    .filter((section) => section.fields.length > 0);
  return sections.length ? { sections } : undefined;
}

/** Project view metadata through the same readable-field boundary as rows. */
export function visibleViews(board: EffectiveBoard): ViewDef[] {
  const readable = new Set(visibleFields(board).map((field) => field.key));
  return board.template.views.flatMap((view) => {
    const columns = view.columns.filter((key) => readable.has(key));
    if (columns.length === 0) return [];
    const filter = view.filter.filter((item) => readable.has(item.field));
    const { sort, ...metadata } = view;
    const visibleSort = sort && readable.has(sort.field) ? sort : undefined;
    return [{ ...metadata, columns, filter, ...(visibleSort ? { sort: visibleSort } : {}) }];
  });
}

export interface RecordReferenceOption {
  readonly id: string;
  readonly label: string;
  readonly boardId: string;
}

/** Incident-scoped, stable reference choices for a declared record_ref field. */
export async function listRecordReferenceOptions(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  sourceBoardId: string,
  fieldKey: string,
  after?: string,
  limit = 50,
): Promise<RecordReferenceOption[]> {
  const source = await getIncidentBoardReadShape(sql, actor, incidentId, sourceBoardId);
  const field = source.fields.find((candidate) => candidate.key === fieldKey && candidate.type === "record_ref");
  if (!field || !canRead(source.role, field.read)) throw new AuthError(404, "reference field not found");
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const options: RecordReferenceOption[] = [];
  let cursor = after;
  while (options.length < boundedLimit) {
    const rows = await sql`
      select r.id, r.board_id, r.data
      from board_records r
      join boards b on b.id = r.board_id
      join incident_boards ib on ib.board_id = b.id and ib.incident_id = ${incidentId}
      where r.incident_id = ${incidentId}
        and b.template_key = ${field.targetBoardKey!}
        and (${cursor ?? null}::uuid is null or r.id > ${cursor ?? null})
      order by r.id
      limit 100`;
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.id as string;
      const target = await getIncidentBoardReadShape(sql, actor, incidentId, row.board_id as string);
      const label = target.fields.find((candidate) => candidate.key === field.labelField);
      if (!label || !canRead(target.role, label.read)) continue;
      const derived = deriveRecordValues(target.fields, row.data as Record<string, unknown>);
      const value = derived[label.key];
      if (typeof value === "string" || typeof value === "number")
        options.push({ id: row.id as string, label: String(value), boardId: row.board_id as string });
      if (options.length === boundedLimit) break;
    }
    if (rows.length < 100) break;
  }
  return options;
}

export async function validateRecordReferences(
  sql: Sql,
  actor: Principal,
  board: EffectiveBoard,
  data: Readonly<Record<string, unknown>>,
  incidentId?: string,
): Promise<void> {
  const populated = board.fields.filter((field) => field.type === "record_ref" && data[field.key] !== undefined);
  if (!populated.length) return;
  if (!incidentId) throw new AuthError(400, "record references require incident scope");
  await getIncidentAuthority(sql, actor, incidentId);
  for (const field of populated) {
    const [row] = await sql`
      select r.id, r.board_id
      from board_records r
      join boards b on b.id = r.board_id
      join incident_boards ib on ib.board_id = b.id and ib.incident_id = ${incidentId}
      where r.id = ${data[field.key] as string}
        and r.incident_id = ${incidentId}
        and b.template_key = ${field.targetBoardKey!}`;
    if (!row) throw new AuthError(400, `field ${field.key} references a record outside this incident`);
    const target = await getIncidentBoardReadShape(sql, actor, incidentId, row.board_id as string);
    const label = target.fields.find((candidate) => candidate.key === field.labelField);
    if (!label || !canRead(target.role, label.read))
      throw new AuthError(403, `field ${field.key} target label is not readable`);
  }
}

/** PostGIS expression fragment for a record's geometry field, or null. */
export function geomExpr(
  sql: Sql,
  fields: readonly FieldDef[],
  data: Record<string, unknown>,
): never {
  const key = geometryFieldKey(fields);
  const g = key ? data[key] : null;
  // A query fragment; typed as never so it slots into any template position.
  return (g ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(g)}), 4326)` : null) as never;
}

export function checkFieldWrites(board: EffectiveBoard, keys: readonly string[]): void {
  for (const key of keys) {
    const field = board.fields.find((f) => f.key === key);
    if (!field) continue; // unknown keys rejected by the record schema
    if (field.write === "admin" && board.role !== "admin")
      throw new AuthError(403, `field ${key} is admin-writable only`);
  }
}

/** Serialize all mutations whose validation depends on a board's effective shape. */
export async function lockBoardMutation(sql: Sql, boardId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${boardId}, 81001::bigint))`;
}
