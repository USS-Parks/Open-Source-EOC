import { useRef, useState, type CSSProperties } from "react";
import type { AarObservation } from "@openeoc/shared";
import type { AarAnalyticsResponse, ApiClient } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ChartCard, DonutChart, HBarChart, VBarChart, statusPalette, type ChartDatum } from "../design/charts/index.js";
import {
  FOLLOW_THROUGH_CATEGORIES,
  PRIORITY_CATEGORIES,
  STATUS_CATEGORIES,
  dashboardCharts,
  dayBoundary,
  filterRecords,
  followThrough,
  localToday,
  type AarChart,
  type DashboardAction,
  type DashboardRecords,
} from "./dashboard.js";
import { capabilityLabel, elementLabel, type AarFilter } from "./model.js";
import "../dashboards/incident/incident-dashboards.css";

/**
 * The after-action dashboard, after WebEOC's: corrective actions by
 * priority, status and improvement plan follow-through, and records by core
 * capability and capability element. It counts this incident (for the
 * operational period chosen above it), or, switched to all incidents,
 * the corrective actions of every incident the reader may read that was
 * active in a date range, with the responsible organization beside them.
 * A slice, bar or legend row filters the list under the charts; VIEW opens
 * this incident's records list filtered the same way.
 */

type Scope = "incident" | "all";

const CHART_TITLES: Readonly<Record<AarChart, string>> = {
  priority: "Actions by priority",
  status: "Actions by status",
  followThrough: "Improvement plan",
  capability: "Core capability",
  element: "Capability element",
  organization: "Responsible organization",
};

