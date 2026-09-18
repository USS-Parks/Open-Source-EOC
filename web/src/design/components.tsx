import type { CSSProperties, ReactNode, SelectHTMLAttributes } from "react";
import { fontStack, toCssVariables, type ThemeName } from "./tokens.js";

/** Wraps a subtree in a theme; the app mounts one at the root. */
export function Theme(props: { name: ThemeName; children: ReactNode }) {
  const style: CSSProperties = {
    ...toCssVariables(props.name),
    background: "var(--eoc-bg)",
    color: "var(--eoc-text)",
    fontFamily: fontStack,
    minHeight: "100%",
  };
  return (
    <div data-theme={props.name} style={style}>
      {props.children}
    </div>
  );
}

export type Status = "info" | "warning" | "critical" | "success" | "unknown";

const statusVar: Record<Status, string> = {
  info: "var(--eoc-status-info)",
  warning: "var(--eoc-status-warning)",
  critical: "var(--eoc-status-critical)",
  success: "var(--eoc-status-success)",
  unknown: "var(--eoc-status-unknown)",
};

/**
 * The only component that uses saturated color (INV-8). Renders as colored
 * text with a border, never a filled block, so a wall of badges stays calm.
 */
export function StatusBadge(props: { status: Status; children: ReactNode }) {
  return (
    <span
      style={{
        color: statusVar[props.status],
        border: `1px solid ${statusVar[props.status]}`,
        borderRadius: 4,
        padding: "1px 8px",
        fontSize: "0.85em",
        fontWeight: 600,
      }}
    >
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
  const kind = props.kind ?? "quiet";
  const style: CSSProperties = {
    fontFamily: "inherit",
    fontSize: "1em",
    padding: "6px 14px",
    // Glove/touchscreen target: at least 44px so field users in PPE can hit it.
    minHeight: 44,
    borderRadius: 4,
    cursor: props.disabled ? "not-allowed" : "pointer",
    border: "1px solid var(--eoc-border)",
    background: kind === "primary" ? "var(--eoc-text)" : "var(--eoc-surface)",
    color:
      kind === "primary"
        ? "var(--eoc-surface)"
        : kind === "danger"
          ? "var(--eoc-status-critical)"
          : "var(--eoc-text)",
  };
  return (
    <button type={props.type ?? "button"} onClick={props.onClick} disabled={props.disabled} style={style}>
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
}) {
  const id = `tf-${fieldSeq++}`;
  return (
    <p style={{ display: "flex", flexDirection: "column", gap: 4, margin: 0 }}>
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        value={props.value}
        required={props.required}
        onChange={(e) => props.onChange(e.target.value)}
        style={{
          fontFamily: "inherit",
          fontSize: "1em",
          padding: 6,
          minHeight: 44,
          borderRadius: 4,
          border: "1px solid var(--eoc-border)",
          background: "var(--eoc-surface)",
          color: "var(--eoc-text)",
        }}
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
    <p style={{ display: "flex", flexDirection: "column", gap: 4, margin: 0 }}>
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{
          fontFamily: "inherit",
          fontSize: "1em",
          padding: 6,
          minHeight: 44,
          borderRadius: 4,
          border: "1px solid var(--eoc-border)",
          background: "var(--eoc-surface)",
          color: "var(--eoc-text)",
        }}
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
    <section
      aria-label={props.title}
      style={{
        background: "var(--eoc-surface)",
        border: "1px solid var(--eoc-border)",
        borderRadius: 6,
        padding: 16,
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: "1.05em" }}>{props.title}</h2>
      {props.children}
    </section>
  );
}
