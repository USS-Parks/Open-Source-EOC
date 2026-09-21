import { z } from "zod";
import type { SpatialQueryScope } from "../impact/contract.js";

/**
 * Dashboard definitions (VEOC-18). A dashboard is data, versioned and
 * shareable exactly like a board template. Widgets bind to board TEMPLATE
 * keys, not board ids, so one definition instantiates in any jurisdiction
 * against that jurisdiction's boards. All aggregation is server-side (the
 * anti-requirement AR6: no client-side join traps); the client renders a
 * computed snapshot and nothing else.
 */

const KEY = /^[a-z][a-z0-9_]*$/;

/** Equality filter over one record field (jsonb-typed comparison). */
export const WidgetFilterSchema = z.object({
  field: z.string().regex(KEY),
  equals: z.union([z.string(), z.number(), z.boolean()]),
});
export type WidgetFilter = z.infer<typeof WidgetFilterSchema>;

const widgetBase = {
  key: z.string().regex(KEY),
  title: z.string().min(1),
  /** Board TEMPLATE key; resolved to the jurisdiction's board at compute time. */
  board: z.string().regex(KEY),
  filter: WidgetFilterSchema.optional(),
};

/** Single number with optional thresholds (count of matching records). */
export const TileWidgetSchema = z.object({
  ...widgetBase,
  kind: z.literal("tile"),
  thresholds: z
    .object({ warn: z.number(), critical: z.number() })
    .refine((t) => t.critical >= t.warn, "critical threshold below warn")
    .optional(),
});

/** Record counts grouped by one field, drawn as bars or a donut. */
export const ChartWidgetSchema = z.object({
  ...widgetBase,
  kind: z.literal("chart"),
  groupBy: z.string().regex(KEY),
  display: z.enum(["bar", "donut"]).default("bar"),
});

/**
 * Latest value per group (e.g. current status per Community Lifeline:
 * newest record wins, older submissions remain history).
 */
export const StatusWidgetSchema = z.object({
  ...widgetBase,
  kind: z.literal("status"),
  groupBy: z.string().regex(KEY),
  valueField: z.string().regex(KEY),
});

/** Most recent records with chosen columns. */
export const ListWidgetSchema = z.object({
  ...widgetBase,
  kind: z.literal("list"),
  columns: z.array(z.string().regex(KEY)).min(1).max(12),
  limit: z.number().int().positive().max(100).default(10),
});

export const DashboardWidgetSchema = z.discriminatedUnion("kind", [
  TileWidgetSchema,
  ChartWidgetSchema,
  StatusWidgetSchema,
  ListWidgetSchema,
]);
export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>;

export const DashboardTemplateSchema = z.object({
  key: z.string().regex(KEY),
  version: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().max(2000).optional(),
  widgets: z.array(DashboardWidgetSchema).min(1).max(24),
});
export type DashboardTemplate = z.infer<typeof DashboardTemplateSchema>;

/** Computed snapshot shapes: what the server sends, all the client renders. */
export type TileLevel = "normal" | "warn" | "critical";

export interface TileResult {
  readonly kind: "tile";
  readonly key: string;
  readonly title: string;
  readonly missing?: boolean;
  readonly value: number;
  readonly level: TileLevel;
  /** Net new matching records in the last 24 hours (the KPI trend delta). */
  readonly trend?: number;
}
export interface ChartResult {
  readonly kind: "chart";
  readonly key: string;
  readonly title: string;
  readonly missing?: boolean;
  readonly display: "bar" | "donut";
  /** The board field this chart groups by, so a group can be drilled into. */
  readonly field?: string;
  readonly groups: ReadonlyArray<{ readonly value: string; readonly count: number }>;
}
export interface StatusResult {
  readonly kind: "status";
  readonly key: string;
  readonly title: string;
  readonly missing?: boolean;
  readonly groups: ReadonlyArray<{
    readonly group: string;
    readonly value: string | null;
    readonly at: string | null;
  }>;
}
export interface ListResult {
  readonly kind: "list";
  readonly key: string;
  readonly title: string;
  readonly missing?: boolean;
  readonly columns: readonly string[];
  readonly records: ReadonlyArray<Record<string, unknown> & { readonly id: string }>;
}
export type WidgetResult = TileResult | ChartResult | StatusResult | ListResult;

export interface DashboardSnapshot {
  readonly dashboardId: string;
  readonly scope?: SpatialQueryScope;
  readonly title: string;
  readonly computedAt: string;
  readonly widgets: readonly WidgetResult[];
  /** The runtime filter applied across the counting widgets, echoed so the
   *  view can show and clear it; null when the dashboard is unfiltered. */
  readonly filter?: WidgetFilter | null;
}

export function tileLevel(
  value: number,
  thresholds?: { warn: number; critical: number },
): TileLevel {
  if (!thresholds) return "normal";
  if (value >= thresholds.critical) return "critical";
  if (value >= thresholds.warn) return "warn";
  return "normal";
}

const d = (raw: DashboardTemplate): DashboardTemplate => DashboardTemplateSchema.parse(raw);

/** The shipped standard dashboard: EOC status over three related boards. */
export const STANDARD_DASHBOARDS: readonly DashboardTemplate[] = [
  d({
    key: "eoc_status",
    version: 1,
    title: "EOC Status",
    description:
      "Community Lifelines condition, shelter posture, and road closures in one live picture.",
    widgets: [
      {
        kind: "status",
        key: "lifelines",
        title: "Community Lifelines",
        board: "lifelines",
        groupBy: "lifeline",
        valueField: "status",
      },
      {
        kind: "status",
        key: "esfs",
        title: "Emergency Support Functions",
        board: "esf_status",
        groupBy: "esf",
        valueField: "status",
      },
      {
        kind: "tile",
        key: "closed_roads",
        title: "Closed roads",
        board: "road_closures",
        filter: { field: "status", equals: "closed" },
        thresholds: { warn: 1, critical: 5 },
      },
      {
        kind: "chart",
        key: "shelters_by_status",
        title: "Shelters by status",
        board: "shelters",
        groupBy: "status",
        display: "donut",
      },
      {
        kind: "list",
        key: "active_closures",
        title: "Active closures",
        board: "road_closures",
        filter: { field: "status", equals: "closed" },
        columns: ["road", "reason", "status"],
        limit: 10,
      },
    ],
  }),
];
