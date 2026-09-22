import { useMemo, useState, type CSSProperties } from "react";
import { StatusBadge, type Status } from "../design/components.js";
import { Icon, LifelineIcon, lifelineIconByKey, type LifelineKey } from "../design/icons/index.js";
import {
  OperationalTable,
  createOperationalTableViewState,
  type OperationalTableColumn,
} from "../design/table.js";
import { LIFELINE_STATUS_COLOR, ESF_STATUS_COLOR } from "@openeoc/shared";
import type {
  ChartResult,
  DashboardSnapshot,
  ListResult,
  StatusResult,
  TileResult,
  WidgetResult,
} from "@openeoc/shared";

/**
 * Dashboard renderer. Everything on screen is a server-computed
 * snapshot; this component never fetches raw records and never joins.
 * Live updates arrive as replacement snapshots over the dashboard stream.
 */

type Drill = (field: string, value: string) => void;

export function Dashboard(props: { snapshot: DashboardSnapshot; onDrill?: Drill | undefined }) {
  return (
    <section aria-label={props.snapshot.title}>
      <h2 style={{ margin: "0 0 8px" }}>{props.snapshot.title}</h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {props.snapshot.widgets.map((w) => (
          <DashboardWidget key={w.key} widget={w} onDrill={props.onDrill} />
        ))}
      </div>
    </section>
  );
}

export function DashboardWidget(props: { widget: WidgetResult; onDrill?: Drill | undefined }) {
  const w = props.widget;
  return (
    <article
      data-testid={`widget-${w.key}`}
      aria-label={w.title}
      style={{
        border: "1px solid var(--eoc-border)",
        borderRadius: "var(--eoc-radius-md)",
        boxShadow: "var(--eoc-shadow-sm)",
        padding: 14,
        background: "var(--eoc-surface)",
      }}
    >
      <h3
        style={{
          margin: "0 0 10px",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--eoc-text-muted)",
        }}
      >
        {w.title}
      </h3>
      {w.missing ? (
        <p style={{ margin: 0, color: "var(--eoc-text-muted)" }}>
          No matching board in this jurisdiction.
        </p>
      ) : (
        renderBody(w, props.onDrill)
      )}
    </article>
  );
}

function renderBody(w: WidgetResult, onDrill?: Drill | undefined) {
  if (w.kind === "tile") return <Tile widget={w} />;
  if (w.kind === "chart") return <Chart widget={w} onDrill={onDrill} />;
  if (w.kind === "status") return <StatusGrid widget={w} />;
  return <List widget={w} />;
}

const TILE_STATUS: Record<TileResult["level"], Status> = {
  normal: "success",
  warn: "warning",
  critical: "critical",
};

function Tile(props: { widget: TileResult }) {
  const trend = props.widget.trend ?? 0;
  return (
    <div>
      <p style={{ margin: 0, fontSize: 32, fontWeight: 600 }}>
        <span data-testid={`tile-${props.widget.key}-value`}>{props.widget.value}</span>{" "}
        <StatusBadge status={TILE_STATUS[props.widget.level]}>{props.widget.level}</StatusBadge>
      </p>
      {trend > 0 ? (
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--eoc-text-muted)" }}>
          +{trend} last 24h
        </p>
      ) : null}
    </div>
  );
}

// A small categorical set drawn from the status tokens, so the donut stays on
// the design system's palette (color reserved for status, INV-8) while giving
// the WebEOC ring-chart form.
const DONUT_COLORS = [
  "var(--eoc-status-info)",
  "var(--eoc-status-warning)",
  "var(--eoc-status-success)",
  "var(--eoc-status-critical)",
  "var(--eoc-status-unknown)",
];

function Chart(props: { widget: ChartResult; onDrill?: Drill | undefined }) {
  return props.widget.display === "donut" ? (
    <Donut widget={props.widget} onDrill={props.onDrill} />
  ) : (
    <BarChart widget={props.widget} onDrill={props.onDrill} />
  );
}

// A drill affordance for a chart group, when the chart exposes its group field.
function drillOf(widget: ChartResult, onDrill?: Drill | undefined): ((value: string) => void) | null {
  return onDrill && widget.field ? (value) => onDrill(widget.field!, value) : null;
}

const drillButton: CSSProperties = {
  background: "none",
  border: "none",
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
  width: "100%",
  textAlign: "left",
  padding: "4px 2px",
};

