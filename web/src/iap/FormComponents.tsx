import { useEffect, useState } from "react";
import {
  ICS_COMPONENT_FORMS,
  ICS_COMPONENT_FORM_IDS,
  DEFAULT_PLAN_FORMS,
  componentFormLabel,
  emptyValue,
  type ComponentField,
  type ComponentValue,
  type IcsComponentFormId,
} from "@openeoc/shared";
import { Button, EnumSelect, StatusBadge, TextField } from "../design/components.js";
import { saveFile } from "../admin/labels.js";
import type { ApiClient, IcsComponentDetail, IcsComponentVersion } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";

/**
 * ICS forms as components of the selected operational period (VA37). Each
 * form is started as a draft prefilled from the incident's records, filled
 * in block by block after the Forms Booklet layout, saved as its next
 * version, and marked ready by its preparer. Every version stays listed and
 * any one prints to PDF. The 204, 213 and 214 may be several to a period,
 * each named by a label.
 */

type ComponentClient = Pick<ApiClient,
  "listIcsComponents" | "createIcsComponent" | "getIcsComponent" | "saveIcsComponent"
  | "listIcsComponentVersions" | "downloadIcsComponentPdf" | "createIap">;

interface Draft {
  readonly component: IcsComponentDetail;
  readonly values: Readonly<Record<string, ComponentValue>>;
  readonly label: string;
  readonly dirty: boolean;
}

const FORM_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  ICS_COMPONENT_FORM_IDS.map((id) => [id, componentFormLabel(id)]));

const named = (formId: IcsComponentFormId, label: string): string =>
  label ? `${componentFormLabel(formId)}, ${label}` : componentFormLabel(formId);

