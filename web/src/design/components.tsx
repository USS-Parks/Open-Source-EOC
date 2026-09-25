import { useSyncExternalStore, type CSSProperties, type ReactNode, type SelectHTMLAttributes } from "react";
import { toCssVariables, type ThemeName } from "./tokens.js";

const MORE_CONTRAST = "(prefers-contrast: more)";

function watchContrast(onChange: () => void): () => void {
  if (typeof matchMedia !== "function") return () => undefined;
  const query = matchMedia(MORE_CONTRAST);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const wantsMoreContrast = () => typeof matchMedia === "function" && matchMedia(MORE_CONTRAST).matches;

/**
 * Wraps a subtree in a theme; the app mounts one at the root. A
 * higher-contrast preference in the operating system strengthens text,
 * borders and focus in either theme, and follows the setting live.
 */
export function Theme(props: { name: ThemeName; children: ReactNode }) {
  const more = useSyncExternalStore(watchContrast, wantsMoreContrast, () => false);
  return (
    <div data-theme={props.name} data-contrast={more ? "more" : undefined} className="eoc-theme"
      style={toCssVariables(props.name, more ? "more" : "normal") as CSSProperties}>
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
  /** The accessible name, where the visible text alone would be ambiguous in a list. */
  label?: string;
}) {
  return (
    <button
      type={props.type ?? "button"}
      className={`eoc-btn is-${props.kind ?? "quiet"}`}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
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

/** Titled surface section; a page made of one panel titles itself at level 1. */
export function Panel(props: { title: string; level?: 1 | 2; children: ReactNode }) {
  const Heading = props.level === 1 ? "h1" : "h2";
  return (
    <section aria-label={props.title} className="eoc-panel">
      <Heading className="eoc-panel-title">{props.title}</Heading>
      {props.children}
    </section>
  );
}
