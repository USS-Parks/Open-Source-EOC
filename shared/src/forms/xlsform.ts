import { z } from "zod";
import { checkExpression } from "./expr.js";

/**
 * XLSForm model and import (F7). An imported form is data: a
 * nested tree of fields, groups, and repeats with the XLSForm logic
 * columns (relevant, constraint, calculation) preserved verbatim for the
 * expression engine. Import takes the three XLSForm sheets in normalized
 * row form; the server's binary reader turns a real .xlsx into that
 * shape, so this stays pure and isomorphic.
 */

export const XLSFORM_FIELD_TYPES = [
  "text",
  "integer",
  "decimal",
  "note",
  "date",
  "datetime",
  "time",
  "select_one",
  "select_multiple",
  "geopoint",
  "geotrace",
  "geoshape",
  "barcode",
  "image",
  "audio",
  "calculate",
] as const;
export type FieldType = (typeof XLSFORM_FIELD_TYPES)[number];

/**
 * Upload types a photo or audio question accepts. Each is also on the file
 * store's allowlist, so a capture the runner takes is one the server stores.
 */
export const FORM_MEDIA_CONTENT_TYPES = {
  image: ["image/png", "image/jpeg", "image/gif"],
  audio: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/webm", "audio/wav", "audio/x-wav"],
} as const satisfies Record<"image" | "audio", readonly string[]>;

/**
 * XLSForm metadata question types. The platform records who submitted and
 * when in the record's own audit trail, so these rows are skipped on import.
 */
const METADATA_TYPES = new Set([
  "start", "end", "today", "deviceid", "subscriberid", "simserial", "phonenumber",
  "username", "email", "audit", "start-geopoint",
]);

export interface Choice {
  readonly name: string;
  readonly label: string;
  /** Extra choices-sheet columns, read by bare names in a choice_filter. */
  readonly properties?: Readonly<Record<string, string>>;
}

export interface FormField {
  readonly kind: "field";
  readonly name: string;
  readonly type: FieldType;
  readonly label?: string;
  readonly required?: boolean;
  readonly relevant?: string;
  readonly constraint?: string;
  readonly constraintMessage?: string;
  readonly calculation?: string;
  readonly list?: string;
  readonly choices?: readonly Choice[];
  /** XLSForm choice_filter: a choice is offered only where this is true for its row. */
  readonly choiceFilter?: string;
  /** An image question with the XLSForm appearance "signature": drawn on a pad, not photographed. */
  readonly signature?: boolean;
}

export interface FormContainer {
  readonly kind: "group" | "repeat";
  readonly name: string;
  readonly label?: string;
  readonly relevant?: string;
  readonly children: readonly FormNode[];
}

export type FormNode = FormField | FormContainer;

export interface FormDefinition {
  readonly key: string;
  readonly version: number;
  readonly title: string;
  readonly nodes: readonly FormNode[];
  /** Board template this form's submissions write to. */
  readonly boardTemplate?: string | undefined;
}

export type SheetRow = Readonly<Record<string, string>>;
export interface XlsFormSheets {
  readonly survey: readonly SheetRow[];
  readonly choices: readonly SheetRow[];
  readonly settings?: SheetRow | undefined;
}

const KEY = /^[a-z][a-z0-9_]*$/i;

