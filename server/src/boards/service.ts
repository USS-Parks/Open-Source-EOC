import {
  applyView,
  BoardTemplateSchema,
  buildRecordSchema,
  conditionHolds,
  deriveRecordValues,
  effectiveFields,
  geometryFieldKey,
  isConditionGroup,
  LocalFieldSchema,
  referenceLabelKeys,
  roleReadsEveryRecord,
  STANDARD_TEMPLATES,
  timeBounds,
  viewConditionSet,
  viewOrder,
  withConditions,
  type ActionWrite,
  type BoardActionRun,
  type BoardTemplate,
  type ConditionGroup,
  type ConditionItem,
  type FieldDef,
  type FormLayout,
  type ViewCondition,
  type ViewDef,
  type ViewSort,
} from "@openeoc/shared";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { verifyPackage } from "./package.js";
import { appendRecordWrite } from "./record-sync.js";
import type { Sql } from "../db/client.js";
import {
  CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, encodeCursor, type Page, type PageRequest,
} from "../db/cursor.js";
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

/**
 * The board a caller may add records to, locked for the write: a board
 * writer's own board, or a board an incident uses when the caller may
 * contribute to that incident.
 */
export async function writableBoard(
  sql: Sql,
  actor: Principal,
  boardId: string,
  incidentId?: string,
): Promise<EffectiveBoard> {
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
    return getIncidentBoardReadShape(sql, actor, incidentId, boardId);
  }
  await lockBoardMutation(sql, boardId);
  const effective = await getEffectiveBoard(sql, actor, boardId);
  requireWriter(effective.role);
  return effective;
}

/** Validate a new record against a board: field write levels, schema, references. */
export async function validateNewRecord(
  sql: Sql,
  actor: Principal,
  board: EffectiveBoard,
  data: Record<string, unknown>,
  incidentId?: string,
): Promise<Record<string, unknown>> {
  checkFieldWrites(board, Object.keys(data));
  const parsed = buildRecordSchema(board.fields).parse(data);
  await validateRecordReferences(sql, actor, board, parsed, incidentId);
  return parsed;
}

/**
 * Insert a validated record and its creation audit. The id is chosen here
 * rather than returned by the insert: a record-level read rule may leave the
 * creator unable to read what they wrote, and RETURNING would need that read.
 */
