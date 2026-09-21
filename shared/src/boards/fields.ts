import { z } from "zod";
import { allEnums } from "../dictionary/citations.js";
import { BoardWorkflowSchema } from "./workflow.js";

/**
 * Board field model (F1). A board template is data, never code: fields,
 * views, and permissions are declarative and validated here. Local
 * (jurisdiction-added) fields live in the reserved `x_` namespace so a
 * template upgrade can never collide with them (INV-5).
 */

export const FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "datetime",
  "enum",
  "person_ref",
  "record_ref",
  "geometry",
  "attachment",
] as const;

/** GeoJSON geometry kinds a geometry field may constrain itself to. */
export const GEOMETRY_KINDS = ["any", "point", "linestring", "polygon"] as const;

const position = z.tuple([z.number().finite(), z.number().finite()]);
const GeoJsonGeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: position }),
  z.object({ type: z.literal("LineString"), coordinates: z.array(position).min(2) }),
  z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(position).min(4)).min(1),
  }),
]);
export type GeoJsonGeometry = z.infer<typeof GeoJsonGeometrySchema>;

function geometrySchema(kind: (typeof GEOMETRY_KINDS)[number]): z.ZodType {
  if (kind === "point") return GeoJsonGeometrySchema.refine((g) => g.type === "Point");
  if (kind === "linestring")
    return GeoJsonGeometrySchema.refine((g) => g.type === "LineString");
  if (kind === "polygon") return GeoJsonGeometrySchema.refine((g) => g.type === "Polygon");
  return GeoJsonGeometrySchema;
}

/** Read visibility levels; write authority levels. Guests never write. */
export const READ_LEVELS = ["any", "member", "admin"] as const;
export const WRITE_LEVELS = ["member", "admin"] as const;

export const FieldConditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
  value: z.union([z.string(), z.number().finite(), z.boolean()]),
});

export const FieldCalculationSchema = z.object({
  op: z.enum(["sum", "subtract", "multiply", "divide"]),
  inputs: z.array(z.string().min(1)).min(1).max(8),
});

export const FieldDefSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case keys only"),
    label: z.string().min(1),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    /** For enum fields: a dictionary enumeration id, or inline values. */
    enumId: z.string().optional(),
    values: z.array(z.string().min(1)).optional(),
    /** For geometry fields: the GeoJSON kind this field accepts. */
    geometryKind: z.enum(GEOMETRY_KINDS).optional(),
    read: z.enum(READ_LEVELS).default("any"),
    write: z.enum(WRITE_LEVELS).default("member"),
    maxLength: z.number().int().positive().optional(),
    /** Declarative visibility/required condition; never executable code. */
    condition: FieldConditionSchema.optional(),
    /** Numeric calculation over direct numeric inputs; computed values are not stored. */
    calculation: FieldCalculationSchema.optional(),
    /** For record_ref fields: target template key and readable label field. */
    targetBoardKey: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
    labelField: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.type === "enum" && !f.enumId && (!f.values || f.values.length === 0)) {
      ctx.addIssue({ code: "custom", message: `enum field ${f.key} needs enumId or values` });
    }
    if (f.type === "enum" && f.enumId && !dictionaryValues(f.enumId)) {
      ctx.addIssue({ code: "custom", message: `unknown dictionary enum ${f.enumId}` });
    }
    if (f.type === "record_ref" && (!f.targetBoardKey || !f.labelField)) {
      ctx.addIssue({ code: "custom", message: `record_ref field ${f.key} needs targetBoardKey and labelField` });
    }
    if (f.calculation && f.type !== "number") {
      ctx.addIssue({ code: "custom", message: `calculated field ${f.key} must be numeric` });
    }
  });

export type FieldDef = z.infer<typeof FieldDefSchema>;

export const ViewDefSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  title: z.string().min(1),
  kind: z.literal("list").default("list"),
  columns: z.array(z.string().min(1)).min(1),
  filter: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum(["eq", "neq", "in"]),
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
      }),
    )
    .default([]),
  sort: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }).optional(),
});

export type ViewDef = z.infer<typeof ViewDefSchema>;

export const FormLayoutSchema = z.object({
  sections: z.array(z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    title: z.string().min(1),
    fields: z.array(z.string().min(1)).min(1),
  })).min(1).max(24),
});

export type FormLayout = z.infer<typeof FormLayoutSchema>;

