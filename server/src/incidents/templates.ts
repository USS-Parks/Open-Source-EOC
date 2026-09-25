import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { IncidentTemplateSchema, type IncidentTemplate } from "./service.js";

/**
 * Incident templates as data, authored and versioned on screen (VC-01). A
 * template is the positions an incident opens with, its boards, and each
 * position's checklist. The row holds the current version; the database keeps
 * every version in `incident_template_versions`, append-only, whichever path
 * saved it. Templates are instance-wide like board templates, so an instance
 * administrator authors them; every signed-in person reads them, and an
 * incident records the version it was activated from.
 */

export interface IncidentTemplateSummary {
  readonly key: string;
  readonly title: string;
  readonly version: number;
  readonly updatedAt: string;
  readonly positions: number;
  readonly boards: number;
  readonly checklistItems: number;
}

export interface IncidentTemplateVersion {
  readonly version: number;
  readonly title: string;
  readonly template: IncidentTemplate;
  readonly savedAt: string;
  /** Who saved it; null for a version the standard or scenario seeding put in. */
  readonly savedBy: string | null;
}

const iso = (value: unknown): string => new Date(value as string).toISOString();

function summary(row: Record<string, unknown>): IncidentTemplateSummary {
  const template = IncidentTemplateSchema.parse(row.definition);
  return {
    key: row.key as string,
    title: row.title as string,
    version: row.version as number,
    updatedAt: iso(row.updated_at),
    positions: template.positions.length,
    boards: template.boards.length,
    checklistItems: template.checklists.reduce((n, list) => n + list.items.length, 0),
  };
}

/** Every template at its current version, by title. */
export async function listIncidentTemplates(sql: Sql): Promise<IncidentTemplateSummary[]> {
  const rows = await sql`
    select key, title, version, updated_at, definition from incident_templates order by title, key`;
  return rows.map(summary);
}

/** One template at its current version. */
export async function getIncidentTemplate(sql: Sql, key: string): Promise<{ template: IncidentTemplate; version: number; updatedAt: string }> {
  const [row] = await sql`select version, updated_at, definition from incident_templates where key = ${key}`;
  if (!row) throw new AuthError(404, "incident template not found");
  return { template: IncidentTemplateSchema.parse(row.definition), version: row.version as number, updatedAt: iso(row.updated_at) };
}

/** Every version of a template, newest first. */
export async function listIncidentTemplateVersions(sql: Sql, key: string): Promise<IncidentTemplateVersion[]> {
  const rows = await sql`
    select v.version, v.title, v.definition, v.created_at, p.display_name
    from incident_template_versions v left join persons p on p.id = v.created_by
    where v.key = ${key} order by v.version desc`;
  if (rows.length === 0) throw new AuthError(404, "incident template not found");
  return rows.map((row) => ({
    version: row.version as number,
    title: row.title as string,
    template: IncidentTemplateSchema.parse(row.definition),
    savedAt: iso(row.created_at),
    savedBy: (row.display_name as string | null) ?? null,
  }));
}

/**
 * Save a template: a new key starts at version 1, and a save of an existing
 * one becomes its next version. `expectedVersion` is the version the editor
 * opened (0 for a new template), so a save over someone else's is refused
 * rather than lost. Every board must be a published board template, and every
 * checklist must belong to one of the template's positions.
 */
export async function saveIncidentTemplate(
  sql: Sql,
  actor: Principal,
  key: string,
  raw: unknown,
  expectedVersion: number,
): Promise<{ key: string; version: number; created: boolean }> {
  if (!actor.isInstanceAdmin) throw new AuthError(403, "requires instance admin");
  const parsed = IncidentTemplateSchema.safeParse({ ...(raw as Record<string, unknown>), key });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AuthError(400, `${issue?.path.join(".") || "template"}: ${issue?.message ?? "invalid template"}`);
  }
  const template = parsed.data;
  if (template.title.length > 200) throw new AuthError(400, "title: keep the title to 200 characters");
  const positions = new Set<string>();
  for (const position of template.positions) {
    if (!/^[a-z][a-z0-9_]*$/.test(position)) throw new AuthError(400, `positions: ${position} is not a position key`);
    if (positions.has(position)) throw new AuthError(400, `positions: ${position} is listed twice`);
    positions.add(position);
  }
  for (const list of template.checklists) {
    if (!positions.has(list.position)) throw new AuthError(400, `checklists: ${list.position} is not one of the template's positions`);
  }
  for (const position of Object.keys(template.positionTitles ?? {})) {
    if (!positions.has(position)) throw new AuthError(400, `positionTitles: ${position} is not one of the template's positions`);
  }
  const boards = [...new Set(template.boards)];
  if (boards.length !== template.boards.length) throw new AuthError(400, "boards: a board is listed twice");
  const known = await sql`select distinct key from board_templates where key = any(${boards})`;
  const missing = boards.filter((board) => !known.some((row) => row.key === board));
  if (missing.length > 0) throw new AuthError(400, `boards: no board template ${missing.join(", ")}`);

  const [current] = await sql`select version from incident_templates where key = ${key} for update`;
  if (!current) {
    if (expectedVersion !== 0) throw new AuthError(409, `incident template ${key} does not exist yet`);
    await sql`
      insert into incident_templates (key, title, definition, version, updated_by, updated_at)
      values (${key}, ${template.title}, ${sql.json(template as never)}, 1, ${actor.person.id}, now())`;
    return { key, version: 1, created: true };
  }
  const version = current.version as number;
  if (expectedVersion !== version) {
    throw new AuthError(409, `the template changed after it was opened: version ${version} is current`);
  }
  await sql`
    update incident_templates
    set title = ${template.title}, definition = ${sql.json(template as never)}, version = ${version + 1},
        updated_by = ${actor.person.id}, updated_at = now()
    where key = ${key}`;
  return { key, version: version + 1, created: false };
}
