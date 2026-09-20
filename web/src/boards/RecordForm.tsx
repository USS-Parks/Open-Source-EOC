import { useState } from "react";
import { buildRecordSchema, dictionaryValues, type FieldDef } from "@openeoc/shared";
import { Button, EnumSelect, TextField } from "../design/components.js";

/**
 * Input view: renders a record form from the board's field definitions.
 * Enumerated controls are the default (INV-8); free text appears only where
 * the schema says text. Validation is the same shared schema the server
 * enforces, so the form can never submit what the server would refuse.
 */
export function RecordForm(props: {
  fields: readonly FieldDef[];
  initial?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => void;
  /** Uploads a picked file and resolves its stored id (for attachment fields). */
  onUpload?: (file: File) => Promise<string>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(props.initial ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set(key: string, value: unknown) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function submit() {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== "" && v !== undefined) cleaned[k] = v;
    }
    const result = buildRecordSchema(props.fields).safeParse(cleaned);
    if (!result.success) {
      const next: Record<string, string> = {};
      for (const issue of result.error.issues) {
        next[String(issue.path[0] ?? "form")] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    props.onSubmit(result.data);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{ display: "grid", gap: 12, maxWidth: 480 }}
    >
      {props.fields.map((f) => (
        <div key={f.key}>
          <FieldControl
            field={f}
            value={values[f.key]}
            onChange={(v) => set(f.key, v)}
            {...(props.onUpload ? { onUpload: props.onUpload } : {})}
          />
          {errors[f.key] ? (
            <p role="alert" style={{ color: "var(--eoc-status-critical)", margin: "4px 0 0" }}>
              {f.label}: {errors[f.key]}
            </p>
          ) : null}
        </div>
      ))}
      <div>
        <Button kind="primary" type="submit">
          Save record
        </Button>
      </div>
    </form>
  );
}

function FieldControl(props: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  onUpload?: (file: File) => Promise<string>;
}) {
  const { field } = props;
  switch (field.type) {
    case "enum": {
      const values = field.enumId ? (dictionaryValues(field.enumId) ?? []) : (field.values ?? []);
      return (
        <EnumSelect
          label={field.label}
          values={["", ...values]}
          value={String(props.value ?? "")}
          onChange={(v) => props.onChange(v === "" ? undefined : v)}
        />
      );
    }
    case "boolean":
      return (
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={Boolean(props.value)}
            onChange={(e) => props.onChange(e.target.checked)}
          />
          {field.label}
        </label>
      );
    case "number":
      return (
        <TextField
          label={field.label}
          value={props.value === undefined ? "" : String(props.value)}
          onChange={(v) => props.onChange(v === "" ? undefined : Number(v))}
        />
      );
    case "datetime":
      return (
        <TextField
          label={`${field.label} (ISO datetime)`}
          value={String(props.value ?? "")}
          onChange={(v) => props.onChange(v === "" ? undefined : v)}
        />
      );
    case "geometry":
      return <GeometryControl field={field} value={props.value} onChange={props.onChange} />;
    case "attachment":
      return (
        <AttachmentControl
          field={field}
          value={props.value}
          onChange={props.onChange}
          {...(props.onUpload ? { onUpload: props.onUpload } : {})}
        />
      );
    default:
      return (
        <TextField
          label={field.label}
          value={String(props.value ?? "")}
          onChange={(v) => props.onChange(v === "" ? undefined : v)}
        />
      );
  }
}

interface PointGeometry {
  readonly type: "Point";
  readonly coordinates: readonly [number, number];
}
function isPoint(v: unknown): v is PointGeometry {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { type?: unknown }).type === "Point" &&
    Array.isArray((v as { coordinates?: unknown }).coordinates)
  );
}

/**
 * Point entry for a geometry field. The map's "add point" mode fills this
 * from a tap; it stays editable so a coordinate can be corrected by hand.
 */
function GeometryControl(props: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const coords = isPoint(props.value) ? props.value.coordinates : undefined;
  const lng = coords?.[0];
  const lat = coords?.[1];
  const update = (nlng: number | undefined, nlat: number | undefined) => {
    if (nlng === undefined || nlat === undefined || Number.isNaN(nlng) || Number.isNaN(nlat)) {
      props.onChange(undefined);
    } else {
      props.onChange({ type: "Point", coordinates: [nlng, nlat] });
    }
  };
  return (
    <div>
      <span style={{ display: "block", marginBottom: 4 }}>{props.field.label} (point)</span>
      <div style={{ display: "flex", gap: 8 }}>
        <TextField
          label="Longitude"
          value={lng === undefined ? "" : String(lng)}
          onChange={(v) => update(v === "" ? undefined : Number(v), lat)}
        />
        <TextField
          label="Latitude"
          value={lat === undefined ? "" : String(lat)}
          onChange={(v) => update(lng, v === "" ? undefined : Number(v))}
        />
      </div>
    </div>
  );
}

/**
 * Attachment (photo or document) entry. Picking a file uploads it at once and
 * stores its id on the record. Used by the map's field-capture flow, which
 * supplies the upload function; without one the field is inert.
 */
function AttachmentControl(props: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  onUpload?: (file: File) => Promise<string>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasFile = typeof props.value === "string" && props.value.length > 0;

  if (!props.onUpload) {
    return (
      <p style={{ color: "var(--eoc-text-muted)", margin: 0 }}>
        {props.field.label}: attachment upload is not available here.
      </p>
    );
  }

  const pick = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const id = await props.onUpload!(file);
      props.onChange(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <span style={{ display: "block", marginBottom: 4 }}>{props.field.label}</span>
      <input
        type="file"
        aria-label={props.field.label}
        disabled={busy}
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      {busy ? (
        <span style={{ color: "var(--eoc-text-muted)" }}> uploading…</span>
      ) : hasFile ? (
        <span style={{ color: "var(--eoc-status-success)" }}> attached ✓</span>
      ) : null}
      {err ? (
        <p role="alert" style={{ color: "var(--eoc-status-critical)", margin: "4px 0 0" }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}
