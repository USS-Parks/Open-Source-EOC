import type { z } from "zod";
import { BoardTemplateSchema, DashboardTemplateSchema, FormDefinitionSchema } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireAdmin, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { canonical } from "../boards/package.js";
import { storeForm } from "../forms/service.js";
import { IncidentTemplateSchema } from "../incidents/service.js";
import { saveIncidentTemplate } from "../incidents/templates.js";
import { PackageRefused, PART_KINDS, ReportTemplateSchema, RuleTemplateSchema, verifySolutionPackage, type PartKind } from "./solution.js";

/**
 * Import a signed solution package (VA11) into an instance, in one
 * transaction. Instance-wide parts (board, incident, dashboard, report and
 * rule templates) join the instance; forms join the jurisdiction the import
 * is made in. Nothing the instance holds is overwritten:
 *
 * - a template or form version the instance already holds with the same
 *   content is "held" and left as it is;
 * - the same key and version with different content is a conflict, and the
 *   whole import is refused, since two publishers' versions cannot both be it;
 * - an incident template the instance already has under that key, with a
 *   different current version, is "kept": incident templates are edited on
 *   screen, so the instance's own stands. It can be edited to the package's
 *   by hand.
 *
 * Every board template a part names must be in the package or the instance.
 * Board templates go in first, then dashboard, report and rule templates,
 * then the incident templates that may name them, then forms.
 */

export interface PartResult {
  readonly created: string[];
  readonly held: string[];
  readonly kept: string[];
}

export interface ImportSummary {
  readonly id: string;
  readonly publisher: string;
  readonly name: string;
  readonly version: string;
  readonly publishedAt: string;
  readonly keyFingerprint: string;
  readonly parts: Readonly<Record<PartKind, PartResult>>;
}

/** The parts kept by key and version, each in its own instance-wide table. */
const VERSIONED: Readonly<Record<"boardTemplates" | "dashboardTemplates" | "reportTemplates" | "ruleTemplates",
  { table: string; what: string; schema: z.ZodType }>> = {
  boardTemplates: { table: "board_templates", what: "board template", schema: BoardTemplateSchema },
  dashboardTemplates: { table: "dashboard_templates", what: "dashboard template", schema: DashboardTemplateSchema },
  reportTemplates: { table: "report_templates", what: "report template", schema: ReportTemplateSchema },
  ruleTemplates: { table: "rule_templates", what: "rule template", schema: RuleTemplateSchema },
};

/** Whether a stored definition is the package's, once both have passed the same schema. */
function sameAs(schema: z.ZodType, stored: unknown, item: unknown): boolean {
  const parsed = schema.safeParse(stored);
  return canonical(parsed.success ? parsed.data : stored) === canonical(item);
}

const label = (item: { key: string; version?: number }) => (item.version === undefined ? item.key : `${item.key} version ${item.version}`);

