import type { HTMLAttributes, ReactNode } from "react";
import type { OperationalState } from "./tokens.js";
import { ActionButton, type ActionButtonProps } from "./controls.js";
import { ConditionBadge } from "./feedback.js";
import "./kit.css";

function classes(base: string, className?: string) {
  return [base, className].filter(Boolean).join(" ");
}

export type KpiValue =
  | { readonly kind: "value"; readonly value: string | number; readonly unit?: string }
  | { readonly kind: "zero"; readonly unit?: string }
  | { readonly kind: "unknown" | "stale" | "unavailable" | "notApplicable" };

export interface KpiCardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly label: string;
  readonly value: KpiValue;
  readonly detail?: string;
  readonly leading?: ReactNode;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

export function KpiCard({ label, value, detail, leading, action, className, ...domProps }: KpiCardProps) {
  const numericZero = value.kind === "value" && (value.value === 0 || value.value === "0");
  const state = value.kind === "zero" || numericZero ? "zero" : value.kind;
  const display = state === "zero" ? "0" : value.kind === "value" ? value.value : "—";
  const unit = value.kind === "value" || value.kind === "zero" ? value.unit : undefined;
  return (
    <article {...domProps} className={classes("eoc-kit-card eoc-kit-kpi-card", className)} data-value-state={state}>
      {leading ? <div className="eoc-kit-card-leading">{leading}</div> : null}
      <div className="eoc-kit-kpi-content">
        <span className="eoc-kit-card-eyebrow">{label}</span>
        <div className="eoc-kit-kpi-value">
          <strong>{display}</strong>{unit ? <span>{unit}</span> : null}
        </div>
        {state !== "value" ? <ConditionBadge state={state} /> : null}
        {detail ? <p>{detail}</p> : null}
      </div>
      {action ? <ActionButton kind="quiet" onClick={action.onClick}>{action.label}</ActionButton> : null}
    </article>
  );
}

export interface ConditionCardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly title: string;
  readonly state: OperationalState;
  readonly stateLabel?: string;
  readonly leading?: ReactNode;
  readonly summary: string;
  readonly metadata?: readonly { readonly label: string; readonly value: ReactNode }[];
  readonly action?: { readonly label: string; readonly onClick: () => void };
  readonly selected?: boolean;
}

export function ConditionCard({ title, state, stateLabel, leading, summary, metadata = [], action, selected = false, className, ...domProps }: ConditionCardProps) {
  return (
    <article
      {...domProps}
      className={classes("eoc-kit-card eoc-kit-condition-card", className)}
      data-state={state}
      data-selected={selected || undefined}
    >
      <header>
        <div className="eoc-kit-condition-heading">
          {leading ? <div className="eoc-kit-condition-leading">{leading}</div> : null}
          <div><h3>{title}</h3><ConditionBadge state={state} {...(stateLabel ? { label: stateLabel } : {})} /></div>
        </div>
      </header>
      <p>{summary}</p>
      {metadata.length > 0 ? (
        <dl>{metadata.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
      ) : null}
      {action ? <ActionButton kind="quiet" onClick={action.onClick}>{action.label}</ActionButton> : null}
    </article>
  );
}

export interface RecordField {
  readonly label: string;
  readonly value: ReactNode;
}

export interface RecordCardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: string;
  readonly title: string;
  readonly fields: readonly RecordField[];
  readonly selected?: boolean;
  readonly actionLabel: string;
  readonly onOpen: () => void;
}

export function RecordCard({ eyebrow, title, fields, selected = false, actionLabel, onOpen, className, ...domProps }: RecordCardProps) {
  return (
    <article
      {...domProps}
      className={classes("eoc-kit-card eoc-kit-record-card", className)}
      data-selected={selected || undefined}
    >
      {eyebrow ? <span className="eoc-kit-card-eyebrow">{eyebrow}</span> : null}
      <h3>{title}</h3>
      <dl>{fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
      <ActionButton kind="quiet" onClick={onOpen}>{actionLabel}</ActionButton>
    </article>
  );
}

export interface CardAction extends Omit<ActionButtonProps, "children"> {
  readonly label: string;
}

export interface ActionCardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly title: string;
  readonly summary: string;
  readonly primaryAction: CardAction;
  readonly secondaryAction?: CardAction;
}

function renderCardAction(action: CardAction, kind?: ActionButtonProps["kind"]) {
  const { label, ...buttonProps } = action;
  if (kind) return <ActionButton {...buttonProps} kind={kind}>{label}</ActionButton>;
  return <ActionButton {...buttonProps}>{label}</ActionButton>;
}

export function ActionCard({ title, summary, primaryAction, secondaryAction, className, ...domProps }: ActionCardProps) {
  return (
    <article {...domProps} className={classes("eoc-kit-card eoc-kit-action-card", className)}>
      <div><h3>{title}</h3><p>{summary}</p></div>
      <div className="eoc-kit-card-actions">
        {secondaryAction ? renderCardAction(secondaryAction) : null}
        {renderCardAction(primaryAction, "primary")}
      </div>
    </article>
  );
}

export interface SummaryItem {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: string;
}

export interface SummaryCardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly title: string;
  readonly items: readonly SummaryItem[];
  readonly footer?: ReactNode;
}

export function SummaryCard({ title, items, footer, className, ...domProps }: SummaryCardProps) {
  return (
    <section {...domProps} className={classes("eoc-kit-card eoc-kit-summary-card", className)}>
      <h3>{title}</h3>
      <dl>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd><strong>{item.value}</strong>{item.detail ? <span>{item.detail}</span> : null}</dd>
          </div>
        ))}
      </dl>
      {footer ? <footer>{footer}</footer> : null}
    </section>
  );
}
