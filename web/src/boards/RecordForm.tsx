import type { FieldDef, FormLayout } from "@openeoc/shared";
import { SchemaForm, type FieldOption } from "../design/forms.js";
import type { DraftScope, ScopedDraftStore } from "../design/form-drafts.js";
import "./board-parts.css";

/**
 * Input view: renders a record form from the board's field definitions.
 * Enumerated controls are the default (INV-8); free text appears only where
 * the schema says text. Validation is the same shared schema the server
 * enforces, so the form can never submit what the server would refuse.
 */
export function RecordForm(props: {
  fields: readonly FieldDef[];
  initial?: Record<string, unknown>;
  layout?: FormLayout;
  referenceOptions?: Readonly<Record<string, readonly FieldOption[]>>;
  draftStore?: ScopedDraftStore;
  draftScope?: DraftScope;
  onDirtyChange?: (dirty: boolean) => void;
  submitLabel?: string;
  onSubmit: (data: Record<string, unknown>) => void | Promise<void>;
  /** Uploads a picked file and resolves its stored id (for attachment fields). */
  onUpload?: (file: File) => Promise<string>;
  /** Fields the record's workflow state keeps from changing, and that state's label. */
  readOnly?: { readonly state: string; readonly fields: readonly string[] } | null;
}) {
  const readOnly = props.readOnly?.fields.length
    ? { fields: new Set(props.readOnly.fields), reason: `Read-only while the record is ${props.readOnly.state}.` }
    : null;
  return (
    <SchemaForm
      fields={props.fields}
      {...(readOnly ? { readOnly } : {})}
      {...(props.layout ? { layout: props.layout } : {})}
      {...(props.initial ? { initialValues: props.initial } : {})}
      {...(props.referenceOptions ? { referenceOptions: props.referenceOptions } : {})}
      {...(props.draftStore ? { draftStore: props.draftStore } : {})}
      {...(props.draftScope ? { draftScope: props.draftScope } : {})}
      {...(props.onDirtyChange ? { onDirtyChange: props.onDirtyChange } : {})}
      {...(props.submitLabel ? { submitLabel: props.submitLabel } : {})}
      {...(props.onUpload ? { onUpload: (_field: FieldDef, file: File) => props.onUpload!(file) } : {})}
      renderGeometry={(context) => (
        <GeometryControl
          field={context.field}
          value={context.value}
          disabled={context.disabled}
          inputId={context.id}
          onChange={context.onChange}
        />
      )}
      onSubmit={async (data) => props.onSubmit(data)}
    />
  );
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
  disabled: boolean;
  inputId: string;
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
    <fieldset disabled={props.disabled} className="eoc-fieldset">
      <legend className="board-point-legend">{props.field.label} (point)</legend>
      <div className="board-point-row">
        <label htmlFor={`${props.inputId}-longitude`}>Longitude
          <input id={`${props.inputId}-longitude`} value={lng === undefined ? "" : String(lng)}
            onChange={(event) => update(event.target.value === "" ? undefined : Number(event.target.value), lat)} />
        </label>
        <label htmlFor={`${props.inputId}-latitude`}>Latitude
          <input id={`${props.inputId}-latitude`} value={lat === undefined ? "" : String(lat)}
            onChange={(event) => update(lng, event.target.value === "" ? undefined : Number(event.target.value))} />
        </label>
      </div>
    </fieldset>
  );
}
