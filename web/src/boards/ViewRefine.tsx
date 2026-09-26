import { useEffect, useMemo, useState } from "react";
import {
  choiceLabel,
  conditionFitsField,
  countsDays,
  dictionaryValues,
  isCalendarDate,
  isConditionGroup,
  isDayValue,
  leafConditions,
  signatureText,
  ViewConditionSchema,
  withConditions,
  type ConditionItem,
  type ConditionMatch,
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
  /** `any` when one condition of `where` is enough; every one must hold when absent. */
  readonly match?: ConditionMatch;
  /** The viewer's time zone, which `where` counts days in when it names a day. */
  readonly timeZone?: string;
  readonly sorts: readonly ViewSort[];
  readonly groupBy: string | null;
  readonly archived: "exclude" | "include" | "only";
}

export const NO_REFINEMENT: ViewRefinement = { where: [], sorts: [], groupBy: null, archived: "exclude" };

/** A refinement's conditions as the entries the server adds to the view's: one group when it matches any or counts days. */
function refinementItems(refinement: ViewRefinement): ConditionItem[] {
  if (refinement.where.length === 0) return [];
  if (refinement.match !== "any" && !refinement.timeZone) return [...refinement.where];
  return [{ match: refinement.match ?? "all", conditions: [...refinement.where],
    ...(refinement.timeZone ? { timeZone: refinement.timeZone } : {}) }];
}

export function refinementQuery(refinement: ViewRefinement): BoardViewQuery {
  const where = refinementItems(refinement);
  return {
    ...(refinement.archived !== "exclude" ? { archived: refinement.archived } : {}),
    ...(where.length ? { where } : {}),
    ...(refinement.sorts.length ? { sorts: refinement.sorts } : {}),
    ...(refinement.groupBy ? { groupBy: refinement.groupBy } : {}),
  };
}

/** The view as the server reads it under a refinement, so the browser orders and filters rows the same way. */
export function refinedView(view: ViewDef, refinement: ViewRefinement): ViewDef {
  const { sort, sorts, ...rest } = withConditions(view, refinementItems(refinement));
  return {
    ...rest,
    ...(refinement.sorts.length ? { sorts: [...refinement.sorts] } : sorts ? { sorts } : sort ? { sort } : {}),
    ...(refinement.groupBy ? { groupBy: refinement.groupBy } : {}),
  };
}

/** The browser's time zone, the one the product reads dates in. */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

type Op = ViewCondition["op"];

const OP_LABEL: Readonly<Record<Op, string>> = {
  eq: "is", neq: "is not", in: "is one of", not_in: "is not one of", contains: "contains",
  starts_with: "starts with", eq_ignore_case: "is, ignoring case", gt: "is greater than", gte: "is at least",
  lt: "is less than", lte: "is at most", between: "is between", before: "is before", after: "is after",
  on: "is on", within_last: "is within the last", within_next: "is within the next",
  is_empty: "is empty", is_not_empty: "is not empty",
};

function operatorsFor(field: FieldDef, days: boolean): Op[] {
  switch (field.type) {
    case "text": return ["contains", "starts_with", "eq", "eq_ignore_case", "neq", "in", "not_in", "is_empty", "is_not_empty"];
    case "enum": return ["contains", "starts_with", "eq", "neq", "in", "not_in", "is_empty", "is_not_empty"];
    case "number": return ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "is_not_empty"];
    case "datetime": return ["after", "before", ...(days ? ["on" as const] : []), "between",
      "within_last", "within_next", "is_empty", "is_not_empty"];
    case "boolean": return ["eq", "is_empty", "is_not_empty"];
    default: return ["is_empty", "is_not_empty"];
  }
}

const TIME_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "now", label: "Now" }, { value: "now-1h", label: "1 hour ago" },
  { value: "now-24h", label: "24 hours ago" }, { value: "now-7d", label: "7 days ago" },
  { value: "now-30d", label: "30 days ago" }, { value: "now+24h", label: "24 hours from now" },
];

