import { useState } from "react";
import { ICS_POSITION_TITLES, ICS_STANDARD_POSITIONS } from "@openeoc/shared";
import { Button, Panel, TextField } from "../design/components.js";
import type {
  ApiClient,
  IncidentTemplateDefinition,
  IncidentTemplateItem,
  IncidentTemplateVersionEntry,
} from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";
import { formatTime } from "../datasets/format.js";

/**
 * Incident templates on screen (VC-01). An instance administrator writes a
 * template's positions, boards and checklists and saves it as the next
 * version of the one opened; every version stays listed with who saved it,
 * and an earlier one can be loaded back and saved again. Checklist items are
 * one per line: an item that came with a category, a key other items depend
 * on, or a due rule keeps them while its text stays the same.
 */

type TemplateClient = Pick<ApiClient,
  "listIncidentTemplates" | "getIncidentTemplate" | "listIncidentTemplateVersions" | "saveIncidentTemplate" | "listTemplates" | "listPositions">;

interface Draft {
  /** The key being edited; null while a new template is still unsaved. */
  readonly editing: string | null;
  readonly expectedVersion: number;
  readonly title: string;
  readonly key: string;
  /** Whether the key was typed rather than taken from the title. */
  readonly keyTouched: boolean;
  readonly positions: readonly string[];
  readonly positionTitles: Readonly<Record<string, string>>;
  readonly boards: readonly string[];
  readonly lines: Readonly<Record<string, string>>;
  readonly original: IncidentTemplateDefinition | null;
  readonly newPosition: string;
}

const itemText = (item: IncidentTemplateItem): string => (typeof item === "string" ? item : item.item);
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** A key from words: "Tsunami Warning" becomes tsunami_warning. */
export function keyFrom(text: string): string {
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "");
  return key.slice(0, 80);
}

function draftFrom(template: IncidentTemplateDefinition, editing: string | null, expectedVersion: number): Draft {
  const lines: Record<string, string> = {};
  for (const list of template.checklists) {
    lines[list.position] = [lines[list.position], ...list.items.map(itemText)].filter(Boolean).join("\n");
  }
  return {
    editing, expectedVersion, title: template.title, key: template.key, keyTouched: true,
    positions: template.positions, positionTitles: template.positionTitles ?? {}, boards: template.boards,
    lines, original: template, newPosition: "",
  };
}

const EMPTY: Draft = {
  editing: null, expectedVersion: 0, title: "", key: "", keyTouched: false, positions: ["incident_commander"],
  positionTitles: {}, boards: [], lines: {}, original: null, newPosition: "",
};

/** The template the draft describes, ready to save. */
export function definitionFrom(draft: Draft): Omit<IncidentTemplateDefinition, "key"> {
  const kept = new Map<string, Map<string, IncidentTemplateItem>>();
  for (const list of draft.original?.checklists ?? []) {
    const byText = kept.get(list.position) ?? new Map<string, IncidentTemplateItem>();
    for (const item of list.items) byText.set(itemText(item), item);
    kept.set(list.position, byText);
  }
  const checklists = draft.positions
    .map((position) => ({
      position,
      items: (draft.lines[position] ?? "").split("\n").map((line) => line.trim()).filter(Boolean)
        .map((text) => kept.get(position)?.get(text) ?? text),
    }))
    .filter((list) => list.items.length > 0);
  const titles = Object.fromEntries(Object.entries(draft.positionTitles).filter(([key]) => draft.positions.includes(key)));
  return {
    title: draft.title.trim(),
    positions: draft.positions,
    ...(Object.keys(titles).length > 0 ? { positionTitles: titles } : {}),
    boards: draft.boards,
    checklists,
  };
}