export async function insertRecord(
  sql: Sql,
  actor: Principal,
  board: EffectiveBoard,
  parsed: Record<string, unknown>,
  incidentId?: string,
  via?: "import",
  /** Where an imported record came from, kept on its creation event. */
  source?: Readonly<Record<string, string>>,
  /** The board action that wrote the record, named on its creation event (VC-17). */
  action?: ActionWrite,
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into board_records
      (id, board_id, data, created_by, created_by_position, geom, incident_id)
    values (${id}, ${board.id}, ${sql.json(parsed as never)}, ${actor.person.id},
            ${actor.position?.id ?? null}, ${geomExpr(sql, board.fields, parsed)},
            ${incidentId ?? null})`;
  await recordAudit(sql, actor, {
    jurisdictionId: board.jurisdictionId,
    ...(incidentId ? { incidentId } : {}),
    category: "board.record.created",
    subjectTable: "board_records",
    subjectId: id,
    payload: { board: board.template.key, data: parsed, ...(via ? { via } : {}), ...(source ? { source } : {}),
      ...(action ? { action } : {}) },
  });
  await appendRecordWrite(sql, board.id, id, incidentId ?? null, parsed, incidentFields(board));
  return id;
}

/** The fields an incident scope's sync documents project: those a member reads. */
function incidentFields(board: EffectiveBoard): ReadonlySet<string> {
  return new Set(visibleFields({ ...board, role: "member" }).map((field) => field.key));
}

export async function createRecord(
  sql: Sql,
  actor: Principal,
  boardId: string,
  data: Record<string, unknown>,
  incidentId?: string,
  action?: ActionWrite,
): Promise<RecordWriteResult> {
  const board = await writableBoard(sql, actor, boardId, incidentId);
  const parsed = await validateNewRecord(sql, actor, board, data, incidentId);
  const id = await insertRecord(sql, actor, board, parsed, incidentId, undefined, undefined, action);
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
  /** The board action making the edit, named on its audit entry (VC-17). */
  action?: ActionWrite,
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
    select data, incident_id, ${recordPermitted(sql, "edit")} as can_edit
    from board_records where id = ${recordId} and board_id = ${boardId}
      and (${incidentId ?? null}::uuid is null or incident_id = ${incidentId ?? null})`;
  if (!existing) throw new AuthError(404, "record not found");
  if (!existing.can_edit) throw new AuthError(403, "not permitted to edit this record");
  const previous = existing.data as Record<string, unknown>;
  const lockedRefusal = readOnlyRefusal(board, await stateReadOnlyFields(sql, board, recordId),
    Object.keys(patch).filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(patch[key])));
  if (lockedRefusal) throw new AuthError(409, lockedRefusal);
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
    payload: {
      board: board.template.key,
      patch: actualPatch,
      previous: Object.fromEntries(Object.keys(actualPatch).map((key) => [key, previous[key] ?? null])),
      ...(action ? { action } : {}),
    },
  });
  await appendRecordWrite(sql, boardId, recordId, recordIncidentId, actualPatch, incidentFields(board));
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
    select r.*, creator.display_name as creator_name,
           coalesce(creator_pos.title, creator_grant.incident_position_title) as creator_position,
           case when creator_pos.id is null then creator_grant.organization_name end as creator_organization,
           updater.display_name as updater_name,
           public.board_record_permitted(r.board_id, r.incident_id, r.created_by,
             r.created_by_position, r.id, 'edit') as can_edit
    from board_records r
    join persons creator on creator.id = r.created_by
    left join positions creator_pos on creator_pos.id = r.created_by_position
    -- A partner author is named by the incident grant it wrote under (the
    -- latest one granted before it wrote), kept after revocation.
    left join lateral (
      select ip.incident_position_title, org.name as organization_name
      from incident_participants ip join jurisdictions org on org.id = ip.organization_id
      where ip.incident_id = r.incident_id and ip.person_id = r.created_by
      order by ip.created_at <= r.created_at desc, ip.created_at desc, ip.id desc limit 1) creator_grant on true
    left join persons updater on updater.id = r.updated_by
    where r.id = ${recordId} and r.board_id = ${boardId}
      and (${incidentId ?? null}::uuid is null or r.incident_id = ${incidentId ?? null})`;
  if (!row) throw new AuthError(404, "record not found in this view");
  const readable = new Set(visibleFields(board).map((field) => field.key));
  const values = deriveRecordValues(board.fields, row.data as Record<string, unknown>);
  const data = Object.fromEntries(Object.entries(values).filter(([key]) => readable.has(key)));
  const events = await sql`
    select e.id, e.created_at, e.category, e.payload, e.corrects, e.person_id,
           e.position_id, p.display_name, coalesce(pos.title, actor_grant.incident_position_title) as position_title,
           case when pos.id is null then actor_grant.organization_name end as organization_name
    from audit_events e
    join persons p on p.id = e.person_id
    left join positions pos on pos.id = e.position_id
    left join lateral (
      select ip.incident_position_title, org.name as organization_name
      from incident_participants ip join jurisdictions org on org.id = ip.organization_id
      where ip.incident_id = ${row.incident_id as string | null} and ip.person_id = e.person_id
      order by ip.created_at <= e.created_at desc, ip.created_at desc, ip.id desc limit 1) actor_grant on true
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
        positionId: event.position_id as string | null, positionTitle: event.position_title as string | null,
        organizationName: (event.organization_name as string | null) ?? null },
      payload: { fields },
    };
  });
  const latestUpdate = [...history].reverse().find((event) =>
    event.category === "board.record.updated" && event.actor.personId === row.updated_by);
  const locked = await stateReadOnlyFields(sql, board, recordId);
  return {
    id: row.id as string, incidentId: row.incident_id as string | null,
    data: { ...data, id: row.id as string },
    createdAt: new Date(row.created_at as string).toISOString(),
    createdBy: { personId: row.created_by as string, displayName: row.creator_name as string,
      positionId: row.created_by_position as string | null, positionTitle: row.creator_position as string | null,
      organizationName: (row.creator_organization as string | null) ?? null },
    updatedAt: new Date((row.updated_at ?? row.created_at) as string).toISOString(),
    updatedBy: row.updated_by ? { personId: row.updated_by as string, displayName: row.updater_name as string,
      positionId: latestUpdate?.actor.positionId ?? null, positionTitle: latestUpdate?.actor.positionTitle ?? null,
      organizationName: latestUpdate?.actor.organizationName ?? null } : null,
    archivedAt: row.archived_at ? new Date(row.archived_at as string).toISOString() : null,
    canEdit: shape.canContribute && Boolean(row.can_edit),
    /** The fields the record's workflow state keeps from changing, and that state; none when nothing is locked. */
    readOnly: locked ? { state: locked.state, fields: [...locked.fields].filter((key) => readable.has(key)) } : null,
    history,
  };
}

