import { z } from "zod";

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
  "image",
  "calculate",
] as const;
export type FieldType = (typeof XLSFORM_FIELD_TYPES)[number];

export interface Choice {
  readonly name: string;
  readonly label: string;
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

/** Group choices by list_name from the choices sheet. */
function choiceLists(rows: readonly SheetRow[]): Map<string, Choice[]> {
  const lists = new Map<string, Choice[]>();
  for (const row of rows) {
    const list = cell(row, "list_name", "list name");
    const name = cell(row, "name");
    if (!list || !name) continue;
    const label = cell(row, "label", "label::English", "label::english") || name;
    if (!lists.has(list)) lists.set(list, []);
    lists.get(list)!.push({ name, label });
  }
  return lists;
}

/**
 * Import an XLSForm (as normalized sheet rows) into a FormDefinition.
 * Recognizes begin/end group and begin/end repeat, resolves select_one
 * and select_multiple to their choice lists, and keeps every logic
 * column for the runner. Unknown or blank-type rows are skipped.
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

  for (const row of sheets.survey) {
    const rawType = cell(row, "type");
    if (!rawType) continue;
    const [head, listName] = rawType.split(/\s+/);
    const name = cell(row, "name");
    const label = cell(row, "label", "label::English", "label::english");
    const relevant = cell(row, "relevant");

    if (head === "begin" || head === "end") {
      // XLSForm allows "begin group"/"begin_group" spellings.
      const which = listName ?? "";
      const isGroup = rawType.includes("group");
      const isRepeat = rawType.includes("repeat");
      void which;
      if (head === "begin") {
        const container: Partial<FormContainer> = {
          kind: isRepeat ? "repeat" : "group",
          name: name || `group_${top().length}`,
          ...(label ? { label } : {}),
          ...(relevant ? { relevant } : {}),
        };
        stack.push({ container, children: [] });
      } else {
        const frame = stack.pop();
        if (!frame) throw new Error("unbalanced end without begin");
        void isGroup;
        top().push({
          kind: frame.container.kind ?? "group",
          name: frame.container.name!,
          ...(frame.container.label ? { label: frame.container.label } : {}),
          ...(frame.container.relevant ? { relevant: frame.container.relevant } : {}),
          children: frame.children,
        } satisfies FormContainer);
      }
      continue;
    }

    if (!XLSFORM_FIELD_TYPES.includes(head as FieldType)) continue; // unknown widget, skip
    const type = head as FieldType;
    if (!name) throw new Error(`row with type '${rawType}' has no name`);
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
      ...(listName ? { list: listName } : {}),
      ...(listName && lists.has(listName) ? { choices: lists.get(listName)! } : {}),
    };
    top().push(field);
  }

  if (stack.length) throw new Error("unbalanced begin without end");

  return {
    key: meta.key,
    version: meta.version ?? 1,
    title,
    nodes: root,
    ...(meta.boardTemplate ? { boardTemplate: meta.boardTemplate } : {}),
  };
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
    choices: z.array(z.object({ name: z.string(), label: z.string() })).optional(),
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