export function IncidentTemplatesPanel(props: {
  readonly client: TemplateClient;
  readonly jurisdictionId: string;
  /** Called after a save, so the activation list reads the templates again. */
  readonly onSaved?: () => void;
}) {
  const [reload, setReload] = useState(0);
  const templates = useAsync(() => props.client.listIncidentTemplates(), [reload]);
  const boardTemplates = useAsync(() => props.client.listTemplates(), []);
  const positions = useAsync(() => props.client.listPositions(props.jurisdictionId), [props.jurisdictionId]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<{ key: string; title: string; versions: readonly IncidentTemplateVersionEntry[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const done = await fn();
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const titleOf = (key: string): string =>
    draft?.positionTitles[key] ?? positions.data?.find((p) => p.key === key)?.title ?? ICS_POSITION_TITLES[key] ?? key;
  const update = (change: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...change } : current));
  const toggle = (list: readonly string[], value: string, on: boolean) =>
    (on ? [...list.filter((v) => v !== value), value] : list.filter((v) => v !== value));

  const open = (key: string) => act(async () => {
    const current = await props.client.getIncidentTemplate(key);
    setHistory(null);
    setDraft(draftFrom(current.template, key, current.version));
  });
  const showHistory = (key: string, title: string) => act(async () => {
    setHistory({ key, title, versions: await props.client.listIncidentTemplateVersions(key) });
  });
  const loadVersion = (entry: IncidentTemplateVersionEntry, key: string) => act(async () => {
    const current = await props.client.getIncidentTemplate(key);
    setDraft(draftFrom(entry.template, key, current.version));
    return `Version ${entry.version} is in the editor. Save it to make it version ${current.version + 1}.`;
  });
  const save = () => act(async () => {
    if (!draft) return;
    const key = draft.editing ?? draft.key;
    if (!draft.title.trim()) throw new Error("Enter the template's title.");
    if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error("The key starts with a letter and uses lowercase letters, digits and underscores.");
    const saved = await props.client.saveIncidentTemplate(key, definitionFrom(draft), draft.expectedVersion);
    setDraft(null);
    setReload((n) => n + 1);
    props.onSaved?.();
    return `Saved ${draft.title.trim()} as version ${saved.version}.`;
  });
  const addPosition = () => {
    if (!draft) return;
    const title = draft.newPosition.trim();
    const key = keyFrom(title);
    if (!key) {
      setError("Enter the new position's title.");
      return;
    }
    update({ positions: toggle(draft.positions, key, true), positionTitles: { ...draft.positionTitles, [key]: title }, newPosition: "" });
  };

  // The standard ICS positions, then the jurisdiction's own, then any the template adds.
  const offered = [...new Set([
    ...ICS_STANDARD_POSITIONS,
    ...(positions.data?.map((p) => p.key) ?? []),
    ...(draft?.positions ?? []),
  ])];

  return (
    <Panel title="Incident templates">
      <p className="eoc-muted">
        A template opens an incident with its positions, boards and each position's checklist. Saving makes a new
        version; incidents already open keep the version they started from.
      </p>
      {templates.loading && !templates.data ? <Loading label="Loading incident templates…" /> : null}
      {templates.error ? <ErrorNote message={templates.error} /> : null}
      {templates.data ? (
        <ul className="incidents-list" aria-label="Incident templates">
          {templates.data.map((t) => (
            <li key={t.key} className="incidents-item">
              <div className="incidents-item-body">
                <div className="incidents-row"><strong>{t.title}</strong><span className="incidents-kind">Version {t.version}</span></div>
                <div className="incidents-authority">
                  <span>{count(t.positions, "position")}</span><span aria-hidden="true">·</span>
                  <span>{count(t.boards, "board")}</span><span aria-hidden="true">·</span>
                  <span>{count(t.checklistItems, "checklist item")}</span>
                </div>
              </div>
              <div className="incidents-item-actions">
                <Button label={`Edit ${t.title}`} onClick={() => void open(t.key)} disabled={busy}>Edit</Button>
                <Button label={`Versions of ${t.title}`} onClick={() => void showHistory(t.key, t.title)} disabled={busy}>Versions</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="eoc-space-above">
        <Button onClick={() => { setHistory(null); setDraft(EMPTY); setNotice(""); setError(null); }} disabled={busy}>New template</Button>
      </div>

      {history ? (
        <section className="eoc-space-above" aria-label={`Versions of ${history.title}`}>
          <h3>Versions of {history.title}</h3>
          <ol className="incidents-list">
            {history.versions.map((entry) => (
              <li key={entry.version} className="incidents-item">
                <div className="incidents-item-body">
                  <strong>Version {entry.version}: {entry.title}</strong>
                  <span className="incidents-authority">
                    Saved {formatTime(entry.savedAt)} {entry.savedBy ? `by ${entry.savedBy}` : "with the product"}
                  </span>
                </div>
                <div className="incidents-item-actions">
                  <Button label={`Load version ${entry.version} into the editor`} onClick={() => void loadVersion(entry, history.key)} disabled={busy}>
                    Load into the editor
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {draft ? (
        <form className="eoc-space-above incidents-section" aria-label={draft.editing ? `Edit ${draft.original?.title ?? draft.editing}` : "New incident template"}
          onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <h3>{draft.editing ? `Edit ${draft.original?.title ?? draft.editing}, version ${draft.expectedVersion}` : "New incident template"}</h3>
          <div className="incidents-form-row">
            <TextField label="Template title" value={draft.title} required
              onChange={(title) => update({ title, ...(draft.editing || draft.keyTouched ? {} : { key: keyFrom(title) }) })} />
            {draft.editing ? null : (
              <TextField label="Template key" value={draft.key} required onChange={(key) => update({ key, keyTouched: true })} />
            )}
          </div>
          <fieldset className="incidents-fieldset">
            <legend>Positions the incident opens with</legend>
            <div className="incidents-positions">
              {offered.map((key) => (
                <label key={key}>
                  <input type="checkbox" checked={draft.positions.includes(key)}
                    onChange={(event) => update({ positions: toggle(draft.positions, key, event.target.checked) })} /> {titleOf(key)}
                </label>
              ))}
            </div>
            <div className="incidents-pair">
              <TextField label="Another position" value={draft.newPosition} onChange={(newPosition) => update({ newPosition })} />
              <Button onClick={addPosition}>Add position</Button>
            </div>
          </fieldset>
          <fieldset className="incidents-fieldset">
            <legend>Boards the incident opens with</legend>
            {boardTemplates.error ? <ErrorNote message={boardTemplates.error} /> : null}
            <div className="incidents-positions">
              {(boardTemplates.data ?? []).map((board) => (
                <label key={board.key}>
                  <input type="checkbox" checked={draft.boards.includes(board.key)}
                    onChange={(event) => update({ boards: toggle(draft.boards, board.key, event.target.checked) })} /> {board.title}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="incidents-fieldset">
            <legend>Checklists, one item per line</legend>
            {draft.positions.map((key) => (
              <label key={key} className="incidents-field">Checklist for {titleOf(key)}
                <textarea rows={3} value={draft.lines[key] ?? ""}
                  onChange={(event) => update({ lines: { ...draft.lines, [key]: event.target.value } })} />
              </label>
            ))}
          </fieldset>
          <div className="incidents-actions">
            <Button type="submit" kind="primary" disabled={busy}>{busy ? "Saving…" : "Save template"}</Button>
            <Button onClick={() => setDraft(null)} disabled={busy}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p role="status" className="eoc-note">{notice}</p> : null}
    </Panel>
  );
}
