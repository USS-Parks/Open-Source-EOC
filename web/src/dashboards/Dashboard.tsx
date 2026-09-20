import { StatusBadge, type Status } from "../design/components.js";
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
 * Dashboard renderer (VEOC-18). Everything on screen is a server-computed
 * snapshot; this component never fetches raw records and never joins.
 * Live updates arrive as replacement snapshots over the dashboard stream.
 */

export function Dashboard(props: { snapshot: DashboardSnapshot }) {
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
          <Widget key={w.key} widget={w} />
        ))}
      </div>
    </section>
  );
}

function Widget(props: { widget: WidgetResult }) {
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
        renderBody(w)
      )}
    </article>
  );
}

function renderBody(w: WidgetResult) {
  if (w.kind === "tile") return <Tile widget={w} />;
  if (w.kind === "chart") return <Chart widget={w} />;
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

function Chart(props: { widget: ChartResult }) {
  const max = Math.max(1, ...props.widget.groups.map((g) => g.count));
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
      {props.widget.groups.map((g) => (
        <li key={g.value} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8 }}>
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
        </li>
      ))}
    </ul>
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
            <span
              aria-hidden="true"
              style={{
                flex: "0 0 auto",
                width: 14,
                height: 14,
                borderRadius: 7,
                background: LIFELINE_DOT[color] ?? LIFELINE_DOT.gray,
                boxShadow: "0 0 0 3px color-mix(in srgb, currentColor 12%, transparent)",
              }}
            />
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
  return (
    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
      <thead>
        <tr>
          {props.widget.columns.map((c) => (
            <th key={c} style={{ textAlign: "left", padding: "2px 6px" }}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.widget.records.map((r) => (
          <tr key={r.id}>
            {props.widget.columns.map((c) => (
              <td key={c} style={{ padding: "2px 6px", borderTop: "1px solid var(--eoc-border)" }}>
                {String(r[c] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
