import { useState } from "react";
import type { BoardWorkflow, FieldDef, ViewRecord } from "@openeoc/shared";
import type { BoardViewQuery } from "../app/api/client.js";
import { ActionButton } from "../design/controls.js";
import { enumValues } from "./ViewRefine.js";
import "./board-tools.css";

/**
 * A board's records beyond the list: kanban columns by an enum field, a
 * calendar by a datetime field, and a bar chart of record counts by any
 * groupable field. Each mode reads the same server view as the list with a
 * group field or a date range added, so every count and range is the server's.
 */

export type BoardMode = "list" | "kanban" | "calendar" | "chart";

/** The board screen's mode, its field, and the calendar's span and anchor day. */
export interface BoardModeState {
  readonly mode: BoardMode;
  /** The chosen field; one that does not fit the mode falls back to the first that does. */
  readonly field: string | null;
  readonly span: "month" | "week";
  /** The day the calendar shows, YYYY-MM-DD in the viewer's timezone. */
  readonly anchor: string;
}

export function initialModeState(now = new Date()): BoardModeState {
  return { mode: "list", field: null, span: "month", anchor: dayKey(now.toISOString()) };
}

const MODES: ReadonlyArray<{ readonly id: BoardMode; readonly label: string }> = [
  { id: "list", label: "List" }, { id: "kanban", label: "Kanban" },
  { id: "calendar", label: "Calendar" }, { id: "chart", label: "Chart" },
];

const FIELD_LABEL: Readonly<Record<Exclude<BoardMode, "list">, string>> = {
  kanban: "Columns from", calendar: "Dates from", chart: "Count by",
};

const NO_FIELD: Readonly<Record<Exclude<BoardMode, "list">, string>> = {
  kanban: "This board has no choice field to make columns from.",
  calendar: "This board has no date and time field to place records by.",
  chart: "This board has no field to count records by.",
};

/** The fields a mode can use, the usual choice first. */
export function modeFields(mode: BoardMode, fields: readonly FieldDef[]): FieldDef[] {
  const stored = fields.filter((field) => !field.calculation);
  if (mode === "kanban") return stored.filter((field) => field.type === "enum");
  if (mode === "calendar") return stored.filter((field) => field.type === "datetime");
  if (mode === "chart") {
    const groupable = stored.filter((field) => field.type !== "geometry");
    return [...groupable.filter((field) => field.type === "enum"), ...groupable.filter((field) => field.type !== "enum")];
  }
  return [];
}

export function modeField(state: BoardModeState, fields: readonly FieldDef[]): FieldDef | null {
  const usable = modeFields(state.mode, fields);
  return usable.find((field) => field.key === state.field) ?? usable[0] ?? null;
}

/**
 * The view read a mode needs on top of the operator's refinement: the group
 * field for kanban and chart counts, and for the calendar a between condition
 * over the days on screen, so a page of the calendar is a page of the server.
 */
export function modeQuery(query: BoardViewQuery, state: BoardModeState, fields: readonly FieldDef[]): BoardViewQuery {
  const field = modeField(state, fields);
  if (!field) return query;
  if (state.mode !== "calendar") return { ...query, groupBy: field.key };
  const { from, to } = calendarRange(state.span, state.anchor);
  return {
    ...query,
    where: [...(query.where ?? []), { field: field.key, op: "between", value: [from, to] }],
    sorts: [{ field: field.key, dir: "asc" }],
  };
}

// ---- Calendar days ----

const DAY_MS = 86_400_000;
const utcDay = (key: string) => new Date(`${key}T00:00:00Z`);
const addDays = (key: string, days: number) => new Date(utcDay(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);

/** The calendar day an instant falls on, YYYY-MM-DD, in a timezone; the viewer's when none is given. */
export function dayKey(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}), year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The days a calendar shows, Sunday first: the anchor's week, or every week touching its month. */
export function calendarDays(span: BoardModeState["span"], anchor: string): string[] {
  let first = addDays(anchor, -utcDay(anchor).getUTCDay());
  let count = 7;
  if (span === "month") {
    const start = `${anchor.slice(0, 7)}-01`;
    const end = addDays(shiftAnchor("month", start, 1), -1);
    first = addDays(start, -utcDay(start).getUTCDay());
    count = Math.ceil(((utcDay(end).getTime() - utcDay(first).getTime()) / DAY_MS + 1) / 7) * 7;
  }
  return Array.from({ length: count }, (_, index) => addDays(first, index));
}

