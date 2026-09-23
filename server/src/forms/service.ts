import type { Readable } from "node:stream";
import {
  checkFormExpressions,
  FORM_MEDIA_CONTENT_TYPES,
  FormDefinitionSchema,
  formBoardData,
  runForm,
  type FormDefinition,
  type AnswerRecord,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError, requireAdmin, requireMember, type Principal } from "../auth/service.js";
import { createRecord, getEffectiveBoard, updateRecord } from "../boards/service.js";
import { recordAudit } from "../audit/service.js";
import { uploadFile, type BlobStore, type UploadLimits } from "../files/service.js";

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
  try {
    checkFormExpressions(def);
  } catch (error) {
    throw new AuthError(400, (error as Error).message);
  }
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

/**
 * Run a submission and write it to a board. The capture is validated by the
 * runner first (relevance-aware required, choice membership under any
 * choice_filter, geometry, repeat structure and constraints), mapped to
 * board fields by the shared adapter the offline queue also uses, and then
 * validated by the board schema on write.
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
  const data = formBoardData(def, board.fields, input.answers);

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

const MEDIA_TYPES: ReadonlySet<string> = new Set(Object.values(FORM_MEDIA_CONTENT_TYPES).flat());

/**
 * Attach a photo or audio answer to the record its submission created. The
 * bytes go through the file store's own upload path, attached to the record
 * in the record's jurisdiction; when the board has an attachment field named
 * like the question, that field is set to the new file as well.
 */
export async function attachFormMedia(
  sql: Sql,
  store: BlobStore,
  actor: Principal,
  input: { recordId: string; question: string; name: string; contentType: string; content: Readable },
  limits: UploadLimits,
): Promise<{ id: string; sha256: string; version: number; field: string | null }> {
  if (!MEDIA_TYPES.has(input.contentType))
    throw new AuthError(400, `photo and audio answers accept ${[...MEDIA_TYPES].join(", ")}`);
  const [record] = await withPerson(sql, actor.person.id, (tx) => tx`
    select r.board_id, b.jurisdiction_id from board_records r
    join boards b on b.id = r.board_id where r.id = ${input.recordId}`);
  if (!record) throw new AuthError(404, "record not found");
  const boardId = record.board_id as string;
  const file = await uploadFile(sql, store, actor, {
    jurisdictionId: record.jurisdiction_id as string,
    name: input.name,
    contentType: input.contentType,
    content: input.content,
    attachedKind: "record",
    attachedId: input.recordId,
  }, limits);
  const field = await withPerson(sql, actor.person.id, async (tx) => {
    const board = await getEffectiveBoard(tx, actor, boardId);
    if (!board.fields.some((f) => f.key === input.question && f.type === "attachment")) return null;
    await updateRecord(tx, actor, boardId, input.recordId, { [input.question]: file.id });
    return input.question;
  });
  return { ...file, field };
}
