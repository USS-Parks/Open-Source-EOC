import { useEffect, useState } from "react";
import {
  choiceLabel,
  conditionFitsField,
  dictionaryValues,
  signatureText,
  ViewConditionSchema,
  type FieldDef,
  type ViewCondition,
  type ViewDef,
  type ViewSort,
} from "@openeoc/shared";
import type { BoardViewQuery } from "../app/api/client.js";
import { ActionButton } from "../design/controls.js";
import "./board-tools.css";

/** What an operator adds to a board view for one read; the server applies all of it. */
export interface ViewRefinement {
  readonly where: readonly ViewCondition[];
  readonly sorts: readonly ViewSort[];
  readonly groupBy: string | null;
  readonly archived: "exclude" | "include" | "only";
}

export const NO_REFINEMENT: ViewRefinement = { where: [], sorts: [], groupBy: null, archived: "exclude" };

export function refinementQuery(refinement: ViewRefinement): BoardViewQuery {
  return {
    ...(refinement.archived !== "exclude" ? { archived: refinement.archived } : {}),
    ...(refinement.where.length ? { where: refinement.where } : {}),
    ...(refinement.sorts.length ? { sorts: refinement.sorts } : {}),
    ...(refinement.groupBy ? { groupBy: refinement.groupBy } : {}),
  };
}

/** The view as the server reads it under a refinement, so the browser orders and filters rows the same way. */
export function refinedView(view: ViewDef, refinement: ViewRefinement): ViewDef {
  const { sort, sorts, ...rest } = view;
  return {
    ...rest,
    where: [...(view.where ?? []), ...refinement.where],
    ...(refinement.sorts.length ? { sorts: [...refinement.sorts] } : sorts ? { sorts } : sort ? { sort } : {}),
    ...(refinement.groupBy ? { groupBy: refinement.groupBy } : {}),
  };
}

type Op = ViewCondition["op"];

const OP_LABEL: Readonly<Record<Op, string>> = {
  eq: "is", neq: "is not", in: "is one of", not_in: "is not one of", contains: "contains",
  starts_with: "starts with", gt: "is greater than", gte: "is at least", lt: "is less than",
  lte: "is at most", between: "is between", before: "is before", after: "is after",
  is_empty: "is empty", is_not_empty: "is not empty",
};

function operatorsFor(field: FieldDef): Op[] {
  switch (field.type) {
    case "text": case "enum": return ["contains", "starts_with", "eq", "neq", "in", "not_in", "is_empty", "is_not_empty"];
    case "number": return ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "is_not_empty"];
    case "datetime": return ["after", "before", "between", "is_empty", "is_not_empty"];
    case "boolean": return ["eq", "is_empty", "is_not_empty"];
    default: return ["is_empty", "is_not_empty"];
  }
}

const TIME_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "now", label: "Now" }, { value: "now-1h", label: "1 hour ago" },
  { value: "now-24h", label: "24 hours ago" }, { value: "now-7d", label: "7 days ago" },
  { value: "now-30d", label: "30 days ago" }, { value: "now+24h", label: "24 hours from now" },
];

/** A condition as typed: raw text, so a half-typed number or time stays editable. */
interface DraftCondition {
  readonly field: string;
  readonly op: Op;
  readonly value: string;
  readonly value2: string;
  readonly values: readonly string[];
}

function blankDraft(field: FieldDef): DraftCondition {
  const time = field.type === "datetime";
  return { field: field.key, op: operatorsFor(field)[0]!, value: time ? "now-24h" : "", value2: time ? "now" : "", values: [] };
}

export function enumValues(field: FieldDef): readonly string[] {
  return field.values ?? (field.enumId ? dictionaryValues(field.enumId) : null) ?? [];
}