/** The anchor a step of the calendar's span away; a month step lands on the first of the month. */
export function shiftAnchor(span: BoardModeState["span"], anchor: string, step: number): string {
  if (span === "week") return addDays(anchor, 7 * step);
  const date = utcDay(`${anchor.slice(0, 7)}-01`);
  date.setUTCMonth(date.getUTCMonth() + step);
  return date.toISOString().slice(0, 10);
}

/** The instants the calendar's days cover in the viewer's timezone, both ends inclusive. */
export function calendarRange(span: BoardModeState["span"], anchor: string): { from: string; to: string } {
  const days = calendarDays(span, anchor);
  const after = localMidnight(addDays(days[days.length - 1]!, 1));
  return { from: localMidnight(days[0]!).toISOString(), to: new Date(after.getTime() - 1).toISOString() };
}

function localMidnight(key: string): Date {
  const [year, month, day] = key.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

/** Records by the day their field's value falls on; a record without a readable time is left out. */
export function placeRecords(records: readonly ViewRecord[], fieldKey: string, timeZone?: string): Map<string, ViewRecord[]> {
  const days = new Map<string, ViewRecord[]>();
  for (const record of records) {
    const value = record[fieldKey];
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) continue;
    const key = dayKey(value, timeZone);
    const list = days.get(key);
    if (list) list.push(record);
    else days.set(key, [record]);
  }
  return days;
}