function BarChart(props: { widget: ChartResult; onDrill?: Drill | undefined }) {
  const max = Math.max(1, ...props.widget.groups.map((g) => g.count));
  const drill = drillOf(props.widget, props.onDrill);
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
      {props.widget.groups.map((g) => {
        const row = (
          <span style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, alignItems: "center" }}>
            <span>{g.value || "(none)"}</span>
            <span
              role="img"
              aria-label={`${g.value}: ${g.count}`}
              style={{
                alignSelf: "center",
                height: 10,
                width: `${Math.round((g.count / max) * 100)}%`,
                minWidth: 2,
                background: "var(--eoc-status-info)",
                borderRadius: 2,
              }}
            />
            <span>{g.count}</span>
          </span>
        );
        return (
          <li key={g.value}>
            {drill ? (
              <button
                type="button"
                style={drillButton}
                aria-label={`Filter by ${g.value || "(none)"}`}
                onClick={() => drill(g.value)}
              >
                {row}
              </button>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** WebEOC-style ring chart: a donut with the total in the center and a legend
 * of counts and percentages. */
function Donut(props: { widget: ChartResult; onDrill?: Drill | undefined }) {
  const groups = props.widget.groups;
  const total = groups.reduce((s, g) => s + g.count, 0);
  const drill = drillOf(props.widget, props.onDrill);
  const R = 16;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <svg
        width="96"
        height="96"
        viewBox="0 0 40 40"
        role="img"
        aria-label={`${props.widget.title}: ${total} total`}
      >
        <circle cx="20" cy="20" r={R} fill="none" stroke="var(--eoc-border)" strokeWidth="6" />
        {total > 0
          ? groups.map((g, i) => {
              const dash = (g.count / total) * C;
              const seg = (
                <circle
                  key={g.value}
                  cx="20"
                  cy="20"
                  r={R}
                  fill="none"
                  stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
                  strokeWidth="6"
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 20 20)"
                />
              );
              offset += dash;
              return seg;
            })
          : null}
        <text x="20" y="21.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--eoc-text)">
          {total}
        </text>
      </svg>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4, minWidth: 0 }}>
        {groups.map((g, i) => {
          const legend = (
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, width: "100%" }}>
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: DONUT_COLORS[i % DONUT_COLORS.length],
                  flex: "0 0 auto",
                }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>{g.value || "(none)"}</span>
              <span style={{ color: "var(--eoc-text-muted)" }}>
                {g.count} ({total > 0 ? Math.round((g.count / total) * 100) : 0}%)
              </span>
            </span>
          );
          return (
            <li key={g.value}>
              {drill ? (
                <button
                  type="button"
                  style={drillButton}
                  aria-label={`Filter by ${g.value || "(none)"}`}
                  onClick={() => drill(g.value)}
                >
                  {legend}
                </button>
              ) : (
                legend
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const LIFELINE_DOT: Record<string, string> = {
  green: "var(--eoc-status-success)",
  yellow: "var(--eoc-status-warning)",
  red: "var(--eoc-status-critical)",
  gray: "var(--eoc-status-unknown)",
};

// Lifelines and ESFs share the green/yellow/red/gray condition scale.
const CONDITION_COLOR: Record<string, string> = { ...LIFELINE_STATUS_COLOR, ...ESF_STATUS_COLOR };

/**
 * Community Lifelines as condition cards (the FEMA Incident Status board): one
 * card per lifeline, a colored status ring, and its current condition. The
 * newest submission per lifeline wins; older ones stay history.
 */
function StatusGrid(props: { widget: StatusResult }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: 8,
      }}
    >
      {props.widget.groups.map((g) => {
        const color = g.value ? (CONDITION_COLOR[g.value] ?? "gray") : "gray";
        const lifeline = g.group in lifelineIconByKey ? g.group as LifelineKey : null;
        return (
          <div
            key={g.group}
            style={{
              border: "1px solid var(--eoc-border)",
              borderRadius: 6,
              padding: "8px 10px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ color: LIFELINE_DOT[color] ?? LIFELINE_DOT.gray, display: "flex" }}>
              {lifeline
                ? <LifelineIcon lifeline={lifeline} decorative size={24} />
                : <Icon name="lifelines" decorative size={24} />}
            </span>
            <span style={{ display: "grid", minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{g.group}</span>
              <span style={{ fontSize: 12, color: "var(--eoc-text-muted)" }}>
                {g.value ?? "unknown"}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function List(props: { widget: ListResult }) {
  type Row = ListResult["records"][number];
  const columns = useMemo<readonly OperationalTableColumn<Row>[]>(
    () => props.widget.columns.map((key) => ({
      id: key,
      header: key.replaceAll("_", " "),
      value: (row: Row) => {
        const value = row[key];
        return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? value
          : value === null || value === undefined
            ? null
            : JSON.stringify(value);
      },
      sortable: true,
      filterable: true,
      missingLabel: "Not reported",
      minWidth: 120,
    })),
    [props.widget.columns],
  );
  const [view, setView] = useState(() => createOperationalTableViewState(columns, { pageSize: 10 }));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const filtered = useMemo(() => {
    const rows = props.widget.records.filter((row) => columns.every((column) => {
      const query = view.filters[column.id]?.trim().toLocaleLowerCase();
      return !query || String(column.value(row) ?? "").toLocaleLowerCase().includes(query);
    }));
    if (!view.sort) return rows;
    const column = columns.find((candidate) => candidate.id === view.sort?.columnId);
    if (!column) return rows;
    const direction = view.sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((left, right) =>
      String(column.value(left) ?? "").localeCompare(String(column.value(right) ?? "")) * direction,
    );
  }, [columns, props.widget.records, view.filters, view.sort]);
  const start = view.page * view.pageSize;
  const page = filtered.slice(start, start + view.pageSize);
  return (
    <OperationalTable
      tableId={`dashboard-${props.widget.key}`}
      caption={props.widget.title}
      columns={columns}
      rows={page}
      rowId={(row) => row.id}
      datasetKey={props.widget.key}
      status={filtered.length === 0 ? "empty" : "ready"}
      viewState={view}
      onViewStateChange={setView}
      totalRows={filtered.length}
      hasPreviousPage={view.page > 0}
      hasNextPage={start + view.pageSize < filtered.length}
      selectedIds={selected}
      onSelectionChange={setSelected}
      emptyTitle="No matching activity"
      emptyDescription="No records match the current dashboard filters."
    />
  );
}
