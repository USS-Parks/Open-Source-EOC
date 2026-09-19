import type { CSSProperties } from "react";
import { Button, StatusBadge } from "../../design/components.js";
import type { ApiClient, BoardListItem } from "../api/client.js";
import { useAsync, usePolled } from "../data/hooks.js";
import { EmptyState, ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

/** The list sections: all boards, situation reports, and notifications. */

export function BoardsIndex(props: {
  boards: readonly BoardListItem[];
  onOpen: (id: string) => void;
}) {
  return (
    <Scroll>
      <SurfaceHeader title="Boards" />
      {props.boards.length === 0 ? (
        <EmptyState label="No boards in this jurisdiction yet." />
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Board</th>
              <th style={th}>Type</th>
              <th style={th}>On map</th>
              <th style={th} aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {props.boards.map((b) => (
              <tr key={b.id}>
                <td style={td}>{b.title}</td>
                <td style={td}>
                  <code style={{ color: "var(--eoc-text-muted)" }}>{b.templateKey}</code>
                </td>
                <td style={td}>
                  {b.hasGeometry ? (
                    <StatusBadge status="info">layer</StatusBadge>
                  ) : (
                    <span style={{ color: "var(--eoc-text-muted)" }}>—</span>
                  )}
                </td>
                <td style={td}>
                  <Button onClick={() => props.onOpen(b.id)}>Open</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Scroll>
  );
}

export function SitrepsIndex(props: {
  client: ApiClient;
  jurisdictionId: string;
  onOpen: (id: string) => void;
}) {
  const { data, error, loading } = useAsync(
    () => props.client.listSitreps(props.jurisdictionId),
    [props.jurisdictionId],
  );
  if (loading && !data) return <Loading label="Loading situation reports…" />;
  if (error && !data) return <ErrorNote message={error} />;
  const items = data ?? [];
  return (
    <Scroll>
      <SurfaceHeader title="Situation Reports" />
      {items.length === 0 ? (
        <EmptyState label="No situation reports yet." hint="A duty officer composes these from live board state." />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {items.map((s) => (
            <li key={s.id}>
              <button type="button" className="eoc-row" onClick={() => props.onOpen(s.id)} style={rowButton}>
                <span style={{ fontWeight: 600 }}>Operational period {s.period}</span>
                <span style={{ color: "var(--eoc-text-muted)" }}>
                  {new Date(s.composedAt).toLocaleString()} · {s.composedBy}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Scroll>
  );
}

export function AlertsSurface(props: { client: ApiClient }) {
  const { data, error, loading } = usePolled(() => props.client.notifications(), 8000, []);
  if (loading && !data) return <Loading label="Loading notifications…" />;
  if (error && !data) return <ErrorNote message={error} />;
  const items = data ?? [];
  return (
    <Scroll>
      <SurfaceHeader title="Notifications" />
      {items.length === 0 ? (
        <EmptyState label="No notifications." hint="Board events and scheduled rules post here." />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {items.map((n) => (
            <li key={n.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{n.title}</strong>
                <StatusBadge status={n.read_at ? "unknown" : "info"}>
                  {n.read_at ? "read" : "new"}
                </StatusBadge>
              </div>
              <p style={{ margin: "4px 0 0" }}>{n.body}</p>
              <p style={{ margin: "4px 0 0", color: "var(--eoc-text-muted)", fontSize: "0.85em" }}>
                {new Date(n.created_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Scroll>
  );
}

const th: CSSProperties = {
  textAlign: "left",
  borderBottom: "2px solid var(--eoc-border)",
  padding: "6px 8px",
};
const td: CSSProperties = {
  borderBottom: "1px solid var(--eoc-border)",
  padding: "6px 8px",
};
const rowButton: CSSProperties = {
  width: "100%",
  textAlign: "left",
  display: "grid",
  gap: 2,
  padding: "10px 12px",
  minHeight: 44,
  background: "var(--eoc-surface)",
  color: "var(--eoc-text)",
  border: "1px solid var(--eoc-border)",
  borderRadius: 4,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "1em",
};
const card: CSSProperties = {
  padding: "10px 12px",
  background: "var(--eoc-surface)",
  border: "1px solid var(--eoc-border)",
  borderRadius: "var(--eoc-radius-md)",
  boxShadow: "var(--eoc-shadow-sm)",
};