const DAY_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "today", label: "Today" }, { value: "days", label: "A number of days from today" },
  { value: "date", label: "A specific date" },
];

/** A condition as typed: raw text, so a half-typed number or time stays editable. */
export interface DraftCondition {
  readonly field: string;
  readonly op: Op;
  readonly value: string;
  readonly value2: string;
  readonly values: readonly string[];
}

/** A group of conditions as typed. */
export interface DraftGroup {
  readonly match: ConditionMatch;
  readonly items: readonly DraftCondition[];
}

export type DraftItem = DraftCondition | DraftGroup;

/** A condition set as typed: all or any of its conditions and groups. */
export interface DraftSet {
  readonly match: ConditionMatch;
  readonly items: readonly DraftItem[];
}

const isDraftGroup = (item: DraftItem): item is DraftGroup => "items" in item;

export function blankDraft(field: FieldDef): DraftCondition {
  const time = field.type === "datetime";
  return { field: field.key, op: operatorsFor(field, false)[0]!, value: time ? "now-24h" : "", value2: time ? "now" : "", values: [] };
}

export function enumValues(field: FieldDef): readonly string[] {
  return field.values ?? (field.enumId ? dictionaryValues(field.enumId) : null) ?? [];
}

/** A draft as a condition the server accepts, or null while it is incomplete. */
export function draftCondition(draft: DraftCondition, field: FieldDef | undefined): ViewCondition | null {
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
    case "gt": case "gte": case "lt": case "lte": case "within_last": case "within_next": value = number(draft.value); break;
    case "eq": case "neq":
      if (draft.value === "") return null;
      value = field.type === "number" ? number(draft.value) : field.type === "boolean" ? draft.value === "true" : draft.value;
      break;
    default: value = draft.value;
  }
  const parsed = ViewConditionSchema.safeParse({ field: draft.field, op: draft.op, ...(value === undefined ? {} : { value }) });
  return parsed.success && conditionFitsField(parsed.data, field) ? parsed.data : null;
}

export function conditionDraft(condition: ViewCondition): DraftCondition {
  const value = condition.value;
  if (Array.isArray(value)) {
    return condition.op === "between"
      ? { field: condition.field, op: condition.op, value: String(value[0]), value2: String(value[1]), values: [] }
      : { field: condition.field, op: condition.op, value: value.join(", "), value2: "", values: value.map(String) };
  }
  return { field: condition.field, op: condition.op, value: value === undefined ? "" : String(value), value2: "", values: [] };
}

/** A stored condition set as drafts. */
export function draftSet(set?: { readonly match?: ConditionMatch | undefined; readonly conditions?: readonly ConditionItem[] | undefined }): DraftSet {
  return {
    match: set?.match ?? "all",
    items: (set?.conditions ?? []).map((item) => isConditionGroup(item)
      ? { match: item.match, items: leafConditions(item.conditions).map(conditionDraft) }
      : conditionDraft(item)),
  };
}

/** The names a set's rows go by on screen: "Condition 2", and "Group 1 condition 3" inside a group. */
function itemNames(items: readonly DraftItem[]): string[] {
  let conditions = 0;
  let groups = 0;
  return items.map((item) => isDraftGroup(item) ? `Group ${++groups}` : `Condition ${++conditions}`);
}

/** The complete conditions of a draft set, and the names of those still being typed, which are left out. */
export function draftConditions(draft: DraftSet, fields: readonly FieldDef[]): { conditions: ConditionItem[]; incomplete: string[] } {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const names = itemNames(draft.items);
  const incomplete: string[] = [];
  const conditions: ConditionItem[] = [];
  draft.items.forEach((item, index) => {
    if (!isDraftGroup(item)) {
      const condition = draftCondition(item, byKey.get(item.field));
      if (condition) conditions.push(condition);
      else incomplete.push(names[index]!);
      return;
    }
    const inner = item.items.flatMap((row, rowIndex) => {
      const condition = draftCondition(row, byKey.get(row.field));
      if (!condition) incomplete.push(`${names[index]!} condition ${rowIndex + 1}`);
      return condition ? [condition] : [];
    });
    if (inner.length) conditions.push({ match: item.match, conditions: inner });
  });
  return { conditions, incomplete };
}