/** A draft as a condition the server accepts, or null while it is incomplete. */
function draftCondition(draft: DraftCondition, field: FieldDef | undefined): ViewCondition | null {
  if (!field) return null;
  const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));
  let value: unknown;
  switch (draft.op) {
    case "is_empty": case "is_not_empty": value = undefined; break;
    case "in": case "not_in":
      value = field.type === "enum" ? [...draft.values] : draft.value.split(",").map((item) => item.trim()).filter(Boolean);
      if ((value as string[]).length === 0) return null;
      break;
    case "between": value = field.type === "number" ? [number(draft.value), number(draft.value2)] : [draft.value, draft.value2]; break;
    case "gt": case "gte": case "lt": case "lte": value = number(draft.value); break;
    case "eq": case "neq":
      if (draft.value === "") return null;
      value = field.type === "number" ? number(draft.value) : field.type === "boolean" ? draft.value === "true" : draft.value;
      break;
    default: value = draft.value;
  }
  const parsed = ViewConditionSchema.safeParse({ field: draft.field, op: draft.op, ...(value === undefined ? {} : { value }) });
  return parsed.success && conditionFitsField(parsed.data, field) ? parsed.data : null;
}

function conditionDraft(condition: ViewCondition): DraftCondition {
  const value = condition.value;
  if (Array.isArray(value)) {
    return condition.op === "between"
      ? { field: condition.field, op: condition.op, value: String(value[0]), value2: String(value[1]), values: [] }
      : { field: condition.field, op: condition.op, value: value.join(", "), value2: "", values: value.map(String) };
  }
  return { field: condition.field, op: condition.op, value: value === undefined ? "" : String(value), value2: "", values: [] };
}

