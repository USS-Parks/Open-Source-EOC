import { useMemo, useState } from "react";
import {
  allFields,
  runForm,
  submission,
  type AnswerRecord,
  type FieldDef,
  type FormDefinition,
  type FormField,
} from "@openeoc/shared";
import { ActionButton } from "../design/controls.js";

interface PointGeometry {
  readonly type: "Point";
  readonly coordinates: readonly [number, number];
}

function parsePoint(value: unknown): PointGeometry | null {
  if (typeof value !== "string") return null;
  const values = value.trim().split(/\s+/).map(Number);
  if (values.length < 2 || !Number.isFinite(values[0]) || !Number.isFinite(values[1])) return null;
  return { type: "Point", coordinates: [values[1]!, values[0]!] };
}

/** Match the server form adapter while producing a board payload for exact offline sync. */
export function formBoardData(
  definition: FormDefinition,
  boardFields: readonly FieldDef[],
  answers: AnswerRecord,
): Record<string, unknown> {
  const values = submission(definition, answers);
  const allowed = new Map(boardFields.map((field) => [field.key, field]));
  const geopoints = new Set(allFields(definition.nodes)
    .filter((field) => field.type === "geopoint")
    .map((field) => field.name));
  const geometryKey = boardFields.find((field) => field.type === "geometry")?.key;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (geopoints.has(key)) {
      if (geometryKey && data[geometryKey] === undefined) {
        const point = parsePoint(value);
        if (point) data[geometryKey] = point;
      }
      continue;
    }
    if (allowed.has(key)) data[key] = value;
  }
  return data;
}

function FieldControl(props: {
  readonly field: FormField;
  readonly value: AnswerRecord[string];
  readonly error?: string;
  readonly online: boolean;
  readonly onChange: (value: AnswerRecord[string]) => void;
  readonly onUpload: (file: File) => Promise<string>;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const id = `field-${props.field.name}`;
  const label = props.field.label ?? props.field.name;
  const describedBy = props.error ? `${id}-error` : undefined;

  if (props.field.type === "note") return <p className="eoc-field-note">{label}</p>;
  if (props.field.type === "calculate") return (
    <div className="eoc-field-calculation"><span>{label}</span><output>{String(props.value ?? "Pending inputs")}</output></div>
  );
  if (props.field.type === "select_multiple") {
    const selected = Array.isArray(props.value) ? props.value as string[] : [];
    return (
      <fieldset className="eoc-field-choices" aria-describedby={describedBy}>
        <legend>{label}{props.field.required ? " *" : ""}</legend>
        {props.field.choices?.map((choice) => <label key={choice.name}>
          <input type="checkbox" checked={selected.includes(choice.name)} onChange={(event) => {
            const next = event.target.checked
              ? [...selected, choice.name]
              : selected.filter((item) => item !== choice.name);
            props.onChange(next.length ? next : undefined);
          }} />{choice.label}
        </label>)}
        {props.error ? <small id={`${id}-error`} role="alert">{props.error}</small> : null}
      </fieldset>
    );
  }
  if (props.field.type === "select_one") return (
    <label htmlFor={id}>{label}{props.field.required ? " *" : ""}
      <select id={id} value={String(props.value ?? "")} aria-describedby={describedBy}
        onChange={(event) => props.onChange(event.target.value || undefined)}>
        <option value="">Choose an option</option>
        {props.field.choices?.map((choice) => <option key={choice.name} value={choice.name}>{choice.label}</option>)}
      </select>
      {props.error ? <small id={`${id}-error`} role="alert">{props.error}</small> : null}
    </label>
  );
  if (props.field.type === "geopoint") return (
    <fieldset className="eoc-field-location" aria-describedby={describedBy}>
      <legend>{label}{props.field.required ? " *" : ""}</legend>
      <label htmlFor={`${id}-coordinates`}>Latitude and longitude
        <input id={`${id}-coordinates`} inputMode="decimal" placeholder="34.0522 -118.2437"
          value={String(props.value ?? "")} onChange={(event) => props.onChange(event.target.value || undefined)} />
      </label>
      <ActionButton kind="secondary" onClick={() => navigator.geolocation.getCurrentPosition(
        (position) => props.onChange(`${position.coords.latitude} ${position.coords.longitude}`),
        () => props.onChange(props.value),
        { enableHighAccuracy: true, timeout: 10000 },
      )}>Use current location</ActionButton>
      {props.error ? <small id={`${id}-error`} role="alert">{props.error}</small> : null}
    </fieldset>
  );
  if (props.field.type === "image") return (
    <label htmlFor={id}>{label}{props.field.required ? " *" : ""}
      <input id={id} type="file" accept="image/png,image/jpeg,image/gif" capture="environment"
        disabled={!props.online || uploading} onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setUploading(true); setUploadError(null);
          void props.onUpload(file).then(props.onChange).catch((error: unknown) => {
            setUploadError(error instanceof Error ? error.message : "Attachment upload failed.");
          }).finally(() => setUploading(false));
        }} />
      <small>{!props.online ? "Reconnect before adding an attachment." : uploading ? "Uploading attachment…" : props.value ? "Attachment ready." : "Take a photo or choose an image."}</small>
      {uploadError ? <small role="alert">{uploadError}</small> : null}
      {props.error ? <small id={`${id}-error`} role="alert">{props.error}</small> : null}
    </label>
  );

  const type = props.field.type === "integer" || props.field.type === "decimal" ? "number"
    : props.field.type === "datetime" ? "datetime-local"
      : ["date", "time"].includes(props.field.type) ? props.field.type : "text";
  return (
    <label htmlFor={id}>{label}{props.field.required ? " *" : ""}
      <input id={id} type={type} inputMode={type === "number" ? "decimal" : undefined}
        value={String(props.value ?? "")} aria-describedby={describedBy} onChange={(event) => {
          const raw = event.target.value;
          props.onChange(type === "number" ? (raw === "" ? undefined : Number(raw)) : raw || undefined);
        }} />
      {props.error ? <small id={`${id}-error`} role="alert">{props.error}</small> : null}
    </label>
  );
}

export function FieldCaptureFields(props: {
  readonly definition: FormDefinition;
  readonly answers: AnswerRecord;
  readonly online: boolean;
  readonly onChange: (answers: AnswerRecord) => void;
  readonly onUpload: (file: File) => Promise<string>;
}) {
  const result = useMemo(() => runForm(props.definition, props.answers), [props.answers, props.definition]);
  const visible = new Set(result.visible.map((name) => name.split("[")[0]!));
  const errors = new Map(result.errors.map((error) => [error.field, error.message]));
  return <div className="eoc-field-controls">
    {allFields(props.definition.nodes).filter((field) => field.type === "note" || visible.has(field.name)).map((field) => (
      <FieldControl key={field.name} field={field} value={result.values[field.name]}
        {...(errors.has(field.name) ? { error: errors.get(field.name)! } : {})}
        online={props.online} onUpload={props.onUpload}
        onChange={(value) => props.onChange({ ...props.answers, [field.name]: value })} />
    ))}
  </div>;
}
