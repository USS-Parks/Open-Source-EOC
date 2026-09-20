import { useState } from "react";
import { allFields, type FormField } from "@openeoc/shared";
import { Button, EnumSelect, Panel, TextField } from "../../design/components.js";
import type { ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { EmptyState, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

function labelOf(f: FormField): string {
  const base = f.label ?? f.name;
  return f.type === "geopoint" ? `${base} (lat lon)` : base;
}

function FormFieldControl(props: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { field } = props;
  switch (field.type) {
    case "note":
      return <p style={{ margin: 0, color: "var(--eoc-text-muted)" }}>{field.label ?? field.name}</p>;
    case "calculate":
      return null;
    case "image":
      return (
        <p style={{ margin: 0, color: "var(--eoc-text-muted)" }}>
          {labelOf(field)}: image capture is not available in this runner.
        </p>
      );
    case "integer":
    case "decimal":
      return (
        <TextField
          label={labelOf(field)}
          value={props.value === undefined ? "" : String(props.value)}
          onChange={(v) => props.onChange(v === "" ? undefined : Number(v))}
        />
      );
    case "select_one": {
      const choices = field.choices ?? [];
      return (
        <EnumSelect
          label={labelOf(field)}
          values={["", ...choices.map((c) => c.name)]}
          value={String(props.value ?? "")}
          onChange={(v) => props.onChange(v === "" ? undefined : v)}
          labels={Object.fromEntries(choices.map((c) => [c.name, c.label]))}
        />
      );
    }
    case "select_multiple": {
      const choices = field.choices ?? [];
      const selected = Array.isArray(props.value) ? (props.value as string[]) : [];
      return (
        <div>
          <span style={{ display: "block", marginBottom: 4 }}>{labelOf(field)}</span>
          <div style={{ display: "grid", gap: 4 }}>
            {choices.map((c) => (
              <label key={c.name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={selected.includes(c.name)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, c.name]
                      : selected.filter((x) => x !== c.name);
                    props.onChange(next.length ? next : undefined);
                  }}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>
      );
    }
    default:
      // text, date, datetime, time, geopoint
      return (
        <TextField
          label={labelOf(field)}
          value={String(props.value ?? "")}
          onChange={(v) => props.onChange(v === "" ? undefined : v)}
        />
      );
  }
}

/**
 * Smart-form runner (F7, VEOC-22). Renders an imported XLSForm from its stored
 * definition and submits the answers to a board, which the server validates and
 * maps. Field capture in the operator's hands, no spreadsheet round-trip.
 */
export function SmartFormsSurface(props: { client: ApiClient; jurisdictionId: string }) {
  const forms = useAsync(() => props.client.listForms(props.jurisdictionId), [props.jurisdictionId]);
  const boards = useAsync(() => props.client.listBoards(props.jurisdictionId), [props.jurisdictionId]);
  const [formKey, setFormKey] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [boardId, setBoardId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const formList = forms.data ?? [];
  const activeKey = formKey || formList[0]?.key || "";
  const def = useAsync(
    () => (activeKey ? props.client.getForm(props.jurisdictionId, activeKey) : Promise.resolve(null)),
    [props.jurisdictionId, activeKey],
  );

  if (forms.loading && !forms.data) return <Loading label="Loading forms…" />;
  if (formList.length === 0)
    return (
      <EmptyState
        label="No smart forms imported."
        hint="Import an XLSForm (.xlsx) through the API; it renders here for field capture."
      />
    );

  const fields = def.data ? allFields(def.data.nodes) : [];
  const boardTemplate = def.data?.boardTemplate;
  const targetBoards = (boards.data ?? []).filter(
    (b) => !boardTemplate || b.templateKey === boardTemplate,
  );
  const activeBoard = boardId || targetBoards[0]?.id || "";

  const submit = () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    if (!activeBoard) {
      setError("No target board for this form. Create one from its board template first.");
      setBusy(false);
      return;
    }
    props.client
      .submitForm(activeKey, { jurisdictionId: props.jurisdictionId, boardId: activeBoard, answers })
      .then(() => {
        setMsg("Form submitted to the board.");
        setAnswers({});
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Scroll>
      <SurfaceHeader title="Smart Forms" />
      <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
        <Panel title="Form">
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <EnumSelect
              label="Smart form"
              values={formList.map((f) => f.key)}
              value={activeKey}
              onChange={(v) => {
                setFormKey(v);
                setAnswers({});
                setBoardId("");
              }}
              labels={Object.fromEntries(formList.map((f) => [f.key, f.title]))}
            />
            <EnumSelect
              label="Target board"
              values={targetBoards.map((b) => b.id)}
              value={activeBoard}
              onChange={setBoardId}
              labels={Object.fromEntries(targetBoards.map((b) => [b.id, b.title]))}
            />
          </div>
        </Panel>

        <Panel title={def.data?.title ?? "Questions"}>
          {def.loading && !def.data ? <Loading label="Loading form…" /> : null}
          {def.data ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              style={{ display: "grid", gap: 12 }}
            >
              {fields.map((f) => (
                <FormFieldControl
                  key={f.name}
                  field={f}
                  value={answers[f.name]}
                  onChange={(v) => setAnswers((a) => ({ ...a, [f.name]: v }))}
                />
              ))}
              <div>
                <Button kind="primary" type="submit" disabled={busy}>
                  Submit form
                </Button>
              </div>
            </form>
          ) : null}
          {msg ? <p style={{ color: "var(--eoc-status-success)", margin: "8px 0 0" }}>{msg}</p> : null}
          {error ? (
            <p role="alert" style={{ color: "var(--eoc-status-critical)", margin: "8px 0 0" }}>
              {error}
            </p>
          ) : null}
        </Panel>
      </div>
    </Scroll>
  );
}
