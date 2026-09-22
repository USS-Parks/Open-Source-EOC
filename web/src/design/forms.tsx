import {
  buildRecordSchema,
  conditionMatches,
  deriveRecordValues,
  dictionaryValues,
  type FieldDef,
  type FormLayout,
} from "@openeoc/shared";
import {
  useEffect,
  useId,
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ActionButton } from "./controls.js";
import { draftScopeKey, type DraftScope, type ScopedDraftStore } from "./form-drafts.js";
import "./forms.css";

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

export interface GeometryFieldContext {
  readonly field: FieldDef;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly id: string;
  readonly describedBy?: string;
  readonly onChange: (value: unknown) => void;
}

interface SchemaFormProps {
  readonly fields: readonly FieldDef[];
  readonly layout?: FormLayout;
  readonly initialValues?: Readonly<Record<string, unknown>>;
  readonly referenceOptions?: Readonly<Record<string, readonly FieldOption[]>>;
  readonly renderGeometry?: (context: GeometryFieldContext) => ReactNode;
  readonly onUpload?: (field: FieldDef, file: File) => Promise<string>;
  readonly draftStore?: ScopedDraftStore;
  readonly draftScope?: DraftScope;
  readonly onSubmit: (values: Record<string, unknown>) => Promise<void>;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly submitLabel?: string;
}

type DraftPhase = "ready" | "loading" | "saving" | "saved" | "error";

interface FieldSection {
  readonly key: string;
  readonly title: string;
  readonly fields: readonly FieldDef[];
}

function formSections(fields: readonly FieldDef[], layout?: FormLayout): readonly FieldSection[] {
  if (!layout) return [{ key: "details", title: "Details", fields }];
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const used = new Set<string>();
  const sections = layout.sections.map((section) => ({
    key: section.key,
    title: section.title,
    fields: section.fields.flatMap((key) => {
      const field = byKey.get(key);
      if (!field) return [];
      used.add(key);
      return [field];
    }),
  }));
  const additional = fields.filter((field) => !used.has(field.key));
  return additional.length > 0
    ? [...sections, { key: "additional", title: "Additional details", fields: additional }]
    : sections;
}

function cleanedVisibleValues(fields: readonly FieldDef[], values: Readonly<Record<string, unknown>>) {
  const derived = deriveRecordValues(fields, values);
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.calculation) continue;
    if (field.condition && !conditionMatches(field.condition, derived)) continue;
    const value = values[field.key];
    if (value !== "" && value !== undefined) output[field.key] = value;
  }
  return output;
}

function validationMessage(field: FieldDef | undefined, issue: { readonly code: string; readonly message: string }) {
  if (!field) return issue.message;
  if (issue.code === "invalid_type") {
    if (field.type === "number") return "Enter a valid number";
    if (field.type === "enum" || field.type === "person_ref" || field.type === "record_ref" || field.type === "boolean") return `Choose ${field.label}`;
    if (field.type === "attachment") return `Attach ${field.label}`;
    if (field.type === "geometry") return `Set ${field.label}`;
    return `Enter ${field.label}`;
  }
  if (issue.code === "invalid_format" && field.type === "datetime") return "Enter a valid date and time";
  return issue.message;
}

