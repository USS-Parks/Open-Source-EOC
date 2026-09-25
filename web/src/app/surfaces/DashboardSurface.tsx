import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DashboardFilterSetSchema,
  type DashboardComposition,
  type DashboardCompositionPanel,
  type DashboardContributionRecord,
  type DashboardFilterMode,
  type DashboardFilterSet,
  type DashboardSnapshot,
  type ViewportBbox,
  type WidgetFilter,
} from "@openeoc/shared";
import { geometryBounds } from "../../cop/tools.js";
import { Dashboard, DashboardWidget } from "../../dashboards/Dashboard.js";
import { CompositionDashboard, type DashboardMapRecords } from "../../dashboards/CompositionDashboard.js";
import { DashboardConfigurator, type DashboardDefinitionOption } from "../../dashboards/DashboardConfigurator.js";
import { DashboardDefinitions } from "../../dashboards/DashboardDefinitions.js";
import { ActionButton } from "../../design/controls.js";
import { ConditionBadge, EmptyState as KitEmptyState, ErrorState } from "../../design/feedback.js";
import type { ThemeName } from "../../design/tokens.js";
import type { ApiClient, DashboardConfigResponse, DashboardListItem } from "../api/client.js";
import { useAsync, usePolled } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll } from "../screens/parts.js";

const ROUTE_STATE_LIMIT = 256;

export interface DashboardViewState {
  readonly scope: "saved" | "incident";
  readonly filterMode?: DashboardFilterMode;
  readonly filters?: DashboardFilterSet;
  readonly bbox?: ViewportBbox;
}

function validBbox(value: unknown): value is ViewportBbox {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
    value[0] >= -180 && value[2] <= 180 && value[1] >= -90 && value[3] <= 90 &&
    value[0] < value[2] && value[1] < value[3];
}

/** Parse the bounded shell route payload. Invalid or incompatible state is ignored. */
export function parseDashboardViewState(text: string | undefined): DashboardViewState | undefined {
  if (!text || text.length > ROUTE_STATE_LIMIT) return undefined;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    if (!Object.keys(value).every((key) => ["scope", "filterMode", "filters", "bbox"].includes(key))) return undefined;
    if (value.scope !== "saved" && value.scope !== "incident") return undefined;
    const filterMode = value.filterMode;
    if (filterMode !== undefined && !["inherit", "replace", "clear"].includes(String(filterMode))) return undefined;
    const parsedFilters = value.filters === undefined ? undefined : DashboardFilterSetSchema.safeParse(value.filters);
    if (parsedFilters && !parsedFilters.success) return undefined;
    if (value.bbox !== undefined && !validBbox(value.bbox)) return undefined;
    if (value.scope === "incident" && value.bbox !== undefined) return undefined;
    if (filterMode === "clear" && value.filters !== undefined) return undefined;
    return {
      scope: value.scope,
      ...(filterMode ? { filterMode: filterMode as DashboardFilterMode } : {}),
      ...(parsedFilters?.success ? { filters: parsedFilters.data } : {}),
      ...(value.bbox ? { bbox: value.bbox as ViewportBbox } : {}),
    };
  } catch {
    return undefined;
  }
}

export interface DashboardSurfaceProps {
  readonly client: ApiClient;
  readonly theme: ThemeName;
  readonly incidentId: string | null;
  readonly dashboardId?: string | undefined;
  readonly dashboards: readonly DashboardListItem[];
  readonly configKey: string | null;
  readonly filter: WidgetFilter | null;
  readonly viewState?: DashboardViewState | undefined;
  readonly onConfigKey: (key: string | null) => void;
  readonly onFilter: (filter: WidgetFilter | null) => void;
  readonly onViewStateChange: (state: DashboardViewState) => void;
  readonly onOpenMap?: (() => void) | undefined;
  /** Opens a board record, from a calendar widget's item. */
  readonly onOpenRecord?: ((boardId: string, recordId: string) => void) | undefined;
  /** With a jurisdiction, the surface also lists its dashboards; administrators create them. */
  readonly jurisdictionId?: string | undefined;
  readonly isAdmin?: boolean | undefined;
  readonly onDashboardsChanged?: (() => void) | undefined;
}

