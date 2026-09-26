import { useState, type CSSProperties } from "react";
import { IA_STRUCTURE_TYPES, PA_CATEGORIES, PA_CATEGORY_LABELS } from "@openeoc/shared";
import { readAllPages, type ApiClient } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import {
  ChartCard,
  DonutChart,
  HBarChart,
  StatusTiles,
  VBarChart,
  statusPalette,
  type ChartDatum,
} from "../design/charts/index.js";
import {
  DEGREE_LABELS,
  DEGREE_ORDER,
  SOURCE_LABELS,
  degreeLabel,
  dollars,
  incidentLabel,
  insuredLabel,
  structureLabel,
  type DamageReport,
  type PaItem,
} from "./model.js";
import { PaletteVariables, degreeColor, paCategoryColor } from "../dashboards/incident/palettes.js";
import "../dashboards/incident/incident-dashboards.css";

/**
 * The Damage Assessment dashboard: reports by moderation state, counted
 * structures by FEMA degree and by structure type, and Public Assistance
 * line items by work category A to G and by status. A tile, slice or bar
 * filters the list under the charts. Counted structures are accepted
 * reports, the rule the loss summary and declaration indicators use. Degree
 * and work category colors are the shared palette tables'.
 */

export type DamageChart = "report" | "degree" | "structure" | "category" | "paStatus";
export interface DamageFilter {
  readonly chart: DamageChart;
  readonly key: string;
}

const PA_STATUS: readonly { readonly key: string; readonly label: string; readonly color: string }[] = [
  { key: "draft", label: "Draft, not counted", color: statusPalette.notStarted },
  { key: "submitted", label: "Submitted", color: statusPalette.inProgress },
  { key: "reviewed", label: "Reviewed", color: statusPalette.complete },
];

const REPORT_TILES: readonly { readonly key: string; readonly label: string; readonly color: string }[] = [
  { key: "submitted", label: "In the intake queue", color: statusPalette.inProgress },
  { key: "approved", label: "Accepted and counted", color: statusPalette.complete },
  { key: "rejected", label: "Rejected", color: statusPalette.notStarted },
  { key: "pa", label: "Public Assistance line items", color: statusPalette.approved },
];

// Short enough to sit under a column; the list below keeps the full names.
const STRUCTURE_SHORT: Readonly<Record<string, string>> = {
  single_family: "Single-family", multi_family: "Multi-family", mobile_home: "Mobile home", business: "Business", other: "Other",
};

/** "Category A: Debris removal" reads "A: Debris removal" beside its bar. */
export const categoryLabel = (key: string) => (PA_CATEGORY_LABELS[key] ?? key).replace(/^Category /, "");

/** Which chart category a report or line item falls in, or null when that chart does not count it. */
export function damageKey(chart: DamageChart, row: DamageReport | PaItem): string | null {
  const report = "degree" in row ? row : null;
  if (chart === "report") return report ? report.status : "pa";
  if (chart === "degree") return report?.status === "approved" ? report.degree : null;
  if (chart === "structure") return report?.status === "approved" ? report.structure_type : null;
  if (report) return null;
  const item = row as PaItem;
  return chart === "category" ? item.category : item.status;
}

