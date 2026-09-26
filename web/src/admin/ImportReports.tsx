import { useId, useState } from "react";
import { Button, Panel, StatusBadge, TextField } from "../design/components.js";
import { ActionButton } from "../design/controls.js";
import type { ApiClient, ImportReportKind, ImportReportSummary, ImportRowOutcome } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";
import "./admin.css";

export const IMPORT_KIND_LABELS: Readonly<Record<ImportReportKind, string>> = {
  webeoc: "WebEOC migration",
  board_records: "Board records",
  solution_package: "Signed solution package",
  form: "Form",
  parcel_baseline: "Parcel baseline",
  people: "People",
};
export const OUTCOME_LABELS: Readonly<Record<ImportRowOutcome, string>> = {
  created: "Created", updated: "Updated", skipped: "Skipped", refused: "Refused",
};
/** Rows listed on screen at once. */
const SHOWN = 200;
const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * The reports every import into this jurisdiction keeps (VC-13): what it
 * read, what it created, updated, skipped and refused with the reason, and
 * the file column it used for each field. An administrator opens a report,
 * checks it and signs it off, once, in their own name.
 */
export function ImportReports(props: { client: ApiClient; jurisdictionId: string; revision?: number }) {
  const first = useAsync(() => props.client.listImportReports(props.jurisdictionId), [props.jurisdictionId, props.revision]);
  // Pages added with "Load more" extend the first page they were read after.
  const [more, setMore] = useState<{ base: unknown; reports: readonly ImportReportSummary[]; nextCursor: string | null } | null>(null);
  const loaded = first.data && more?.base === first.data ? more
    : first.data ? { base: first.data, reports: first.data.reports, nextCursor: first.data.nextCursor } : null;
  const [openId, setOpenId] = useState<string | null>(null);
  const loadMore = async () => {
    if (!loaded?.nextCursor) return;
    const next = await props.client.listImportReports(props.jurisdictionId, { cursor: loaded.nextCursor });
    setMore({ base: loaded.base, reports: [...loaded.reports, ...next.reports], nextCursor: next.nextCursor });
  };

  return (
    <Panel title="Import reports">
      <div className="admin-stack">
        <p className="d21-muted">Each import that writes into this jurisdiction keeps a report: the rows it read, what it created, updated, skipped and refused, each refusal with its reason, and the file column it used for each field. Open a report to check it and sign it off. Checking a file writes no report.</p>
        {first.error && !loaded ? <ErrorNote message={first.error} /> : null}
        {!loaded && !first.error ? <Loading label="Loading import reports…" /> : null}
        {loaded && loaded.reports.length === 0 ? <p className="eoc-flush">No import has written into this jurisdiction yet.</p> : null}
        {loaded && loaded.reports.length ? <div className="admin-scroll">
          <table className="eoc-table" aria-label="Import reports">
            <thead><tr>
              <th scope="col">Import</th><th scope="col">Into</th><th scope="col">Run</th><th scope="col">Read</th>
              <th scope="col">Created</th><th scope="col">Updated</th><th scope="col">Skipped</th><th scope="col">Refused</th>
              <th scope="col">Sign-off</th>
            </tr></thead>
            <tbody>{loaded.reports.map((r) => <tr key={r.id}>
              <td><Button label={`${IMPORT_KIND_LABELS[r.kind]}: ${r.subject}, run ${when(r.runAt)}`} onClick={() => setOpenId(r.id)}>
                {IMPORT_KIND_LABELS[r.kind]}</Button></td>
              <td className="admin-wrap">{r.subject}{r.sourceName ? <><br /><span className="d21-muted">{r.sourceName}</span></> : null}</td>
              <td>{r.runBy}<br /><span className="d21-muted">{when(r.runAt)}</span></td>
              <td>{r.read}</td><td>{r.created}</td><td>{r.updated}</td><td>{r.skipped}</td><td>{r.refused}</td>
              <td className="admin-nowrap">{r.signOff
                ? <StatusBadge status="success">Signed off by {r.signOff.by}</StatusBadge>
                : <StatusBadge status="warning">Waiting for sign-off</StatusBadge>}</td>
            </tr>)}</tbody>
          </table>
        </div> : null}
        {loaded?.nextCursor ? <div><ActionButton onClick={() => void loadMore()}>Load more reports</ActionButton></div> : null}
        {openId ? <ReportDetail key={openId} client={props.client} reportId={openId}
          onClose={() => setOpenId(null)} onSignedOff={first.reload} /> : null}
      </div>
    </Panel>
  );
}

