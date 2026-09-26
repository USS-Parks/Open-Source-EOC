import { useEffect, useMemo, useState } from "react";
import {
  choiceLabel,
  dictionaryValues,
  DashboardCompositionSchema,
  IMPACT_CATEGORIES,
  type DashboardComposition,
  type DashboardCompositionPanel,
  type DashboardTemplate,
  type FieldDef,
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
  /** The incident's boards a create-record tile can open, and a reader of a board's fields for its presets. */
  readonly boards?: readonly { readonly id: string; readonly title: string }[] | undefined;
  readonly loadBoard?: ((boardId: string) => Promise<{ readonly fields: readonly FieldDef[] }>) | undefined;
}

type CreatePanel = Extract<DashboardCompositionPanel, { source: "create" }>;
/** Field types a create-record tile can preset. */
const PRESET_TYPES: ReadonlySet<FieldDef["type"]> = new Set(["text", "number", "boolean", "enum"]);

function choices(field: FieldDef): readonly string[] {
  return field.values ?? (field.enumId ? dictionaryValues(field.enumId) : null) ?? [];
}

function presetDefault(field: FieldDef): string {
  return field.type === "boolean" ? "true" : field.type === "enum" ? choices(field)[0] ?? "" : "";
}

/** A preset as typed on screen, as the value its field stores; null when a number does not parse. */
function presetValue(field: FieldDef, text: string): string | number | boolean | null {
  if (field.type === "boolean") return text === "true";
  if (field.type !== "number") return text;
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) ? value : null;
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
    presentation: presentationOptions(widget)[0]!,
  };
}

// A kanban summary sits with the charts and upcoming calendar items with the activity lists.
const PRESENTATION: Readonly<Record<DashboardTemplate["widgets"][number]["kind"], DashboardCompositionPanel["presentation"]>> = {
  tile: "tile", chart: "chart", status: "status", list: "list", kanban: "chart", calendar: "list",
};

function optionIdentity(panel: DashboardCompositionPanel): string {
  if (panel.source === "create") return `create:${panel.key}`;
  return panel.source === "impact"
    ? `impact:${panel.category}`
    : `dashboard:${panel.dashboardId}:${panel.widgetKey}`;
}

