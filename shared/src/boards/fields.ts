import { z } from "zod";
import { allEnums } from "../dictionary/citations.js";

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
  })
  .superRefine((f, ctx) => {
    if (f.type === "enum" && !f.enumId && (!f.values || f.values.length === 0)) {
      ctx.addIssue({ code: "custom", message: `enum field ${f.key} needs enumId or values` });
    }
    if (f.type === "enum" && f.enumId && !dictionaryValues(f.enumId)) {
      ctx.addIssue({ code: "custom", message: `unknown dictionary enum ${f.enumId}` });
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

export const BoardTemplateSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    version: z.number().int().positive(),
    title: z.string().min(1),
    description: z.string().default(""),
    fields: z.array(FieldDefSchema).min(1),
    views: z.array(ViewDefSchema).min(1),
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
    const base = fieldValueSchema(f);
    shape[f.key] = f.required ? base : base.optional();
  }
  return z.strictObject(shape);
}

/** A local (jurisdiction-added) field: additive, namespaced, never required. */
export const LocalFieldSchema = FieldDefSchema.superRefine((f, ctx) => {
  if (!f.key.startsWith("x_"))
    ctx.addIssue({ code: "custom", message: "local fields must use the x_ namespace" });
  if (f.required)
    ctx.addIssue({ code: "custom", message: "local fields cannot be required (additive only)" });
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