/** What the status line says about conditions still being typed. */
export function incompleteNote(incomplete: readonly string[], subject: string): string | null {
  if (incomplete.length === 0) return null;
  const one = incomplete.length === 1;
  return `${incomplete.join(", ")} ${one ? "is" : "are"} left out of ${subject} until ${one ? "its value is" : "their values are"} complete.`;
}

const MATCH_OPTIONS = [{ value: "all", label: "Every condition to hold" }, { value: "any", label: "Any condition to hold" }];

/**
 * A condition set as rows of controls: conditions, and with `groups`, groups
 * of them one level deep, all or any of which must hold. View conditions,
 * refinements, workflow guards and board actions all use it.
 */
export function ConditionEditor(props: {
  readonly draft: DraftSet;
  /** The fields a condition may name. */
  readonly fields: readonly FieldDef[];
  readonly onChange: (next: DraftSet) => void;
  /** The label of the all-or-any choice; without one, every condition must hold. */
  readonly matchLabel?: string;
  /** Offer groups of conditions. */
  readonly groups?: boolean;
  /** Offer days (today, a number of days from today, a date) as datetime values. */
  readonly days?: boolean;
  /** The condition a new row starts as. */
  readonly start?: (field: FieldDef) => DraftCondition;
}) {
  const { draft, fields } = props;
  const days = props.days ?? false;
  const start = () => (props.start ?? blankDraft)(fields[0]!);
  const names = itemNames(draft.items);
  const emit = (items: readonly DraftItem[], match = draft.match) => props.onChange({ match, items });
  const replace = (index: number, item: DraftItem | null) =>
    emit(draft.items.flatMap((current, itemIndex) => itemIndex === index ? (item ? [item] : []) : [current]));
  const full = fields.length === 0 || draft.items.length >= 16;
  return <>
    {props.matchLabel && draft.items.length ? <Select label={props.matchLabel} value={draft.match} options={MATCH_OPTIONS}
      onChange={(match) => emit(draft.items, match as ConditionMatch)} /> : null}
    {draft.items.map((item, index) => {
      const name = names[index]!;
      if (!isDraftGroup(item)) return <ConditionRow key={index} name={name} draft={item} fields={fields} days={days}
        onChange={(next) => replace(index, next)} onRemove={() => replace(index, null)} />;
      // A group with no conditions left is gone.
      const setGroup = (next: DraftGroup) => replace(index, next.items.length ? next : null);
      return <fieldset key={index} className="board-refine__nest">
        <legend>{name}</legend>
        <Select label={`${name} needs`} value={item.match} options={MATCH_OPTIONS}
          onChange={(match) => setGroup({ ...item, match: match as ConditionMatch })} />
        {item.items.map((row, rowIndex) => <ConditionRow key={rowIndex} name={`${name} condition ${rowIndex + 1}`}
          draft={row} fields={fields} days={days}
          onChange={(next) => setGroup({ ...item, items: item.items.map((current, j) => j === rowIndex ? next : current) })}
          onRemove={() => setGroup({ ...item, items: item.items.filter((_, j) => j !== rowIndex) })} />)}
        <div className="board-refine__actions">
          <ActionButton disabled={item.items.length >= 16} onClick={() => setGroup({ ...item, items: [...item.items, start()] })}>
            Add condition to {name.toLowerCase()}
          </ActionButton>
          <ActionButton kind="quiet" onClick={() => replace(index, null)}>Remove {name.toLowerCase()}</ActionButton>
        </div>
      </fieldset>;
    })}
    <div className="board-refine__actions">
      <ActionButton disabled={full} onClick={() => emit([...draft.items, start()])}>Add condition</ActionButton>
      {props.groups ? <ActionButton disabled={full}
        onClick={() => emit([...draft.items, { match: "any", items: [start()] }])}>Add group</ActionButton> : null}
    </div>
  </>;
}

