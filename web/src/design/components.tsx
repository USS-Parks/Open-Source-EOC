import type { CSSProperties, ReactNode, SelectHTMLAttributes } from "react";
import { toCssVariables, type ThemeName } from "./tokens.js";

/** Wraps a subtree in a theme; the app mounts one at the root. */
export function Theme(props: { name: ThemeName; children: ReactNode }) {
  return (
    <div data-theme={props.name} className="eoc-theme" style={toCssVariables(props.name) as CSSProperties}>
      {props.children}
    </div>
  );
}

export type Status = "info" | "warning" | "critical" | "success" | "unknown";

/**
 * The only component that uses saturated color (INV-8). Renders as colored
 * text with a border, never a filled block, so a wall of badges stays calm.
 */
export function StatusBadge(props: { status: Status; children: ReactNode }) {
  return (
    <span className="eoc-status-badge" data-status={props.status}>
      {props.children}
    </span>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "quiet" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={props.type ?? "button"}
      className={`eoc-btn is-${props.kind ?? "quiet"}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

let fieldSeq = 0;

/** Labeled text input; label and control are always wired for a11y. */
export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: "text" | "password";
}) {
  const id = `tf-${fieldSeq++}`;
  return (
    <p className="eoc-input-field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        className="eoc-input"
        type={props.type ?? "text"}
        value={props.value}
        required={props.required}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </p>
  );
}

/**
 * Enumerated input, the default control of the system (INV-8): where
 * doctrine defines values, users pick, never type.
 */
export function EnumSelect(props: {
  label: string;
  values: readonly string[];
  value: string;
  onChange: (v: string) => void;
  labels?: Readonly<Record<string, string>>;
  selectProps?: SelectHTMLAttributes<HTMLSelectElement>;
}) {
  const id = `es-${fieldSeq++}`;
  return (
    <p className="eoc-input-field">
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        className="eoc-input"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        {...props.selectProps}
      >
        {props.values.map((v) => (
          <option key={v} value={v}>
            {props.labels?.[v] ?? v}
          </option>
        ))}
      </select>
    </p>
  );
}

/** Titled surface section. */
export function Panel(props: { title: string; children: ReactNode }) {
  return (
    <section aria-label={props.title} className="eoc-panel">
      <h2 className="eoc-panel-title">{props.title}</h2>
      {props.children}
    </section>
  );
}