export const BoardTemplateSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    version: z.number().int().positive(),
    title: z.string().min(1),
    description: z.string().default(""),
    fields: z.array(FieldDefSchema).min(1),
    views: z.array(ViewDefSchema).min(1),
    inputLayout: FormLayoutSchema.optional(),
    detailLayout: FormLayoutSchema.optional(),
    workflow: BoardWorkflowSchema.optional(),
  })
  .superRefine((t, ctx) => {
    const keys = new Set<string>();
    for (const f of t.fields) {
      if (keys.has(f.key))
        ctx.addIssue({ code: "custom", message: `duplicate field key ${f.key}` });
      keys.add(f.key);
      if (f.key.startsWith("x_"))
        ctx.addIssue({ code: "custom", message: `template fields may not use the local x_ namespace (${f.key})` });
    }
    for (const v of t.views) {
      for (const c of v.columns)
        if (!keys.has(c))
          ctx.addIssue({ code: "custom", message: `view ${v.key} references unknown field ${c}` });
    }
    for (const [name, layout] of [["input", t.inputLayout], ["detail", t.detailLayout]] as const) {
      if (!layout) continue;
      const used = new Set<string>();
      for (const section of layout.sections) for (const key of section.fields) {
        if (!keys.has(key)) ctx.addIssue({ code: "custom", message: `${name} layout references unknown field ${key}` });
        if (used.has(key)) ctx.addIssue({ code: "custom", message: `${name} layout repeats field ${key}` });
        used.add(key);
      }
    }
    for (const transition of t.workflow?.transitions ?? []) {
      const due = transition.due;
      if (due?.kind !== "record_field") continue;
      const dueField = t.fields.find((field) => field.key === due.field);
      if (!dueField) {
        ctx.addIssue({ code: "custom", message: `transition ${transition.key} has unknown due field ${due.field}` });
      } else if (dueField.type !== "datetime") {
        ctx.addIssue({ code: "custom", message: `transition ${transition.key} due field ${dueField.key} must be datetime` });
      }
    }
    const byKey = new Map(t.fields.map((field) => [field.key, field]));
    const readRank = { any: 0, member: 1, admin: 2 } as const;
    const dependencies = new Map<string, string[]>();
    for (const field of t.fields) {
      const refs: string[] = [];
      if (field.condition) refs.push(field.condition.field);
      if (field.calculation) refs.push(...field.calculation.inputs);
      dependencies.set(field.key, refs);
      for (const ref of refs) {
        const source = byKey.get(ref);
        if (!source) {
          ctx.addIssue({ code: "custom", message: `field ${field.key} references unknown field ${ref}` });
          continue;
        }
        if (readRank[source.read] > readRank[field.read])
          ctx.addIssue({ code: "custom", message: `field ${field.key} cannot expose restricted dependency ${ref}` });
      }
      if (field.condition) {
        const source = byKey.get(field.condition.field);
        if (source && !conditionValueMatches(source, field.condition.value, field.condition.op))
          ctx.addIssue({ code: "custom", message: `condition on ${field.key} is incompatible with ${source.key}` });
      }
      if (field.calculation) {
        const expected = field.calculation.op === "subtract" || field.calculation.op === "divide" ? 2 : null;
        if (expected && field.calculation.inputs.length !== expected)
          ctx.addIssue({ code: "custom", message: `${field.calculation.op} on ${field.key} requires two inputs` });
        for (const ref of field.calculation.inputs) {
          const source = byKey.get(ref);
          if (source && (source.type !== "number" || source.calculation))
            ctx.addIssue({ code: "custom", message: `calculation ${field.key} requires direct numeric input ${ref}` });
        }
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (key: string): boolean => {
      if (visiting.has(key)) return true;
      if (visited.has(key)) return false;
      visiting.add(key);
      for (const ref of dependencies.get(key) ?? []) if (visit(ref)) return true;
      visiting.delete(key); visited.add(key); return false;
    };
    for (const key of keys) if (visit(key)) {
      ctx.addIssue({ code: "custom", message: `field dependency cycle includes ${key}` });
      break;
    }
  });

export type BoardTemplate = z.infer<typeof BoardTemplateSchema>;

export function dictionaryValues(enumId: string): readonly string[] | null {
  const found = allEnums().find((e) => e.id === enumId);
  return found ? found.values : null;
}

function fieldValueSchema(f: FieldDef): z.ZodType {
  switch (f.type) {
    case "text":
      return z.string().max(f.maxLength ?? 4000);
    case "number":
      return z.number().finite();
    case "boolean":
      return z.boolean();
    case "datetime":
      return z.iso.datetime({ offset: true });
    case "person_ref":
    case "record_ref":
      return z.uuid();
    case "enum": {
      const values = f.enumId ? (dictionaryValues(f.enumId) ?? []) : (f.values ?? []);
      return z.enum(values as [string, ...string[]]);
    }
    case "geometry":
      return geometrySchema(f.geometryKind ?? "any");
    case "attachment":
      // Stores the id of an uploaded file (photo or document) in the store.
      return z.uuid();
  }
}

/** The key of a board's first geometry field, if any (its map layer). */
export function geometryFieldKey(fields: readonly FieldDef[]): string | null {
  return fields.find((f) => f.type === "geometry")?.key ?? null;
}

/**
 * Build the zod validator for a record against an effective field set
 * (template fields plus local fields). Unknown keys are rejected: a record
 * can never smuggle data outside the declared schema.
 */
export function buildRecordSchema(fields: readonly FieldDef[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    if (f.calculation) continue;
    const base = fieldValueSchema(f);
    shape[f.key] = f.required && !f.condition ? base : base.optional();
  }
  return z.strictObject(shape).superRefine((record, ctx) => {
    let derived: Record<string, unknown> = record;
    try { derived = deriveRecordValues(fields, record); }
    catch (error) {
      ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "invalid calculation" });
    }
    for (const field of fields) {
      const active = !field.condition || conditionMatches(field.condition, derived);
      if (field.required && (field.condition || field.calculation) && active && derived[field.key] === undefined)
        ctx.addIssue({ code: "custom", path: [field.key], message: `${field.label} is required when its condition matches` });
    }
  });
}

