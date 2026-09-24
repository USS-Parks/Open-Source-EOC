import type { ReactNode } from "react";
import { StatusBadge, type Status } from "./components.js";

/** Application frame: skip link, header, main. */
export function AppFrame(props: { title: string; children: ReactNode }) {
  return (
    <div className="eoc-app-frame">
      <a href="#main" className="eoc-skip-link">
        Skip to content
      </a>
      <header>
        <h1>{props.title}</h1>
      </header>
      <main id="main">
        {props.children}
      </main>
    </div>
  );
}

interface BoardListItem {
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
      <ul className="eoc-board-list">
        {props.boards.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              className="eoc-row"
              onClick={() => props.onOpen(b.id)}
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
    <table className="eoc-table">
      <caption className="eoc-table-caption">
        {props.caption}
      </caption>
      <thead>
        <tr>
          {props.columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Labeled stand-in frame used where a composition shows the map region without mounting it. */
export function MapPanel(props: { label: string }) {
  return (
    <div role="region" aria-label={props.label} className="eoc-map-stand-in">
      {props.label}
    </div>
  );
}

interface TrayNotification {
  readonly id: string;
  readonly status: Status;
  readonly text: string;
}

/** Live notification tray; announces politely, never steals focus. */
export function NotificationTray(props: { items: readonly TrayNotification[] }) {
  return (
    <aside aria-label="Notifications">
      <ul aria-live="polite" className="eoc-tray">
        {props.items.map((n) => (
          <li key={n.id}>
            <StatusBadge status={n.status}>{n.status}</StatusBadge>
            <span>{n.text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