export function SchemaForm({
  fields,
  layout,
  initialValues = {},
  referenceOptions = {},
  renderGeometry,
  onUpload,
  draftStore,
  draftScope,
  onSubmit,
  onDirtyChange,
  submitLabel = "Save record",
}: SchemaFormProps) {
  const formId = useId();
  const summaryRef = useRef<HTMLDivElement>(null);
  const focusSummaryForSubmit = useRef(false);
  const saveSequence = useRef(0);
  const [values, setValues] = useState<Record<string, unknown>>({ ...initialValues });
  const valuesRef = useRef<Record<string, unknown>>({ ...initialValues });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [draftPhase, setDraftPhase] = useState<DraftPhase>(draftStore && draftScope ? "loading" : "ready");
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const scopeKey = draftScope ? draftScopeKey(draftScope) : "no-draft";
  const generationRef = useRef({ scopeKey, value: 0 });
  if (generationRef.current.scopeKey !== scopeKey) {
    generationRef.current = { scopeKey, value: generationRef.current.value + 1 };
  }
  const generation = generationRef.current.value;
  const [pendingUploads, setPendingUploads] = useState<ReadonlySet<string>>(() => new Set());
  const sections = useMemo(() => formSections(fields, layout), [fields, layout]);
  const derived = useMemo(() => {
    try {
      return { values: deriveRecordValues(fields, values), error: null };
    } catch (error) {
      return { values, error: error instanceof Error ? error.message : "Calculated value is invalid" };
    }
  }, [fields, values]);

  useEffect(() => {
    let active = true;
    saveSequence.current += 1;
    const resetValues = { ...initialValues };
    valuesRef.current = resetValues;
    setValues(resetValues);
    setErrors({});
    focusSummaryForSubmit.current = false;
    setDirty(false);
    setSubmitError(null);
    setSuccess(null);
    setSubmitting(false);
    setPendingUploads(new Set());
    setDraftMessage(null);
    if (!draftStore || !draftScope) {
      setDraftPhase("ready");
      return () => { active = false; };
    }
    setDraftPhase("loading");
    void draftStore.load(draftScope).then((draft) => {
      if (!active) return;
      if (draft) {
        const restoredValues = { ...draft.values };
        valuesRef.current = restoredValues;
        setValues(restoredValues);
        setDirty(true);
        setDraftMessage(`Draft restored from ${new Date(draft.savedAt).toLocaleString()}`);
        setDraftPhase("saved");
      } else {
        setDraftPhase("ready");
      }
    }).catch((error) => {
      if (!active) return;
      setDraftPhase("error");
      setDraftMessage(error instanceof Error ? error.message : "Draft could not be loaded");
    });
    return () => { active = false; };
  }, [draftStore, scopeKey]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (focusSummaryForSubmit.current && Object.keys(errors).length > 0) {
      focusSummaryForSubmit.current = false;
      summaryRef.current?.focus();
    }
  }, [errors]);

  function isCurrentGeneration(operationGeneration: number) {
    return generationRef.current.value === operationGeneration;
  }

  async function persistDraft(next: Readonly<Record<string, unknown>>, operationGeneration = generation) {
    if (!draftStore || !draftScope || !isCurrentGeneration(operationGeneration)) return;
    const sequence = ++saveSequence.current;
    setDraftPhase("saving");
    setDraftMessage(null);
    try {
      const saved = await draftStore.save(draftScope, next);
      if (sequence !== saveSequence.current || !isCurrentGeneration(operationGeneration)) return;
      setDraftPhase("saved");
      setDraftMessage(`Draft saved at ${new Date(saved.savedAt).toLocaleTimeString()}`);
    } catch (error) {
      if (sequence !== saveSequence.current || !isCurrentGeneration(operationGeneration)) return;
      setDraftPhase("error");
      setDraftMessage(error instanceof Error ? error.message : "Draft could not be saved");
    }
  }

  const uploadPending = useCallback((key: string, pending: boolean, operationGeneration: number) => {
    if (!isCurrentGeneration(operationGeneration)) return;
    setPendingUploads((current) => {
      const next = new Set(current);
      if (pending) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  function change(key: string, value: unknown) {
    if (!isCurrentGeneration(generation)) return;
    const next = { ...valuesRef.current, [key]: value };
    valuesRef.current = next;
    setValues(next);
    setDirty(true);
    setSuccess(null);
    setSubmitError(null);
    setErrors((current) => {
      if (!current[key]) return current;
      const copy = { ...current };
      delete copy[key];
      return copy;
    });
    void persistDraft(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operationGeneration = generation;
    setSuccess(null);
    setSubmitError(null);
    if (pendingUploads.size > 0) {
      setSubmitError("Wait for attachment uploads to finish before saving.");
      return;
    }
    let cleaned: Record<string, unknown>;
    try {
      cleaned = cleanedVisibleValues(fields, values);
    } catch (error) {
      focusSummaryForSubmit.current = true;
      setErrors({ form: error instanceof Error ? error.message : "Calculated value is invalid" });
      return;
    }
    const result = buildRecordSchema(fields).safeParse(cleaned);
    if (!result.success) {
      const next: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = validationMessage(fields.find((field) => field.key === key), issue);
      }
      focusSummaryForSubmit.current = true;
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await onSubmit(result.data);
      if (!isCurrentGeneration(operationGeneration)) return;
      if (draftStore && draftScope) {
        try {
          await draftStore.clear(draftScope);
          if (!isCurrentGeneration(operationGeneration)) return;
          setDraftPhase("ready");
          setDraftMessage(null);
        } catch (error) {
          if (!isCurrentGeneration(operationGeneration)) return;
          setDraftPhase("error");
          setDraftMessage(error instanceof Error ? error.message : "Saved record, but draft cleanup failed");
        }
      }
      if (!isCurrentGeneration(operationGeneration)) return;
      setDirty(false);
      setSuccess("Record saved");
    } catch (error) {
      if (!isCurrentGeneration(operationGeneration)) return;
      setSubmitError(error instanceof Error ? error.message : "Record could not be saved");
      setDirty(true);
      await persistDraft(valuesRef.current, operationGeneration);
    } finally {
      if (isCurrentGeneration(operationGeneration)) setSubmitting(false);
    }
  }

  const loading = draftPhase === "loading";
  return (
    <form className="eoc-form" aria-busy={loading || submitting || pendingUploads.size > 0 || undefined} onSubmit={(event) => void submit(event)} noValidate>
      {loading ? <div className="eoc-form-storage" role="status">Loading saved draft…</div> : null}
      {draftMessage ? <div className={`eoc-form-storage is-${draftPhase}`} role={draftPhase === "error" ? "alert" : "status"}>{draftMessage}</div> : null}
      {submitError ? <div className="eoc-form-submit-error" role="alert"><strong>Record was not saved.</strong> {submitError} Your values remain in this form.</div> : null}
      {success ? <div className="eoc-form-success" role="status">{success}</div> : null}
      {derived.error ? <div className="eoc-form-submit-error" role="alert">{derived.error}</div> : null}
      {Object.keys(errors).length > 0 ? (
        <div ref={summaryRef} className="eoc-form-error-summary" role="alert" tabIndex={-1} aria-labelledby={`${formId}-error-title`}>
          <strong id={`${formId}-error-title`}>Correct {Object.keys(errors).length} form error{Object.keys(errors).length === 1 ? "" : "s"}</strong>
          <ul>{Object.entries(errors).map(([key, message]) => (
            <li key={key}>{key === "form" ? message : <a href={`#${formId}-${key}`} onClick={(event) => { event.preventDefault(); document.getElementById(`${formId}-${key}`)?.focus(); }}>{fields.find((field) => field.key === key)?.label ?? key}: {message}</a>}</li>
          ))}</ul>
        </div>
      ) : null}

      {sections.map((section) => {
        const activeFields = section.fields.filter((field) => !field.condition || conditionMatches(field.condition, derived.values));
        if (activeFields.length === 0) return null;
        return (
          <fieldset key={section.key} className="eoc-form-section" disabled={loading || submitting}>
            <legend>{section.title}</legend>
            <div className="eoc-form-grid">
              {activeFields.map((field) => {
                const error = errors[field.key];
                const inputId = `${formId}-${field.key}`;
                const errorId = error ? `${inputId}-error` : undefined;
                return (
                  <div key={`${generation}:${field.key}`} className="eoc-form-field" data-field-type={field.type}>
                    <FieldControl
                      field={field}
                      value={derived.values[field.key]}
                      onChange={(value) => change(field.key, value)}
                      inputId={inputId}
                      disabled={loading || submitting}
                      {...(errorId ? { describedBy: errorId } : {})}
                      {...(referenceOptions[field.key] ? { options: referenceOptions[field.key] } : {})}
                      {...(renderGeometry ? { renderGeometry } : {})}
                      {...(onUpload ? { onUpload } : {})}
                      generation={generation}
                      onUploadPendingChange={uploadPending}
                    />
                    {error ? <p id={errorId} className="eoc-form-inline-error">{error}</p> : null}
                  </div>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      <div className="eoc-form-actions">
        <span className="eoc-form-dirty-state">{dirty ? "Unsaved changes" : "No unsaved changes"}</span>
        <ActionButton kind="primary" type="submit" loading={submitting} loadingLabel="Saving record…" disabled={loading || pendingUploads.size > 0 || Boolean(derived.error)}>{submitLabel}</ActionButton>
      </div>
    </form>
  );
}

interface FieldControlProps {
  readonly field: FieldDef;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly inputId: string;
  readonly disabled: boolean;
  readonly describedBy?: string;
  readonly options?: readonly FieldOption[];
  readonly renderGeometry?: (context: GeometryFieldContext) => ReactNode;
  readonly onUpload?: (field: FieldDef, file: File) => Promise<string>;
  readonly generation: number;
  readonly onUploadPendingChange: (key: string, pending: boolean, generation: number) => void;
}

function FieldControl(props: FieldControlProps) {
  const common = {
    id: props.inputId,
    disabled: props.disabled,
    "aria-invalid": props.describedBy ? true : undefined,
    "aria-describedby": props.describedBy,
  };
  if (props.field.calculation) {
    return <label htmlFor={props.inputId}>{props.field.label}<output id={props.inputId} {...(props.describedBy ? { "aria-describedby": props.describedBy } : {})}>{props.value === undefined ? "Unavailable" : String(props.value)}</output></label>;
  }
  switch (props.field.type) {
    case "boolean":
      return <label className="eoc-form-checkbox"><input {...common} type="checkbox" checked={Boolean(props.value)} onChange={(event) => props.onChange(event.target.checked)} /> <span>{props.field.label}</span></label>;
    case "number":
      return <label htmlFor={props.inputId}>{props.field.label}<input {...common} type="number" value={props.value === undefined ? "" : String(props.value)} onChange={(event) => props.onChange(event.target.value === "" ? undefined : Number(event.target.value))} /></label>;
    case "datetime":
      return <label htmlFor={props.inputId}>{props.field.label}<input {...common} type="datetime-local" value={toLocalDateTime(props.value)} onChange={(event) => props.onChange(event.target.value === "" ? undefined : new Date(event.target.value).toISOString())} /></label>;
    case "enum": {
      const values = props.field.enumId ? (dictionaryValues(props.field.enumId) ?? []) : (props.field.values ?? []);
      return <label htmlFor={props.inputId}>{props.field.label}<select {...common} value={String(props.value ?? "")} onChange={(event) => props.onChange(event.target.value || undefined)}><option value="">Select…</option>{values.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>;
    }
    case "person_ref":
    case "record_ref":
      return props.options
        ? <label htmlFor={props.inputId}>{props.field.label}<select {...common} value={String(props.value ?? "")} onChange={(event) => props.onChange(event.target.value || undefined)}><option value="">Select…</option>{props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        : <UnavailableField label={props.field.label} reason="Reference choices are unavailable in this context." />;
    case "geometry":
      return props.renderGeometry
        ? props.renderGeometry({ field: props.field, value: props.value, disabled: props.disabled, id: props.inputId, ...(props.describedBy ? { describedBy: props.describedBy } : {}), onChange: props.onChange })
        : <UnavailableField label={props.field.label} reason="Geometry editing is unavailable in this context." />;
    case "attachment":
      return props.onUpload
        ? <AttachmentField {...props} onUpload={props.onUpload} />
        : <UnavailableField label={props.field.label} reason="Attachment upload is unavailable in this context." />;
    case "text":
      return <label htmlFor={props.inputId}>{props.field.label}<textarea {...common} maxLength={props.field.maxLength} value={String(props.value ?? "")} onChange={(event) => props.onChange(event.target.value || undefined)} /></label>;
  }
}

function UnavailableField({ label, reason }: { readonly label: string; readonly reason: string }) {
  return <div className="eoc-form-unavailable"><strong>{label}</strong><span>{reason}</span></div>;
}

function AttachmentField(props: FieldControlProps & { readonly onUpload: (field: FieldDef, file: File) => Promise<string> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const operation = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      operation.current += 1;
      props.onUploadPendingChange(props.field.key, false, props.generation);
    };
  }, [props.field.key, props.generation, props.onUploadPendingChange]);
  async function pick(file: File | null) {
    if (!file) return;
    const operationId = ++operation.current;
    setBusy(true);
    setError(null);
    props.onUploadPendingChange(props.field.key, true, props.generation);
    try {
      const attachment = await props.onUpload(props.field, file);
      if (active.current && operationId === operation.current) props.onChange(attachment);
    } catch (reason) {
      if (active.current && operationId === operation.current) setError(reason instanceof Error ? reason.message : "Attachment could not be uploaded");
    } finally {
      if (active.current && operationId === operation.current) {
        setBusy(false);
        props.onUploadPendingChange(props.field.key, false, props.generation);
      }
    }
  }
  return <div><label htmlFor={props.inputId}>{props.field.label}<input id={props.inputId} type="file" disabled={props.disabled || busy} aria-describedby={props.describedBy} onChange={(event) => void pick(event.target.files?.[0] ?? null)} /></label>{busy ? <span role="status">Uploading…</span> : props.value ? <span>Attached</span> : null}{error ? <p role="alert" className="eoc-form-inline-error">{error}</p> : null}</div>;
}

function toLocalDateTime(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16);
}
