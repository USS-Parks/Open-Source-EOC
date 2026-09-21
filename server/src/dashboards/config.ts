import {
  DashboardCompositionSchema,
  DashboardFilterSetSchema,
  type DashboardComposition,
  type DashboardCompositionSnapshot,
  type DashboardFilterCapability,
  type DashboardFilterMode,
  type DashboardFilterSet,
  type DashboardPanelSnapshot,
  type SavedStatePayload,
  type SavedStateRecord,
  type ViewportBbox,
  type WidgetFilter,
} from "@openeoc/shared";
import { AuthError, type Principal } from "../auth/service.js";
import type { Sql } from "../db/client.js";
import { getIncidentAuthority } from "../incidents/participation.js";
import { getIncidentImpact } from "../impact/service.js";
import { spatialScope } from "../impact/bbox.js";
import {
  deleteSavedState,
  getSavedState,
  listSavedStates,
  saveSavedState,
} from "../saved-state/service.js";
import {
  computeDashboard,
  dashboardWidgetCapabilities,
  getDashboard,
  resolveDashboardOperationalPeriod,
} from "./service.js";

const KIND = "dashboard_config" as const;
const SCHEMA_VERSION = 1;

export interface DashboardConfigListItem {
  readonly key: string;
  readonly revision: number;
  readonly title: string | null;
  readonly valid: boolean;
  readonly reason: string | null;
  readonly updatedAt: string;
}

function parseComposition(state: SavedStateRecord): DashboardComposition {
  const parsed = DashboardCompositionSchema.safeParse(state.payload);
  if (!parsed.success)
    throw new AuthError(422, "saved dashboard config is invalid");
  return parsed.data;
}

function presentationCompatible(
  presentation: DashboardComposition["panels"][number]["presentation"],
  widgetKind: "tile" | "chart" | "status" | "list",
): boolean {
  if (presentation === "tile") return widgetKind === "tile";
  if (presentation === "chart") return widgetKind === "chart";
  if (presentation === "list") return widgetKind !== "status";
  return widgetKind !== "status";
}

async function validateComposition(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  composition: DashboardComposition,
): Promise<void> {
  for (const panel of composition.panels) {
    if (panel.source === "impact") continue;
    const dashboard = await getDashboard(sql, actor, panel.dashboardId, incidentId);
    const widget = dashboard.template.widgets.find((candidate) => candidate.key === panel.widgetKey);
    if (!widget) throw new AuthError(400, `dashboard widget ${panel.widgetKey} does not exist`);
    if (!presentationCompatible(panel.presentation, widget.kind))
      throw new AuthError(400, `${panel.presentation} does not support ${widget.kind} widget ${panel.widgetKey}`);
  }
}

export async function listDashboardConfigs(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  cursor: string | undefined,
  limit: number,
): Promise<{ configs: DashboardConfigListItem[]; nextCursor: string | null }> {
  const page = await listSavedStates(sql, actor, incidentId, KIND, cursor, limit);
  return {
    configs: page.states.map((state) => {
      const parsed = DashboardCompositionSchema.safeParse(state.payload);
      return {
        key: state.key,
        revision: state.revision,
        title: parsed.success ? parsed.data.title : null,
        valid: parsed.success,
        reason: parsed.success ? null : "saved dashboard config is invalid",
        updatedAt: state.updatedAt,
      };
    }),
    nextCursor: page.nextCursor,
  };
}

export async function getDashboardConfig(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  key: string,
): Promise<{ state: SavedStateRecord; composition: DashboardComposition }> {
  const state = await getSavedState(sql, actor, incidentId, KIND, key);
  return { state, composition: parseComposition(state) };
}

export async function putDashboardConfig(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  key: string,
  expectedRevision: number,
  rawComposition: unknown,
): Promise<{ state: SavedStateRecord; composition: DashboardComposition }> {
  const composition = DashboardCompositionSchema.parse(rawComposition);
  await resolveDashboardOperationalPeriod(
    sql, actor, incidentId, composition.defaultFilters?.operationalPeriod,
  );
  await validateComposition(sql, actor, incidentId, composition);
  const state = await saveSavedState(sql, actor, incidentId, KIND, key, {
    schemaVersion: SCHEMA_VERSION,
    expectedRevision,
    payload: composition as unknown as SavedStatePayload,
  });
  return { state, composition };
}

export async function removeDashboardConfig(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  key: string,
  expectedRevision: number,
): Promise<void> {
  await deleteSavedState(sql, actor, incidentId, KIND, key, expectedRevision);
}

function mergeFilters(
  defaults: DashboardFilterSet | undefined,
  requested: DashboardFilterSet | undefined,
): DashboardFilterSet | undefined {
  if (!defaults && !requested) return undefined;
  return DashboardFilterSetSchema.parse({
    ...defaults,
    ...requested,
    ...(defaults?.date || requested?.date
      ? { date: { ...defaults?.date, ...requested?.date } }
      : {}),
  });
}

function effectiveFilters(
  defaults: DashboardFilterSet | undefined,
  requested: DashboardFilterSet | undefined,
  mode: DashboardFilterMode,
): DashboardFilterSet | undefined {
  if (mode === "clear") return undefined;
  if (mode === "replace")
    return requested ? DashboardFilterSetSchema.parse(requested) : undefined;
  return mergeFilters(defaults, requested);
}

