import type { ReactNode } from "react";

/** Small shared building blocks for the console's center surfaces. */

export function Loading(props: { label?: string }) {
  return <p className="eoc-note eoc-note-loading">{props.label ?? "Loading…"}</p>;
}

export function ErrorNote(props: { message: string }) {
  return (
    <p role="alert" className="eoc-note eoc-note-error">
      {props.message}
    </p>
  );
}

export function EmptyState(props: { label: string; hint?: string }) {
  return (
    <div className="eoc-empty">
      <p className="eoc-empty-title">{props.label}</p>
      {props.hint ? <p className="eoc-empty-hint">{props.hint}</p> : null}
    </div>
  );
}

/** A scrolling wrapper for non-map surfaces inside the flex center column. */
export function Scroll(props: { children: ReactNode }) {
  return <div className="eoc-scroll">{props.children}</div>;
}

export function SurfaceHeader(props: { title: string; actions?: ReactNode }) {
  return (
    <div className="eoc-surface-header">
      <h2 className="eoc-surface-title">{props.title}</h2>
      {props.actions}
    </div>
  );
}

export function NotFoundState(props: { readonly onMap: () => void; readonly onOverview: () => void }) {
  return (
    <section className="eoc-surface-state" aria-labelledby="not-found-title">
      <h2 id="not-found-title">Page not found</h2>
      <p>This address does not match an available workspace.</p>
      <div>
        <button type="button" className="eoc-btn" onClick={props.onMap}>Open Map</button>
        <button type="button" className="eoc-btn" onClick={props.onOverview}>Open Overview</button>
      </div>
    </section>
  );
}