export async function importSolutionPackage(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  raw: unknown,
  trustedKeys: readonly string[],
): Promise<ImportSummary> {
  if (!actor.isInstanceAdmin) throw new AuthError(403, "requires instance admin");
  requireAdmin(actor, jurisdictionId);
  let verified;
  try {
    verified = verifySolutionPackage(raw, trustedKeys);
  } catch (error) {
    if (error instanceof PackageRefused) throw new AuthError(400, error.message);
    throw error;
  }
  const pkg = verified.package;
  const { contents } = pkg;
  const parts = Object.fromEntries(PART_KINDS.map((kind): [PartKind, PartResult] => [kind, { created: [], held: [], kept: [] }])) as Record<PartKind, PartResult>;
  const conflicts: string[] = [];

  /**
   * Insert a key-and-version template unless held. A held version is compared
   * with the package's after both pass the same schema (`sameAs`).
   */
  const versioned = async (kind: keyof typeof VERSIONED, item: { key: string; version: number; title: string }) => {
    const { table, what, schema } = VERSIONED[kind];
    const [existing] = await sql`select definition from ${sql(table)} where key = ${item.key} and version = ${item.version}`;
    if (existing) {
      if (sameAs(schema, existing.definition, item)) parts[kind].held.push(label(item));
      else conflicts.push(`${what} ${label(item)} is already on this instance with different content`);
      return;
    }
    await sql`insert into ${sql(table)} (key, version, title, definition) values (${item.key}, ${item.version}, ${item.title}, ${sql.json(item as never)})`;
    parts[kind].created.push(label(item));
  };

  for (const template of contents.boardTemplates) await versioned("boardTemplates", template);

  // Every board template a part names, known once the package's own are in.
  const named = [...new Set([
    ...contents.incidentTemplates.flatMap((template) => template.boards),
    ...contents.forms.flatMap((form) => (form.boardTemplate ? [form.boardTemplate] : [])),
    ...contents.dashboardTemplates.flatMap((template) => template.widgets.map((widget) => widget.board)),
    ...contents.reportTemplates.map((template) => template.board),
    ...contents.ruleTemplates.flatMap((template) => (template.board ? [template.board] : [])),
  ])];
  const known = named.length ? await sql`select distinct key from board_templates where key = any(${named})` : [];
  const missing = named.filter((key) => !known.some((row) => row.key === key));
  if (missing.length) conflicts.push(`no board template ${missing.join(", ")} in the package or on this instance`);

  // A report or rule is made from its template at activation; one naming a
  // field its board template lacks would fail every activation that uses it,
  // so it is refused here, where the publisher can be told.
  const fieldsOf = new Map<string, Map<string, string>>();
  for (const key of new Set([...contents.reportTemplates.map((t) => t.board), ...contents.ruleTemplates.flatMap((t) => (t.board ? [t.board] : []))])) {
    if (missing.includes(key)) continue;
    const [latest] = await sql`select definition from board_templates where key = ${key} order by version desc limit 1`;
    const parsed = BoardTemplateSchema.safeParse(latest!.definition);
    const fields = parsed.success ? parsed.data.fields : ((latest!.definition as { fields?: Array<{ key: string; type: string }> }).fields ?? []);
    fieldsOf.set(key, new Map(fields.map((field) => [field.key, field.type])));
  }
  for (const template of contents.reportTemplates) {
    const fields = fieldsOf.get(template.board);
    if (!fields) continue;
    const { columns, groupBy, sorts, where, totals } = template.definition;
    const unknown = [...new Set([...columns, ...groupBy, ...sorts.map((s) => s.field), ...where.map((w) => w.field), ...totals.map((t) => t.field)])]
      .filter((field) => !fields.has(field));
    if (unknown.length) conflicts.push(`report template ${label(template)} names ${unknown.join(", ")}, which board template ${template.board} does not have`);
    const notNumbers = totals.filter((t) => fields.has(t.field) && fields.get(t.field) !== "number").map((t) => t.field);
    if (notNumbers.length) conflicts.push(`report template ${label(template)} totals ${notNumbers.join(", ")}, which is not a number`);
  }
  for (const template of contents.ruleTemplates) {
    const fields = template.board ? fieldsOf.get(template.board) : undefined;
    if (fields && template.condition.field && !fields.has(template.condition.field)) {
      conflicts.push(`rule template ${label(template)} watches ${template.condition.field}, which board template ${template.board} does not have`);
    }
  }
  if (conflicts.length) throw new AuthError(409, `package refused, nothing imported: ${conflicts.slice(0, 5).join("; ")}`);

  // Dashboard, report and rule templates go in before the incident templates that may name them.
  for (const template of contents.dashboardTemplates) await versioned("dashboardTemplates", template);
  for (const template of contents.reportTemplates) await versioned("reportTemplates", template);
  for (const template of contents.ruleTemplates) await versioned("ruleTemplates", template);
  for (const template of contents.incidentTemplates) {
    const [current] = await sql`select definition from incident_templates where key = ${template.key}`;
    if (!current) {
      await saveIncidentTemplate(sql, actor, template.key, template, 0);
      parts.incidentTemplates.created.push(template.key);
    } else if (sameAs(IncidentTemplateSchema, current.definition, template)) parts.incidentTemplates.held.push(template.key);
    else parts.incidentTemplates.kept.push(template.key);
  }
  for (const form of contents.forms) {
    const [existing] = await sql`
      select definition from form_definitions where jurisdiction_id = ${jurisdictionId} and key = ${form.key} and version = ${form.version}`;
    if (!existing) {
      await storeForm(sql, actor, jurisdictionId, form);
      parts.forms.created.push(label(form));
    } else if (sameAs(FormDefinitionSchema, existing.definition, form)) parts.forms.held.push(label(form));
    else conflicts.push(`form ${label(form)} is already in this jurisdiction with different content`);
  }
  if (conflicts.length) throw new AuthError(409, `package refused, nothing imported: ${conflicts.slice(0, 5).join("; ")}`);

  const [row] = await sql`
    insert into solution_packages
      (publisher, name, version, published_at, key_fingerprint, digest, jurisdiction_id, summary, imported_by)
    values (${pkg.publisher}, ${pkg.name}, ${pkg.version}, ${pkg.publishedAt}, ${verified.keyFingerprint},
            ${verified.digest}, ${jurisdictionId}, ${sql.json(parts as never)}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "package.imported",
    subjectTable: "solution_packages",
    subjectId: id,
    payload: {
      publisher: pkg.publisher, name: pkg.name, version: pkg.version, keyFingerprint: verified.keyFingerprint,
      created: Object.fromEntries(PART_KINDS.map((kind) => [kind, parts[kind].created.length])),
    },
  });
  return { id, publisher: pkg.publisher, name: pkg.name, version: pkg.version, publishedAt: pkg.publishedAt, keyFingerprint: verified.keyFingerprint, parts };
}

export interface ImportedPackage {
  readonly id: string;
  readonly publisher: string;
  readonly name: string;
  readonly version: string;
  readonly publishedAt: string;
  readonly keyFingerprint: string;
  readonly importedAt: string;
  readonly importedBy: string;
  readonly parts: Readonly<Record<PartKind, PartResult>>;
}

/** Every package imported on this instance, newest first (instance admin). */
export async function listImportedPackages(sql: Sql, actor: Principal): Promise<ImportedPackage[]> {
  if (!actor.isInstanceAdmin) throw new AuthError(403, "requires instance admin");
  const rows = await sql`
    select s.id, s.publisher, s.name, s.version, s.published_at, s.key_fingerprint, s.imported_at, s.summary, p.display_name
    from solution_packages s join persons p on p.id = s.imported_by
    order by s.imported_at desc, s.id limit 200`;
  return rows.map((row) => ({
    id: row.id as string,
    publisher: row.publisher as string,
    name: row.name as string,
    version: row.version as string,
    publishedAt: new Date(row.published_at as string).toISOString(),
    keyFingerprint: row.key_fingerprint as string,
    importedAt: new Date(row.imported_at as string).toISOString(),
    importedBy: row.display_name as string,
    parts: row.summary as Record<PartKind, PartResult>,
  }));
}
