import { z } from "zod";
import { IMPACT_CATEGORIES, type ImpactCategoryAggregate, type SpatialQueryScope } from "../impact/contract.js";

/**
 * Dashboard definitions. A dashboard is data, versioned and
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

const DashboardDateFilterSchema = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((value) => value.from !== undefined || value.to !== undefined, "date filter is empty")
  .refine(
    (value) => value.from === undefined || value.to === undefined ||
      Date.parse(value.from) < Date.parse(value.to),
    "date filter from must precede to",
  );

export const DashboardFilterSetSchema = z
  .object({
    category: WidgetFilterSchema.optional(),
    operationalPeriod: z.object({
      field: z.string().regex(KEY),
      areaRevision: z.number().int().positive(),
    }).strict().optional(),
    date: DashboardDateFilterSchema.optional(),
  })
  .strict();
export type DashboardFilterSet = z.infer<typeof DashboardFilterSetSchema>;

export interface DashboardResolvedOperationalPeriod {
  readonly areaRevision: number;
  readonly label: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

const DashboardBboxSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(
    ([west, south, east, north]) =>
      [west, south, east, north].every(Number.isFinite) &&
      west >= -180 && east <= 180 && south >= -90 && north <= 90 &&
      west < east && south < north,
    "bbox must be finite ordered WGS84 west,south,east,north",
  );

const DashboardPresentationSchema = z.enum(["tile", "chart", "list", "map", "status"]);
const DashboardPanelBase = {
  key: z.string().regex(KEY),
  title: z.string().min(1).max(200).optional(),
  presentation: DashboardPresentationSchema,
};
export const DashboardCompositionPanelSchema = z.discriminatedUnion("source", [
  z.object({
    ...DashboardPanelBase,
    source: z.literal("dashboard"),
    dashboardId: z.string().uuid(),
    widgetKey: z.string().regex(KEY),
  }).strict(),
  z.object({
    ...DashboardPanelBase,
    source: z.literal("impact"),
    category: z.enum(IMPACT_CATEGORIES),
  }).strict(),
]);
export type DashboardCompositionPanel = z.infer<typeof DashboardCompositionPanelSchema>;

export const DashboardCompositionSchema = z
  .object({
    title: z.string().min(1).max(200),
    panels: z.array(DashboardCompositionPanelSchema).min(1).max(24),
    defaultFilters: DashboardFilterSetSchema.optional(),
    bbox: DashboardBboxSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = new Set<string>();
    value.panels.forEach((panel, index) => {
      if (keys.has(panel.key)) ctx.addIssue({
        code: "custom",
        path: ["panels", index, "key"],
        message: "panel keys must be unique",
      });
      keys.add(panel.key);
    });
  });
export type DashboardComposition = z.infer<typeof DashboardCompositionSchema>;

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
  /** Composable filters applied in addition to the legacy runtime filter. */
  readonly filters?: DashboardFilterSet | null;
  readonly resolvedOperationalPeriod?: DashboardResolvedOperationalPeriod | null;
}

export interface DashboardContributionRecord {
  readonly id: string;
  readonly at: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly geometry?: Readonly<Record<string, unknown>> | null;
}

export interface DashboardContributionPage {
  readonly dashboardId: string;
  readonly widgetKey: string;
  readonly scope: SpatialQueryScope;
  readonly total: number;
  readonly records: readonly DashboardContributionRecord[];
  readonly nextCursor: string | null;
}

export type DashboardPanelState = "ready" | "stale" | "missing" | "unsupported";
export type DashboardFilterCapability = "category" | "operationalPeriod" | "date" | "bbox";
export type DashboardFilterMode = "inherit" | "replace" | "clear";

export interface DashboardPanelSnapshot {
  readonly key: string;
  readonly title: string;
  readonly source: "dashboard" | "impact";
  readonly presentation: "tile" | "chart" | "list" | "map" | "status";
  readonly state: DashboardPanelState;
  readonly reason: string | null;
  readonly filterCapabilities: readonly DashboardFilterCapability[];
  readonly contributionDrilldown: boolean;
  readonly notApplied: readonly DashboardFilterCapability[];
  readonly data: WidgetResult | ImpactCategoryAggregate | null;
}

export interface DashboardCompositionSnapshot {
  readonly key: string;
  readonly revision: number;
  readonly title: string;
  readonly computedAt: string;
  readonly scope: SpatialQueryScope;
  readonly filterMode: DashboardFilterMode;
  readonly filters: DashboardFilterSet | null;
  readonly resolvedOperationalPeriod: DashboardResolvedOperationalPeriod | null;
  readonly panels: readonly DashboardPanelSnapshot[];
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