function localInput(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/**
 * Conditions, sort keys, a group field and archived records for the board
 * view, drafted here and sent to the server on Apply.
 */
export function ViewRefineControls(props: {
  readonly fields: readonly FieldDef[];
  readonly value: ViewRefinement;
  readonly onApply: (next: ViewRefinement) => void;
  /** In a template's own view, where archived records follow the board's reads, the archived choice is left out. */
  readonly forView?: boolean;
}) {
  const filterable = props.fields.filter((field) => field.type !== "geometry");
  const groupable = filterable.filter((field) => !field.calculation);
  const byKey = new Map(props.fields.map((field) => [field.key, field]));
  const [conditions, setConditions] = useState<DraftCondition[]>([]);
  const [sorts, setSorts] = useState<ViewSort[]>([]);
  const [groupBy, setGroupBy] = useState("");
  const [archived, setArchived] = useState<ViewRefinement["archived"]>("exclude");
  const [problem, setProblem] = useState<string | null>(null);
  const applied = JSON.stringify(props.value);
  useEffect(() => {
    setConditions(props.value.where.map(conditionDraft));
    setSorts([...props.value.sorts]);
    setGroupBy(props.value.groupBy ?? "");
    setArchived(props.value.archived);
    setProblem(null);
  }, [applied]);

  const fieldOptions = (list: readonly FieldDef[]) => list.map((field) => ({ value: field.key, label: field.label }));
  const setCondition = (index: number, next: DraftCondition) =>
    setConditions(conditions.map((item, itemIndex) => itemIndex === index ? next : item));

  function apply() {
    const where: ViewCondition[] = [];
    for (const [index, draft] of conditions.entries()) {
      const condition = draftCondition(draft, byKey.get(draft.field));
      if (!condition) {
        setProblem(`Condition ${index + 1} needs a complete value.`);
        return;
      }
      where.push(condition);
    }
    setProblem(null);
    props.onApply({ where, sorts: sorts.filter((sort) => byKey.has(sort.field)), groupBy: groupBy || null, archived });
  }

  const active = [
    props.value.where.length ? `${props.value.where.length} condition${props.value.where.length === 1 ? "" : "s"}` : null,
    props.value.sorts.length ? `sorted by ${props.value.sorts.map((sort) => byKey.get(sort.field)?.label ?? sort.field).join(", ")}` : null,
    props.value.groupBy ? `grouped by ${byKey.get(props.value.groupBy)?.label ?? props.value.groupBy}` : null,
    props.value.archived === "include" ? "including archived" : props.value.archived === "only" ? "archived only" : null,
  ].filter(Boolean);

  return <details className="board-refine">
    <summary><span>{props.forView ? "Conditions, sorts and groups" : "Filter, sort and group"}</span>{active.length ? <small>{active.join(" · ")}</small> : null}</summary>
    <div className="board-refine__body">
      <fieldset className="board-refine__group">
        <legend>Conditions</legend>
        {conditions.length === 0 ? <p>All records in the view. Every condition added must hold.</p> : null}
        {conditions.map((draft, index) => {
          const field = byKey.get(draft.field) ?? filterable[0]!;
          const n = index + 1;
          return <div className="board-refine__row" key={index}>
            <Select label={`Condition ${n} field`} value={draft.field} options={fieldOptions(filterable)}
              onChange={(key) => setCondition(index, blankDraft(byKey.get(key)!))} />
            <Select label={`Condition ${n} operator`} value={draft.op}
              options={operatorsFor(field).map((op) => ({ value: op, label: OP_LABEL[op] }))}
              onChange={(op) => setCondition(index, { ...draft, op: op as Op })} />
            <ConditionValue n={n} field={field} draft={draft} onChange={(next) => setCondition(index, next)} />
            <ActionButton kind="quiet" onClick={() => setConditions(conditions.filter((_, itemIndex) => itemIndex !== index))}>
              Remove condition {n}
            </ActionButton>
          </div>;
        })}
        <div><ActionButton disabled={filterable.length === 0 || conditions.length >= 16}
          onClick={() => setConditions([...conditions, blankDraft(filterable[0]!)])}>Add condition</ActionButton></div>
      </fieldset>
      <fieldset className="board-refine__group">
        <legend>Sort</legend>
        {sorts.length === 0 ? <p>The view&apos;s own order.</p> : null}
        {sorts.map((sort, index) => <div className="board-refine__row" key={index}>
          <Select label={`Sort ${index + 1} field`} value={sort.field} options={fieldOptions(filterable)}
            onChange={(field) => setSorts(sorts.map((item, itemIndex) => itemIndex === index ? { ...item, field } : item))} />
          <Select label={`Sort ${index + 1} direction`} value={sort.dir}
            options={[{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]}
            onChange={(dir) => setSorts(sorts.map((item, itemIndex) => itemIndex === index ? { ...item, dir: dir as ViewSort["dir"] } : item))} />
          <ActionButton kind="quiet" onClick={() => setSorts(sorts.filter((_, itemIndex) => itemIndex !== index))}>
            Remove sort {index + 1}
          </ActionButton>
        </div>)}
        <div><ActionButton disabled={filterable.length === 0 || sorts.length >= 4}
          onClick={() => setSorts([...sorts, { field: filterable[0]!.key, dir: "asc" }])}>Add sort key</ActionButton></div>
      </fieldset>
      <div className="board-refine__row">
        <Select label="Group by" value={groupBy} options={[{ value: "", label: "No grouping" }, ...fieldOptions(groupable)]}
          onChange={setGroupBy} />
        {props.forView ? null : <Select label="Archived records" value={archived}
          options={[{ value: "exclude", label: "Leave out archived records" },
            { value: "include", label: "Include archived records" }, { value: "only", label: "Only archived records" }]}
          onChange={(next) => setArchived(next as ViewRefinement["archived"])} />}
      </div>
      {problem ? <p role="alert">{problem}</p> : null}
      <div className="board-refine__actions">
        <ActionButton kind="primary" onClick={apply}>{props.forView ? "Save to view" : "Apply"}</ActionButton>
        <ActionButton kind="quiet" onClick={() => props.onApply(NO_REFINEMENT)}>Clear</ActionButton>
      </div>
    </div>
  </details>;
}

function ConditionValue(props: { n: number; field: FieldDef; draft: DraftCondition; onChange: (next: DraftCondition) => void }) {
  const { draft, field, n } = props;
  const label = `Condition ${n} value`;
  const set = (patch: Partial<DraftCondition>) => props.onChange({ ...draft, ...patch });
  if (draft.op === "is_empty" || draft.op === "is_not_empty") return null;
  if (field.type === "enum" && (draft.op === "in" || draft.op === "not_in")) {
    return <fieldset className="board-refine__checks"><legend>{label}</legend>
      {enumValues(field).map((value) => <label key={value}>
        <input type="checkbox" checked={draft.values.includes(value)} onChange={(event) => set({
          values: event.target.checked ? [...draft.values, value] : draft.values.filter((item) => item !== value),
        })} />{value}
      </label>)}
    </fieldset>;
  }
  if (field.type === "enum" && (draft.op === "eq" || draft.op === "neq")) {
    return <Select label={label} value={draft.value}
      options={[{ value: "", label: "Choose a value" }, ...enumValues(field).map((value) => ({ value, label: value }))]}
      onChange={(value) => set({ value })} />;
  }
  if (field.type === "boolean") {
    return <Select label={label} value={draft.value}
      options={[{ value: "", label: "Choose a value" }, { value: "true", label: "Yes" }, { value: "false", label: "No" }]}
      onChange={(value) => set({ value })} />;
  }
  if (field.type === "datetime") {
    return draft.op === "between" ? <>
      <TimeValue label={`${label} from`} value={draft.value} onChange={(value) => set({ value })} />
      <TimeValue label={`${label} to`} value={draft.value2} onChange={(value2) => set({ value2 })} />
    </> : <TimeValue label={label} value={draft.value} onChange={(value) => set({ value })} />;
  }
  const type = field.type === "number" && draft.op !== "in" && draft.op !== "not_in" ? "number" : "text";
  if (draft.op === "between") return <>
    <Text label={`${label} from`} type={type} value={draft.value} onChange={(value) => set({ value })} />
    <Text label={`${label} to`} type={type} value={draft.value2} onChange={(value2) => set({ value2 })} />
  </>;
  return <Text label={draft.op === "in" || draft.op === "not_in" ? `${label}s, separated by commas` : label}
    type={type} value={draft.value} onChange={(value) => set({ value })} />;
}

function TimeValue(props: { label: string; value: string; onChange: (value: string) => void }) {
  const preset = TIME_PRESETS.some((item) => item.value === props.value) ? props.value : "specific";
  return <>
    <Select label={props.label} value={preset} options={[...TIME_PRESETS, { value: "specific", label: "A specific time" }]}
      onChange={(value) => props.onChange(value === "specific" ? "" : value)} />
    {preset === "specific" ? <label className="board-refine__control"><span>{props.label}, specific time</span>
      <input type="datetime-local" value={localInput(props.value)}
        onChange={(event) => props.onChange(event.target.value ? new Date(event.target.value).toISOString() : "")} />
    </label> : null}
  </>;
}

function Text(props: { label: string; type: "text" | "number"; value: string; onChange: (value: string) => void }) {
  return <label className="board-refine__control"><span>{props.label}</span>
    <input type={props.type} value={props.value} onChange={(event) => props.onChange(event.target.value)} /></label>;
}

function Select(props: {
  label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  return <label className="board-refine__control"><span>{props.label}</span>
    <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
      {props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>;
}

/** Record counts per group over every matching record, from the first page of a grouped view. */
export function GroupCounts(props: {
  readonly field: FieldDef | undefined;
  readonly groups: ReadonlyArray<{ readonly value: unknown; readonly count: number }>;
}) {
  const label = props.field?.label ?? "group";
  return <section className="board-refine__counts" aria-label="Group counts">
    <strong>Grouped by {label}</strong>
    <ul>{props.groups.map((group) => <li key={JSON.stringify(group.value)}>
      <span>{groupLabel(group.value, props.field?.type)}</span> <strong>{group.count}</strong>
    </li>)}</ul>
  </section>;
}

function groupLabel(value: unknown, type: FieldDef["type"] | undefined): string {
  if (value === null || value === undefined || value === "") return "No value";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return signatureText(value) ?? JSON.stringify(value);
  return type === "enum" ? choiceLabel(String(value)) : String(value);
}