/** The time zone a condition set counts days in, from the zones the browser knows. */
export function TimeZoneSelect(props: { label: string; value: string; onChange: (zone: string) => void }) {
  const zones = useMemo(() => {
    const known = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return [...new Set(["UTC", props.value, ...known])];
  }, [props.value]);
  return <Select label={props.label} value={props.value} options={zones.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }))}
    onChange={props.onChange} />;
}

/**
 * Conditions, sort keys, a group field and archived records for the board
 * view, drafted here and sent to the server on Apply.
 */
export function ViewRefineControls(props: {
  readonly fields: readonly FieldDef[];
  readonly value: ViewRefinement;
  readonly onApply: (next: ViewRefinement) => void;
  /**
   * Offer any-of conditions and days counted in the viewer's time zone. A
   * saved report stores a list every condition of which must hold, so the
   * report builder leaves this off.
   */
  readonly anyOf?: boolean;
}) {
  const filterable = props.fields.filter((field) => field.type !== "geometry");
  const groupable = filterable.filter((field) => !field.calculation);
  const byKey = new Map(props.fields.map((field) => [field.key, field]));
  const anyOf = props.anyOf ?? false;
  const [draft, setDraft] = useState<DraftSet>(() => draftSet());
  const [sorts, setSorts] = useState<ViewSort[]>([]);
  const [groupBy, setGroupBy] = useState("");
  const [archived, setArchived] = useState<ViewRefinement["archived"]>("exclude");
  const [problem, setProblem] = useState<string | null>(null);
  const applied = JSON.stringify(props.value);
  useEffect(() => {
    setDraft(draftSet({ match: props.value.match, conditions: props.value.where }));
    setSorts([...props.value.sorts]);
    setGroupBy(props.value.groupBy ?? "");
    setArchived(props.value.archived);
    setProblem(null);
  }, [applied]);

  const fieldOptions = (list: readonly FieldDef[]) => list.map((field) => ({ value: field.key, label: field.label }));

  function apply() {
    const { conditions, incomplete } = draftConditions(draft, filterable);
    if (incomplete.length) {
      setProblem(`${incomplete[0]} needs a complete value.`);
      return;
    }
    const where = leafConditions(conditions);
    setProblem(null);
    props.onApply({
      where,
      ...(anyOf && draft.match === "any" && where.length ? { match: "any" as const } : {}),
      ...(anyOf && countsDays(where) ? { timeZone: viewerTimeZone() } : {}),
      sorts: sorts.filter((sort) => byKey.has(sort.field)), groupBy: groupBy || null, archived,
    });
  }

  const count = props.value.where.length;
  const active = [
    count ? `${count} condition${count === 1 ? "" : "s"}${props.value.match === "any" && count > 1 ? ", any one" : ""}` : null,
    props.value.sorts.length ? `sorted by ${props.value.sorts.map((sort) => byKey.get(sort.field)?.label ?? sort.field).join(", ")}` : null,
    props.value.groupBy ? `grouped by ${byKey.get(props.value.groupBy)?.label ?? props.value.groupBy}` : null,
    props.value.archived === "include" ? "including archived" : props.value.archived === "only" ? "archived only" : null,
  ].filter(Boolean);

  return <details className="board-refine">
    <summary><span>Filter, sort and group</span>{active.length ? <small>{active.join(" · ")}</small> : null}</summary>
    <div className="board-refine__body">
      <fieldset className="board-refine__group">
        <legend>Conditions</legend>
        {draft.items.length === 0 ? <p>All records in the view.{anyOf ? "" : " Every condition added must hold."}</p> : null}
        <ConditionEditor draft={draft} fields={filterable} onChange={setDraft} days={anyOf}
          {...(anyOf ? { matchLabel: "Records need" } : {})} />
      </fieldset>
      <SortKeys fields={filterable} value={sorts} onChange={setSorts} empty="The view's own order." />
      <div className="board-refine__row">
        <Select label="Group by" value={groupBy} options={[{ value: "", label: "No grouping" }, ...fieldOptions(groupable)]}
          onChange={setGroupBy} />
        <Select label="Archived records" value={archived}
          options={[{ value: "exclude", label: "Leave out archived records" },
            { value: "include", label: "Include archived records" }, { value: "only", label: "Only archived records" }]}
          onChange={(next) => setArchived(next as ViewRefinement["archived"])} />
      </div>
      {problem ? <p role="alert">{problem}</p> : null}
      <div className="board-refine__actions">
        <ActionButton kind="primary" onClick={apply}>Apply</ActionButton>
        <ActionButton kind="quiet" onClick={() => props.onApply(NO_REFINEMENT)}>Clear</ActionButton>
      </div>
    </div>
  </details>;
}

