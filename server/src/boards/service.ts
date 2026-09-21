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
} from "@openeoc/shared";
import { verifyPackage } from "./package.js";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { getIncidentAuthority } from "../incidents/participation.js";

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
}

export async function createRecord(
  sql: Sql,
  actor: Principal,
  boardId: string,
  data: Record<string, unknown>,
  incidentId?: string,
): Promise<RecordWriteResult> {
  await lockBoardMutation(sql, boardId);
  let board: EffectiveBoard;
  let participantOrg: string | undefined;
  if (incidentId) {
    // Incident contribution (VEOC-79B1): a contributor participant, or an
    // owner writer, adds a record to a board the incident uses. Source
    // ownership (the board's jurisdiction) is unchanged; the record is tagged
    // with the incident so it is shared to that incident and no other. A
    // participant acts as a non-admin writer, so admin-only fields stay closed.
    const authority = await getIncidentAuthority(sql, actor, incidentId);
    if (!authority.canContribute) throw new AuthError(403, "requires incident contributor");
    const [attached] = await sql`
      select 1 as ok from incident_boards
      where incident_id = ${incidentId} and board_id = ${boardId}`;
    if (!attached) throw new AuthError(400, "board is not part of this incident");
    participantOrg = authority.participation?.organizationId;
    board = { ...(await loadBoardShape(sql, boardId)), role: "member" };
  } else {
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
  // Attribute the audit to a jurisdiction the actor belongs to: the board's
  // owner when the actor is a member, otherwise the contributing partner's own
  // organization, so the audit membership wall never rejects the write.
  const isOwnerMember = actor.memberships.some((m) => m.jurisdictionId === board.jurisdictionId);
  const auditJurisdiction =
    isOwnerMember || !participantOrg ? board.jurisdictionId : participantOrg;
  await recordAudit(sql, actor, {
    jurisdictionId: auditJurisdiction,
    ...(incidentId ? { incidentId } : {}),
    category: "board.record.created",
    subjectTable: "board_records",
    subjectId: id,
    payload: { board: board.template.key, data: parsed },
  });
  return { id, data: parsed, boardKey: board.template.key, jurisdictionId: board.jurisdictionId };
}

export async function updateRecord(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  patch: Record<string, unknown>,
): Promise<RecordWriteResult> {
  await lockBoardMutation(sql, boardId);
  const board = await getEffectiveBoard(sql, actor, boardId);
  requireWriter(board.role);
  checkFieldWrites(board, Object.keys(patch));
  const [existing] = await sql`
    select data, incident_id from board_records where id = ${recordId} and board_id = ${boardId}`;
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
  await validateRecordReferences(sql, actor, board, parsed, existing.incident_id as string | undefined);
  await sql`
    update board_records
    set data = ${sql.json(persisted as never)}, updated_by = ${actor.person.id},
        updated_at = now(), geom = ${geomExpr(sql, board.fields, persisted)}
    where id = ${recordId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: board.jurisdictionId,
    category: "board.record.updated",
    subjectTable: "board_records",
    subjectId: recordId,
    payload: { board: board.template.key, patch },
  });
  return {
    id: recordId,
    data: persisted,
    previous,
    boardKey: board.template.key,
    jurisdictionId: board.jurisdictionId,
  };
}

export interface ViewRecords {
  readonly view: string;
  readonly columns: readonly string[];
  readonly records: ReadonlyArray<Record<string, unknown> & { id: string }>;
}

export async function listViewRecords(
  sql: Sql,
  actor: Principal,
  boardId: string,
  viewKey: string,
  incidentId?: string,
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
  const rows = await sql`
    select id, data, created_at from board_records
    where board_id = ${boardId}
      and (${incidentId ?? null}::uuid is null or incident_id = ${incidentId ?? null})
    order by created_at desc`;
  const readable = new Set(
    board.fields.filter((f) => canRead(board.role, f.read)).map((f) => f.key),
  );
  const masked = rows.map((r) => {
    const data = deriveRecordValues(board.fields, r.data as Record<string, unknown>);
    const out: Record<string, unknown> & { id: string } = { id: r.id as string };
    for (const key of Object.keys(data)) if (readable.has(key)) out[key] = data[key];
    return out;
  });
  // One view semantics for server and browser (shared applyView).
  const records = applyView(view, masked);
  const columns = view.columns.filter((c) => readable.has(c));
  return { view: view.key, columns, records };
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

async function validateRecordReferences(
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

function checkFieldWrites(board: EffectiveBoard, keys: readonly string[]): void {
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