function pdfName(formId: string, label: string, version: number): string {
  const base = `${formId}-${label}`.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${base}-v${version}.pdf`;
}

function draftOf(component: IcsComponentDetail): Draft {
  const form = ICS_COMPONENT_FORMS[component.formId];
  const values = Object.fromEntries(form.fields.map((field) => [field.key, component.values[field.key] ?? emptyValue(field)]));
  return { component, values, label: component.label, dirty: false };
}

function TableField(props: {
  readonly field: ComponentField;
  readonly rows: readonly (readonly string[])[];
  readonly onChange: (rows: readonly (readonly string[])[]) => void;
}) {
  const columns = props.field.columns ?? [];
  const setCell = (r: number, c: number, text: string) =>
    props.onChange(props.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? text : cell)) : row)));
  return (
    <fieldset className="iap-component-field">
      <legend>{props.field.block}. {props.field.label}</legend>
      <div className="iap-table-scroll">
        <table className="eoc-table iap-component-table">
          <thead>
            <tr>
              {columns.map((column) => <th key={column} scope="col">{column}</th>)}
              <th scope="col"><span className="eoc-visually-hidden">Row</span></th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row, r) => (
              <tr key={r}>
                {columns.map((column, c) => (
                  <td key={column}>
                    <input className="eoc-input" value={row[c] ?? ""} aria-label={`${props.field.label}, row ${r + 1}, ${column}`}
                      onChange={(event) => setCell(r, c, event.target.value)} />
                  </td>
                ))}
                <td>
                  <Button label={`Remove row ${r + 1} of ${props.field.label}`}
                    onClick={() => props.onChange(props.rows.filter((_, i) => i !== r))}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.rows.length === 0 ? <p className="iap-muted">No rows yet.</p> : null}
      <div className="iap-actions">
        <Button label={`Add a row to ${props.field.label}`}
          onClick={() => props.onChange([...props.rows, columns.map(() => "")])}>Add row</Button>
      </div>
    </fieldset>
  );
}

function FieldEditor(props: {
  readonly field: ComponentField;
  readonly value: ComponentValue;
  readonly onChange: (value: ComponentValue) => void;
}) {
  const { field } = props;
  const caption = `${field.block}. ${field.label}`;
  switch (field.kind) {
    case "table":
      return <TableField field={field} rows={props.value as readonly (readonly string[])[]} onChange={props.onChange} />;
    case "checks": {
      const checked = props.value as readonly string[];
      return (
        <fieldset className="iap-component-field">
          <legend>{caption}</legend>
          <div className="iap-component-checks">
            {field.options!.map((option) => (
              <label key={option}>
                <input type="checkbox" checked={checked.includes(option)}
                  onChange={(event) => props.onChange(event.target.checked
                    ? field.options!.filter((o) => o === option || checked.includes(o))
                    : checked.filter((o) => o !== option))} /> {option}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    case "choice":
      return (
        <label className="iap-field">
          <span>{caption}</span>
          <select value={props.value as string} onChange={(event) => props.onChange(event.target.value)}>
            <option value="">Not answered</option>
            {field.options!.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      );
    case "multiline":
      return (
        <label className="iap-field">
          <span>{caption}</span>
          <textarea rows={4} value={props.value as string} onChange={(event) => props.onChange(event.target.value)} />
        </label>
      );
    default:
      return (
        <label className="iap-field">
          <span>{caption}{field.kind === "datetime" ? " (date and time)" : ""}</span>
          <input className="eoc-input" value={props.value as string} onChange={(event) => props.onChange(event.target.value)} />
        </label>
      );
  }
}

export function FormComponents(props: {
  readonly client: ComponentClient;
  readonly incidentId: string;
  readonly periodRevision: number;
  readonly periodLabel: string;
  /** Open the IAP workspace, where an assembled plan is submitted and approved. */
  readonly onOpenIap?: () => void;
}) {
  const [reload, setReload] = useState(0);
  const list = useAsync(
    () => props.client.listIcsComponents(props.incidentId, props.periodRevision),
    [props.incidentId, props.periodRevision, reload],
  );
  const [formId, setFormId] = useState<IcsComponentFormId>("ICS-202");
  const [newLabel, setNewLabel] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [versions, setVersions] = useState<readonly IcsComponentVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  // Forms ticked or unticked for the plan; the rest follow the default set.
  const [picked, setPicked] = useState<Readonly<Record<string, boolean>>>({});
  const [assembled, setAssembled] = useState(false);

  useEffect(() => {
    setDraft(null);
    setVersions(null);
    setError(null);
    setNotice("");
    setPicked({});
    setAssembled(false);
  }, [props.incidentId, props.periodRevision]);

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

  const chosen = ICS_COMPONENT_FORMS[formId];
  const existing = chosen.many ? undefined : list.data?.find((c) => c.formId === formId);

  const open = (id: string) => act(async () => {
    setVersions(null);
    setDraft(draftOf(await props.client.getIcsComponent(id)));
  });
  const start = () => act(async () => {
    if (existing) {
      setVersions(null);
      setDraft(draftOf(await props.client.getIcsComponent(existing.id)));
      return;
    }
    if (chosen.many && !newLabel.trim()) throw new Error(`Name this ${formId.replace("-", " ")}: ${chosen.labelHint}.`);
    const created = await props.client.createIcsComponent(props.incidentId, {
      formId, periodRevision: props.periodRevision, ...(chosen.many ? { label: newLabel.trim() } : {}),
    });
    setNewLabel("");
    setVersions(null);
    setDraft(draftOf(created));
    setReload((n) => n + 1);
    return `Started ${named(created.formId, created.label)} as a draft, prefilled from the incident's records.`;
  });
  const save = (status: "draft" | "ready") => act(async () => {
    if (!draft) return;
    const form = ICS_COMPONENT_FORMS[draft.component.formId];
    const saved = await props.client.saveIcsComponent(draft.component.id, {
      values: draft.values, status, expectedVersion: draft.component.version,
      ...(form.many ? { label: draft.label.trim() } : {}),
    });
    setDraft(draftOf(saved));
    setVersions(null);
    setReload((n) => n + 1);
    const plans = saved.plans.map((plan) => (plan.revisionNumber > 1 && plan.contentRevision === 1
      ? ` The IAP's revision ${plan.revisionNumber} started from it, a draft for approval.`
      : ` IAP revision ${plan.revisionNumber} took it.`)).join("");
    return `Saved ${named(saved.formId, saved.label)} as version ${saved.version}, ${saved.status}.${plans}`;
  });
  const showVersions = () => act(async () => {
    if (draft) setVersions(await props.client.listIcsComponentVersions(draft.component.id));
  });
  // A ready form is in the plan when ticked; untouched, the default set (decision 16) is.
  const inPlan = (c: { readonly id: string; readonly formId: IcsComponentFormId; readonly status: string }) =>
    c.status === "ready" && (picked[c.id] ?? DEFAULT_PLAN_FORMS.includes(c.formId));
  const planIds = (list.data ?? []).filter(inPlan).map((c) => c.id);
  const assemble = () => act(async () => {
    await props.client.createIap(props.incidentId, {
      operationalPeriod: props.periodLabel, periodRevision: props.periodRevision, componentIds: planIds,
    });
    setAssembled(true);
    return `Assembled a draft IAP for ${props.periodLabel} from ${planIds.length} ${planIds.length === 1 ? "form" : "forms"}.`;
  });
  const print = (version?: number) => act(async () => {
    if (!draft) return;
    const { component } = draft;
    const chosenVersion = version ?? component.version;
    saveFile(await props.client.downloadIcsComponentPdf(component.id, version),
      pdfName(component.formId, component.label, chosenVersion));
  });
  const loadVersion = (entry: IcsComponentVersion) => {
    if (!draft) return;
    setDraft({ ...draft, values: { ...entry.values }, label: entry.label, dirty: true });
    setNotice(`Version ${entry.version} is in the editor. Save it to make it version ${draft.component.version + 1}.`);
  };
  const setValue = (key: string, value: ComponentValue) =>
    setDraft((current) => (current ? { ...current, values: { ...current.values, [key]: value }, dirty: true } : current));

  const editing = draft?.component;
  const editingForm = editing ? ICS_COMPONENT_FORMS[editing.formId] : null;

  return (
    <div className="iap-components">
      <p className="iap-muted">
        Each form is kept on its own for {props.periodLabel}. Start it from the incident&apos;s records, fill it in block by
        block, and save: every save is a new version, and a form is marked ready when its preparer has finished it.
      </p>
      {list.loading && !list.data ? <Loading label="Loading the period's forms…" /> : null}
      {list.error ? <ErrorNote message={list.error} /> : null}
      {list.data && list.data.length === 0 ? <p className="iap-muted">No forms started for this period yet.</p> : null}
      {list.data && list.data.length > 0 ? (
        <ul className="iap-list" aria-label="Forms for this period">
          {list.data.map((c) => (
            <li key={c.id}>
              <button type="button" className="iap-list-button" aria-current={editing?.id === c.id ? "true" : undefined}
                onClick={() => void open(c.id)} disabled={busy}>
                <span className="iap-list-heading">
                  <strong>{named(c.formId, c.label)}</strong>
                  <StatusBadge status={c.status === "ready" ? "success" : "info"}>{c.status === "ready" ? "Ready" : "Draft"}</StatusBadge>
                </span>
                <span className="iap-row-meta">
                  Version {c.version} · {c.preparedBy}, {c.preparedRole} · {new Date(c.updatedAt).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {list.data && list.data.length > 0 ? (
        <fieldset className="iap-component-field">
          <legend>Assemble the IAP from these forms</legend>
          <p className="iap-muted">
            A plan takes ready forms at their current version and is approved as a whole. The 202, 203, 204, 205,
            205A, 206, 207 and 208 are ticked by default; the others go in when ticked.
          </p>
          <div className="iap-component-checks iap-plan-choice">
            {list.data.map((c) => (
              <label key={c.id}>
                <input type="checkbox" checked={inPlan(c)} disabled={c.status !== "ready" || busy}
                  onChange={(event) => setPicked((current) => ({ ...current, [c.id]: event.target.checked }))} />
                {" "}{named(c.formId, c.label)}{c.status === "ready" ? "" : " (draft)"}
              </label>
            ))}
          </div>
          <div className="iap-actions">
            <Button kind="primary" onClick={() => void assemble()} disabled={busy || planIds.length === 0}>
              Assemble IAP from {planIds.length} {planIds.length === 1 ? "form" : "forms"}
            </Button>
            {assembled && props.onOpenIap ? <Button onClick={props.onOpenIap}>Review it in the IAP workspace</Button> : null}
          </div>
        </fieldset>
      ) : null}

      <div className="iap-component-start">
        <EnumSelect label="Form to start" values={ICS_COMPONENT_FORM_IDS} value={formId} labels={FORM_LABELS}
          onChange={(value) => setFormId(value as IcsComponentFormId)} />
        {chosen.many ? <TextField label={`Name (${chosen.labelHint})`} value={newLabel} onChange={setNewLabel} /> : null}
        <Button kind="primary" onClick={() => void start()} disabled={busy}>
          {existing ? `Open the period's ${formId.replace("-", " ")}` : "Start form"}
        </Button>
      </div>

      {draft && editing && editingForm ? (
        // Only the save buttons make a version; Enter in a field does not.
        <form className="iap-component-editor" aria-label={`Edit ${named(editing.formId, editing.label)}`}
          onSubmit={(event) => event.preventDefault()}>
          <div className="iap-detail-heading">
            <h3>{named(editing.formId, editing.label)}</h3>
            <StatusBadge status={editing.status === "ready" ? "success" : "info"}>
              Version {editing.version}, {editing.status === "ready" ? "ready" : "draft"}
            </StatusBadge>
          </div>
          <p className="iap-muted">
            {editing.incidentName} · {editing.operationalPeriod} · Prepared by {editing.preparedBy}, {editing.preparedRole}
            {" "}· Layout after the {editing.edition}
          </p>
          {editingForm.many ? (
            <TextField label={`Name (${editingForm.labelHint})`} value={draft.label}
              onChange={(label) => setDraft({ ...draft, label, dirty: true })} />
          ) : null}
          {editingForm.fields.map((field) => (
            <FieldEditor key={field.key} field={field} value={draft.values[field.key] ?? emptyValue(field)}
              onChange={(value) => setValue(field.key, value)} />
          ))}
          <div className="iap-actions">
            <Button onClick={() => void save("draft")} disabled={busy}>Save as draft</Button>
            <Button kind="primary" onClick={() => void save("ready")} disabled={busy}>Save and mark ready</Button>
            <Button onClick={() => void print()} disabled={busy}>Print version {editing.version}</Button>
            <Button onClick={() => void showVersions()} disabled={busy}>Versions</Button>
            <Button onClick={() => { setDraft(null); setVersions(null); }} disabled={busy}>Close</Button>
          </div>
          {draft.dirty ? <p className="iap-muted">Unsaved changes. Printing uses the saved version.</p> : null}
        </form>
      ) : null}

      {draft && versions ? (
        <section aria-label={`Versions of ${named(draft.component.formId, draft.component.label)}`}>
          <h3>Versions</h3>
          <ol className="iap-lineage">
            {versions.map((entry) => (
              <li key={entry.version} className="iap-lineage-row">
                <span>
                  <strong>Version {entry.version}, {entry.status}</strong>
                  {" "}· {entry.savedBy}, {entry.savedRole} · {new Date(entry.savedAt).toLocaleString()}
                </span>
                <span className="iap-actions">
                  <Button label={`Print version ${entry.version}`} onClick={() => void print(entry.version)} disabled={busy}>Print</Button>
                  <Button label={`Load version ${entry.version} into the editor`} onClick={() => loadVersion(entry)} disabled={busy}>
                    Load into the editor
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p role="status" className="eoc-note">{notice}</p> : null}
    </div>
  );
}