function cell(row: SheetRow, ...names: string[]): string {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function truthy(v: string): boolean {
  const s = v.toLowerCase();
  return s === "yes" || s === "true" || s === "1";
}

/** Choices-sheet columns that are not filter properties. */
const CHOICE_SHEET_COLUMNS = /^(list_name|list name|name|label|media|image|audio|video)(::|$)/;

/** Group choices by list_name from the choices sheet. */
function choiceLists(rows: readonly SheetRow[]): Map<string, Choice[]> {
  const lists = new Map<string, Choice[]>();
  for (const row of rows) {
    const list = cell(row, "list_name", "list name");
    const name = cell(row, "name");
    if (!list || !name) continue;
    const label = cell(row, "label", "label::English", "label::english") || name;
    const properties = Object.fromEntries(Object.entries(row)
      .filter(([column, value]) => !CHOICE_SHEET_COLUMNS.test(column) && String(value).trim() !== "")
      .map(([column, value]) => [column, String(value).trim()]));
    if (!lists.has(list)) lists.set(list, []);
    lists.get(list)!.push({ name, label, ...(Object.keys(properties).length ? { properties } : {}) });
  }
  return lists;
}

/**
 * Import an XLSForm (as normalized sheet rows) into a FormDefinition.
 * Recognizes begin/end group and begin/end repeat in either spelling,
 * resolves select_one and select_multiple to their choice lists with any
 * choice_filter, and keeps every logic column for the runner. Metadata rows
 * are skipped; any other construct the runner cannot honor is refused with
 * the survey row that carries it.
 */
export function importXlsForm(
  sheets: XlsFormSheets,
  meta: { key: string; version?: number; title?: string; boardTemplate?: string },
): FormDefinition {
  if (!KEY.test(meta.key)) throw new Error(`invalid form key '${meta.key}'`);
  const lists = choiceLists(sheets.choices);
  const settings = sheets.settings ?? {};
  const title = meta.title ?? (cell(settings, "form_title", "title") || meta.key);

  // A stack of child arrays; the top is where new nodes are appended.
  const root: FormNode[] = [];
  const stack: { container: Partial<FormContainer>; children: FormNode[] }[] = [];
  const top = (): FormNode[] => (stack.length ? stack[stack.length - 1]!.children : root);

  for (const [index, row] of sheets.survey.entries()) {
    const rawType = cell(row, "type");
    if (!rawType) continue;
    // The header is sheet row 1, so the first survey row is row 2.
    const at = `survey row ${index + 2}`;
    const [head, listName, extra] = rawType.split(/\s+/);
    const name = cell(row, "name");
    const label = cell(row, "label", "label::English", "label::english");
    const relevant = cell(row, "relevant");

    const block = /^(begin|end)[\s_]+(group|repeat)$/.exec(rawType);
    if (block) {
      const kind = block[2] as FormContainer["kind"];
      if (block[1] === "begin") {
        if (kind === "repeat" && cell(row, "repeat_count")) {
          throw new Error(`${at}: repeat_count is not supported; field users add entries themselves`);
        }
        const container: Partial<FormContainer> = {
          kind,
          name: name || `group_${top().length}`,
          ...(label ? { label } : {}),
          ...(relevant ? { relevant } : {}),
        };
        stack.push({ container, children: [] });
      } else {
        const frame = stack.pop();
        if (!frame) throw new Error(`${at}: unbalanced end without begin`);
        if (frame.container.kind !== kind) {
          throw new Error(`${at}: end ${kind} closes the ${frame.container.kind} '${frame.container.name}'`);
        }
        top().push({
          kind,
          name: frame.container.name!,
          ...(frame.container.label ? { label: frame.container.label } : {}),
          ...(frame.container.relevant ? { relevant: frame.container.relevant } : {}),
          children: frame.children,
        } satisfies FormContainer);
      }
      continue;
    }

    if (METADATA_TYPES.has(head!)) continue;
    if (!XLSFORM_FIELD_TYPES.includes(head as FieldType)) {
      throw new Error(`${at}: question type '${rawType}' is not supported`);
    }
    const type = head as FieldType;
    if (!name) throw new Error(`${at}: row with type '${rawType}' has no name`);
    const select = type === "select_one" || type === "select_multiple";
    if (select) {
      if (!listName) throw new Error(`${at}: ${type} '${name}' names no choice list`);
      if (extra) throw new Error(`${at}: '${rawType}' is not supported; add an explicit other choice instead`);
      if (!lists.has(listName)) throw new Error(`${at}: choice list '${listName}' is not on the choices sheet`);
    }
    const choiceFilter = cell(row, "choice_filter", "choice filter");
    if (choiceFilter && !select) throw new Error(`${at}: choice_filter applies only to select questions`);
    const field: FormField = {
      kind: "field",
      name,
      type,
      ...(label ? { label } : {}),
      ...(truthy(cell(row, "required")) ? { required: true } : {}),
      ...(relevant ? { relevant } : {}),
      ...(cell(row, "constraint") ? { constraint: cell(row, "constraint") } : {}),
      ...(cell(row, "constraint_message", "constraint message")
        ? { constraintMessage: cell(row, "constraint_message", "constraint message") }
        : {}),
      ...(cell(row, "calculation") ? { calculation: cell(row, "calculation") } : {}),
      ...(select ? { list: listName!, choices: lists.get(listName!)! } : {}),
      ...(choiceFilter ? { choiceFilter } : {}),
      ...(type === "image" && /(^|\s)signature(\s|$)/.test(cell(row, "appearance")) ? { signature: true } : {}),
    };
    top().push(field);
  }

  if (stack.length) throw new Error("unbalanced begin without end");

  const def: FormDefinition = {
    key: meta.key,
    version: meta.version ?? 1,
    title,
    nodes: root,
    ...(meta.boardTemplate ? { boardTemplate: meta.boardTemplate } : {}),
  };
  checkFormExpressions(def);
  return def;
}

/**
 * Refuse a form whose relevant, constraint, calculation or choice_filter the
 * runner cannot evaluate, naming the question and the column.
 */
export function checkFormExpressions(def: FormDefinition): void {
  const check = (node: FormNode, column: string, src: string | undefined, columns = false): void => {
    if (!src) return;
    try {
      checkExpression(src, columns);
    } catch (error) {
      throw new Error(`question '${node.name}' ${column}: ${(error as Error).message}`, { cause: error });
    }
  };
  const walk = (nodes: readonly FormNode[]): void => {
    for (const node of nodes) {
      check(node, "relevant", node.relevant);
      if (node.kind === "field") {
        check(node, "constraint", node.constraint);
        check(node, "calculation", node.calculation);
        check(node, "choice_filter", node.choiceFilter, true);
      } else {
        walk(node.children);
      }
    }
  };
  walk(def.nodes);
}

/** Zod schema for a stored/transmitted form definition. */
export const FormFieldSchema: z.ZodType<FormField> = z.lazy(() =>
  z.object({
    kind: z.literal("field"),
    name: z.string(),
    type: z.enum(XLSFORM_FIELD_TYPES),
    label: z.string().optional(),
    required: z.boolean().optional(),
    relevant: z.string().optional(),
    constraint: z.string().optional(),
    constraintMessage: z.string().optional(),
    calculation: z.string().optional(),
    list: z.string().optional(),
    choices: z.array(z.object({
      name: z.string(),
      label: z.string(),
      properties: z.record(z.string(), z.string()).optional(),
    })).optional(),
    choiceFilter: z.string().optional(),
    signature: z.boolean().optional(),
  }),
) as z.ZodType<FormField>;

export const FormNodeSchema: z.ZodType<FormNode> = z.lazy(() =>
  z.union([
    FormFieldSchema,
    z.object({
      kind: z.enum(["group", "repeat"]),
      name: z.string(),
      label: z.string().optional(),
      relevant: z.string().optional(),
      children: z.array(FormNodeSchema),
    }),
  ]),
) as z.ZodType<FormNode>;

export const FormDefinitionSchema = z.object({
  key: z.string().regex(KEY),
  version: z.number().int().positive(),
  title: z.string().min(1),
  nodes: z.array(FormNodeSchema),
  boardTemplate: z.string().optional(),
});

/** Flatten every field in tree order (groups/repeats descended into). */
export function allFields(nodes: readonly FormNode[]): FormField[] {
  const out: FormField[] = [];
  for (const node of nodes) {
    if (node.kind === "field") out.push(node);
    else out.push(...allFields(node.children));
  }
  return out;
}
