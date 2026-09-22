import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { operationalStates, type OperationalState } from "./tokens.js";
import "./kit.css";

const foregroundByState: Readonly<Record<OperationalState, string>> = {
  normal: "var(--eoc-status-success)",
  watch: "var(--eoc-status-warning)",
  critical: "var(--eoc-status-critical)",
  unknown: "var(--eoc-status-unknown)",
  stale: "var(--eoc-status-warning)",
  unavailable: "var(--eoc-status-unknown)",
  notApplicable: "var(--eoc-text-muted)",
  zero: "var(--eoc-text)",
};

const markerText: Readonly<Record<OperationalState, string>> = {
  normal: "●",
  watch: "▲",
  critical: "◆",
  unknown: "?",
  stale: "◷",
  unavailable: "—",
  notApplicable: "/",
  zero: "0",
};

interface ConditionBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  readonly state: OperationalState;
  readonly label?: string;
}

/** A condition or data-state label whose marker and text preserve meaning without color. */
export function ConditionBadge({ state, label, className, style, ...domProps }: ConditionBadgeProps) {
  const semantic = operationalStates.light[state];
  const foreground = foregroundByState[state];
  const variables = {
    "--eoc-kit-state-color": foreground,
    "--eoc-kit-state-background": `color-mix(in srgb, ${foreground} 11%, var(--eoc-surface))`,
    ...style,
  } as CSSProperties;
  return (
    <span
      {...domProps}
      className={["eoc-kit-condition-badge", className].filter(Boolean).join(" ")}
      data-state={state}
      data-treatment={semantic.treatment}
      style={variables}
    >
      <span className="eoc-kit-condition-marker" aria-hidden="true">{markerText[state]}</span>
      <span>{label ?? semantic.label}</span>
    </span>
  );
}

interface CountBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  readonly value: number | null;
  readonly label: string;
}

/** Neutral record count. Null is unknown; numeric zero is explicit and never styled as success. */
export function CountBadge({ value, label, className, ...domProps }: CountBadgeProps) {
  const state = value === null ? "unknown" : value === 0 ? "zero" : "count";
  const spoken = value === null ? "unknown" : value === 0 ? "zero" : String(value);
  return (
    <span
      {...domProps}
      className={["eoc-kit-count-badge", className].filter(Boolean).join(" ")}
      data-count-state={state}
      role="group"
      aria-label={`${label}: ${spoken}`}
    >
      <strong aria-hidden="true">{value === null ? "?" : value}</strong>
      {state !== "count" ? <span aria-hidden="true">{spoken}</span> : null}
    </span>
  );
}

interface LoadingStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  readonly label?: string;
  readonly lines?: number;
}

export function LoadingState({ label = "Loading", lines = 3, className, ...domProps }: LoadingStateProps) {
  const safeLines = Math.max(1, Math.min(6, Math.trunc(lines)));
  return (
    <div
      {...domProps}
      className={["eoc-kit-feedback", "eoc-kit-loading", className].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <strong>{label}</strong>
      <div aria-hidden="true" className="eoc-kit-loading-lines">
        {Array.from({ length: safeLines }, (_, index) => <span key={index} />)}
      </div>
    </div>
  );
}

interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}

export function EmptyState({ title, description, action, className, ...domProps }: EmptyStateProps) {
  return (
    <div {...domProps} className={["eoc-kit-feedback", "eoc-kit-empty", className].filter(Boolean).join(" ")}>
      <span className="eoc-kit-feedback-marker" aria-hidden="true">○</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <div className="eoc-kit-feedback-action">{action}</div> : null}
    </div>
  );
}

interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly title: string;
  readonly message: string;
  readonly action?: ReactNode;
}

export function ErrorState({ title, message, action, className, ...domProps }: ErrorStateProps) {
  return (
    <div
      {...domProps}
      className={["eoc-kit-feedback", "eoc-kit-error", className].filter(Boolean).join(" ")}
      role="alert"
    >
      <span className="eoc-kit-feedback-marker" aria-hidden="true">!</span>
      <strong>{title}</strong>
      <p>{message}</p>
      {action ? <div className="eoc-kit-feedback-action">{action}</div> : null}
    </div>
  );
}