function presentationOptions(widget: DashboardTemplate["widgets"][number]): readonly DashboardCompositionPanel["presentation"][] {
  if (widget.kind === "list") return ["list", "map"];
  return [PRESENTATION[widget.kind]];
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
  const unresolved = panels.filter((panel) => panel.source !== "create" && !known.has(optionIdentity(panel)));
  const creates = panels.filter((panel): panel is CreatePanel => panel.source === "create");
  const tileTitle = (panel: CreatePanel) => {
    const board = props.boards?.find((candidate) => candidate.id === panel.boardId);
    return panel.title ?? (board ? `New ${board.title} record` : "New record on a board not in this incident");
  };

  // The create-record tile being added: its board, label and preset values.
  const [tileBoard, setTileBoard] = useState("");
  const [tileLabel, setTileLabel] = useState("");
  const [presets, setPresets] = useState<Array<{ field: string; text: string }>>([]);
  const [tileFields, setTileFields] = useState<readonly FieldDef[]>([]);
  const presettable = tileFields.filter((field) => PRESET_TYPES.has(field.type) && !field.calculation);
  const { loadBoard } = props;
  useEffect(() => {
    setPresets([]);
    setTileFields([]);
    if (!tileBoard || !loadBoard) return;
    let active = true;
    loadBoard(tileBoard).then((board) => { if (active) setTileFields(board.fields); })
      .catch((cause: unknown) => { if (active) setLocalError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [tileBoard, loadBoard]);

  const addTile = () => {
    const values: Record<string, string | number | boolean> = {};
    for (const preset of presets) {
      const field = presettable.find((candidate) => candidate.key === preset.field);
      const value = field ? presetValue(field, preset.text) : null;
      if (!field || value === null) {
        setLocalError(`Enter a number for the preset ${field?.label ?? preset.field}.`);
        return;
      }
      values[field.key] = value;
    }
    const used = new Set(panels.map((panel) => panel.key));
    let n = 1;
    while (used.has(`create_${n}`)) n += 1;
    setPanels((current) => [...current, {
      key: `create_${n}`, source: "create", presentation: "tile", boardId: tileBoard,
      ...(tileLabel.trim() ? { title: tileLabel.trim() } : {}),
      ...(Object.keys(values).length ? { presets: values } : {}),
    }]);
    setLocalError(null);
    setTileBoard("");
    setTileLabel("");
  };

  const toggle = (candidate: DashboardCompositionPanel, checked: boolean) => {
    const identity = optionIdentity(candidate);
    setPanels((current) => checked
      ? current.some((panel) => optionIdentity(panel) === identity) ? current : [...current, candidate]
      : current.filter((panel) => optionIdentity(panel) !== identity));
  };

  const presentation = (candidate: DashboardCompositionPanel, next: string) => {
    setPanels((current) => current.map((panel) => panel.source !== "create" && optionIdentity(panel) === optionIdentity(candidate)
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
        <fieldset className="p-dash-config-source">
          <legend>Create-record tiles</legend>
          {creates.map((panel) => {
            const title = tileTitle(panel);
            const count = Object.keys(panel.presets ?? {}).length;
            return (
              <div className="p-dash-config-option" key={panel.key}>
                <span>{title}</span>
                <span>{count ? `${count} preset value${count === 1 ? "" : "s"}` : "No preset values"}</span>
                <ActionButton kind="quiet" onClick={() => setPanels((current) => current.filter((candidate) => candidate.key !== panel.key))}>
                  Remove {title}
                </ActionButton>
              </div>
            );
          })}
          <div className="p-dash-filter-grid">
            <label>
              Board for a new tile
              <select value={tileBoard} onChange={(event) => setTileBoard(event.target.value)}>
                <option value="">Choose a board</option>
                {(props.boards ?? []).map((board) => <option key={board.id} value={board.id}>{board.title}</option>)}
              </select>
            </label>
            <label>
              Tile label (empty for New board record)
              <input value={tileLabel} maxLength={200} onChange={(event) => setTileLabel(event.target.value)} />
            </label>
          </div>
          {presets.map((preset, index) => {
            const field = presettable.find((candidate) => candidate.key === preset.field);
            const set = (next: { field: string; text: string }) =>
              setPresets((current) => current.map((row, i) => (i === index ? next : row)));
            return (
              <div className="p-dash-filter-grid" key={index}>
                <label>
                  Preset {index + 1} field
                  <select value={preset.field} onChange={(event) => {
                    const next = presettable.find((candidate) => candidate.key === event.target.value);
                    if (next) set({ field: next.key, text: presetDefault(next) });
                  }}>
                    {presettable.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}
                  </select>
                </label>
                <label>
                  Preset {index + 1} value
                  {field?.type === "enum" || field?.type === "boolean" ? (
                    <select value={preset.text} onChange={(event) => set({ ...preset, text: event.target.value })}>
                      {(field.type === "boolean" ? ["true", "false"] : choices(field)).map((value) => (
                        <option key={value} value={value}>{field.type === "boolean" ? (value === "true" ? "Yes" : "No") : choiceLabel(value)}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={preset.text} inputMode={field?.type === "number" ? "decimal" : "text"}
                      onChange={(event) => set({ ...preset, text: event.target.value })} />
                  )}
                </label>
                <ActionButton kind="quiet" onClick={() => setPresets((current) => current.filter((_, i) => i !== index))}>
                  Remove preset {index + 1}
                </ActionButton>
              </div>
            );
          })}
          <div className="p-dash-actions p-dash-config-create">
            <ActionButton disabled={presettable.length === 0} onClick={() => {
              const field = presettable.find((candidate) => !presets.some((row) => row.field === candidate.key)) ?? presettable[0]!;
              setPresets((current) => [...current, { field: field.key, text: presetDefault(field) }]);
            }}>Add a preset value</ActionButton>
            <ActionButton disabled={!tileBoard} onClick={addTile}>Add create-record tile</ActionButton>
          </div>
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