/** The record-level rule for the current row of board_records, as a SQL expression. */
function recordPermitted(sql: Sql, action: "read" | "edit"): never {
  return sql`public.board_record_permitted(board_id, incident_id, created_by,
    created_by_position, id, ${action})` as never;
}

/**
 * Whether the caller reads every record on a board, so a shared document
 * holding all of them may be served to it. Mirrors the SQL rule from the
 * principal: an incident participant who is not a member reads as a member.
 */
export function readsEveryRecord(actor: Principal, board: EffectiveBoard, incidentScoped: boolean): boolean {
  const membership = actor.memberships.find((m) => m.jurisdictionId === board.jurisdictionId);
  const role = membership?.role ?? (incidentScoped ? "member" : "guest");
  return roleReadsEveryRecord(board.template.recordAccess, role);
}

/**
 * Archive or restore a record. Archive only hides it from default views; the
 * record, its history and every reference stay as they were. Board writers
 * whose record-level edit rule admits them may do it.
 */
export async function setRecordArchived(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  archived: boolean,
): Promise<{ archivedAt: string | null }> {
  await lockBoardMutation(sql, boardId);
  const board = await getEffectiveBoard(sql, actor, boardId);
  requireWriter(board.role);
  const [row] = await sql`
    select incident_id, archived_at, ${recordPermitted(sql, "edit")} as can_edit
    from board_records where id = ${recordId} and board_id = ${boardId}`;
  if (!row) throw new AuthError(404, "record not found");
  if (!row.can_edit) throw new AuthError(403, "not permitted to edit this record");
  if (Boolean(row.archived_at) === archived) {
    return { archivedAt: row.archived_at ? new Date(row.archived_at as string).toISOString() : null };
  }
  const [updated] = await sql`
    update board_records
    set archived_at = ${archived ? sql`now()` : null}, archived_by = ${archived ? actor.person.id : null}
    where id = ${recordId} and board_id = ${boardId}
    returning archived_at`;
  const incidentId = row.incident_id as string | null;
  await recordAudit(sql, actor, {
    jurisdictionId: board.jurisdictionId,
    ...(incidentId ? { incidentId } : {}),
    category: archived ? "board.record.archived" : "board.record.restored",
    subjectTable: "board_records",
    subjectId: recordId,
    payload: { board: board.template.key },
  });
  return { archivedAt: updated!.archived_at ? new Date(updated!.archived_at as string).toISOString() : null };
}

export interface DeletedRecord {
  readonly jurisdictionId: string;
  readonly boardKey: string;
  readonly incidentId: string | null;
  readonly previous: Record<string, unknown>;
}

/**
 * Delete a record: jurisdiction admins only. The row becomes a tombstone no
 * read path returns; the audit entry keeps the prior data, so the record's
 * history stays complete.
 */
export async function deleteRecord(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
): Promise<DeletedRecord> {
  await lockBoardMutation(sql, boardId);
  const board = await getEffectiveBoard(sql, actor, boardId);
  requireRole(actor, board.jurisdictionId, "admin");
  const [row] = await sql`
    select data, incident_id from board_records where id = ${recordId} and board_id = ${boardId}`;
  if (!row) throw new AuthError(404, "record not found");
  const [done] = await sql`select public.tombstone_board_record(${recordId}) as ok`;
  if (!done?.ok) throw new AuthError(409, "record could not be deleted");
  const incidentId = row.incident_id as string | null;
  const previous = row.data as Record<string, unknown>;
  await recordAudit(sql, actor, {
    jurisdictionId: board.jurisdictionId,
    ...(incidentId ? { incidentId } : {}),
    category: "board.record.deleted",
    subjectTable: "board_records",
    subjectId: recordId,
    payload: { board: board.template.key, previous },
  });
  return { jurisdictionId: board.jurisdictionId, boardKey: board.template.key, incidentId, previous };
}

export interface RecordHistoryEntry {
  readonly seq: number;
  readonly id: string;
  readonly at: string;
  readonly category: string;
  readonly corrects: string | null;
  readonly actor: {
    readonly personId: string; readonly displayName: string;
    readonly positionId: string | null; readonly positionTitle: string | null;
    readonly organizationName: string | null;
  };
  /** Fields this entry changed, each with its value before and after. */
  readonly changes: ReadonlyArray<{ readonly field: string; readonly before: unknown; readonly after: unknown }>;
  /** The board action that made this write, when one did (VC-17). */
  readonly action: { readonly key: string; readonly label: string } | null;
  /** A board action's run, for a `board.action.run` entry. */
  readonly run: BoardActionRun | null;
}

