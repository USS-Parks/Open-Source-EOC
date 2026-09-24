import { Component, type ReactNode } from "react";

/** Small shared building blocks for the console's center surfaces. */

/** A polite status, so a screen reader announces what is loading. */
export function Loading(props: { label?: string }) {
  return <p role="status" className="eoc-note eoc-note-loading">{props.label ?? "Loading…"}</p>;
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

/**
 * Shows a screen whose module failed to load, such as one the network dropped
 * before the console fetched it, instead of a blank console, and leaves the
 * rest of the console usable. The browser keeps a failed module import, so
 * only a page load fetches it again; the session and the route survive it.
 */
export class LoadBoundary extends Component<{ readonly name: string; readonly children: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidUpdate(previous: { readonly name: string }) {
    // Opening another screen tries that one.
    if (previous.name !== this.props.name && this.state.failed) this.setState({ failed: false });
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="eoc-surface-state" aria-label={`${this.props.name} did not load`}>
        <ErrorNote message={`${this.props.name} could not be loaded. Check the network connection, then reload the page.`} />
        <div><button type="button" className="eoc-btn" onClick={() => location.reload()}>Reload page</button></div>
      </section>
    );
  }
}
