import { useEffect, useState } from "react";
import type { FieldDef } from "@openeoc/shared";
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
 * position, when, and each field changed with its value before and after.
 */
export function RecordHistory(props: { readonly load: HistoryPageLoader; readonly fields: readonly FieldDef[] }) {
  const [entries, setEntries] = useState<BoardRecordChange[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const labels = new Map(props.fields.map((field) => [field.key, field.label]));

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
        <strong>{ACTIONS[entry.category] ?? entry.category.replaceAll(".", " ")}{entry.corrects ? " (correction)" : ""}</strong>
        {" · "}{new Date(entry.at).toLocaleString()}
        {" · "}{entry.actor.displayName}{entry.actor.positionTitle || entry.actor.organizationName
          ? ` (${[entry.actor.positionTitle, entry.actor.organizationName].filter(Boolean).join(" · ")})` : ""}
        {entry.changes.length ? <dl>{entry.changes.map((change) => <div key={change.field}>
          <dt>{labels.get(change.field) ?? change.field}</dt>
          <dd>{historyValue(change.before)} → {historyValue(change.after)}</dd>
        </div>)}</dl> : null}
      </li>)}
    </ol> : !loading && !error ? <p>No history is recorded for this record.</p> : null}
    {loading ? <p role="status">Loading history…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {cursor && !loading ? <ActionButton kind="quiet" onClick={() => void read(cursor, false)}>Load more history</ActionButton> : null}
  </div>;
}

function historyValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