/**
 * A record's change history, oldest first, a page at a time: who, in which
 * position, when, and each readable field changed with its value before and
 * after. It reads the audit log, so it covers every path that writes a
 * record and outlives a delete; the audit policies apply the record's read
 * rule. An update recorded before this history existed carries no before
 * values, and those read as null.
 */
export async function listRecordHistory(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  incidentId?: string,
  page: PageRequest = {},
): Promise<Page<RecordHistoryEntry>> {
  const { board } = await getBoardReadShape(sql, actor, boardId, incidentId);
  const readable = new Set(visibleFields(board).map((field) => field.key));
  const after = decodeCursor(page.cursor, ["seq"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select e.seq, e.id, e.created_at, e.category, e.payload, e.corrects, e.person_id,
           e.position_id, p.display_name, coalesce(pos.title, actor_grant.incident_position_title) as position_title,
           case when pos.id is null then actor_grant.organization_name end as organization_name
    from audit_events e
    join persons p on p.id = e.person_id
    left join positions pos on pos.id = e.position_id
    left join lateral (
      select ip.incident_position_title, org.name as organization_name
      from incident_participants ip join jurisdictions org on org.id = ip.organization_id
      where ip.incident_id = e.incident_id and ip.person_id = e.person_id
      order by ip.created_at <= e.created_at desc, ip.created_at desc, ip.id desc limit 1) actor_grant on true
    where ((e.subject_table = 'board_records' and e.subject_id = ${recordId})
       or e.corrects in (select original.id from audit_events original
          where original.subject_table = 'board_records' and original.subject_id = ${recordId}))
      and (${incidentId ?? null}::uuid is null or e.incident_id = ${incidentId ?? null})
      and (${after?.[0] ?? null}::bigint is null or e.seq > ${after?.[0] ?? null}::bigint)
    order by e.seq
    limit ${limit + 1}`;
  if (!after && rows.length === 0) throw new AuthError(404, "record not found");
  const result = cutPage(rows, limit, (row) => [String(row.seq)]);
  return {
    nextCursor: result.nextCursor,
    items: result.items.map((row) => ({
      seq: Number(row.seq),
      id: row.id as string,
      at: new Date(row.created_at as string).toISOString(),
      category: row.category as string,
      corrects: row.corrects as string | null,
      actor: {
        personId: row.person_id as string, displayName: row.display_name as string,
        positionId: row.position_id as string | null, positionTitle: row.position_title as string | null,
        organizationName: (row.organization_name as string | null) ?? null,
      },
      changes: historyChanges(row.payload as Record<string, unknown>).filter((change) => readable.has(change.field)),
      ...(row.category === "board.action.run"
        ? { action: null, run: runOf(row.payload as BoardActionRun, readable) }
        : { action: actionOf(row.payload as Record<string, unknown>), run: null }),
    })),
  };
}

function actionOf(payload: Record<string, unknown>): RecordHistoryEntry["action"] {
  const action = payload.action as { key?: unknown; label?: unknown } | undefined;
  return typeof action?.key === "string" && typeof action.label === "string" ? { key: action.key, label: action.label } : null;
}

/** An action run as a reader sees it: a field they may not read is not named. */
function runOf(run: BoardActionRun, readable: ReadonlySet<string>): BoardActionRun {
  const field = run.trigger.field && readable.has(run.trigger.field) ? run.trigger.field : null;
  const { field: written, ...rest } = run.result ?? {};
  const result = run.result ? { ...rest, ...(written && readable.has(written) ? { field: written } : {}) } : null;
  return {
    action: run.action, trigger: { ...run.trigger, field }, step: run.step, outcome: run.outcome,
    reason: run.reason, chain: run.chain, depth: run.depth, result,
  };
}

/** Field changes carried in one audit payload: a creation's data, an update's patch, a delete's prior data. */
function historyChanges(payload: Record<string, unknown>): Array<{ field: string; before: unknown; after: unknown }> {
  const object = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const data = object(payload.data);
  const patch = object(payload.patch);
  const previous = object(payload.previous);
  if (data) return Object.entries(data).map(([field, after]) => ({ field, before: null, after }));
  if (patch) {
    return Object.entries(patch).map(([field, after]) => ({ field, before: previous?.[field] ?? null, after }));
  }
  if (previous) return Object.entries(previous).map(([field, before]) => ({ field, before, after: null }));
  return [];
}

export interface ViewRecords {
  readonly view: string;
  readonly columns: readonly string[];
  readonly records: ReadonlyArray<Record<string, unknown> & { id: string }>;
  /** Opaque cursor for the next page; null on the last page. */
  readonly nextCursor: string | null;
  /**
   * Record count per value of the group field over every matching record,
   * in group order. Returned with the first page of a grouped view only;
   * the rows themselves arrive ordered by the group field.
   */
  readonly groups?: ReadonlyArray<{ readonly value: unknown; readonly count: number }>;
}

/** Request-time refinements of a view, ANDed with or replacing its own. */
export interface ViewOptions extends PageRequest {
  /** Archived records: left out (the default), included, or the only ones listed. */
  readonly archived?: "exclude" | "include" | "only" | undefined;
  /** Conditions, and groups of them, that must hold as well as the view's own. */
  readonly where?: readonly ConditionItem[] | undefined;
  /** Sort keys replacing the view's own. */
  readonly sorts?: readonly ViewSort[] | undefined;
  /** Group field replacing the view's own. */
  readonly groupBy?: string | undefined;
}

/** Text form of a float8 sort key as Postgres prints it. */
const FLOAT_KEY = /^-?(Infinity|\d+(\.\d+)?(e[+-]\d+)?)$/;

/**
 * One page of a board view, newest first unless the view sorts. Filters and
 * the sort run in SQL over a keyset carrying every sort key, so the first
 * page costs the same on a board of 50 records or 50,000 and a walk returns
 * each matching record once. Row-level rules (record access, deletion) are
 * the database's; field visibility and archive are applied here.
 */
export async function listViewRecords(
  sql: Sql,
  actor: Principal,
  boardId: string,
  viewKey: string,
  incidentId?: string,
  options: ViewOptions = {},
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
  const declared = board.template.views.find((v) => v.key === viewKey);
  if (!declared) throw new AuthError(404, "view not found");
  const { sort, sorts, ...rest } = withConditions(declared, options.where ?? []);
  const view: ViewDef = {
    ...rest,
    ...(options.sorts ? { sorts: [...options.sorts] } : sorts ? { sorts } : sort ? { sort } : {}),
    ...(options.groupBy ? { groupBy: options.groupBy } : {}),
  };
  const fields = new Map(board.fields.map((f) => [f.key, f]));
  const readable = new Set(
    board.fields.filter((f) => canRead(board.role, f.read)).map((f) => f.key),
  );
  // ponytail: a calculated field has no stored value to sort by, so a sort on
  // one orders within each page only; add a SQL expression if a template needs it.
  const usable = (key: string) => readable.has(key) && fields.has(key) && !fields.get(key)!.calculation;
  const order = viewOrder(view);
  const keys = order.filter((s) => usable(s.field))
    .map((s) => ({ ...sortKeySql(sql, fields.get(s.field)!), dir: s.dir }));
  const now = new Date();
  const width = Math.max(keys.length, 1);
  const after = decodeCursor(options.cursor,
    [...Array.from({ length: width }, () => "key" as const), "at", "id"]);
  if (after && keys.some((key, i) => key.numeric && !FLOAT_KEY.test(after[i]!)))
    throw new AuthError(400, "invalid page cursor");
  const limit = options.limit ?? DEFAULT_PAGE_LIMIT;
  let keyset = sql``;
  if (after) {
    let clause = sql`(created_at, id) < (${after[width]!}::text::timestamptz, ${after[width + 1]!}::uuid)`;
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const key = keys[i]!;
      const value = key.numeric ? sql`${after[i]!}::float8` : sql`${after[i]!}`;
      clause = sql`(${key.expr} ${key.dir === "asc" ? sql`>` : sql`<`} ${value}
        or (${key.expr} = ${value} and ${clause}))`;
    }
    keyset = sql`and ${clause}`;
  }
  const archived = options.archived === "include" ? sql``
    : options.archived === "only" ? sql`and archived_at is not null` : sql`and archived_at is null`;
  const filters = sql`and ${conditionSetSql(sql, viewConditionSet(view), fields, readable, now)}`;
  const scope = sql`board_id = ${boardId}
      and (${incidentId ?? null}::uuid is null or incident_id = ${incidentId ?? null})
      ${archived} ${filters}`;
  const keyColumns = keys.reduce((cols, key, i) => sql`${cols}, (${key.expr})::text as ${sql(`k${i}`)}`, sql``);
  const orderBy = keys.reduce((clauses, key) =>
    sql`${clauses} ${key.expr} ${key.dir === "asc" ? sql`asc` : sql`desc`},`, sql``);
  const rows = await sql`
    select id, data, archived_at, created_at,
           (select p.display_name from persons p where p.id = board_records.created_by) as creator_name,
           to_char(created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at ${keyColumns}
    from board_records
    where ${scope} ${keyset}
    order by ${orderBy} created_at desc, id desc
    limit ${limit + 1}`;
  const pageRows = rows.slice(0, limit);
  const last = rows.length > limit ? pageRows.at(-1)! : null;
  const masked = pageRows.map((r) => {
    const data = deriveRecordValues(board.fields, r.data as Record<string, unknown>);
    const out: Record<string, unknown> & { id: string } = { id: r.id as string };
    for (const key of Object.keys(data)) if (readable.has(key)) out[key] = data[key];
    if (r.archived_at) out.archivedAt = new Date(r.archived_at as string).toISOString();
    // When and by whom, as the record's detail shows them to the same readers.
    out.createdAt = new Date(r.created_at as string).toISOString();
    if (r.creator_name) out.createdByName = r.creator_name as string;
    return out;
  });
  // One view semantics for server and browser (shared applyView): the SQL
  // above may admit extra rows, never fewer, and applyView has the last word.
  const records = applyView(view, masked, { fields: board.fields, now });
  const columns = view.columns.filter((c) => readable.has(c));
  let groups: ViewRecords["groups"];
  if (view.groupBy && usable(view.groupBy) && !options.cursor) {
    const key = sortKeySql(sql, fields.get(view.groupBy)!);
    const counted = await sql`
      select data -> ${view.groupBy} as value, count(*)::int as count
      from board_records where ${scope}
      group by 1
      order by min(${key.expr}) ${order[0]!.dir === "asc" ? sql`asc` : sql`desc`}`;
    groups = counted.map((row) => ({ value: row.value ?? null, count: row.count as number }));
  }
  return {
    view: view.key,
    columns,
    records,
    nextCursor: last
      ? encodeCursor([
          ...(keys.length ? keys.map((_, i) => last[`k${i}`] as string) : [""]),
          last.page_at as string, last.id as string,
        ])
      : null,
    ...(groups ? { groups } : {}),
  };
}

/** A stored number, or null when the value is absent or not a number. */
function numberSql(sql: Sql, key: string): never {
  return sql`(case when jsonb_typeof(data -> ${key}) = 'number' then (data -> ${key})::float8 end)` as never;
}

/** A stored timestamp, or null when the value is absent or not a timestamp. */
function timeSql(sql: Sql, key: string): never {
  return sql`(case when jsonb_typeof(data -> ${key}) = 'string'
    and pg_input_is_valid(data ->> ${key}, 'timestamptz') then (data ->> ${key})::timestamptz end)` as never;
}

/**
 * The SQL sort key of a field, matching applyView's order: numbers by value
 * and datetimes by instant, an absent value first; anything else as text.
 */
function sortKeySql(sql: Sql, field: FieldDef): { expr: never; numeric: boolean } {
  if (field.type === "number")
    return { numeric: true, expr: sql`coalesce(${numberSql(sql, field.key)}, '-Infinity'::float8)` as never };
  if (field.type === "datetime")
    return { numeric: false,
      expr: sql`coalesce(to_char(${timeSql(sql, field.key)} at time zone 'UTC', ${CURSOR_AT_FORMAT}), '')` as never };
  return { numeric: false, expr: sql`coalesce(data ->> ${field.key}, '')` as never };
}

/**
 * One view condition as a SQL clause, `and` and a predicate that admits
 * every row applyView keeps. Days count in the time zone given, UTC when
 * none is.
 */
export function conditionSql(
  sql: Sql,
  condition: ViewCondition,
  fields: ReadonlyMap<string, FieldDef>,
  readable: ReadonlySet<string>,
  now: Date,
  timeZone = "UTC",
): never {
  return sql`and ${conditionPredicate(sql, condition, fields, readable, now, timeZone)}` as never;
}

/**
 * A condition set as one SQL predicate, its entries joined by `and` or `or`
 * as it matches, a group by its own. Each entry admits every row applyView
 * keeps, so the whole does too. Days count in the set's time zone, else the
 * one given, else UTC.
 */
export function conditionSetSql(
  sql: Sql,
  set: ConditionGroup,
  fields: ReadonlyMap<string, FieldDef>,
  readable: ReadonlySet<string>,
  now: Date,
  timeZone = "UTC",
): never {
  const zone = set.timeZone ?? timeZone;
  const parts = set.conditions.map((item: ConditionItem) => isConditionGroup(item)
    ? conditionSetSql(sql, item, fields, readable, now, zone)
    : conditionPredicate(sql, item, fields, readable, now, zone));
  if (parts.length === 0) return sql`true` as never;
  const join = set.match === "any" ? sql` or ` : sql` and `;
  let whole = sql`(${parts[0]!})`;
  for (const part of parts.slice(1)) whole = sql`${whole}${join}(${part})`;
  return sql`(${whole})` as never;
}

/**
 * One view condition as a SQL predicate that admits every row applyView
 * keeps. An unreadable field is masked before applyView sees it, so it reads
 * as absent here too, decided once for the whole page. A calculated field
 * has no stored value; applyView alone decides it, which can leave a page
 * short. Times compare against the bounds applyView uses (`timeBounds`).
 * ponytail: `in` compares the stored value's text form, which differs from
 * applyView's String() only for objects and exotic numbers such as 1e21.
 */
function conditionPredicate(
  sql: Sql,
  condition: ViewCondition,
  fields: ReadonlyMap<string, FieldDef>,
  readable: ReadonlySet<string>,
  now: Date,
  timeZone: string,
): never {
  const { field, op, value } = condition;
  const def = fields.get(field);
  if (def?.calculation) return sql`true` as never;
  if (!def || !readable.has(field))
    return (conditionHolds(condition, undefined, now, timeZone) ? sql`true` : sql`false`) as never;
  const json = sql`data -> ${field}`;
  const text = sql`data ->> ${field}`;
  const values = Array.isArray(value) ? value.map(String) : null;
  const scalar = sql`jsonb_typeof(${json}) in ('string', 'number', 'boolean')`;
  switch (op) {
    case "eq": return (values ? sql`false` : sql`${json} = ${sql.json(value as never)}`) as never;
    case "neq": return (values ? sql`true` : sql`${json} is distinct from ${sql.json(value as never)}`) as never;
    case "in": return (values?.length ? sql`${text} in ${sql(values)}` : sql`false`) as never;
    case "not_in":
      return (values?.length ? sql`(${text} is null or ${text} not in ${sql(values)})` : sql`true`) as never;
    case "contains": case "starts_with": case "eq_ignore_case": {
      // Case folds by Unicode's rules whatever the database's collation, as
      // the browser's toLowerCase does; the sought text is folded there.
      const folded = sql`lower(${text} collate "und-x-icu")`;
      const sought = String(value).toLowerCase();
      const match = op === "contains" ? sql`strpos(${folded}, ${sought}) > 0`
        : op === "starts_with" ? sql`starts_with(${folded}, ${sought})` : sql`${folded} = ${sought}`;
      return sql`(${scalar} and ${match})` as never;
    }
    case "gt": return sql`${numberSql(sql, field)} > ${Number(value)}::float8` as never;
    case "gte": return sql`${numberSql(sql, field)} >= ${Number(value)}::float8` as never;
    case "lt": return sql`${numberSql(sql, field)} < ${Number(value)}::float8` as never;
    case "lte": return sql`${numberSql(sql, field)} <= ${Number(value)}::float8` as never;
    case "between":
      if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number")
        return sql`${numberSql(sql, field)} between ${value[0]}::float8 and ${value[1]}::float8` as never;
      return timeBoundsSql(sql, field, timeBounds(condition, now, timeZone));
    case "before": case "after": case "on": case "within_last": case "within_next":
      return timeBoundsSql(sql, field, timeBounds(condition, now, timeZone));
    case "is_empty":
      return sql`(${json} is null or ${json} = 'null'::jsonb or ${json} = '""'::jsonb)` as never;
    case "is_not_empty":
      return sql`(${json} is not null and ${json} <> 'null'::jsonb and ${json} <> '""'::jsonb)` as never;
  }
}

/** A stored time within bounds from (inclusive) to until (exclusive); a value that reads as no time is outside them. */
function timeBoundsSql(sql: Sql, key: string, bounds: { from?: number; until?: number } | null): never {
  if (!bounds) return sql`false` as never;
  const at = timeSql(sql, key);
  const instant = (ms: number) => sql`${new Date(ms).toISOString()}::timestamptz`;
  const from = bounds.from === undefined ? sql`true` : sql`${at} >= ${instant(bounds.from)}`;
  const until = bounds.until === undefined ? sql`true` : sql`${at} < ${instant(bounds.until)}`;
  return sql`(${at} is not null and ${from} and ${until})` as never;
}

export interface BoardListItem {
  readonly id: string;
  readonly title: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  /** Whether the board carries a geometry field (so it appears on the COP). */
  readonly hasGeometry: boolean;
  /** The incidents the board serves, so the shell can keep another incident's boards out of view. */
  readonly incidentIds: string[];
}

/**
 * The active boards in a jurisdiction the caller belongs to. Discovery for
 * the app shell's navigation: any membership role may list (viewers included),
 * and RLS is the second wall. `hasGeometry` mirrors the OGC collections rule
 * so the client can mark which boards also render as a COP layer. The
 * incident links are read under the same row-level security.
 */
export async function listBoards(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<BoardListItem[]> {
  if (!actor.memberships.some((m) => m.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
  const rows = await sql`
    select b.id, b.title, b.template_key, b.template_version, b.local_fields, t.definition,
      coalesce((select array_agg(ib.incident_id::text order by ib.incident_id)
        from incident_boards ib where ib.board_id = b.id), '{}') as incident_ids
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
      incidentIds: r.incident_ids as string[],
    };
  });
}

