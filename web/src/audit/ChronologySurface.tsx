import { useMemo, useState } from "react";
import { Button, EnumSelect, Panel } from "../design/components.js";
import { Tabs } from "../design/controls.js";
import {
  OperationalTable,
  createOperationalTableViewState,
  type OperationalTableColumn,
  type OperationalTableViewState,
} from "../design/table.js";
import type { ApiClient } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import {
  CATEGORY_LABELS,
  SIGNIFICANT_CATEGORIES,
  categoryLabel,
  chronologyCategories,
  entryDetail,
  type ChronologyEntry,
  type ChronologyFilters,
  type ChronologyPage,
} from "./chronology.js";
import "./chronology.css";

type View = "significant" | "all";

const byLabel = (keys: readonly string[]) => [...keys].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));
const ALL_OPTIONS = byLabel(Object.keys(CATEGORY_LABELS));
const SIGNIFICANT_OPTIONS = byLabel(SIGNIFICANT_CATEGORIES);

const who = (entry: ChronologyEntry) => (entry.position ? `${entry.person} (${entry.position})` : entry.person);
const when = (value: string) => new Date(value).toLocaleString();

/** A datetime-local value as an ISO instant; undefined when blank or unreadable. */
function instant(local: string): string | undefined {
  const date = new Date(local);
  return local && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * The audit chronology for the selected incident, or the whole jurisdiction
 * when none is selected: filtered on the server, read a page at a time, with
 * corrections recorded as new attributed entries and, for admins, export of
 * the whole trail.
 */
export function ChronologySurface(props: {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly incidentId: string | null;
  readonly incidentName: string | null;
  readonly isAdmin: boolean;
}) {
  const [view, setView] = useState<View>("significant");
  const [category, setCategory] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // The correction action stays pinned in view while the wider columns scroll.
  const [tableState, setTableState] = useState<OperationalTableViewState>(() => ({
    ...createOperationalTableViewState([
      { id: "at", width: 170 }, { id: "event", width: 230 }, { id: "by", width: 190 },
      { id: "detail", width: 300 }, { id: "seq", width: 100 }, { id: "action", width: 160 },
    ]),
    pinned: { action: "end" },
  }));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [correcting, setCorrecting] = useState<ChronologyEntry | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const options = view === "significant" ? SIGNIFICANT_OPTIONS : ALL_OPTIONS;
  const chosen = options.includes(category) ? category : "all";
  const filters = useMemo<ChronologyFilters>(() => {
    const categories = chronologyCategories(view === "significant", chosen);
    const fromAt = instant(from);
    const toAt = instant(to);
    return {
      ...(props.incidentId ? { incidentId: props.incidentId } : {}),
      ...(categories ? { categories } : {}),
      ...(fromAt ? { from: fromAt } : {}),
      ...(toAt ? { to: toAt } : {}),
    };
  }, [chosen, from, props.incidentId, to, view]);
  const response = useAsync(
    () => props.client.listChronology(props.jurisdictionId, filters),
    [props.jurisdictionId, filters],
  );
  // Pages added with "Load more" extend the first page they were read after,
  // so a reload or a filter change starts again from the first page.
  const [more, setMore] = useState<{ base: ChronologyPage; entries: readonly ChronologyEntry[]; nextCursor: string | null } | null>(null);
  const loaded = response.data && more?.base === response.data ? more
    : response.data ? { base: response.data, entries: response.data.entries, nextCursor: response.data.nextCursor } : null;
  const loadMore = loaded?.nextCursor ? async () => {
    const next = await props.client.listChronology(props.jurisdictionId, filters, { cursor: loaded.nextCursor! });
    setMore({ base: loaded.base, entries: [...loaded.entries, ...next.entries], nextCursor: next.nextCursor });
  } : undefined;
  const entries = loaded?.entries ?? [];
  const seqById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry.seq])), [entries]);

  const run = async (work: () => Promise<string>) => {
    setBusy(true); setActionError(null); setNotice(null);
    try {
      setNotice(await work());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };
  const recordCorrection = (original: ChronologyEntry) => run(async () => {
    await props.client.correctAuditEvent(original.id, note.trim());
    setCorrecting(null); setNote(""); response.reload();
    return `Correction to event ${original.seq} recorded as a new entry.`;
  });
  const exportTrail = (format: "csv" | "json") => run(async () => {
    saveBlob(await props.client.exportAuditTrail(props.jurisdictionId, format),
      format === "csv" ? "audit-trail.csv" : "audit-trail-signed.json");
    return format === "csv" ? "Audit trail exported as CSV." : "Signed audit trail exported.";
  });

  const columns = useMemo<readonly OperationalTableColumn<ChronologyEntry>[]>(() => [
    { id: "at", header: "Time", value: (entry) => entry.at, width: 170,
      render: (entry) => <time dateTime={entry.at}>{when(entry.at)}</time> },
    { id: "event", header: "Event", value: (entry) => categoryLabel(entry.category), width: 230,
      render: (entry) => <span className="eoc-chronology-event"><strong>{categoryLabel(entry.category)}</strong>
        {entry.corrects ? <small>Corrects {seqById.has(entry.corrects) ? `event ${seqById.get(entry.corrects)}` : "an earlier event"}</small> : null}</span> },
    { id: "by", header: "Recorded by", value: who, width: 190 },
    { id: "detail", header: "Details", value: entryDetail, width: 300, missingLabel: "No details" },
    { id: "seq", header: "Event number", value: (entry) => entry.seq, width: 100 },
    { id: "action", header: "Action", value: () => "Add correction", width: 160,
      render: (entry) => <Button disabled={busy} onClick={() => { setCorrecting(entry); setNote(""); setNotice(null); setActionError(null); }}>Add correction</Button> },
  ], [busy, seqById]);
  const status = response.loading && !response.data ? "loading"
    : response.error && !response.data ? "error" : entries.length === 0 ? "empty" : "ready";

  return <main className="eoc-chronology">
    <header className="eoc-chronology-header">
      <div>
        <p className="eoc-chronology-eyebrow">{props.incidentName ?? "Whole jurisdiction"}</p>
        <h1>Chronology</h1>
        <p>The attributed, append-only record of actions. A correction is added as a new entry; nothing is edited or removed.</p>
      </div>
      {props.isAdmin ? <div className="eoc-chronology-export" role="group" aria-label="Export the audit trail">
        <p>Export the whole audit trail</p>
        <Button disabled={busy} onClick={() => void exportTrail("csv")}>Export CSV</Button>
        <Button disabled={busy} onClick={() => void exportTrail("json")}>Export signed JSON</Button>
      </div> : null}
    </header>
    <section className="eoc-chronology-controls" aria-label="Chronology filters">
      <Tabs id="chronology-view" label="Chronology view" value={view} onChange={(next) => setView(next as View)}
        tabs={[{ id: "significant", label: "Significant events" }, { id: "all", label: "All events" }]} />
      <div className="eoc-chronology-filters">
        <EnumSelect label="Event type" values={["all", ...options]} value={chosen} onChange={setCategory}
          labels={{ ...CATEGORY_LABELS, all: view === "significant" ? "All significant events" : "All event types" }} />
        <label>From<input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
    </section>
    {notice ? <p className="eoc-chronology-notice" role="status">{notice}</p> : null}
    {actionError ? <p className="eoc-chronology-notice is-error" role="alert">{actionError}</p> : null}
    {correcting ? <Panel title="Record a correction">
      <form className="eoc-chronology-correction" onSubmit={(event) => { event.preventDefault(); void recordCorrection(correcting); }}>
        <p>Event {correcting.seq}, {categoryLabel(correcting.category)}, recorded by {who(correcting)} at {when(correcting.at)}. The original stays in the chronology unchanged.</p>
        <label>Correction note<textarea required maxLength={4000} rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <div className="eoc-chronology-actions">
          <Button type="submit" kind="primary" disabled={busy || !note.trim()}>{busy ? "Recording…" : "Record correction"}</Button>
          <Button disabled={busy} onClick={() => setCorrecting(null)}>Cancel</Button>
        </div>
      </form>
    </Panel> : null}
    <OperationalTable tableId="audit-chronology" caption={view === "significant" ? "Significant events" : "All events"}
      columns={columns} rows={entries} rowId={(entry) => entry.id}
      datasetKey={JSON.stringify([props.jurisdictionId, filters])} status={status}
      errorMessage={response.error ?? "The chronology could not be loaded."} onRetry={response.reload}
      emptyTitle="No events match these filters" emptyDescription="Choose All events, another event type or a wider time range."
      viewState={tableState} onViewStateChange={setTableState} totalRows={null}
      hasPreviousPage={false} hasNextPage={false} selectedIds={selected} onSelectionChange={setSelected}
      {...(loadMore ? { onLoadMore: loadMore } : {})} />
  </main>;
}
