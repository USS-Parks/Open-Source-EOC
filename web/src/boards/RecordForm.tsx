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
          <FieldControl field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
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
