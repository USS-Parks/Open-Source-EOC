import { useEffect, useState } from "react";
import { choiceLabel, signatureText, type BoardActionRun, type FieldDef } from "@openeoc/shared";
import type { BoardRecordChange, PageOptions } from "../app/api/client.js";
import { ActionButton } from "../design/controls.js";
import "./board-tools.css";

export type HistoryPageLoader = (page: PageOptions) => Promise<{ entries: BoardRecordChange[]; nextCursor: string | null }>;

const ACTIONS: Readonly<Record<string, string>> = {
  "board.record.created": "Created",
  "board.record.updated": "Updated",
  "board.record.archived": "Archived",
  "board.record.restored": "Restored",
  "board.record.deleted": "Deleted",
};

/**
 * A record's change history, oldest first, a page at a time: who, in which
 * position, when, and each field changed with its value before and after. A
 * write a board action made names the action, and each action run says what
 * set it off and what it did, or why it was refused or stopped.
 */
export function RecordHistory(props: { readonly load: HistoryPageLoader; readonly fields: readonly FieldDef[] }) {
  const [entries, setEntries] = useState<BoardRecordChange[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const labels = new Map(props.fields.map((field) => [field.key, field.label]));
  const types = new Map(props.fields.map((field) => [field.key, field.type]));

  async function read(after: string | null, replace: boolean) {
    setLoading(true);
    setError(null);
    try {
      const page = await props.load(after ? { cursor: after } : {});
      setEntries((current) => replace ? page.entries : [...current, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "History could not be loaded.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void read(null, true); }, [props.load]);

  return <div className="board-history-panel">
    {entries.length ? <ol className="board-history" aria-label="Record history">
      {entries.map((entry) => <li key={entry.id}>
        <strong>{entry.run ? `Action: ${entry.run.action.label}` : ACTIONS[entry.category] ?? entry.category.replaceAll(".", " ")}
          {entry.corrects ? " (correction)" : ""}{entry.action ? ` by action ${entry.action.label}` : ""}
          {entry.via === "sms" ? " by text message" : ""}</strong>
        {" · "}{new Date(entry.at).toLocaleString()}
        {" · "}{entry.actor.displayName}{entry.actor.positionTitle || entry.actor.organizationName
          ? ` (${[entry.actor.positionTitle, entry.actor.organizationName].filter(Boolean).join(" · ")})` : ""}
        {entry.run ? <p className="board-history__run" data-outcome={entry.run.outcome}>{runText(entry.run, labels)}</p> : null}
        {entry.changes.length ? <dl>{entry.changes.map((change) => <div key={change.field}>
          <dt>{labels.get(change.field) ?? change.field}</dt>
          <dd>{historyValue(change.before, types.get(change.field))} → {historyValue(change.after, types.get(change.field))}</dd>
        </div>)}</dl> : null}
      </li>)}
    </ol> : !loading && !error ? <p>No history is recorded for this record.</p> : null}
    {loading ? <p role="status">Loading history…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {cursor && !loading ? <ActionButton kind="quiet" onClick={() => void read(cursor, false)}>Load more history</ActionButton> : null}
  </div>;
}

/** An action run in words: what set it off, then what it did or why it did not. */
function runText(run: BoardActionRun, labels: ReadonlyMap<string, string>): string {
  const field = (key: string | null | undefined) => key ? labels.get(key) ?? key : null;
  const trigger = run.trigger.kind === "record_created" ? "When the record was created"
    : run.trigger.kind === "field_changed" ? `When ${field(run.trigger.field) ?? "a field"} changed`
    : `When the record entered ${run.trigger.state ?? "a state"}`;
  const cause = run.trigger.byAction ? `${trigger}, by action ${run.trigger.byAction}` : trigger;
  if (run.outcome !== "done") return `${cause}: ${run.outcome === "refused" ? "refused" : "stopped"}. ${run.reason ?? ""}`.trim();
  const result = run.result ?? {};
  const did = run.step === "set_field" ? `set ${field(result.field) ?? "a field"}`
    : run.step === "create_record" ? `created a linked record on ${result.board ?? "another board"}`
    : run.step === "transition" ? run.reason ? "requested a transition" : `moved the record to ${result.state ?? "its next state"}`
    : `notified ${result.to ?? "its recipients"}`;
  return `${cause}: ${did}.${run.reason ? ` ${run.reason}` : ""}`;
}

function historyValue(value: unknown, type: FieldDef["type"] | undefined): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (type === "enum" && typeof value === "string") return choiceLabel(value);
  return signatureText(value) ?? (typeof value === "object" ? JSON.stringify(value) : String(value));
}