function activeCapabilities(filters: DashboardFilterSet | undefined): DashboardFilterCapability[] {
  const active: DashboardFilterCapability[] = [];
  if (filters?.category) active.push("category");
  if (filters?.operationalPeriod) active.push("operationalPeriod");
  if (filters?.date) active.push("date");
  return active;
}

function impactState(
  panel: Extract<DashboardComposition["panels"][number], { source: "impact" }>,
  category: Awaited<ReturnType<typeof getIncidentImpact>>["impact"]["categories"][keyof Awaited<ReturnType<typeof getIncidentImpact>>["impact"]["categories"]],
  notApplied: DashboardFilterCapability[],
): DashboardPanelSnapshot {
  const stale = category.availability === "stale" || category.availability === "mixed" &&
    category.sources.some((source) => source.availability === "stale");
  const state = notApplied.length > 0 ? "unsupported" :
    stale ? "stale" : category.value === null ? "missing" : "ready";
  const filterReason = notApplied.length > 0
    ? `${notApplied.join(", ")} filters do not apply to impact aggregates`
    : null;
  return {
    key: panel.key,
    title: panel.title ?? panel.category,
    source: "impact",
    presentation: panel.presentation,
    state,
    reason: filterReason ?? category.reason,
    filterCapabilities: ["bbox"],
    contributionDrilldown: category.sources.some((source) => source.datasetId !== null),
    notApplied,
    data: category,
  };
}

export async function computeDashboardConfig(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  key: string,
  runtimeFilter: WidgetFilter | undefined,
  requestedFilters: DashboardFilterSet | undefined,
  requestedBbox: ViewportBbox | null | undefined,
  filterMode: DashboardFilterMode = "inherit",
): Promise<DashboardCompositionSnapshot> {
  const { state, composition } = await getDashboardConfig(sql, actor, incidentId, key);
  if (filterMode === "clear" && runtimeFilter)
    throw new AuthError(400, "clear filter mode cannot include filters");
  const filters = effectiveFilters(composition.defaultFilters, requestedFilters, filterMode);
  const resolvedOperationalPeriod = await resolveDashboardOperationalPeriod(
    sql, actor, incidentId, filters?.operationalPeriod,
  );
  const bbox = requestedBbox === null ? undefined : requestedBbox ?? composition.bbox;
  const impactPanels = composition.panels.filter((panel) => panel.source === "impact");
  const impact = impactPanels.length > 0
    ? await getIncidentImpact(sql, actor, incidentId, undefined, bbox)
    : null;
  const dashboardCache = new Map<string, Awaited<ReturnType<typeof computeDashboard>>>();
  const panels: DashboardPanelSnapshot[] = [];

  for (const panel of composition.panels) {
    if (panel.source === "impact") {
      panels.push(impactState(panel, impact!.impact.categories[panel.category], activeCapabilities(filters)));
      continue;
    }
    let snapshot = dashboardCache.get(panel.dashboardId);
    let capabilities: Awaited<ReturnType<typeof dashboardWidgetCapabilities>>;
    try {
      if (!snapshot) {
        snapshot = await computeDashboard(
          sql, actor, panel.dashboardId, runtimeFilter, incidentId, bbox, filters,
        );
        dashboardCache.set(panel.dashboardId, snapshot);
      }
      capabilities = await dashboardWidgetCapabilities(
        sql, actor, panel.dashboardId, panel.widgetKey, incidentId, runtimeFilter, filters,
      );
    } catch (error) {
      if (!(error instanceof AuthError) || ![403, 404].includes(error.status)) throw error;
      await getIncidentAuthority(sql, actor, incidentId);
      panels.push({
        key: panel.key,
        title: panel.title ?? panel.widgetKey,
        source: "dashboard",
        presentation: panel.presentation,
        state: "missing",
        reason: "dashboard or widget source is unavailable",
        filterCapabilities: [],
        contributionDrilldown: false,
        notApplied: [],
        data: null,
      });
      continue;
    }
    const widget = snapshot.widgets.find((candidate) => candidate.key === panel.widgetKey);
    if (!widget) {
      panels.push({
        key: panel.key,
        title: panel.title ?? panel.widgetKey,
        source: "dashboard",
        presentation: panel.presentation,
        state: "missing",
        reason: "dashboard widget source is unavailable",
        filterCapabilities: [],
        contributionDrilldown: false,
        notApplied: [],
        data: null,
      });
      continue;
    }
    const mapMissing = panel.presentation === "map" && !capabilities.readableGeometry;
    panels.push({
      key: panel.key,
      title: panel.title ?? widget.title,
      source: "dashboard",
      presentation: panel.presentation,
      state: widget.missing || mapMissing ? "missing" : "ready",
      reason: mapMissing ? "map geometry is unavailable for this viewer" :
        widget.missing ? "widget source or readable fields are unavailable" : null,
      filterCapabilities: [
        "category", "operationalPeriod", "date",
        ...(capabilities.readableGeometry ? ["bbox" as const] : []),
      ],
      contributionDrilldown: capabilities.drilldown,
      notApplied: [],
      data: mapMissing ? null : widget,
    });
  }
  return {
    key,
    revision: state.revision,
    title: composition.title,
    computedAt: new Date().toISOString(),
    scope: spatialScope(bbox),
    filterMode,
    filters: filters ?? null,
    resolvedOperationalPeriod,
    panels,
  };
}