/** Ordered sort keys, up to four, each a field and a direction. */
export function SortKeys(props: {
  readonly fields: readonly FieldDef[];
  readonly value: readonly ViewSort[];
  readonly onChange: (next: ViewSort[]) => void;
  /** Said when there are no sort keys. */
  readonly empty: string;
}) {
  const { value: sorts } = props;
  const options = props.fields.map((field) => ({ value: field.key, label: field.label }));
  const update = (index: number, patch: Partial<ViewSort>) =>
    props.onChange(sorts.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <fieldset className="board-refine__group">
    <legend>Sort</legend>
    {sorts.length === 0 ? <p>{props.empty}</p> : null}
    {sorts.map((sort, index) => <div className="board-refine__row" key={index}>
      <Select label={`Sort ${index + 1} field`} value={sort.field} options={options} onChange={(field) => update(index, { field })} />
      <Select label={`Sort ${index + 1} direction`} value={sort.dir}
        options={[{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]}
        onChange={(dir) => update(index, { dir: dir as ViewSort["dir"] })} />
      <ActionButton kind="quiet" onClick={() => props.onChange(sorts.filter((_, itemIndex) => itemIndex !== index))}>
        Remove sort {index + 1}
      </ActionButton>
    </div>)}
    <div><ActionButton disabled={props.fields.length === 0 || sorts.length >= 4}
      onClick={() => props.onChange([...sorts, { field: props.fields[0]!.key, dir: "asc" }])}>Add sort key</ActionButton></div>
  </fieldset>;
}

/** A datetime condition's value kept to the kind the new operator takes. */
function retarget(draft: DraftCondition, op: Op, field: FieldDef): DraftCondition {
  const next = { ...draft, op };
  if (field.type !== "datetime") return next;
  const count = /^\d+$/.test(draft.value);
  if (op === "within_last" || op === "within_next") return count ? next : { ...next, value: "7" };
  if (op === "on") return isDayValue(draft.value) ? next : { ...next, value: "today" };
  return count ? { ...next, value: "now-24h", value2: draft.value2 || "now" } : next;
}

/**
 * One condition as a row of controls: its field, an operator that fits the
 * field's type, and a value control for both.
 */
export function ConditionRow(props: {
  /** The row's name on screen, such as "Condition 2", which its controls' labels start with. */
  readonly name: string;
  readonly draft: DraftCondition;
  /** The fields a condition may name. */
  readonly fields: readonly FieldDef[];
  /** Offer days (today, a number of days from today, a date) as datetime values. */
  readonly days?: boolean;
  readonly onChange: (next: DraftCondition) => void;
  readonly onRemove: () => void;
}) {
  const { draft, name } = props;
  const days = props.days ?? false;
  const byKey = new Map(props.fields.map((field) => [field.key, field]));
  const field = byKey.get(draft.field) ?? props.fields[0]!;
  return <div className="board-refine__row">
    <Select label={`${name} field`} value={draft.field}
      options={props.fields.map((item) => ({ value: item.key, label: item.label }))}
      onChange={(key) => props.onChange(blankDraft(byKey.get(key)!))} />
    <Select label={`${name} operator`} value={draft.op}
      options={operatorsFor(field, days).map((op) => ({ value: op, label: OP_LABEL[op] }))}
      onChange={(op) => props.onChange(retarget(draft, op as Op, field))} />
    <ConditionValue name={name} field={field} draft={draft} days={days} onChange={props.onChange} />
    <ActionButton kind="quiet" onClick={props.onRemove}>Remove {name.toLowerCase()}</ActionButton>
  </div>;
}

function ConditionValue(props: { name: string; field: FieldDef; draft: DraftCondition; days: boolean; onChange: (next: DraftCondition) => void }) {
  const { draft, field } = props;
  const label = `${props.name} value`;
  const set = (patch: Partial<DraftCondition>) => props.onChange({ ...draft, ...patch });
  if (draft.op === "is_empty" || draft.op === "is_not_empty") return null;
  if (draft.op === "within_last" || draft.op === "within_next")
    return <Text label={`${label}, number of days`} type="number" value={draft.value} onChange={(value) => set({ value })} />;
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
      <TimeValue label={`${label} from`} value={draft.value} days={props.days} onChange={(value) => set({ value })} />
      <TimeValue label={`${label} to`} value={draft.value2} days={props.days} onChange={(value2) => set({ value2 })} />
    </> : <TimeValue label={label} value={draft.value} days={props.days} dayOnly={draft.op === "on"}
      onChange={(value) => set({ value })} />;
  }
  const type = field.type === "number" && draft.op !== "in" && draft.op !== "not_in" ? "number" : "text";
  if (draft.op === "between") return <>
    <Text label={`${label} from`} type={type} value={draft.value} onChange={(value) => set({ value })} />
    <Text label={`${label} to`} type={type} value={draft.value2} onChange={(value2) => set({ value2 })} />
  </>;
  return <Text label={draft.op === "in" || draft.op === "not_in" ? `${label}s, separated by commas` : label}
    type={type} value={draft.value} onChange={(value) => set({ value })} />;
}

type TimeMode = "preset" | "today" | "days" | "date" | "specific";

/** How a time value was chosen; null for an empty value, whose kind the select remembers. */
function timeMode(value: string): TimeMode | null {
  if (!value) return null;
  if (TIME_PRESETS.some((preset) => preset.value === value)) return "preset";
  if (value === "today") return "today";
  if (value.startsWith("today")) return "days";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
  return "specific";
}

/** A signed number of days from today as a day value; an unfinished number stays unfinished. */
function dayValue(text: string): string {
  const days = Number(text);
  if (text.trim() === "" || !Number.isInteger(days)) return "today+";
  return `today${days < 0 ? "-" : "+"}${Math.abs(days)}d`;
}

function TimeValue(props: { label: string; value: string; days: boolean; dayOnly?: boolean; onChange: (value: string) => void }) {
  const [chosen, setChosen] = useState<TimeMode>(props.dayOnly ? "date" : "specific");
  const mode = timeMode(props.value) ?? chosen;
  const options = props.dayOnly ? DAY_CHOICES
    : [...TIME_PRESETS, ...(props.days ? DAY_CHOICES : []), { value: "specific", label: "A specific time" }];
  const offset = /^today([+-]\d{1,4})d$/.exec(props.value)?.[1];
  return <>
    <Select label={props.label} value={mode === "preset" ? props.value : mode} options={options}
      onChange={(next) => {
        if (next === "days") return props.onChange("today+1d");
        if (next === "date" || next === "specific") {
          setChosen(next);
          return props.onChange("");
        }
        props.onChange(next);
      }} />
    {mode === "days" ? <Text label={`${props.label}, days from today (negative for earlier days)`} type="number"
      value={offset === undefined ? "" : String(Number(offset))} onChange={(text) => props.onChange(dayValue(text))} /> : null}
    {mode === "date" ? <label className="board-refine__control"><span>{props.label}, date</span>
      <input type="date" value={isCalendarDate(props.value) ? props.value : ""}
        onChange={(event) => props.onChange(event.target.value)} />
    </label> : null}
    {mode === "specific" ? <label className="board-refine__control"><span>{props.label}, specific time</span>
      <input type="datetime-local" value={localInput(props.value)}
        onChange={(event) => props.onChange(event.target.value ? new Date(event.target.value).toISOString() : "")} />
    </label> : null}
  </>;
}

function localInput(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
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
