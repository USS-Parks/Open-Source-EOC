import { useEffect, useMemo, useState } from "react";
import {
  DashboardCompositionSchema,
  IMPACT_CATEGORIES,
  type DashboardComposition,
  type DashboardCompositionPanel,
  type DashboardTemplate,
} from "@openeoc/shared";
import { ActionButton } from "../design/controls.js";
import { ErrorState } from "../design/feedback.js";

export interface DashboardDefinitionOption {
  readonly id: string;
  readonly title: string;
  readonly template: DashboardTemplate;
}

export interface DashboardConfiguratorProps {
  readonly current: { readonly revision: number; readonly composition: DashboardComposition } | null;
  readonly initialKey: string;
  readonly dashboards: readonly DashboardDefinitionOption[];
  readonly saving: boolean;
  readonly error: string | null;
  readonly onSave: (key: string, expectedRevision: number, composition: DashboardComposition) => void;
  readonly onCancel: () => void;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function dashboardPanel(
  dashboardId: string,
  widget: DashboardTemplate["widgets"][number],
): DashboardCompositionPanel {
  const prefix = dashboardId.replaceAll(/[^A-Za-z0-9]/g, "").slice(0, 8) || "dashboard";
  return {
    key: `d${prefix}_${widget.key}`.slice(0, 128),
    source: "dashboard",
    dashboardId,
    widgetKey: widget.key,
    presentation: widget.kind === "status" ? "status" : widget.kind,
  };
}

function optionIdentity(panel: DashboardCompositionPanel): string {
  return panel.source === "impact"
    ? `impact:${panel.category}`
    : `dashboard:${panel.dashboardId}:${panel.widgetKey}`;
}

function presentationOptions(widget: DashboardTemplate["widgets"][number]): readonly string[] {
  if (widget.kind === "list") return ["list", "map"];
  return [widget.kind];
}

export function DashboardConfigurator(props: DashboardConfiguratorProps) {
  const [key, setKey] = useState(props.initialKey || "incident-overview");
  const [title, setTitle] = useState(props.current?.composition.title ?? "Incident overview");
  const [panels, setPanels] = useState<DashboardCompositionPanel[]>(
    () => props.current ? [...props.current.composition.panels] : [],
  );
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setKey(props.initialKey || "incident-overview");
    setTitle(props.current?.composition.title ?? "Incident overview");
    setPanels(props.current ? [...props.current.composition.panels] : []);
    setLocalError(null);
  }, [props.current, props.initialKey]);

  const selected = useMemo(() => new Map(panels.map((panel) => [optionIdentity(panel), panel])), [panels]);
  const known = useMemo(() => new Set([
    ...props.dashboards.flatMap((dashboard) => dashboard.template.widgets.map(
      (widget) => optionIdentity(dashboardPanel(dashboard.id, widget)),
    )),
    ...IMPACT_CATEGORIES.map((category) => `impact:${category}`),
  ]), [props.dashboards]);
  const unresolved = panels.filter((panel) => !known.has(optionIdentity(panel)));

  const toggle = (candidate: DashboardCompositionPanel, checked: boolean) => {
    const identity = optionIdentity(candidate);
    setPanels((current) => checked
      ? current.some((panel) => optionIdentity(panel) === identity) ? current : [...current, candidate]
      : current.filter((panel) => optionIdentity(panel) !== identity));
  };

  const presentation = (candidate: DashboardCompositionPanel, next: string) => {
    setPanels((current) => current.map((panel) => optionIdentity(panel) === optionIdentity(candidate)
      ? { ...panel, presentation: next as DashboardCompositionPanel["presentation"] }
      : panel));
  };

  const submit = () => {
    if (!KEY.test(key) || key.length > 128) {
      setLocalError("View key must start with a letter or number and use only letters, numbers, dots, colons, underscores or hyphens.");
      return;
    }
    const parsed = DashboardCompositionSchema.safeParse({ title: title.trim(), panels });
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? "The dashboard configuration is invalid.");
      return;
    }
    setLocalError(null);
    props.onSave(key, props.current?.revision ?? 0, parsed.data);
  };

  return (
    <section className="p-dash-config-editor" aria-label="Configure saved dashboard">
      <header>
        <h2>{props.current ? "Configure saved view" : "Create saved view"}</h2>
        <ActionButton kind="quiet" onClick={props.onCancel}>Close</ActionButton>
      </header>
      <div className="p-dash-filter-grid">
        <label>
          View key
          <input value={key} disabled={Boolean(props.current)} maxLength={128} onChange={(event) => setKey(event.target.value)} />
        </label>
        <label>
          View title
          <input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        </label>
      </div>
      <div className="p-dash-config-sources">
        {props.dashboards.map((dashboard) => (
          <fieldset className="p-dash-config-source" key={dashboard.id}>
            <legend>{dashboard.title}</legend>
            {dashboard.template.widgets.map((widget) => {
              const candidate = dashboardPanel(dashboard.id, widget);
              const identity = optionIdentity(candidate);
              const chosen = selected.get(identity);
              return (
                <label className="p-dash-config-option" key={widget.key}>
                  <input type="checkbox" checked={Boolean(chosen)} onChange={(event) => toggle(candidate, event.target.checked)} />
                  <span>{widget.title}</span>
                  <select
                    aria-label={`${widget.title} presentation`}
                    disabled={!chosen}
                    value={chosen?.presentation ?? candidate.presentation}
                    onChange={(event) => presentation(candidate, event.target.value)}
                  >
                    {presentationOptions(widget).map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              );
            })}
          </fieldset>
        ))}
        <fieldset className="p-dash-config-source">
          <legend>Incident impact</legend>
          {IMPACT_CATEGORIES.map((category) => {
            const candidate = {
              key: `impact_${category}`,
              source: "impact" as const,
              category,
              presentation: "tile" as const,
            };
            const identity = optionIdentity(candidate);
            return (
              <label className="p-dash-config-option" key={category}>
                <input type="checkbox" checked={selected.has(identity)} onChange={(event) => toggle(candidate, event.target.checked)} />
                <span>{category.replaceAll("_", " ")}</span>
                <span>Impact tile</span>
              </label>
            );
          })}
        </fieldset>
        {unresolved.length ? (
          <fieldset className="p-dash-config-source">
            <legend>Unavailable configured sources</legend>
            {unresolved.map((panel) => (
              <label className="p-dash-config-option" key={panel.key}>
                <input type="checkbox" checked onChange={() => toggle(panel, false)} />
                <span>{panel.title ?? panel.key}</span>
                <span>Keep or remove</span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>
      {localError ? <p className="p-dash-inline-error" role="alert">{localError}</p> : null}
      {props.error ? <ErrorState title="Could not save dashboard" message={props.error} /> : null}
      <div className="p-dash-actions">
        <ActionButton kind="primary" loading={props.saving} loadingLabel="Saving…" onClick={submit}>
          Save view
        </ActionButton>
        <ActionButton kind="quiet" onClick={props.onCancel}>Cancel</ActionButton>
      </div>
    </section>
  );
}