function tally(chart: DamageChart, rows: readonly (DamageReport | PaItem)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = damageKey(chart, row);
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Every chart's counts, from the same reports and line items the list shows. */
export function damageCharts(reports: readonly DamageReport[], items: readonly PaItem[]): Readonly<Record<DamageChart, ChartDatum[]>> {
  const rows = [...reports, ...items];
  const count = (chart: DamageChart) => tally(chart, rows);
  const withCounts = (keys: readonly string[], counts: Map<string, number>, label: (key: string) => string, color: (key: string) => string) =>
    [...new Set([...keys, ...counts.keys()])].map((key) => ({ key, label: label(key), value: counts.get(key) ?? 0, color: color(key) }));
  return {
    report: withCounts(REPORT_TILES.map((tile) => tile.key), count("report"),
      (key) => REPORT_TILES.find((tile) => tile.key === key)?.label ?? key,
      (key) => REPORT_TILES.find((tile) => tile.key === key)?.color ?? statusPalette.notStarted),
    degree: withCounts(DEGREE_ORDER, count("degree"), degreeLabel, (key) => degreeColor(key) ?? statusPalette.notStarted),
    structure: withCounts(IA_STRUCTURE_TYPES.values, count("structure"), (key) => STRUCTURE_SHORT[key] ?? structureLabel(key), () => statusPalette.approved),
    category: withCounts(PA_CATEGORIES.values, count("category"), categoryLabel, (key) => paCategoryColor(key) ?? statusPalette.notStarted),
    paStatus: withCounts(PA_STATUS.map((status) => status.key), count("paStatus"),
      (key) => PA_STATUS.find((status) => status.key === key)?.label ?? key,
      (key) => PA_STATUS.find((status) => status.key === key)?.color ?? statusPalette.notStarted),
  };
}

/** The rows a chart category holds, exactly those its count counted; accepted reports when nothing is chosen. */
export function damageRows(reports: readonly DamageReport[], items: readonly PaItem[], filter: DamageFilter | null) {
  const chosen: DamageFilter = filter ?? { chart: "report", key: "approved" };
  return {
    reports: reports.filter((report) => damageKey(chosen.chart, report) === chosen.key),
    items: items.filter((item) => damageKey(chosen.chart, item) === chosen.key),
  };
}

const TITLES: Readonly<Record<DamageChart, string>> = {
  report: "Reports",
  degree: "Counted structures by degree",
  structure: "Counted structures by type",
  category: "Public Assistance line items by category",
  paStatus: "Line items by status",
};

type Client = Pick<ApiClient, "listDamageReports" | "listPaItems">;

export function DamageDashboard(props: {
  readonly client: Client;
  readonly jurisdictionId: string;
  readonly revision: number;
  /** The selected incident: its records and those recorded with no incident, which are marked. None reads them all. */
  readonly incidentId?: string | null;
}) {
  const [filter, setFilter] = useState<DamageFilter | null>(null);
  const incidentId = props.incidentId ?? null;
  const scope = incidentId ? { incidentId } : {};
  // ponytail: reads every report and line item; an aggregate endpoint if a jurisdiction holds tens of thousands.
  const data = useAsync(async () => {
    const [reports, items] = await Promise.all([
      readAllPages(async (page) => {
        const result = await props.client.listDamageReports(props.jurisdictionId, { ...page, ...scope });
        return { items: result.assessments, nextCursor: result.nextCursor };
      }),
      readAllPages(async (page) => {
        const result = await props.client.listPaItems(props.jurisdictionId, { ...page, ...scope });
        return { items: result.items, nextCursor: result.nextCursor };
      }),
    ]);
    return { reports, items };
  }, [props.jurisdictionId, props.revision, incidentId]);
  const unscoped = (record: { readonly incident_id?: string | null }) =>
    incidentLabel(record, incidentId) === "No incident" ? " · No incident" : "";
  if (!data.data) {
    return data.error
      ? <p role="alert" className="eoc-dash-state is-error">Damage reports could not be loaded: {data.error}</p>
      : <p role="status" className="eoc-dash-state">Loading damage reports…</p>;
  }
  const { reports, items } = data.data;
  const charts = damageCharts(reports, items);
  const shown = damageRows(reports, items, filter);
  const choose = (chart: DamageChart, key: string) =>
    setFilter((current) => (current?.chart === chart && current.key === key ? null : { chart, key }));
  const selected = (chart: DamageChart) => (filter?.chart === chart ? filter.key : null);
  const listTitle = filter
    ? `${TITLES[filter.chart]}: ${charts[filter.chart].find((item) => item.key === filter.key)?.label ?? filter.key}`
    : "Accepted and counted reports";
  const count = shown.reports.length + shown.items.length;

  return (
    <div className="eoc-dash eoc-damage-dash">
      <PaletteVariables />
      <div className="eoc-dash-toolbar">
        <StatusTiles label="Reports and line items" items={charts.report}
          selectedKey={selected("report")} onSelect={(key) => choose("report", key)} />
      </div>
      <section className="eoc-dash-grid" aria-label="Damage assessment charts">
        <ChartCard title={TITLES.degree}>
          <DonutChart data={charts.degree} caption="Structures" size={136} emptyLabel="No accepted reports yet"
            selectedKey={selected("degree")} onSelect={(key) => choose("degree", key)}
            onView={(key) => setFilter({ chart: "degree", key })} />
        </ChartCard>
        <ChartCard title={TITLES.structure}>
          <VBarChart data={charts.structure} height={150} valueLabel="Structures" emptyLabel="No accepted reports yet"
            selectedKey={selected("structure")} onSelect={(key) => choose("structure", key)} />
        </ChartCard>
        <ChartCard title={TITLES.category}>
          <HBarChart data={charts.category} valueLabel="Line items" emptyLabel="No Public Assistance line items yet"
            selectedKey={selected("category")} onSelect={(key) => choose("category", key)} />
        </ChartCard>
        <ChartCard title={TITLES.paStatus}>
          <DonutChart data={charts.paStatus} caption="Line items" size={136} emptyLabel="No Public Assistance line items yet"
            selectedKey={selected("paStatus")} onSelect={(key) => choose("paStatus", key)}
            onView={(key) => setFilter({ chart: "paStatus", key })} />
        </ChartCard>
      </section>
      <p className="eoc-dash-note">Reports record an address and a position, not a jurisdiction or area, so there is no count by area.</p>
      <section className="eoc-dash-list" aria-labelledby="eoc-damage-list-title">
        <header>
          <h3 id="eoc-damage-list-title">
            {listTitle}
            <span className="eoc-dash-count"> {count} {shown.items.length > 0 ? (count === 1 ? "line item" : "line items") : count === 1 ? "report" : "reports"}</span>
          </h3>
          {filter ? <button type="button" className="eoc-dash-link" onClick={() => setFilter(null)}>Clear filter</button> : null}
        </header>
        {count === 0 ? <p className="eoc-dash-empty">{filter ? "Nothing in this category." : "No report has been accepted yet. Field assessments count as soon as they are saved; public reports count once a moderator accepts them."}</p> : (
          <ul className="eoc-dash-rows">
            {shown.reports.map((report) => (
              <li key={report.id} className="eoc-dash-row" style={{ "--eoc-dash-row-color": degreeColor(report.degree) ?? statusPalette.notStarted } as CSSProperties}>
                <span className="eoc-dash-row-main">
                  <strong>{report.address}</strong>
                  <span className="eoc-dash-muted">{DEGREE_LABELS[report.degree] ?? degreeLabel(report.degree)} · {structureLabel(report.structure_type)} · {SOURCE_LABELS[report.source]}{unscoped(report)}</span>
                </span>
                <span className="eoc-dash-row-facts">
                  <span>{dollars(report.estimated_loss)} estimated loss</span>
                  <span className="eoc-dash-muted">{insuredLabel(report.insured)} · {REPORT_TILES.find((tile) => tile.key === report.status)?.label ?? report.status}</span>
                </span>
              </li>
            ))}
            {shown.items.map((item) => (
              <li key={item.id} className="eoc-dash-row" style={{ "--eoc-dash-row-color": PA_STATUS.find((status) => status.key === item.status)?.color ?? statusPalette.notStarted } as CSSProperties}>
                <span className="eoc-dash-row-main">
                  <strong>{item.applicant}</strong>
                  <span className="eoc-dash-muted">{categoryLabel(item.category)}{item.site ? ` · ${item.site}` : ""}{unscoped(item)}</span>
                </span>
                <span className="eoc-dash-row-facts">
                  <span>{dollars(item.estimated_cost_cents / 100)} estimated cost</span>
                  <span className="eoc-dash-muted">{PA_STATUS.find((status) => status.key === item.status)?.label ?? item.status} · {item.percent_complete}% complete</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
