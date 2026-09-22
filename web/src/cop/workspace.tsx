import { useEffect, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "../design/icons/index.js";
import type { SymbolStatus } from "./symbology.js";

export interface CopInspectionRow {
  readonly label: string;
  readonly value: string;
}

export interface CopInspection {
  readonly title: string;
  readonly kind: string;
  readonly source: string;
  readonly status: SymbolStatus;
  readonly facilityType?: string | undefined;
  readonly freshness?: string | undefined;
  readonly coverage?: string | undefined;
  readonly attribution?: string | undefined;
  readonly rows: readonly CopInspectionRow[];
}

function statusLabel(status: SymbolStatus): string {
  switch (status) {
    case "critical": return "Critical";
    case "warning": return "Warning";
    case "normal": return "Normal";
    case "unknown": return "Unknown";
    default: return "Unknown";
  }
}

export function WorkspaceSection(props: {
  readonly title: string;
  readonly icon: IconName;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean | undefined;
  readonly forceOpen?: boolean | undefined;
  readonly className?: string | undefined;
  readonly testId?: string | undefined;
}) {
  const sectionRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if ((props.defaultOpen || props.forceOpen) && sectionRef.current) sectionRef.current.open = true;
  }, [props.defaultOpen, props.forceOpen]);

  return (
    <details
      ref={sectionRef}
      className={["eoc-cop-section", props.className].filter(Boolean).join(" ")}
      data-testid={props.testId}
    >
      <summary>
        <Icon name={props.icon} size={16} decorative />
        <span>{props.title}</span>
      </summary>
      <div className="eoc-cop-section-body">{props.children}</div>
    </details>
  );
}

export function EmptyLayerSearch(props: { readonly visible: boolean }) {
  return props.visible ? (
    <p className="eoc-cop-empty-filter" role="status">
      No map layers match this filter.
    </p>
  ) : null;
}

export function CopFeatureInspector(props: {
  readonly selection: CopInspection;
  readonly onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, [props.selection]);

  const meta: Array<readonly [string, string, IconName]> = [
    ["Source", props.selection.source, "source"],
  ];
  if (props.selection.facilityType) meta.push(["Facility type", props.selection.facilityType, "map"]);
  meta.push(["Operational status", statusLabel(props.selection.status), "clock"]);
  meta.push(["Freshness", props.selection.freshness ?? "Freshness unknown", "clock"]);
  meta.push(["Coverage", props.selection.coverage ?? "Coverage unknown", "map"]);

  return (
    <aside
      aria-label="Selected map feature"
      className="eoc-cop-inspector"
      data-testid="cop-feature-inspector"
    >
      <div className="maplibregl-popup-content eoc-cop-inspector-content">
      <header>
        <div>
          <span className="eoc-cop-eyebrow">{props.selection.kind}</span>
          <h2>{props.selection.title}</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close selected map feature"
          className="eoc-cop-icon-button"
          onClick={props.onClose}
        >
          <Icon name="close" size={20} decorative />
        </button>
      </header>

      <span className="eoc-cop-status" data-status={props.selection.status}>
        {statusLabel(props.selection.status)}
      </span>

      <dl className="eoc-cop-inspection-meta">
        {meta.map(([label, value, icon]) => (
          <div key={label}>
            <dt><Icon name={icon} size={16} decorative />{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {props.selection.rows.length ? (
        <section aria-labelledby="cop-feature-details">
          <h3 id="cop-feature-details">Feature details</h3>
          <dl className="eoc-cop-feature-rows">
            {props.selection.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {props.selection.attribution ? (
        <p className="eoc-cop-attribution">
          <Icon name="source" size={16} decorative />
          {props.selection.attribution}
        </p>
      ) : null}

      <button type="button" className="eoc-cop-return" onClick={props.onClose}>
        Return to map
      </button>
      </div>
    </aside>
  );
}
