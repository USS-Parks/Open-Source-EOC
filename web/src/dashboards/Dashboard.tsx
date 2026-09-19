import { StatusBadge, type Status } from "../design/components.js";
import { LIFELINE_STATUS_COLOR } from "@openeoc/shared";
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
  return (
    <p style={{ margin: 0, fontSize: 32, fontWeight: 600 }}>
      <span data-testid={`tile-${props.widget.key}-value`}>{props.widget.value}</span>{" "}
      <StatusBadge status={TILE_STATUS[props.widget.level]}>{props.widget.level}</StatusBadge>
    </p>
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

const LIFELINE_BADGE: Record<string, Status> = {
  green: "success",
  yellow: "warning",
  red: "critical",
  gray: "unknown",
};

function StatusGrid(props: { widget: StatusResult }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
      {props.widget.groups.map((g) => {
        const color = g.value ? (LIFELINE_STATUS_COLOR[g.value] ?? "gray") : "gray";
        return (
          <li key={g.group} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{g.group}</span>
            <StatusBadge status={LIFELINE_BADGE[color] ?? "unknown"}>
              {g.value ?? "unknown"}
            </StatusBadge>
          </li>
        );
      })}
    </ul>
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