export function roleFor(actor: Principal, jurisdictionId: string, boardId: string): BoardRole | null {
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

/**
 * A reference label composed from the target record's label fields, in
 * order. A label field the caller cannot read is left out; null when no
 * readable label field holds a value.
 */
function composeReferenceLabel(
  field: FieldDef,
  target: EffectiveBoard,
  data: Readonly<Record<string, unknown>>,
): string | null {
  const derived = deriveRecordValues(target.fields, data);
  const parts = referenceLabelKeys(field).flatMap((key) => {
    const def = target.fields.find((candidate) => candidate.key === key);
    const value = derived[key];
    if (!def || !canRead(target.role, def.read)) return [];
    return typeof value === "string" || typeof value === "number" ? [String(value)] : [];
  });
  return parts.length ? parts.join(" / ") : null;
}

/** Whether a reference target shows the caller at least one of its label fields. */
function hasReadableLabel(field: FieldDef, target: EffectiveBoard): boolean {
  return referenceLabelKeys(field).some((key) => {
    const def = target.fields.find((candidate) => candidate.key === key);
    return Boolean(def && canRead(target.role, def.read));
  });
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
  const targets = new Map<string, EffectiveBoard>();
  let cursor = after;
  while (options.length < boundedLimit) {
    const rows = await sql`
      select r.id, r.board_id, r.data
      from board_records r
      join boards b on b.id = r.board_id
      join incident_boards ib on ib.board_id = b.id and ib.incident_id = ${incidentId}
      where r.incident_id = ${incidentId}
        and r.archived_at is null
        and b.template_key = ${field.targetBoardKey!}
        and (${cursor ?? null}::uuid is null or r.id > ${cursor ?? null})
      order by r.id
      limit 100`;
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.id as string;
      const targetId = row.board_id as string;
      const target = targets.get(targetId) ?? await getIncidentBoardReadShape(sql, actor, incidentId, targetId);
      targets.set(targetId, target);
      const label = composeReferenceLabel(field, target, row.data as Record<string, unknown>);
      if (label !== null) options.push({ id: row.id as string, label, boardId: targetId });
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
    if (!hasReadableLabel(field, target))
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

/**
 * The fields a record's workflow state makes read-only (VC-11), and the
 * state's label: from the template version its workflow runs on, or, for a
 * record whose workflow has not moved yet, the board's initial state. Null
 * when nothing is locked.
 */
export async function stateReadOnlyFields(
  sql: Sql, board: EffectiveBoard, recordId: string,
): Promise<{ readonly state: string; readonly fields: ReadonlySet<string> } | null> {
  const [instance] = await sql`
    select w.state_key, t.definition from board_workflow_instances w
    join board_templates t on t.key = w.template_key and t.version = w.template_version
    where w.record_id = ${recordId}`;
  const workflow = instance ? (instance.definition as BoardTemplate).workflow : board.template.workflow;
  if (!workflow) return null;
  const key = instance ? (instance.state_key as string) : workflow.initialState;
  const state = workflow.states.find((item) => item.key === key);
  if (!state?.readOnlyFields?.length) return null;
  return { state: state.label, fields: new Set(state.readOnlyFields) };
}

/** Why an edit changing `changed` is refused in a state that locks some of them; null when it is not. */
export function readOnlyRefusal(
  board: EffectiveBoard, locked: { readonly state: string; readonly fields: ReadonlySet<string> } | null, changed: readonly string[],
): string | null {
  const hit = locked ? changed.filter((key) => locked.fields.has(key)) : [];
  if (!locked || hit.length === 0) return null;
  const labels = hit.map((key) => board.fields.find((field) => field.key === key)?.label ?? key);
  return `${labels.join(", ")} cannot change while the record is ${locked.state}`;
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