// A calendar day key read at noon UTC names the same date in every timezone.
const dayDate = (key: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: "UTC" });
const fullDate = (key: string) => dayDate(key, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

// ---- Columns and counts ----

export interface ValueColumn {
  /** The stored value; null holds the records with no value. */
  readonly value: string | null;
  readonly label: string;
  /** The server's count over every matching record, or the loaded records when it sent none. */
  readonly count: number;
  readonly records: readonly ViewRecord[];
}

const valueKey = (value: unknown): string | null => value === undefined || value === null || value === ""
  ? null : typeof value === "object" ? JSON.stringify(value) : String(value);

/** A stored value as people read it: an enum value's words, a boolean as yes or no. */
export function valueLabel(value: string | null, type: FieldDef["type"] = "enum"): string {
  if (value === null) return "No value";
  if (type === "boolean") return value === "true" ? "Yes" : value === "false" ? "No" : value;
  if (type !== "enum") return value;
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

/**
 * One column per value of a field: an enum's values in its own order, then
 * any other stored value, then "No value" when any record lacks one.
 */
export function valueColumns(
  field: FieldDef,
  records: readonly ViewRecord[],
  groups?: ReadonlyArray<{ readonly value: unknown; readonly count: number }> | null,
): ValueColumn[] {
  const byValue = new Map<string | null, ViewRecord[]>();
  for (const record of records) {
    const key = valueKey(record[field.key]);
    const list = byValue.get(key);
    if (list) list.push(record);
    else byValue.set(key, [record]);
  }
  const counts = groups ? new Map(groups.map((group) => [valueKey(group.value), group.count])) : null;
  const values: (string | null)[] = [...enumValues(field)];
  for (const key of [...(counts?.keys() ?? []), ...byValue.keys()]) {
    if (key !== null && !values.includes(key)) values.push(key);
  }
  if (byValue.has(null) || counts?.has(null)) values.push(null);
  return values.map((value) => ({
    value,
    label: valueLabel(value, field.type),
    count: counts ? counts.get(value) ?? 0 : byValue.get(value)?.length ?? 0,
    records: byValue.get(value) ?? [],
  }));
}

/**
 * Whether a field mirrors the board's workflow state: an enum holding every
 * workflow state. Moving such a card would change the field without the
 * transition, so its state changes only through the workflow.
 */
export function isWorkflowStateField(field: FieldDef, workflow: BoardWorkflow | null | undefined): boolean {
  if (!workflow || field.type !== "enum") return false;
  const values = new Set(enumValues(field));
  return workflow.states.every((state) => values.has(state.key));
}

function cellText(value: unknown, type: FieldDef["type"] | undefined): string {
  if (valueKey(value) === null) return "";
  if (type === "datetime" && typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** A record's title from the view's first column, and up to two further columns as detail. */
function recordSummary(record: ViewRecord, columns: readonly string[], fields: ReadonlyMap<string, FieldDef>, skip: string) {
  const shown = columns.filter((key) => key !== skip && fields.has(key));
  const [first, ...rest] = shown;
  const title = first ? cellText(record[first], fields.get(first)?.type) : "";
  const detail = rest.map((key) => ({ key, text: cellText(record[key], fields.get(key)?.type) }))
    .filter((item) => item.text).slice(0, 2)
    .map((item) => `${fields.get(item.key)!.label}: ${item.text}`).join(" · ");
  return { title: title || "Untitled record", detail };
}

// ---- Controls ----

/** The mode switch and the mode's field. The mode, field and calendar range are screen state. */
export function BoardModeControls(props: {
  readonly value: BoardModeState;
  readonly fields: readonly FieldDef[];
  readonly onChange: (next: BoardModeState) => void;
}) {
  const { value } = props;
  const usable = modeFields(value.mode, props.fields);
  const field = modeField(value, props.fields);
  return <div className="board-modes">
    <div role="group" aria-label="Show records as" className="board-modes__switch">
      {MODES.map((mode) => <button key={mode.id} type="button" aria-pressed={value.mode === mode.id}
        onClick={() => props.onChange({ ...value, mode: mode.id })}>{mode.label}</button>)}
    </div>
    {value.mode !== "list" && field ? <label className="board-refine__control">
      <span>{FIELD_LABEL[value.mode]}</span>
      <select value={field.key} onChange={(event) => props.onChange({ ...value, field: event.target.value })}>
        {usable.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}
      </select>
    </label> : null}
  </div>;
}

export interface BoardModeBodyProps {
  readonly state: BoardModeState;
  readonly onChange: (next: BoardModeState) => void;
  readonly fields: readonly FieldDef[];
  /** The view's columns, which give each card and calendar entry its summary. */
  readonly columns: readonly string[];
  readonly records: readonly ViewRecord[];
  readonly groups: ReadonlyArray<{ readonly value: unknown; readonly count: number }> | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onLoadMore?: (() => Promise<void>) | undefined;
  readonly canWrite: boolean;
  /** The board's workflow; undefined while it is still being read. */
  readonly workflow: BoardWorkflow | null | undefined;
  readonly onMove: (recordId: string, field: string, value: string) => Promise<void>;
  readonly onSelectRecord: (recordId: string) => void;
  readonly selectedRecordId: string | null;
}

/** The records in the chosen mode other than the list. */
export function BoardModeBody(props: BoardModeBodyProps) {
  const [loadingMore, setLoadingMore] = useState(false);
  if (props.state.mode === "list") return null;
  const field = modeField(props.state, props.fields);
  if (!field) return <p className="board-note" role="note">{NO_FIELD[props.state.mode]}</p>;
  const fields = new Map(props.fields.map((candidate) => [candidate.key, candidate]));
  // The calendar keeps its paging controls while the next range loads.
  if (props.loading && props.state.mode === "calendar") return <div className="board-modes__body">
    <p className="board-note" role="status">Loading records…</p>
    <Calendar {...props} records={[]} field={field} fieldMap={fields} />
  </div>;
  if (props.error && props.records.length === 0) return <p className="board-note" role="alert">{props.error}</p>;
  if (props.loading) return <p className="board-note" role="status">Loading records…</p>;
  const more = props.onLoadMore && props.state.mode !== "chart" ? <div className="board-modes__more">
    <span>Showing {props.records.length} loaded records.</span>
    <ActionButton loading={loadingMore} loadingLabel="Loading…" onClick={() => {
      setLoadingMore(true);
      void props.onLoadMore!().finally(() => setLoadingMore(false));
    }}>Load more records</ActionButton>
  </div> : null;
  return <div className="board-modes__body">
    {props.error ? <p className="board-note" role="alert">Showing the last loaded records. {props.error}</p> : null}
    {props.state.mode === "kanban" ? <Kanban {...props} field={field} fieldMap={fields} />
      : props.state.mode === "calendar" ? <Calendar {...props} field={field} fieldMap={fields} />
        : <CountChart field={field} groups={props.groups} />}
    {more}
  </div>;
}

type ModeViewProps = BoardModeBodyProps & { readonly field: FieldDef; readonly fieldMap: ReadonlyMap<string, FieldDef> };

function Kanban(props: ModeViewProps) {
  const { field } = props;
  const [dragged, setDragged] = useState<{ id: string; from: string | null } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const workflowField = isWorkflowStateField(field, props.workflow);
  const canMove = props.canWrite && props.workflow !== undefined && !workflowField;
  const columns = valueColumns(field, props.records, props.groups);
  const targets = columns.filter((column): column is ValueColumn & { value: string } => column.value !== null);

  async function move(recordId: string, from: string | null, to: string) {
    if (to === from) return;
    setMoving(recordId);
    setProblem(null);
    try {
      await props.onMove(recordId, field.key, to);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "The server refused the change.");
    } finally {
      setMoving(null);
    }
  }

  return <>
    {workflowField ? <p className="board-note" role="note">
      {field.label} follows the board&apos;s workflow, so cards do not move here. Change it with a transition in the
      record&apos;s Workflow section.</p>
      : !props.canWrite ? <p className="board-note" role="note">You can read this board but not change it, so cards do not move.</p>
        : null}
    {problem ? <p className="board-note" role="alert">The card was not moved. {problem}</p> : null}
    <div className="board-kanban" role="region" aria-label={`Kanban by ${field.label}`}>
      {columns.map((column, index) => {
        const droppable = canMove && dragged !== null && column.value !== null && column.value !== dragged.from;
        const headingId = `board-kanban-${field.key}-${index}`;
        return <section key={column.value ?? ""} className="board-kanban__column" aria-labelledby={headingId}
          data-value={column.value ?? ""} data-drop={droppable && over === column.value ? "over" : undefined}
          onDragOver={(event) => {
            if (!droppable) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setOver(column.value);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(event) => {
            event.preventDefault();
            const source = dragged;
            setDragged(null);
            setOver(null);
            if (source && droppable) void move(source.id, source.from, column.value!);
          }}>
          <h3 id={headingId}><span>{column.label}</span>
            <span className="board-kanban__count" aria-label={`${column.count} record${column.count === 1 ? "" : "s"}`}>{column.count}</span>
          </h3>
          <ul>
            {column.records.map((record) => {
              const summary = recordSummary(record, props.columns, props.fieldMap, field.key);
              return <li key={record.id} className="board-kanban__card" draggable={canMove && moving === null}
                aria-busy={moving === record.id || undefined}
                data-selected={props.selectedRecordId === record.id || undefined}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", record.id);
                  event.dataTransfer.effectAllowed = "move";
                  setDragged({ id: record.id, from: column.value });
                }}
                onDragEnd={() => {
                  setDragged(null);
                  setOver(null);
                }}>
                <button type="button" className="board-kanban__open" onClick={() => props.onSelectRecord(record.id)}>
                  {summary.title}
                </button>
                {summary.detail ? <small>{summary.detail}</small> : null}
                {canMove && targets.length > 1 ? <label className="board-kanban__move">
                  <span className="eoc-sr-only">Move {summary.title} to</span>
                  <select value={column.value ?? ""} disabled={moving !== null}
                    onChange={(event) => void move(record.id, column.value, event.target.value)}>
                    {column.value === null ? <option value="">No value</option> : null}
                    {targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
                  </select>
                </label> : null}
              </li>;
            })}
          </ul>
          {column.records.length < column.count
            ? <p className="board-kanban__more">{column.count - column.records.length} more not loaded</p> : null}
        </section>;
      })}
    </div>
  </>;
}

function Calendar(props: ModeViewProps) {
  const { field, state } = props;
  const days = calendarDays(state.span, state.anchor);
  const placed = placeRecords(props.records, field.key);
  const month = state.anchor.slice(0, 7);
  const today = dayKey(new Date().toISOString());
  const title = state.span === "month"
    ? dayDate(`${month}-01`, { month: "long", year: "numeric" })
    : `Week of ${fullDate(days[0]!)}`;
  const go = (anchor: string) => props.onChange({ ...state, anchor });
  return <section className="board-calendar" aria-label={`Calendar by ${field.label}`}>
    <header className="board-calendar__header">
      <h3 aria-live="polite">{title}</h3>
      <div className="board-calendar__nav">
        <div role="group" aria-label="Calendar span" className="board-modes__switch">
          {(["month", "week"] as const).map((span) => <button key={span} type="button" aria-pressed={state.span === span}
            onClick={() => props.onChange({ ...state, span })}>{span === "month" ? "Month" : "Week"}</button>)}
        </div>
        <ActionButton onClick={() => go(shiftAnchor(state.span, state.anchor, -1))}>Previous {state.span}</ActionButton>
        <ActionButton onClick={() => go(today)}>Today</ActionButton>
        <ActionButton onClick={() => go(shiftAnchor(state.span, state.anchor, 1))}>Next {state.span}</ActionButton>
      </div>
    </header>
    <div className="board-calendar__weekdays" aria-hidden="true">
      {days.slice(0, 7).map((day) => <span key={day}>{dayDate(day, { weekday: "short" })}</span>)}
    </div>
    <ol className="board-calendar__grid">
      {days.map((day) => {
        const entries = placed.get(day) ?? [];
        return <li key={day} data-day={day} data-outside={(state.span === "month" && !day.startsWith(month)) || undefined}
          data-today={day === today || undefined} data-empty={entries.length === 0 || undefined}>
          <span className="board-calendar__date">
            <span className="board-calendar__short" aria-hidden="true">{Number(day.slice(8))}</span>
            <span className="board-calendar__long">{fullDate(day)}</span>
          </span>
          {entries.length ? <ul>
            {entries.map((record) => {
              const at = String(record[field.key]);
              const summary = recordSummary(record, props.columns, props.fieldMap, field.key);
              return <li key={record.id} data-selected={props.selectedRecordId === record.id || undefined}>
                <button type="button" onClick={() => props.onSelectRecord(record.id)}>
                  <time dateTime={at}>{new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                  {" "}{summary.title}
                </button>
              </li>;
            })}
          </ul> : null}
        </li>;
      })}
    </ol>
  </section>;
}

/** Record counts by value as horizontal bars, with the same numbers as a table. */
export function CountChart(props: {
  readonly field: FieldDef;
  readonly groups: ReadonlyArray<{ readonly value: unknown; readonly count: number }> | null;
}) {
  const rows = valueColumns(props.field, [], props.groups ?? []);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const max = Math.max(1, ...rows.map((row) => row.count));
  const share = (count: number) => (total ? Math.round((count / total) * 100) : 0);
  return <figure className="board-chart" aria-label={`Records by ${props.field.label}`}>
    <figcaption><strong>Records by {props.field.label}</strong> <span>{total} in total</span></figcaption>
    {rows.length === 0 ? <p>No records to count.</p> : <ul className="board-chart__bars">
      {rows.map((row) => <li key={row.value ?? ""} title={`${row.label}: ${row.count} records, ${share(row.count)}%`}>
        <span className="board-chart__label">{row.label}</span>
        <span className="board-chart__track" aria-hidden="true">
          <span className="board-chart__bar" style={{ width: `${(row.count / max) * 100}%` }} />
        </span>
        <span className="board-chart__value">{row.count}</span>
      </li>)}
    </ul>}
    <details className="board-chart__table">
      <summary>Show as a table</summary>
      <table>
        <caption className="eoc-sr-only">Records by {props.field.label}</caption>
        <thead><tr><th scope="col">{props.field.label}</th><th scope="col">Records</th><th scope="col">Share</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.value ?? ""}>
          <th scope="row">{row.label}</th><td>{row.count}</td><td>{share(row.count)}%</td>
        </tr>)}</tbody>
      </table>
    </details>
  </figure>;
}
