import { z } from "zod";

/**
 * Data-pack contract (VEOC-79C). A participating organization onboards its
 * datasets into an incident at runtime, with no code change or redeploy, by
 * registering a pack: the organization is the source owner, and each dataset
 * declares how its source fields map onto the platform's normalized fields,
 * its geographic coverage, and how long its data stays fresh. A dataset whose
 * source is missing or stale reads as unavailable, never as a fabricated zero.
 */

/** The platform fields a source can be mapped onto. */
export const NORMALIZED_FIELDS = [
  "title",
  "category",
  "severity",
  "occurredAt",
  "status",
  "note",
] as const;
export type NormalizedField = (typeof NORMALIZED_FIELDS)[number];

const mappedPath = z.string().trim().min(1).max(200);

/**
 * Map platform fields to dot-paths into a source record. Each is optional, so
 * a pack maps only the fields its source carries; at least one is required.
 */
export const FieldMappingSchema = z
  .object({
    title: mappedPath.optional(),
    category: mappedPath.optional(),
    severity: mappedPath.optional(),
    occurredAt: mappedPath.optional(),
    status: mappedPath.optional(),
    note: mappedPath.optional(),
    /**
     * Stable source identity for idempotent persistence (VEOC-79C1). When the
     * source carries no id, items are keyed by a hash of their mapped content,
     * so a reload of the same content stays one row.
     */
    sourceId: mappedPath.optional(),
    /** Dot-path to a GeoJSON geometry on the source record (VEOC-79C1). */
    geometry: mappedPath.optional(),
  })
  .strict()
  .refine((m) => NORMALIZED_FIELDS.some((f) => m[f] !== undefined), "map at least one field");
export type FieldMapping = z.infer<typeof FieldMappingSchema>;

export const DATASET_KINDS = ["geojson", "cap", "georss", "cot", "table"] as const;

export const DataPackDatasetSchema = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, "lower_snake key")
      .max(64),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(DATASET_KINDS),
    url: z.string().url().max(2000).optional(),
    fieldMapping: FieldMappingSchema,
    // GeoJSON geometry; validated against PostGIS server-side, kept opaque here.
    coverage: z.unknown().optional(),
    staleAfterSeconds: z.number().int().min(60).max(604800).default(3600),
  })
  .strict();
export type DataPackDataset = z.infer<typeof DataPackDatasetSchema>;

export const DataPackSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    organizationSlug: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    datasets: z.array(DataPackDatasetSchema).min(1).max(50),
  })
  .strict()
  .refine(
    (p) => new Set(p.datasets.map((d) => d.key)).size === p.datasets.length,
    "dataset keys must be unique within a pack",
  );
export type DataPack = z.infer<typeof DataPackSchema>;

// --- Field-mapping engine (pure) ---

/** Resolve a dot-path (`a.b.c`) in a record; a missing step yields undefined. */
export function resolvePath(record: unknown, path: string): unknown {
  let cursor: unknown = record;
  for (const key of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/**
 * Apply a dataset's field mapping to one raw source record. A mapped path that
 * is absent yields null, never a fabricated zero or empty string, so a missing
 * source value is never mistaken downstream for a real one. Unmapped fields are
 * omitted entirely.
 */
export function applyFieldMapping(
  record: unknown,
  mapping: FieldMapping,
): Partial<Record<NormalizedField, unknown>> {
  const out: Partial<Record<NormalizedField, unknown>> = {};
  for (const field of NORMALIZED_FIELDS) {
    const path = mapping[field];
    if (path === undefined) continue;
    const value = resolvePath(record, path);
    out[field] = value === undefined ? null : value;
  }
  return out;
}

export interface MappedItem {
  /** The source's stable id, or null when the mapping names none. */
  readonly sourceId: string | null;
  readonly data: Partial<Record<NormalizedField, unknown>>;
  /** GeoJSON geometry when the mapping names a geometry path, else null. */
  readonly geometry: unknown | null;
}

/**
 * Map one raw source record to a persistable item (VEOC-79C1): its normalized
 * fields, its stable source id when the mapping names one (else null, so the
 * caller derives a content id for idempotent persistence), and its GeoJSON
 * geometry when a geometry path is mapped.
 */
export function mapItem(record: unknown, mapping: FieldMapping): MappedItem {
  const rawId = mapping.sourceId ? resolvePath(record, mapping.sourceId) : undefined;
  const sourceId = rawId === undefined || rawId === null ? null : String(rawId);
  const geometry = mapping.geometry ? (resolvePath(record, mapping.geometry) ?? null) : null;
  return { sourceId, data: applyFieldMapping(record, mapping), geometry };
}

// --- Dataset availability (missing is never zero) ---

export type DatasetAvailability = "available" | "stale" | "awaiting" | "unavailable";

export interface DatasetStatus {
  readonly key: string;
  readonly name: string;
  readonly kind: string;
  readonly organizationSlug: string;
  readonly organizationName: string;
  readonly availability: DatasetAvailability;
  /** null while awaiting or unavailable: an absent source is never reported as 0. */
  readonly itemCount: number | null;
  readonly coverageArea: number | null;
  readonly lastSuccessAt: string | null;
  readonly staleAfterSeconds: number;
  readonly reason: string | null;
  /** The last load's ingest tally (VEOC-79C2): how many items the source sent,
   *  and how many were not persisted (invalid or duplicate). Null before a load. */
  readonly lastReceived?: number | null;
  readonly lastRejected?: number | null;
}

/**
 * Classify a dataset's availability from its last successful load. Never
 * loaded is "awaiting"; a hard error is "unavailable"; a success older than
 * the freshness window is "stale"; otherwise "available". Callers must leave
 * itemCount null unless the dataset is available or stale, so missing data can
 * never be counted as zero impact.
 */
export function datasetAvailability(input: {
  lastSuccessAt: Date | null;
  lastError: string | null;
  staleAfterSeconds: number;
  now?: Date;
}): DatasetAvailability {
  if (input.lastSuccessAt === null) return input.lastError ? "unavailable" : "awaiting";
  // A prior success with a later error is last-good but not confirmed current:
  // the freshest refresh failed, so the dataset reads stale (never available)
  // with that error as its reason (VEOC-79C2).
  if (input.lastError) return "stale";
  const now = input.now ?? new Date();
  const ageSeconds = Math.floor((now.getTime() - input.lastSuccessAt.getTime()) / 1000);
  return ageSeconds > input.staleAfterSeconds ? "stale" : "available";
}
