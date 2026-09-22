import { useEffect, useMemo, useState } from "react";
import type {
  DashboardComposition,
  DashboardCompositionPanel,
  DashboardCompositionSnapshot,
  DashboardContributionRecord,
  DashboardPanelSnapshot,
  ImpactCategoryAggregate,
  ViewportBbox,
  WidgetResult,
} from "@openeoc/shared";
import { LIFELINE_STATUS_COLOR, ESF_STATUS_COLOR } from "@openeoc/shared";
import { CopMap } from "../cop/CopMap.js";
import type { CopFeatureCollection } from "../cop/layers.js";
import {
  assetBase,
  basemapStyleUrl,
  buildingsSource,
  jurisdictionMapBounds,
  jurisdictionOverlays,
  rasterBasemaps,
  streetBasemap,
  terrainSource,
} from "../app/config.js";
import { KpiCard } from "../design/cards.js";
import { ActionButton } from "../design/controls.js";
import { ConditionBadge, ErrorState, LoadingState } from "../design/feedback.js";
import {
  Icon,
  LifelineIcon,
  iconRegistry,
  lifelineIconByKey,
  type IconName,
  type LifelineKey,
} from "../design/icons/index.js";
import type { OperationalState } from "../design/tokens.js";
import { DashboardWidget } from "./Dashboard.js";
import "./dashboard.css";

export interface DashboardMapRecords {
  readonly records: readonly DashboardContributionRecord[];
  readonly total: number;
}

export interface CompositionDashboardProps {
  readonly snapshot: DashboardCompositionSnapshot;
  readonly composition: DashboardComposition;
  readonly theme: "light" | "dark";
  readonly initialMapBounds?: ViewportBbox | undefined;
  readonly loadMapRecords: (panel: DashboardCompositionPanel) => Promise<DashboardMapRecords>;
  readonly onDrill: (panel: DashboardCompositionPanel, field: string, value: string) => void;
  readonly onOpenMap?: (() => void) | undefined;
}

function sourcePanel(
  composition: DashboardComposition,
  snapshot: DashboardPanelSnapshot,
): DashboardCompositionPanel | null {
  return composition.panels.find((panel) => panel.key === snapshot.key) ?? null;
}

function isWidget(value: DashboardPanelSnapshot["data"]): value is WidgetResult {
  return Boolean(value && typeof value === "object" && "kind" in value);
}

function isImpact(value: DashboardPanelSnapshot["data"]): value is ImpactCategoryAggregate {
  return Boolean(value && typeof value === "object" && "category" in value && "sources" in value);
}

function panelState(panel: DashboardPanelSnapshot): OperationalState {
  if (panel.state === "stale") return "stale";
  if (panel.state === "missing") return "unavailable";
  if (panel.state === "unsupported") return "notApplicable";
  return "normal";
}

function stateLabel(panel: DashboardPanelSnapshot): string {
  if (panel.state === "unsupported") return "Filter not applicable";
  if (panel.state === "missing") return "Unavailable";
  if (panel.state === "stale") return "Stale source";
  return "Current";
}

const IMPACT_ICON: Readonly<Record<ImpactCategoryAggregate["category"], IconName>> = {
  structures_parcels: "overview",
  infrastructure_facilities: "resources",
  shelters: "foodHydrationShelter",
  closures: "transportation",
  population: "participants",
};

const IMPACT_LABEL: Readonly<Record<ImpactCategoryAggregate["category"], string>> = {
  structures_parcels: "Structures and parcels",
  infrastructure_facilities: "Infrastructure facilities",
  shelters: "Shelters",
  closures: "Closures",
  population: "Population exposed",
};