async function allDashboardConfigs(client: ApiClient, incidentId: string) {
  const configs = [] as Awaited<ReturnType<ApiClient["listDashboardConfigs"]>>["configs"];
  let cursor: string | undefined;
  do {
    const page = await client.listDashboardConfigs(incidentId, { ...(cursor ? { cursor } : {}), limit: 100 });
    configs.push(...page.configs);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return configs;
}

export function DashboardViewControls(props: {
  readonly value: DashboardViewState;
  readonly error: string | null;
  readonly onChange: (state: DashboardViewState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [categoryField, setCategoryField] = useState(props.value.filters?.category?.field ?? "");
  const [category, setCategory] = useState(String(props.value.filters?.category?.equals ?? ""));
  const [periodField, setPeriodField] = useState(props.value.filters?.operationalPeriod?.field ?? "");
  const [periodRevision, setPeriodRevision] = useState(props.value.filters?.operationalPeriod?.areaRevision?.toString() ?? "");
  const [from, setFrom] = useState(props.value.filters?.date?.from ?? "");
  const [to, setTo] = useState(props.value.filters?.date?.to ?? "");
  const [validation, setValidation] = useState<string | null>(null);

  // The fields follow the applied filters when those change, and only then:
  // the value is parsed from the route on every render of the console, so
  // following its identity would clear what the operator is typing each time
  // the console refreshes.
  const applied = JSON.stringify(props.value.filters ?? null);
  useEffect(() => {
    const filters = JSON.parse(applied) as DashboardViewState["filters"] | null;
    setCategoryField(filters?.category?.field ?? "");
    setCategory(String(filters?.category?.equals ?? ""));
    setPeriodField(filters?.operationalPeriod?.field ?? "");
    setPeriodRevision(filters?.operationalPeriod?.areaRevision?.toString() ?? "");
    setFrom(filters?.date?.from ?? "");
    setTo(filters?.date?.to ?? "");
  }, [applied]);

  const apply = () => {
    const candidate = {
      ...(categoryField || category ? { category: { field: categoryField, equals: category } } : {}),
      ...(periodField || periodRevision ? {
        operationalPeriod: { field: periodField, areaRevision: Number(periodRevision) },
      } : {}),
      ...(from || to ? { date: { ...(from ? { from } : {}), ...(to ? { to } : {}) } } : {}),
    };
    const parsed = DashboardFilterSetSchema.safeParse(candidate);
    if (!parsed.success) {
      setValidation(parsed.error.issues[0]?.message ?? "Dashboard filters are invalid.");
      return;
    }
    setValidation(null);
    props.onChange({ ...props.value, filterMode: "replace", filters: parsed.data });
  };

  const changeScope = (scope: DashboardViewState["scope"]) => {
    props.onChange(scope === "saved"
      ? { ...props.value, scope }
      : {
          scope,
          ...(props.value.filterMode ? { filterMode: props.value.filterMode } : {}),
          ...(props.value.filters ? { filters: props.value.filters } : {}),
        });
  };

  return (
    <section className="p-dash-filter-panel" aria-label="Dashboard scope and filters">
      <header>
        <h2>Scope and filters</h2>
        <ActionButton kind="quiet" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Hide filters" : "Edit filters"}
        </ActionButton>
      </header>
      <div className="p-dash-context-line">
        <ConditionBadge
          state={props.value.scope === "incident" ? "normal" : "unknown"}
          label={props.value.scope === "incident" ? "Entire incident area" : "Saved view scope"}
        />
        <span>Filter mode: {props.value.filterMode ?? "inherit"}</span>
        {props.value.filters?.category ? <span>Category: {String(props.value.filters.category.equals)}</span> : null}
        {props.value.filters?.operationalPeriod
          ? <span>Area revision: {props.value.filters.operationalPeriod.areaRevision}</span>
          : null}
      </div>
      {open ? (
        <>
          <div className="p-dash-filter-grid">
            <label>
              Geographic scope
              <select
                value={props.value.scope}
                onChange={(event) => changeScope(event.target.value === "incident" ? "incident" : "saved")}
              >
                <option value="saved">Saved viewport</option>
                <option value="incident">Entire incident area</option>
              </select>
            </label>
            <label>Category field<input value={categoryField} onChange={(event) => setCategoryField(event.target.value)} /></label>
            <label>Category value<input value={category} onChange={(event) => setCategory(event.target.value)} /></label>
            <label>Period field<input value={periodField} onChange={(event) => setPeriodField(event.target.value)} /></label>
            <label>Area revision<input inputMode="numeric" value={periodRevision} onChange={(event) => setPeriodRevision(event.target.value)} /></label>
            <label>From, ISO timestamp<input value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>To, ISO timestamp<input value={to} onChange={(event) => setTo(event.target.value)} /></label>
          </div>
          {validation ? <p className="p-dash-inline-error" role="alert">{validation}</p> : null}
          {props.error ? <p className="p-dash-inline-error" role="alert">{props.error}</p> : null}
          <div className="p-dash-actions">
            <ActionButton kind="primary" onClick={apply}>Apply filters</ActionButton>
            <ActionButton kind="quiet" onClick={() => props.onChange({ scope: props.value.scope, filterMode: "clear" })}>
              Clear filters
            </ActionButton>
          </div>
        </>
      ) : null}
    </section>
  );
}

function SupportingRecords(props: {
  readonly title: string;
  readonly records: DashboardMapRecords | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
}) {
  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const record of props.records?.records ?? []) for (const key of Object.keys(record.data)) keys.add(key);
    return [...keys].slice(0, 12);
  }, [props.records]);
  return (
    <section className="p-dash-drilldown" aria-label={`Supporting records for ${props.title}`}>
      <header><h2>Supporting records: {props.title}</h2><ActionButton kind="quiet" onClick={props.onClose}>Close</ActionButton></header>
      {props.loading ? <Loading label="Loading supporting records…" /> : null}
      {props.error ? <ErrorState title="Could not load supporting records" message={props.error} /> : null}
      {props.records ? (
        <>
          <p>{props.records.records.length} of {props.records.total} contributing records loaded.</p>
          <DashboardWidget widget={{
            kind: "list",
            key: "supporting_records",
            title: props.title,
            columns: columns.length ? columns : ["record"],
            records: props.records.records.map((record) => ({ id: record.id, ...record.data })),
          }} />
        </>
      ) : null}
    </section>
  );
}

