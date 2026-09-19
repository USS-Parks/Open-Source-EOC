import type { ReactNode } from "react";
import { StatusBadge, type Status } from "./components.js";

/** Application frame: skip link, header, main. */
export function AppFrame(props: { title: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <a
        href="#main"
        style={{ position: "absolute", left: -9999, top: 0 }}
        onFocus={(e) => (e.currentTarget.style.left = "8px")}
        onBlur={(e) => (e.currentTarget.style.left = "-9999px")}
      >
        Skip to content
      </a>
      <header
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid var(--eoc-border)",
          background: "var(--eoc-surface)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.1em" }}>{props.title}</h1>
      </header>
      <main id="main" style={{ flex: 1, padding: 16, display: "grid", gap: 16 }}>
        {props.children}
      </main>
    </div>
  );
}

export interface BoardListItem {
  readonly id: string;
  readonly name: string;
  readonly status?: Status;
}

/** Navigation list of boards (the viewer's first screen). */
export function BoardList(props: {
  boards: readonly BoardListItem[];
  onOpen: (id: string) => void;
}) {
  return (
    <nav aria-label="Boards">
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
        {props.boards.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              className="eoc-row"
              onClick={() => props.onOpen(b.id)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                fontFamily: "inherit",
                fontSize: "1em",
                background: "var(--eoc-surface)",
                color: "var(--eoc-text)",
                border: "1px solid var(--eoc-border)",
                borderRadius: "var(--eoc-radius-sm)",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                alignItems: "center",
              }}
            >
              <span>{b.name}</span>
              {b.status ? <StatusBadge status={b.status}>{b.status}</StatusBadge> : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Board display view: an accessible data table. */
export function BoardTable(props: {
  caption: string;
  columns: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}) {
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <caption style={{ textAlign: "left", fontWeight: 600, paddingBottom: 8 }}>
        {props.caption}
      </caption>
      <thead>
        <tr>
          {props.columns.map((c) => (
            <th
              key={c}
              scope="col"
              style={{
                textAlign: "left",
                borderBottom: "2px solid var(--eoc-border)",
                padding: "6px 8px",
              }}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) => (
              <td
                key={j}
                style={{ borderBottom: "1px solid var(--eoc-border)", padding: "6px 8px" }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Placeholder frame for the COP map (real map lands at VEOC-17). */
export function MapPanel(props: { label: string }) {
  return (
    <div
      role="region"
      aria-label={props.label}
      style={{
        minHeight: 200,
        display: "grid",
        placeItems: "center",
        background: "var(--eoc-surface-raised)",
        border: "1px solid var(--eoc-border)",
        borderRadius: 6,
        color: "var(--eoc-text-muted)",
      }}
    >
      {props.label}
    </div>
  );
}

export interface TrayNotification {
  readonly id: string;
  readonly status: Status;
  readonly text: string;
}

/** Live notification tray; announces politely, never steals focus. */
export function NotificationTray(props: { items: readonly TrayNotification[] }) {
  return (
    <aside aria-label="Notifications">
      <ul
        aria-live="polite"
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}
      >
        {props.items.map((n) => (
          <li
            key={n.id}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "baseline",
              padding: "6px 10px",
              background: "var(--eoc-surface)",
              border: "1px solid var(--eoc-border)",
              borderRadius: 4,
            }}
          >
            <StatusBadge status={n.status}>{n.status}</StatusBadge>
            <span>{n.text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