function readableIdentifier(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function panelTitle(panel: DashboardPanelSnapshot, source: DashboardCompositionPanel | null): string {
  return source?.source === "impact" && !source.title ? IMPACT_LABEL[source.category] : panel.title;
}

function conditionState(value: string | null): OperationalState {
  const color = value ? (LIFELINE_STATUS_COLOR[value] ?? ESF_STATUS_COLOR[value]) : undefined;
  return color === "green" ? "normal" : color === "yellow" ? "watch" : color === "red" ? "critical" : "unknown";
}

function widgetIcon(panel: DashboardPanelSnapshot): IconName {
  if (isImpact(panel.data)) return IMPACT_ICON[panel.data.category];
  const text = `${panel.key} ${panel.title}`.toLocaleLowerCase();
  if (text.includes("shelter")) return "foodHydrationShelter";
  if (text.includes("task") || text.includes("due")) return "tasks";
  if (text.includes("report") || text.includes("activity")) return "fieldReports";
  if (text.includes("request") || text.includes("resource")) return "resources";
  if (text.includes("closure") || text.includes("road")) return "transportation";
  return "overview";
}

function ImpactTile(props: { panel: DashboardPanelSnapshot }) {
  const aggregate = isImpact(props.panel.data) ? props.panel.data : null;
  const value = !aggregate || props.panel.state === "missing"
    ? { kind: "unavailable" as const }
    : props.panel.state === "stale"
      ? { kind: "stale" as const }
      : aggregate.value === null
        ? { kind: "unknown" as const }
        : aggregate.value === 0
          ? { kind: "zero" as const, unit: aggregate.unit }
          : { kind: "value" as const, value: aggregate.value, unit: aggregate.unit };
  const reason = props.panel.reason ?? aggregate?.reason ?? null;
  return (
    <div className="p-dash-impact-tile">
      <KpiCard
        data-testid={`panel-${props.panel.key}`}
        label={props.panel.title}
        value={value}
        detail={aggregate ? `${readableIdentifier(aggregate.coverage)} coverage` : "Source unavailable"}
        leading={<Icon name={widgetIcon(props.panel)} decorative size={24} />}
      />
      {reason ? <details><summary>Source details</summary><p>{reason}</p></details> : null}
    </div>
  );
}

function TilePanel(props: {
  readonly panel: DashboardPanelSnapshot;
  readonly source: DashboardCompositionPanel | null;
  readonly onDrill: CompositionDashboardProps["onDrill"];
}) {
  if (props.source?.source === "impact" || isImpact(props.panel.data)) return <ImpactTile panel={props.panel} />;
  if (props.source?.source === "dashboard" && ["missing", "unsupported"].includes(props.panel.state)) {
    return <PanelUnavailable panel={props.panel} />;
  }
  if (isWidget(props.panel.data) && props.panel.data.kind === "tile") {
    const widget = props.panel.data;
    return (
      <KpiCard
        data-testid={`panel-${props.panel.key}`}
        label={props.panel.title}
        value={props.panel.state === "stale"
            ? { kind: "stale" }
          : widget.value === 0
            ? { kind: "zero" }
            : { kind: "value", value: widget.value }}
        {...(widget.trend
          ? { detail: `+${widget.trend} in the last 24 hours` }
          : props.panel.reason ? { detail: props.panel.reason } : {})}
        leading={<Icon name={widgetIcon(props.panel)} decorative size={24} />}
        {...(props.source?.source === "dashboard" && props.panel.contributionDrilldown
          ? { action: { label: "View records", onClick: () => props.onDrill(props.source!, "", "") } }
          : {})}
      />
    );
  }
  return <PanelUnavailable panel={props.panel} />;
}

function PanelUnavailable(props: { readonly panel: DashboardPanelSnapshot }) {
  return (
    <section className="p-dash-panel-state" data-testid={`panel-${props.panel.key}`} aria-label={props.panel.title}>
      <ConditionBadge state={panelState(props.panel)} label={stateLabel(props.panel)} />
      <h3>{props.panel.title}</h3>
      <p>{props.panel.reason ?? "The configured source is not available to this viewer."}</p>
    </section>
  );
}

function recordsToFeatures(records: readonly DashboardContributionRecord[]): CopFeatureCollection {
  return {
    type: "FeatureCollection",
    features: records.flatMap((record) => record.geometry ? [{
      type: "Feature" as const,
      id: record.id,
      geometry: record.geometry,
      properties: { ...record.data, id: record.id, observedAt: record.at },
    }] : []),
  };
}

function MapPanel(props: {
  readonly panel: DashboardPanelSnapshot;
  readonly source: DashboardCompositionPanel;
  readonly theme: CompositionDashboardProps["theme"];
  readonly initialBounds?: ViewportBbox | undefined;
  readonly loadRecords: CompositionDashboardProps["loadMapRecords"];
  readonly onOpenMap?: (() => void) | undefined;
}) {
  const [result, setResult] = useState<DashboardMapRecords | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setResult(null);
    setError(null);
    props.loadRecords(props.source).then((next) => {
      if (active) setResult(next);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [props.loadRecords, props.source]);
  if (error) return <ErrorState title={`Could not load ${props.panel.title}`} message={error} />;
  if (!result) return <LoadingState label={`Loading ${props.panel.title}`} lines={4} />;
  const features = recordsToFeatures(result.records);
  return (
    <section className="p-dash-map-panel" data-testid={`panel-${props.panel.key}`} aria-label={props.panel.title}>
      <header>
        <span><Icon name="map" decorative size={20} /><strong>{props.panel.title}</strong></span>
        <span>{features.features.length} mapped of {result.total} contributing records</span>
        {props.onOpenMap ? <ActionButton kind="quiet" onClick={props.onOpenMap}>Open full map</ActionButton> : null}
      </header>
      <div className="p-dash-map-canvas">
        <CopMap
          key={`${props.panel.key}-${props.theme}-${JSON.stringify(props.initialBounds)}`}
          theme={props.theme}
          boards={[{ id: props.panel.key, title: props.panel.title }]}
          fetchItems={() => Promise.resolve(features)}
          basemap={{ kind: "natural-earth", assetBase: assetBase() }}
          bundledBasemap={{ assetBase: assetBase() }}
          basemapStyleUrl={basemapStyleUrl()}
          streetBasemap={streetBasemap()}
          rasterBasemaps={rasterBasemaps()}
          terrain={terrainSource()}
          buildings={buildingsSource()}
          jurisdictionOverlays={jurisdictionOverlays()}
          initialBounds={props.initialBounds
            ? [props.initialBounds[0], props.initialBounds[1], props.initialBounds[2], props.initialBounds[3]]
            : jurisdictionMapBounds()}
        />
      </div>
    </section>
  );
}

function StandardPanel(props: {
  readonly panel: DashboardPanelSnapshot;
  readonly source: DashboardCompositionPanel | null;
  readonly onDrill: CompositionDashboardProps["onDrill"];
}) {
  if (!isWidget(props.panel.data)) return <PanelUnavailable panel={props.panel} />;
  if (props.panel.data.kind === "status") {
    return (
      <article className="p-dash-status-panel" data-testid={`panel-${props.panel.key}`} aria-label={props.panel.title}>
        <h3>{props.panel.title}</h3>
        <div className="p-dash-status-grid">
          {props.panel.data.groups.map((group) => {
            const lifeline = group.group in lifelineIconByKey ? group.group as LifelineKey : null;
            const label = lifeline ? iconRegistry[lifelineIconByKey[lifeline]].label : readableIdentifier(group.group);
            const state = conditionState(group.value);
            return (
              <div className="p-dash-status-item" data-state={state} key={group.group}>
                <span className="p-dash-status-icon">
                  {lifeline
                    ? <LifelineIcon lifeline={lifeline} decorative size={24} />
                    : <Icon name="lifelines" decorative size={24} />}
                </span>
                <span><strong>{label}</strong><ConditionBadge state={state} label={readableIdentifier(group.value ?? "unknown")} /></span>
              </div>
            );
          })}
        </div>
      </article>
    );
  }
  return (
    <div className="p-dash-standard-panel" data-testid={`panel-${props.panel.key}`}>
      <DashboardWidget
        widget={{ ...props.panel.data, title: props.panel.title }}
        onDrill={props.source ? (field, value) => props.onDrill(props.source!, field, value) : undefined}
      />
    </div>
  );
}

export function CompositionDashboard(props: CompositionDashboardProps) {
  const paired = useMemo(() => props.snapshot.panels.map((rawPanel) => {
    const source = sourcePanel(props.composition, rawPanel);
    return { panel: { ...rawPanel, title: panelTitle(rawPanel, source) }, source };
  }), [props.composition, props.snapshot.panels]);
  const tiles = paired.filter(({ panel }) => panel.presentation === "tile");
  const maps = paired.filter(({ panel }) => panel.presentation === "map");
  const statuses = paired.filter(({ panel }) => panel.presentation === "status");
  const lists = paired.filter(({ panel }) => panel.presentation === "list");
  const charts = paired.filter(({ panel }) => panel.presentation === "chart");
  return (
    <section className="p-dash-composition" aria-label={props.snapshot.title}>
      {tiles.length ? (
        <section className="p-dash-stats" aria-label="Incident statistics">
          {tiles.map(({ panel, source }) => <TilePanel key={panel.key} panel={panel} source={source} onDrill={props.onDrill} />)}
        </section>
      ) : null}
      {maps.length || statuses.length ? (
        <div className="p-dash-situation-row">
          <div className="p-dash-maps">
            {maps.map(({ panel, source }) => source && !["missing", "unsupported"].includes(panel.state) ? (
              <MapPanel key={panel.key} panel={panel} source={source} theme={props.theme}
                initialBounds={props.initialMapBounds} loadRecords={props.loadMapRecords} onOpenMap={props.onOpenMap} />
            ) : <PanelUnavailable key={panel.key} panel={panel} />)}
          </div>
          <section className="p-dash-lifelines" aria-label="Community Lifelines">
            {statuses.length ? statuses.map(({ panel, source }) => (
              <StandardPanel key={panel.key} panel={panel} source={source} onDrill={props.onDrill} />
            )) : (
              <section className="p-dash-panel-state" aria-label="Community Lifelines">
                <ConditionBadge state="unknown" label="Not configured" />
                <h3>Community Lifelines</h3>
                <p>Add a status panel from a dashboard definition to show reported conditions.</p>
              </section>
            )}
          </section>
        </div>
      ) : null}
      {charts.length ? (
        <div className="p-dash-charts">
          {charts.map(({ panel, source }) => <StandardPanel key={panel.key} panel={panel} source={source} onDrill={props.onDrill} />)}
        </div>
      ) : null}
      {lists.length ? (
        <section className="p-dash-activity" aria-label="Priority work and recent activity">
          {lists.map(({ panel, source }) => <StandardPanel key={panel.key} panel={panel} source={source} onDrill={props.onDrill} />)}
        </section>
      ) : null}
    </section>
  );
}