function conditionValueMatches(field: FieldDef, value: string | number | boolean, op: string): boolean {
  if (["gt", "gte", "lt", "lte"].includes(op) && field.type !== "number") return false;
  return fieldValueSchema(field).safeParse(value).success;
}

export function conditionMatches(
  condition: z.infer<typeof FieldConditionSchema>,
  record: Readonly<Record<string, unknown>>,
): boolean {
  const left = record[condition.field];
  if (left === undefined || left === null) return false;
  switch (condition.op) {
    case "eq": return left === condition.value;
    case "neq": return left !== condition.value;
    case "gt": return typeof left === "number" && typeof condition.value === "number" && left > condition.value;
    case "gte": return typeof left === "number" && typeof condition.value === "number" && left >= condition.value;
    case "lt": return typeof left === "number" && typeof condition.value === "number" && left < condition.value;
    case "lte": return typeof left === "number" && typeof condition.value === "number" && left <= condition.value;
  }
}

/** Add bounded calculated values for presentation without changing stored data. */
export function deriveRecordValues(
  fields: readonly FieldDef[],
  stored: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const output = { ...stored };
  for (const field of fields) if (field.calculation) delete output[field.key];
  for (const field of fields) {
    if (!field.calculation) continue;
    const values = field.calculation.inputs.map((key) => stored[key]);
    if (values.some((value) => value === undefined || value === null)) continue;
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value)))
      throw new Error(`calculation ${field.key} requires finite numeric inputs`);
    const nums = values as number[];
    let value: number;
    switch (field.calculation.op) {
      case "sum": value = nums.reduce((total, next) => total + next, 0); break;
      case "subtract": value = nums[0]! - nums[1]!; break;
      case "multiply": value = nums.reduce((total, next) => total * next, 1); break;
      case "divide":
        if (nums[1] === 0) throw new Error(`calculation ${field.key} cannot divide by zero`);
        value = nums[0]! / nums[1]!; break;
    }
    if (!Number.isFinite(value)) throw new Error(`calculation ${field.key} produced a non-finite value`);
    output[field.key] = value;
  }
  return output;
}

/** A local (jurisdiction-added) field: additive, namespaced, never required. */
export const LocalFieldSchema = FieldDefSchema.superRefine((f, ctx) => {
  if (!f.key.startsWith("x_"))
    ctx.addIssue({ code: "custom", message: "local fields must use the x_ namespace" });
  if (f.required)
    ctx.addIssue({ code: "custom", message: "local fields cannot be required (additive only)" });
  if (f.condition || f.calculation || f.type === "record_ref")
    ctx.addIssue({ code: "custom", message: "advanced authored fields require a versioned template" });
});

/**
 * Effective fields after applying local customization to a template, and
 * the re-convergence rule (INV-5): a local field whose key (minus the x_
 * prefix) now exists in the template is dropped in favor of the template's
 * definition, which is how divergent copies come back to a regional
 * standard.
 */
export function effectiveFields(
  template: BoardTemplate,
  localFields: readonly FieldDef[],
): { fields: FieldDef[]; dropped: string[] } {
  const templateKeys = new Set(template.fields.map((f) => f.key));
  const kept: FieldDef[] = [];
  const dropped: string[] = [];
  for (const lf of localFields) {
    if (templateKeys.has(lf.key.replace(/^x_/, ""))) dropped.push(lf.key);
    else kept.push(lf);
  }
  return { fields: [...template.fields, ...kept], dropped };
}
