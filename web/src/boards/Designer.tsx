import { useState } from "react";
import {
  allEnums,
  BoardTemplateSchema,
  FIELD_TYPES,
  READ_LEVELS,
  templateDiff,
  WRITE_LEVELS,
  type BoardTemplate,
  type FieldDef,
  type ViewDef,
} from "@openeoc/shared";
import { Button, EnumSelect, Panel, TextField } from "../design/components.js";

/**
 * The no-code board designer (INV-6). Everything an administrator can do
 * here is a structured control over the template model; there is no markup
 * input, no script input, and no escape hatch by construction. Saving
 * produces the next template version; the diff is shown before save.
 */
export function Designer(props: {
  base?: BoardTemplate;
  onSave: (template: BoardTemplate) => void;
}) {
  const [key, setKey] = useState(props.base?.key ?? "");
  const [title, setTitle] = useState(props.base?.title ?? "");
  const [fields, setFields] = useState<FieldDef[]>(props.base ? [...props.base.fields] : []);
  const [views, setViews] = useState<ViewDef[]>(props.base ? [...props.base.views] : []);
  const [error, setError] = useState<string | null>(null);

  const draft = (): unknown => ({
    key,
    version: (props.base?.version ?? 0) + 1,
    title,
    description: props.base?.description ?? "",
    fields,
    views,
  });

  function save() {
    const parsed = BoardTemplateSchema.safeParse(draft());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "invalid template");
      return;
    }
    setError(null);
    props.onSave(parsed.data);
  }

  const parsedDraft = BoardTemplateSchema.safeParse(draft());
  const diff =
    props.base && parsedDraft.success ? templateDiff(props.base, parsedDraft.data) : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="Board">
        <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
          <TextField label="Board key" value={key} onChange={setKey} />
          <TextField label="Board title" value={title} onChange={setTitle} />
        </div>
      </Panel>

      <Panel title="Fields">
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {fields.map((f, i) => (
            <li key={f.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ minWidth: 180 }}>
                {f.label} <code>({f.key}: {f.type})</code>
              </span>
              <Button onClick={() => setFields(fields.filter((_, j) => j !== i))}>Remove</Button>
            </li>
          ))}
        </ul>
        <FieldEditor onAdd={(f) => setFields([...fields, f])} />
      </Panel>

      <Panel title="Views">
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {views.map((v, i) => (
            <li key={v.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ minWidth: 180 }}>
                {v.title} <code>({v.columns.join(", ")})</code>
              </span>
              <Button onClick={() => setViews(views.filter((_, j) => j !== i))}>Remove</Button>
            </li>
          ))}
        </ul>
        <ViewEditor fieldKeys={fields.map((f) => f.key)} onAdd={(v) => setViews([...views, v])} />
      </Panel>

      {diff ? (
        <Panel title={`Changes from version ${diff.fromVersion}`}>
          <p data-testid="diff">
            added: {diff.addedFields.join(", ") || "none"}; removed:{" "}
            {diff.removedFields.join(", ") || "none"}; changed:{" "}
            {diff.changedFields.join(", ") || "none"}
          </p>
        </Panel>
      ) : null}

      {error ? (
        <p role="alert" style={{ color: "var(--eoc-status-critical)" }}>
          {error}
        </p>
      ) : null}
      <div>
        <Button kind="primary" onClick={save}>
          Save as version {(props.base?.version ?? 0) + 1}
        </Button>
      </div>
    </div>
  );
}

function FieldEditor(props: { onAdd: (field: FieldDef) => void }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<string>("text");
  const [enumId, setEnumId] = useState("");
  const [required, setRequired] = useState(false);
  const [read, setRead] = useState<string>("any");
  const [write, setWrite] = useState<string>("member");

  function add() {
    const field = {
      key,
      label,
      type,
      required,
      read,
      write,
      ...(type === "enum" && enumId ? { enumId } : {}),
    };
    props.onAdd(field as FieldDef);
    setKey("");
    setLabel("");
    setEnumId("");
    setRequired(false);
  }

  return (
    <fieldset style={{ border: "1px solid var(--eoc-border)", borderRadius: 4, padding: 12 }}>
      <legend>Add field</legend>
      <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
        <TextField label="Field key" value={key} onChange={setKey} />
        <TextField label="Field label" value={label} onChange={setLabel} />
        <EnumSelect label="Field type" values={FIELD_TYPES} value={type} onChange={setType} />
        {type === "enum" ? (
          <EnumSelect
            label="Enumeration"
            values={allEnums().map((e) => e.id)}
            value={enumId || (allEnums()[0]?.id ?? "")}
            onChange={setEnumId}
          />
        ) : null}
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          Required
        </label>
        <EnumSelect label="Readable by" values={READ_LEVELS} value={read} onChange={setRead} />
        <EnumSelect label="Writable by" values={WRITE_LEVELS} value={write} onChange={setWrite} />
        <div>
          <Button onClick={add}>Add field</Button>
        </div>
      </div>
    </fieldset>
  );
}

function ViewEditor(props: { fieldKeys: readonly string[]; onAdd: (view: ViewDef) => void }) {
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const [columns, setColumns] = useState<string[]>([]);

  function toggleColumn(field: string) {
    setColumns((c) => (c.includes(field) ? c.filter((x) => x !== field) : [...c, field]));
  }

  function add() {
    props.onAdd({ key, title, kind: "list", columns, filter: [] } as ViewDef);
    setKey("");
    setTitle("");
    setColumns([]);
  }

  return (
    <fieldset style={{ border: "1px solid var(--eoc-border)", borderRadius: 4, padding: 12 }}>
      <legend>Add view</legend>
      <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
        <TextField label="View key" value={key} onChange={setKey} />
        <TextField label="View title" value={title} onChange={setTitle} />
        <div role="group" aria-label="View columns">
          {props.fieldKeys.map((f) => (
            <label key={f} style={{ display: "inline-flex", gap: 4, marginRight: 12 }}>
              <input
                type="checkbox"
                checked={columns.includes(f)}
                onChange={() => toggleColumn(f)}
              />
              {f}
            </label>
          ))}
        </div>
        <div>
          <Button onClick={add}>Add view</Button>
        </div>
      </div>
    </fieldset>
  );
}
