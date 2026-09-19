import type { ReactNode } from "react";

/** Small shared building blocks for the console's center surfaces. */

export function Loading(props: { label?: string }) {
  return <p style={{ color: "var(--eoc-text-muted)", padding: 16 }}>{props.label ?? "Loading…"}</p>;
}

export function ErrorNote(props: { message: string }) {
  return (
    <p role="alert" style={{ color: "var(--eoc-status-critical)", padding: 16 }}>
      {props.message}
    </p>
  );
}

export function EmptyState(props: { label: string; hint?: string }) {
  return (
    <div style={{ padding: 24, color: "var(--eoc-text-muted)" }}>
      <p style={{ margin: 0, fontWeight: 600 }}>{props.label}</p>
      {props.hint ? <p style={{ margin: "4px 0 0" }}>{props.hint}</p> : null}
    </div>
  );
}

/** A scrolling wrapper for non-map surfaces inside the flex center column. */
export function Scroll(props: { children: ReactNode }) {
  return <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16 }}>{props.children}</div>;
}

export function SurfaceHeader(props: { title: string; actions?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        marginBottom: 12,
      }}
    >
      <h2 style={{ margin: 0, fontSize: "1.15em" }}>{props.title}</h2>
      {props.actions}
    </div>
  );
}