function ReportDetail(props: { client: ApiClient; reportId: string; onClose: () => void; onSignedOff: () => void }) {
  const id = useId();
  const report = useAsync(() => props.client.getImportReport(props.reportId), [props.reportId]);
  const [show, setShow] = useState<"all" | ImportRowOutcome>("all");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signOff = async () => {
    setBusy(true); setError(null);
    try {
      await props.client.signOffImportReport(props.reportId, note.trim());
      report.reload();
      props.onSignedOff();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The sign-off could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (report.error && !report.data) return <ErrorNote message={report.error} />;
  if (!report.data) return <Loading label="Loading the report…" />;
  const r = report.data;
  const listed = r.rows.filter((row) => show === "all" || row.outcome === show);
  return (
    <section aria-labelledby={`${id}-heading`} className="admin-section">
      <h3 id={`${id}-heading`}>{IMPORT_KIND_LABELS[r.kind]}: {r.subject}</h3>
      <dl className="d21-facts">
        <div><dt>File</dt><dd className="admin-wrap">{r.sourceName ?? "Not named"}</dd></div>
        <div><dt>Run by</dt><dd>{r.runBy}, {when(r.runAt)}</dd></div>
        <div><dt>Rows</dt><dd>{r.read} read: {r.created} created, {r.updated} updated, {r.skipped} skipped, {r.refused} refused</dd></div>
      </dl>
      {r.mapping.length ? <div className="admin-scroll">
        <table className="eoc-table" aria-label="Fields and the columns that filled them">
          <thead><tr><th scope="col">Field</th><th scope="col">File column</th></tr></thead>
          <tbody>{r.mapping.map((m) => <tr key={m.field}><td>{m.field}</td><td>{m.column}</td></tr>)}</tbody>
        </table>
      </div> : null}
      <div className="d21-toolbar">
        <span className="eoc-inline">
          <label htmlFor={`${id}-show`}>Show</label>
          <select id={`${id}-show`} value={show} className="admin-input is-bounded" onChange={(event) => setShow(event.target.value as typeof show)}>
            <option value="all">All rows</option>
            {(Object.keys(OUTCOME_LABELS) as ImportRowOutcome[]).map((outcome) =>
              <option key={outcome} value={outcome}>{OUTCOME_LABELS[outcome]}</option>)}
          </select>
        </span>
        <Button onClick={props.onClose}>Close report</Button>
      </div>
      <div className="admin-scroll">
        <table className="eoc-table" aria-label="Rows and their outcomes">
          <thead><tr><th scope="col">Row</th><th scope="col">Item</th><th scope="col">Outcome</th><th scope="col">Detail</th></tr></thead>
          <tbody>{listed.slice(0, SHOWN).map((row, i) => <tr key={i}>
            <td>{row.row ?? ""}</td><td className="admin-wrap">{row.item ?? ""}</td>
            <td>{OUTCOME_LABELS[row.outcome]}</td><td className="admin-wrap">{row.reason ?? ""}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {listed.length > SHOWN ? <p className="d21-muted">Showing the first {SHOWN} of {listed.length} rows.</p> : null}
      {r.signOff ? <p role="status">Signed off by {r.signOff.by}, {when(r.signOff.at)}.{r.signOff.note ? ` Note: ${r.signOff.note}` : ""}</p> : <>
        <TextField label="Sign-off note (optional)" value={note} onChange={setNote} />
        <div className="d21-toolbar">
          <span className="d21-muted">Signing off records that you checked this import, in your name. It cannot be undone.</span>
          <ActionButton kind="primary" loading={busy} loadingLabel="Signing off…" onClick={() => void signOff()}>Sign off this report</ActionButton>
        </div>
      </>}
      {error ? <p className="d21-error" role="alert">{error}</p> : null}
    </section>
  );
}
