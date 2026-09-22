import {
  allFields,
  FormDefinitionSchema,
  geometryFieldKey,
  submission,
  runForm,
  type FormDefinition,
  type AnswerRecord,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireAdmin, requireMember, type Principal } from "../auth/service.js";
import { createRecord, getEffectiveBoard } from "../boards/service.js";
import { recordAudit } from "../audit/service.js";

/**
 * Smart form service (F7). Imported XLSForm definitions are
 * stored as versioned per-jurisdiction data. A submission runs through
 * the pure runner (relevance, calculations, constraints) and its result
 * is written to a board through the same schema engine every other write
 * uses, so a captured form becomes an ordinary audited board record,
 * geometry included.
 */

export class FormValidationError extends Error {
  constructor(readonly errors: ReadonlyArray<{ field: string; message: string }>) {
    super("form validation failed");
  }
}

export async function storeForm(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  rawDef: FormDefinition,
): Promise<{ key: string; version: number }> {
  requireAdmin(actor, jurisdictionId);
  const def = FormDefinitionSchema.parse(rawDef);
  const [existing] = await sql`
    select 1 from form_definitions
    where jurisdiction_id = ${jurisdictionId} and key = ${def.key} and version = ${def.version}`;
  if (existing) throw new AuthError(409, "form version already exists");
  const [inserted] = await sql`
    insert into form_definitions
      (jurisdiction_id, key, version, title, board_template, definition, created_by)
    values
      (${jurisdictionId}, ${def.key}, ${def.version}, ${def.title},
       ${def.boardTemplate ?? null}, ${sql.json(def as never)}, ${actor.person.id})
    returning id`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "form.imported",
    subjectTable: "form_definitions",
    subjectId: inserted!.id as string,
    payload: { key: def.key, version: def.version, title: def.title },
  });
  return { key: def.key, version: def.version };
}

export async function listForms(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<Array<{ key: string; version: number; title: string }>> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select key, version, title from form_definitions
    where jurisdiction_id = ${jurisdictionId} order by key, version desc`;
  return rows.map((r) => ({
    key: r.key as string,
    version: r.version as number,
    title: r.title as string,
  }));
}

export async function getForm(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  key: string,
  version?: number,
): Promise<FormDefinition> {
  requireMember(actor, jurisdictionId);
  const [row] = version
    ? await sql`
        select definition from form_definitions
        where jurisdiction_id = ${jurisdictionId} and key = ${key} and version = ${version}`
    : await sql`
        select definition from form_definitions
        where jurisdiction_id = ${jurisdictionId} and key = ${key}
        order by version desc limit 1`;
  if (!row) throw new AuthError(404, "form not found");
  return FormDefinitionSchema.parse(row.definition);
}

/** ODK geopoint "lat lon [alt] [acc]" -> GeoJSON Point [lon, lat]. */
function geopointToGeoJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]!) || Number.isNaN(parts[1]!)) return null;
  return { type: "Point", coordinates: [parts[1]!, parts[0]!] };
}

/**
 * Run a submission and write it to a board. Field values map to board
 * fields by name; the form's geopoint becomes the board's geometry. The
 * capture is validated by the runner first (relevance-aware required and
 * constraint checks) and then by the board schema on write.
 */
export async function submitForm(
  sql: Sql,
  actor: Principal,
  input: { jurisdictionId: string; formKey: string; boardId: string; answers: AnswerRecord },
): Promise<{ recordId: string }> {
  const def = await getForm(sql, actor, input.jurisdictionId, input.formKey);
  const run = runForm(def, input.answers);
  if (run.errors.length > 0) throw new FormValidationError(run.errors);

  const board = await getEffectiveBoard(sql, actor, input.boardId);
  if (board.jurisdictionId !== input.jurisdictionId)
    throw new AuthError(400, "board is not in this jurisdiction");
  const sub = submission(def, input.answers);
  const boardKeys = new Set(board.fields.map((f) => f.key));
  const geomKey = geometryFieldKey(board.fields);
  const geopointNames = allFields(def.nodes)
    .filter((f) => f.type === "geopoint")
    .map((f) => f.name);

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sub)) {
    if (geopointNames.includes(k)) continue; // handled as geometry below
    if (boardKeys.has(k)) data[k] = v;
  }
  if (geomKey) {
    for (const name of geopointNames) {
      const geo = geopointToGeoJson(sub[name]);
      if (geo) {
        data[geomKey] = geo;
        break;
      }
    }
  }

  const result = await createRecord(sql, actor, input.boardId, data);
  await recordAudit(sql, actor, {
    jurisdictionId: input.jurisdictionId,
    category: "form.submitted",
    subjectTable: "board_records",
    subjectId: result.id,
    payload: { form: def.key, board: board.template.key },
  });
  return { recordId: result.id };
}