/** The incident Overview over one server-computed, revisioned dashboard composition. */
export function DashboardSurface(props: DashboardSurfaceProps) {
  const state = props.viewState ?? { scope: "incident" as const };
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [drill, setDrill] = useState<{
    source: Extract<DashboardCompositionPanel, { source: "dashboard" }>;
    title: string;
    group?: string;
  } | null>(null);
  const [drillResult, setDrillResult] = useState<DashboardMapRecords | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const configs = useAsync(
    () => props.incidentId ? allDashboardConfigs(props.client, props.incidentId) : Promise.resolve([]),
    [props.incidentId],
  );
  const definitions = useAsync<DashboardDefinitionOption[]>(
    () => props.incidentId
      ? Promise.all(props.dashboards.map((dashboard) => props.client.getDashboard(dashboard.id, props.incidentId!)))
      : Promise.resolve([]),
    [props.incidentId, props.dashboards.map((dashboard) => dashboard.id).join(",")],
  );

  useEffect(() => {
    if (!props.incidentId || !configs.data || editing) return;
    const selected = props.configKey
      ? configs.data.find((config) => config.key === props.configKey && config.valid)
      : null;
    if (selected) return;
    const first = configs.data.find((config) => config.valid);
    if (props.configKey !== (first?.key ?? null)) props.onConfigKey(first?.key ?? null);
  }, [configs.data, editing, props.configKey, props.incidentId, props.onConfigKey]);

  const config = useAsync<DashboardConfigResponse | null>(
    () => props.incidentId && props.configKey
      ? props.client.getDashboardConfig(props.incidentId, props.configKey)
      : Promise.resolve(null),
    [props.incidentId, props.configKey],
  );
  const snapshot = usePolled(
    () => props.incidentId && props.configKey
      ? props.client.dashboardConfigData(props.incidentId, props.configKey, {
          scope: state.scope,
          filterMode: state.filterMode ?? "inherit",
          ...(props.filter ? { runtimeFilter: props.filter } : {}),
          ...(state.filters ? { filters: state.filters } : {}),
          ...(state.bbox ? { bbox: state.bbox } : {}),
        })
      : Promise.resolve(null),
    5000,
    [props.incidentId, props.configKey, props.filter?.field, props.filter?.equals, JSON.stringify(state)],
  );
  const legacy = usePolled<DashboardSnapshot | null>(
    () => props.dashboardId
      ? props.client.dashboardData(
          props.dashboardId,
          props.filter ? { field: props.filter.field, equals: String(props.filter.equals) } : null,
          props.incidentId,
        )
      : Promise.resolve(null),
    5000,
    [props.dashboardId, props.filter?.field, props.filter?.equals, props.incidentId],
  );
  const area = useAsync(
    () => props.incidentId ? props.client.getIncidentArea(props.incidentId) : Promise.resolve(null),
    [props.incidentId],
  );

  const changeView = (next: DashboardViewState) => {
    const encoded = JSON.stringify(next);
    if (encoded.length > ROUTE_STATE_LIMIT) {
      setRouteError(`The selected filters need ${encoded.length} route characters; the supported maximum is ${ROUTE_STATE_LIMIT}. Shorten the field or value.`);
      return;
    }
    setRouteError(null);
    props.onViewStateChange(next);
  };

  const loadRecords = useCallback(async (
    source: Extract<DashboardCompositionPanel, { source: "dashboard" }>,
    group?: string,
  ): Promise<DashboardMapRecords> => {
    if (!props.incidentId) throw new Error("Select an incident before loading contributing records.");
    const records: DashboardContributionRecord[] = [];
    let cursor: string | undefined;
    let total: number;
    const seen = new Set<string>();
    do {
      const page = await props.client.dashboardContributions(source.dashboardId, source.widgetKey, {
        incidentId: props.incidentId,
        ...(props.filter ? { runtimeFilter: props.filter } : {}),
        ...(snapshot.data?.filters ? { filters: snapshot.data.filters } : {}),
        ...(group !== undefined ? { group } : {}),
        ...(snapshot.data?.scope.kind === "viewport" ? { bbox: snapshot.data.scope.bbox } : {}),
        ...(cursor ? { cursor } : {}),
        limit: 100,
      });
      total = page.total;
      records.push(...page.records);
      if (page.nextCursor && seen.has(page.nextCursor)) throw new Error("Contribution pagination repeated a cursor.");
      if (page.nextCursor) seen.add(page.nextCursor);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return { records, total };
  }, [props.client, props.filter, props.incidentId, snapshot.data?.filters, snapshot.data?.scope]);

  const loadMapRecords = useCallback((panel: DashboardCompositionPanel) => {
    if (panel.source !== "dashboard") {
      return Promise.reject(new Error("Impact aggregates do not expose map records through dashboard drilldown."));
    }
    return loadRecords(panel);
  }, [loadRecords]);

  const openDrill = (source: DashboardCompositionPanel, field: string, value: string, title: string) => {
    if (source.source !== "dashboard") return;
    setDrill({ source, title, ...(field ? { group: value } : {}) });
    if (field) props.onFilter({ field, equals: value });
  };

  useEffect(() => {
    if (!drill) {
      setDrillResult(null);
      setDrillError(null);
      return;
    }
    let active = true;
    setDrillLoading(true);
    setDrillResult(null);
    setDrillError(null);
    loadRecords(drill.source, drill.group).then((result) => {
      if (active) setDrillResult(result);
    }).catch((cause: unknown) => {
      if (active) setDrillError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setDrillLoading(false); });
    return () => { active = false; };
  }, [drill, loadRecords]);

  const save = (key: string, expectedRevision: number, composition: DashboardComposition) => {
    if (!props.incidentId) return;
    setSaving(true);
    setSaveError(null);
    props.client.putDashboardConfig(props.incidentId, key, expectedRevision, composition).then(() => {
      props.onConfigKey(key);
      setEditing(false);
      configs.reload();
      config.reload();
      snapshot.reload();
    }).catch((cause: unknown) => {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => setSaving(false));
  };

  const current = useMemo(
    () => config.data ? { revision: config.data.state.revision, composition: config.data.composition } : null,
    [config.data],
  );

  const jurisdictionDashboards = props.jurisdictionId ? (
    <DashboardDefinitions client={props.client} jurisdictionId={props.jurisdictionId} isAdmin={props.isAdmin ?? false}
      dashboards={props.dashboards} definitions={definitions.data ?? []} onCreated={props.onDashboardsChanged} />
  ) : null;

  if (!props.incidentId) {
    return (
      <Scroll><div className="p-dash-surface">
        <KitEmptyState title="Select an incident" description="Saved dashboards, impact totals and map records are incident scoped." />
        {legacy.data ? <Dashboard snapshot={legacy.data} onDrill={(field, value) => props.onFilter({ field, equals: value })} onOpenRecord={props.onOpenRecord} /> : null}
        {jurisdictionDashboards}
      </div></Scroll>
    );
  }

  const mapBounds = snapshot.data?.scope.kind === "viewport"
    ? snapshot.data.scope.bbox
    : geometryBounds(area.data?.geometry ?? null) ?? undefined;

  return (
    <Scroll><div className="p-dash-surface">
      <div className="p-dash-toolbar">
        <label>
          Saved dashboard
          <select aria-label="Saved dashboard" value={props.configKey ?? ""}
            onChange={(event) => props.onConfigKey(event.target.value || null)}>
            <option value="">No saved dashboard</option>
            {(configs.data ?? []).map((item) => (
              <option key={item.key} value={item.key} disabled={!item.valid}>
                {item.title ?? item.key}{item.valid ? "" : " — invalid"}
              </option>
            ))}
          </select>
        </label>
        <ActionButton kind="primary" onClick={() => setEditing(true)}>
          {config.data ? "Configure view" : "Create saved view"}
        </ActionButton>
        {props.filter ? (
          <ActionButton kind="quiet" onClick={() => props.onFilter(null)}>
            Clear {props.filter.field} = {String(props.filter.equals)}
          </ActionButton>
        ) : null}
      </div>

      {configs.error ? <ErrorNote message={configs.error} /> : null}
      {editing ? (
        <DashboardConfigurator
          current={current}
          initialKey={props.configKey ?? "incident-overview"}
          dashboards={definitions.data ?? []}
          saving={saving}
          error={saveError ?? definitions.error}
          onSave={save}
          onCancel={() => { setEditing(false); setSaveError(null); }}
        />
      ) : null}
      {props.configKey ? <DashboardViewControls value={state} error={routeError} onChange={changeView} /> : null}

      {snapshot.loading && !snapshot.data && props.configKey ? <Loading label="Loading saved dashboard…" /> : null}
      {snapshot.error && !snapshot.data ? <ErrorNote message={snapshot.error} /> : null}
      {legacy.loading && !legacy.data && props.dashboardId ? <Loading label="Loading dashboard…" /> : null}
      {legacy.error && !legacy.data ? <ErrorNote message={legacy.error} /> : null}
      {snapshot.data && config.data ? (
        <>
          {snapshot.error ? <ErrorNote message={`Dashboard refresh failed: ${snapshot.error}`} /> : null}
          <CompositionDashboard
            snapshot={snapshot.data}
            composition={config.data.composition}
            theme={props.theme}
            initialMapBounds={mapBounds}
            loadMapRecords={loadMapRecords}
            onDrill={(panel, field, value) => {
              const title = snapshot.data?.panels.find((candidate) => candidate.key === panel.key)?.title ?? panel.key;
              openDrill(panel, field, value, title);
            }}
            onOpenMap={props.onOpenMap}
            onOpenRecord={props.onOpenRecord}
          />
          <p className="p-dash-context-line">
            Updated {new Date(snapshot.data.computedAt).toLocaleTimeString()} · {snapshot.data.scope.kind === "viewport" ? "Viewport totals" : "Incident-area totals"}
          </p>
        </>
      ) : null}

      {!props.configKey && !configs.loading && !legacy.loading && !legacy.error ? (
        <KitEmptyState
          title="No saved incident overview"
          description="Create a saved view to choose real dashboard widgets and impact panels. No values are inferred or filled with demo data."
          action={<ActionButton kind="primary" onClick={() => setEditing(true)}>Create saved view</ActionButton>}
        />
      ) : null}
      {!props.configKey && legacy.data ? (
        <section aria-label="Legacy dashboard fallback">
          <p className="p-dash-context-line">Legacy dashboard · not a saved incident overview</p>
          <Dashboard snapshot={legacy.data} onDrill={(field, value) => props.onFilter({ field, equals: value })} onOpenRecord={props.onOpenRecord} />
        </section>
      ) : null}
      {drill ? (
        <SupportingRecords title={drill.title} records={drillResult} loading={drillLoading} error={drillError}
          onClose={() => { setDrill(null); props.onFilter(null); }} />
      ) : null}
      {jurisdictionDashboards}
    </div></Scroll>
  );
}