function yearAgo(today: string): string {
  const [year, month, day] = today.split("-");
  return `${Number(year) - 1}-${month}-${day}`;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const categoryLabel = (categories: readonly { key: string; label: string }[], key: string) =>
  categories.find((item) => item.key === key)?.label ?? key;

export function AarDashboard(props: {
  readonly client: Pick<ApiClient, "getAarRollup">;
  /** This incident's records for the selected operational period. */
  readonly data: AarAnalyticsResponse;
  readonly periodLabel: string | null;
  /** Opens this incident's records list under a filter. */
  readonly onView: (filter: AarFilter) => void;
  /** The calendar date due dates are read against; today when left out. */
  readonly today?: string;
}) {
  const today = props.today ?? localToday();
  const [scope, setScope] = useState<Scope>("incident");
  const [from, setFrom] = useState(() => yearAgo(today));
  const [to, setTo] = useState(today);
  const [filter, setFilter] = useState<{ readonly chart: AarChart; readonly key: string } | null>(null);
  const list = useRef<HTMLElement>(null);
  const range = { from: dayBoundary(from), to: dayBoundary(to, true) };
  const rollup = useAsync(
    () => scope === "all" ? props.client.getAarRollup({
      ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}),
    }) : Promise.resolve(null),
    [scope, range.from, range.to],
  );
  const incidentNames = new Map((rollup.data?.incidents ?? []).map((incident) => [incident.id, incident.name]));
  const records: DashboardRecords | null = scope === "incident"
    ? { observations: props.data.observations, actions: props.data.correctiveActions }
    : rollup.data ? { observations: [], actions: rollup.data.correctiveActions } : null;
  const charts = records ? dashboardCharts(records, today) : null;
  const shown = records && filter ? filterRecords(records, filter.chart, filter.key, today) : records;

  const changeScope = (next: Scope) => { setScope(next); setFilter(null); };
  const choose = (chart: AarChart, key: string) =>
    setFilter((current) => (current?.chart === chart && current.key === key ? null : { chart, key }));
  const selected = (chart: AarChart) => (filter?.chart === chart ? filter.key : null);
  const view = (chart: AarChart, key: string) => {
    if (scope === "incident" && chart !== "organization") {
      props.onView({ dimension: chart, key });
      return;
    }
    setFilter({ chart, key });
    list.current?.focus();
  };
  const filterName = filter && charts
    ? `${CHART_TITLES[filter.chart]}: ${charts[filter.chart].find((item) => item.key === filter.key)?.label ?? filter.key}`
    : null;
  const count = shown ? shown.observations.length + shown.actions.length : 0;
  const recordsView: AarFilter | null = filter && scope === "incident" && filter.chart !== "organization"
    ? { dimension: filter.chart, key: filter.key } : null;

  const donut = (chart: AarChart, data: ChartDatum[]) => (
    <ChartCard title={CHART_TITLES[chart]}>
      <DonutChart data={data} caption="Actions" size={136} emptyLabel="No corrective actions yet"
        selectedKey={selected(chart)} onSelect={(key) => choose(chart, key)} onView={(key) => view(chart, key)} />
    </ChartCard>
  );

  return (
    <div className="eoc-dash eoc-aar-dash">
      <div className="eoc-dash-toolbar">
        <fieldset className="eoc-dash-scope">
          <legend className="eoc-visually-hidden">Count records from</legend>
          {(["incident", "all"] as const).map((value) => (
            <label key={value} className="eoc-dash-scope-option">
              <input type="radio" name="eoc-aar-scope" value={value} checked={scope === value}
                onChange={() => changeScope(value)} />
              <span>{value === "incident" ? "This incident" : "All incidents"}</span>
            </label>
          ))}
        </fieldset>
        {scope === "all" ? (
          <div className="eoc-dash-range">
            <label>From<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>To<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
          </div>
        ) : null}
        <p className="eoc-dash-summary" role="status">
          {scope === "incident"
            ? `${plural(props.data.observations.length, "observation")} and ${plural(props.data.correctiveActions.length, "corrective action")}${props.periodLabel ? ` in ${props.periodLabel}` : ", all operational periods"}.`
            : rollup.error ? `The incidents could not be counted: ${rollup.error}`
              : !rollup.data ? "Counting corrective actions across incidents…"
                : `${plural(rollup.data.correctiveActions.length, "corrective action")} across ${plural(rollup.data.incidents.length, "incident")} you can read, active in this range.`}
        </p>
      </div>
      {charts ? (
        <section className="eoc-aar-dash-grid" aria-label="After-action charts">
          <div className="eoc-aar-dash-column">
            {donut("priority", charts.priority)}
            {donut("status", charts.status)}
            {donut("followThrough", charts.followThrough)}
          </div>
          <ChartCard title={CHART_TITLES.capability}>
            <HBarChart data={charts.capability} valueLabel={scope === "incident" ? "Records" : "Corrective actions"}
              emptyLabel={scope === "incident" ? "No observations or corrective actions yet" : "No corrective actions in this range"}
              selectedKey={selected("capability")} onSelect={(key) => choose("capability", key)} />
          </ChartCard>
          <div className="eoc-aar-dash-column">
            <ChartCard title={CHART_TITLES.element}>
              <VBarChart data={charts.element} height={scope === "all" ? 180 : 300}
                valueLabel={scope === "incident" ? "Records" : "Corrective actions"}
                emptyLabel={scope === "incident" ? "No observations or corrective actions yet" : "No corrective actions in this range"}
                selectedKey={selected("element")} onSelect={(key) => choose("element", key)} />
            </ChartCard>
            {scope === "all" ? (
              <ChartCard title={CHART_TITLES.organization}>
                <HBarChart data={charts.organization} valueLabel="Corrective actions" emptyLabel="No corrective actions in this range"
                  selectedKey={selected("organization")} onSelect={(key) => choose("organization", key)} />
              </ChartCard>
            ) : null}
          </div>
        </section>
      ) : null}
      {shown ? (
        <section className="eoc-dash-list" aria-labelledby="eoc-aar-dash-list-title" ref={list} tabIndex={-1}>
          <header>
            <h3 id="eoc-aar-dash-list-title">
              {filterName ?? (scope === "incident" ? "Every record" : "Every corrective action")}
              <span className="eoc-dash-count"> {plural(count, scope === "incident" ? "record" : "corrective action")}</span>
            </h3>
            <span className="eoc-dash-list-tools">
              {recordsView ? (
                <button type="button" className="eoc-dash-link" onClick={() => props.onView(recordsView)}>
                  Open in the records list
                </button>
              ) : null}
              {filter ? <button type="button" className="eoc-dash-link" onClick={() => setFilter(null)}>Clear filter</button> : null}
            </span>
          </header>
          {count === 0 ? (
            <p className="eoc-dash-empty">{filter ? "Nothing in this category." : scope === "incident"
              ? "No observations or corrective actions are recorded for this incident yet. Record them on the Records tab."
              : "No incident you can read was active in this range with corrective actions."}</p>
          ) : (
            <ul className="eoc-dash-rows">
              {shown.actions.map((action) => (
                <ActionRow key={action.id} action={action} today={today}
                  incident={scope === "all" ? incidentNames.get(action.incidentId ?? "") ?? null : null} />
              ))}
              {shown.observations.map((observation) => <ObservationRow key={observation.id} observation={observation} />)}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ActionRow(props: { readonly action: DashboardAction; readonly today: string; readonly incident: string | null }) {
  const action = props.action;
  const status = STATUS_CATEGORIES.find((item) => item.key === action.status)!;
  const standing = followThrough(action, props.today);
  return (
    <li className="eoc-dash-row" style={{ "--eoc-dash-row-color": status.color } as CSSProperties}>
      <span className="eoc-dash-row-main">
        <strong>{action.recommendation}</strong>
        <span className="eoc-dash-muted">
          {[props.incident, capabilityLabel(action.capability), elementLabel(action.capabilityElement)].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="eoc-dash-row-facts">
        <span>{status.label} · {categoryLabel(PRIORITY_CATEGORIES, action.priority)} priority</span>
        <span className={standing === "past_due" ? "eoc-dash-pill" : "eoc-dash-muted"}>
          {action.dueDate ? `Due ${action.dueDate}` : "No due date"}{standing === "past_due" ? `, ${categoryLabel(FOLLOW_THROUGH_CATEGORIES, standing).toLocaleLowerCase()}` : ""}
        </span>
        <span className="eoc-dash-muted">
          {action.owner ? `${action.owner}${action.ownerOrganization ? `, ${action.ownerOrganization.name}` : ""}` : "No owner assigned"}
        </span>
      </span>
    </li>
  );
}

function ObservationRow(props: { readonly observation: AarObservation }) {
  const item = props.observation;
  return (
    <li className="eoc-dash-row" data-kind="observation"
      style={{ "--eoc-dash-row-color": item.kind === "strength" ? statusPalette.complete : statusPalette.inProgress } as CSSProperties}>
      <span className="eoc-dash-row-main">
        <strong>{item.observation}</strong>
        <span className="eoc-dash-muted">{capabilityLabel(item.capability)} · {elementLabel(item.capabilityElement)}</span>
      </span>
      <span className="eoc-dash-row-facts">
        <span>{item.kind === "strength" ? "Strength" : "Area for improvement"}</span>
        <span className="eoc-dash-muted">Observation</span>
      </span>
    </li>
  );
}
