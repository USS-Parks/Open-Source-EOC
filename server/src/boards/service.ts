import {
  BoardTemplateSchema,
  buildRecordSchema,
  effectiveFields,
  LocalFieldSchema,
  STANDARD_TEMPLATES,
  type BoardTemplate,
  type FieldDef,
} from "@openeoc/shared";
import { verifyPackage } from "./package.js";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";

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
  const [existing] = await sql`
    select 1 from board_templates where key = ${template.key} and version = ${template.version}`;
  if (existing) throw new AuthError(409, "template version already exists");
  await sql`
    insert into board_templates (key, version, title, definition)
    values (${template.key}, ${template.version}, ${template.title}, ${sql.json(template)})`;
  return { key: template.key, version: template.version };
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

export async function getEffectiveBoard(
  sql: Sql,
  actor: Principal,
  boardId: string,
): Promise<EffectiveBoard> {
  const [board] = await sql`
    select b.id, b.jurisdiction_id, b.title, b.local_fields, t.definition
    from boards b join board_templates t
      on t.key = b.template_key and t.version = b.template_version
    where b.id = ${boardId} and b.archived_at is null`;
  if (!board) throw new AuthError(404, "board not found");
  const role = roleFor(actor, board.jurisdiction_id as string, boardId);
  if (!role) throw new AuthError(403, "no access to this board");
  const template = BoardTemplateSchema.parse(board.definition);
  const locals = (board.local_fields as FieldDef[]) ?? [];
  const { fields } = effectiveFields(template, locals);
  return {
    id: board.id as string,
    jurisdictionId: board.jurisdiction_id as string,
    title: board.title as string,
    template,
    fields,
    role,
  };
}

export async function addLocalField(
  sql: Sql,
  actor: Principal,
  boardId: string,
  raw: unknown,
): Promise<void> {
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
  const board = await getEffectiveBoard(sql, actor, boardId);
  requireRole(actor, board.jurisdictionId, "admin");
  const [next] = await sql`
    select definition from board_templates
    where key = ${board.template.key} and version = ${toVersion}`;
  if (!next) throw new AuthError(404, "target template version not found");
  const nextTemplate = BoardTemplateSchema.parse(next.definition);
  const [current] = await sql`select local_fields from boards where id = ${boardId}`;
  const locals = (current!.local_fields as FieldDef[]) ?? [];
  const { fields, dropped } = effectiveFields(nextTemplate, locals);
  const keptLocals = fields.filter((f) => f.key.startsWith("x_"));
  await sql`
    update boards
    set template_version = ${toVersion}, local_fields = ${sql.json(keptLocals)}
    where id = ${boardId}`;
  return { dropped };
}

export async function createRecord(
  sql: Sql,
  actor: Principal,
  boardId: string,
  data: Record<string, unknown>,
): Promise<string> {
  const board = await getEffectiveBoard(sql, actor, boardId);
  requireWriter(board.role);
  checkFieldWrites(board, Object.keys(data));
  const parsed = buildRecordSchema(board.fields).parse(data);
  const [row] = await sql`
    insert into board_records (board_id, data, created_by, created_by_position)
    values (${boardId}, ${sql.json(parsed as never)}, ${actor.person.id}, ${actor.position?.id ?? null})
    returning id`;
  return row!.id as string;
}

export async function updateRecord(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const board = await getEffectiveBoard(sql, actor, boardId);
  requireWriter(board.role);
  checkFieldWrites(board, Object.keys(patch));
  const [existing] = await sql`
    select data from board_records where id = ${recordId} and board_id = ${boardId}`;
  if (!existing) throw new AuthError(404, "record not found");
  const merged = { ...(existing.data as Record<string, unknown>), ...patch };
  const parsed = buildRecordSchema(board.fields).parse(merged);
  await sql`
    update board_records
    set data = ${sql.json(parsed as never)}, updated_by = ${actor.person.id}, updated_at = now()
    where id = ${recordId}`;
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
): Promise<ViewRecords> {
  const board = await getEffectiveBoard(sql, actor, boardId);
  const view = board.template.views.find((v) => v.key === viewKey);
  if (!view) throw new AuthError(404, "view not found");
  const rows = await sql`
    select id, data, created_at from board_records
    where board_id = ${boardId} order by created_at desc`;
  const readable = new Set(
    board.fields.filter((f) => canRead(board.role, f.read)).map((f) => f.key),
  );
  let records: Array<Record<string, unknown> & { id: string }> = rows.map((r) => {
    const data = r.data as Record<string, unknown>;
    const out: Record<string, unknown> & { id: string } = { id: r.id as string };
    for (const key of Object.keys(data)) if (readable.has(key)) out[key] = data[key];
    return out;
  });
  for (const f of view.filter) {
    records = records.filter((rec) => {
      const v = rec[f.field];
      if (f.op === "eq") return v === f.value;
      if (f.op === "neq") return v !== f.value;
      return Array.isArray(f.value) && f.value.includes(String(v));
    });
  }
  if (view.sort) {
    const { field, dir } = view.sort;
    records.sort((a, b) => {
      const av = String(a[field] ?? "");
      const bv = String(b[field] ?? "");
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }
  const columns = view.columns.filter((c) => readable.has(c));
  return { view: view.key, columns, records };
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

function checkFieldWrites(board: EffectiveBoard, keys: readonly string[]): void {
  for (const key of keys) {
    const field = board.fields.find((f) => f.key === key);
    if (!field) continue; // unknown keys rejected by the record schema
    if (field.write === "admin" && board.role !== "admin")
      throw new AuthError(403, `field ${key} is admin-writable only`);
  }
}
