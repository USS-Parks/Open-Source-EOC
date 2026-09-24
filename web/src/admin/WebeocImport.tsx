import { useEffect, useId, useState } from "react";
import { Panel } from "../design/components.js";
import { ActionButton } from "../design/controls.js";
import type { ApiClient, WebeocImportReport, WebeocRowOutcome } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";
import { saveFile } from "./labels.js";

const INPUT_STYLE = {
  font: "inherit", minHeight: 44, padding: 6, borderRadius: 4, border: "1px solid var(--eoc-border)",
  background: "var(--eoc-surface)", color: "var(--eoc-text)", maxWidth: "100%",
} as const;
/** A control that fills its cell of the form grid instead of spilling into the next. */
const FILL_STYLE = { ...INPUT_STYLE, width: "100%", minWidth: 0, boxSizing: "border-box" } as const;
const ZONES = Intl.supportedValuesOf("timeZone");
const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** Rows listed on screen; the rejection report holds every rejected row. */
const SHOWN = 200;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Move the records of a WebEOC board into a board here from the CSV WebEOC
 * exports. The operator maps board fields to the export's columns, checks the
 * file (a dry run that reports every row), then imports: the valid rows are
 * written and the rejected rows come back as a report to fix and import again.
 */
export function WebeocImport(props: { client: ApiClient; jurisdictionId: string }) {
  const id = useId();
  const boards = useAsync(() => props.client.listBoards(props.jurisdictionId), [props.jurisdictionId]);
  const [boardId, setBoardId] = useState("");
  const target = useAsync(async () => boardId
    ? { board: await props.client.getBoard(boardId), saved: await props.client.webeocMapping(boardId) }
    : null, [boardId]);
  const [timeZone, setTimeZone] = useState(BROWSER_ZONE);
  const [mapping, setMapping] = useState<Readonly<Record<string, string>>>({});
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<readonly string[]>([]);
  const [checked, setChecked] = useState<{ key: string; report: WebeocImportReport } | null>(null);
  const [show, setShow] = useState<"all" | WebeocRowOutcome["outcome"]>("all");
  const [busy, setBusy] = useState<"checking" | "saving" | "importing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setFile(null); setColumns([]); setChecked(null); setError(null); setNotice("");
    const saved = target.data?.saved;
    setMapping(saved?.mapping ?? {});
    setTimeZone(saved?.timeZone ?? BROWSER_ZONE);
  }, [target.data]);

  const fields = (target.data?.board.fields ?? []).filter((field) => !field.calculation);
  const keyOf = (next: Readonly<Record<string, string>>, zone: string) => JSON.stringify([next, zone]);
  const current = checked && checked.key === keyOf(mapping, timeZone) ? checked.report : null;
  const importable = current !== null && current.dryRun && current.valid > 0;

  const run = async (step: "checking" | "saving" | "importing", operation: () => Promise<string | void>) => {
    setBusy(step); setError(null); setNotice("");
    try { setNotice((await operation()) ?? ""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The request failed."); }
    finally { setBusy(null); }
  };
  const check = (chosen: File, first: boolean) => run("checking", async () => {
    // The first check of a file with no mapping yet lets the server match fields to columns by name.
    const sendMapping = !first || Object.keys(mapping).length > 0;
    const report = await props.client.importWebeocRecords(boardId, chosen, {
      dryRun: true, timeZone, ...(sendMapping ? { mapping } : {}),
    });
    setColumns(report.columns);
    setMapping(report.mapping);
    setChecked({ key: keyOf(report.mapping, timeZone), report });
  });
  const choose = (input: HTMLInputElement) => {
    const next = input.files?.[0] ?? null;
    // Cleared so a corrected file of the same name can be chosen again.
    input.value = "";
    if (!next) return;
    setFile(next);
    setChecked(null);
    void check(next, true);
  };
  const save = () => run("saving", async () => {
    await props.client.saveWebeocMapping(boardId, { mapping, timeZone });
    return `Mapping saved for ${target.data?.board.title ?? "this board"}.`;
  });
  const commit = () => run("importing", async () => {
    if (!file) return;
    const report = await props.client.importWebeocRecords(boardId, file, { dryRun: false, mapping, timeZone });
    setChecked({ key: keyOf(mapping, timeZone), report });
    return `Imported ${plural(report.created, "record")}. ${plural(report.rejected, "row")} rejected, ${report.skipped} already imported.`;
  });
  const download = (report: WebeocImportReport) =>
    saveFile(new Blob([report.rejectionCsv], { type: "text/csv" }), "webeoc-rejections.csv");

  const outcomeLabel = (outcome: WebeocRowOutcome["outcome"], dryRun: boolean) =>
    outcome === "reject" ? "Rejected" : outcome === "skip" ? "Already imported" : dryRun ? "Will be created" : "Created";
  const listed = current ? current.outcomes.filter((o) => show === "all" || o.outcome === show) : [];

  return (
    <Panel title="WebEOC migration">
      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
        <p className="d21-muted">Moves the records of one WebEOC board into a board here, from the CSV file WebEOC exports for that board. Records only: WebEOC processes, views, links and menus are not migrated. Check the file first; nothing is written until you choose Import. Import writes the valid rows and leaves the rejected rows out, so download the rejection report, correct those rows and import that file.</p>
        {boards.error ? <ErrorNote message={boards.error} /> : null}
        <div className="d21-form-section-grid">
          <span style={{ display: "grid", gap: 4 }}>
            <label htmlFor={`${id}-board`}>Target board</label>
            <select id={`${id}-board`} value={boardId} disabled={busy !== null} style={FILL_STYLE} onChange={(event) => setBoardId(event.target.value)}>
              <option value="">Choose a board</option>
              {(boards.data ?? []).map((board) => <option key={board.id} value={board.id}>{board.title}</option>)}
            </select>
          </span>
          {target.data ? <>
            <span style={{ display: "grid", gap: 4 }}>
              <label htmlFor={`${id}-zone`}>WebEOC server time zone</label>
              <select id={`${id}-zone`} value={timeZone} disabled={busy !== null} style={FILL_STYLE} onChange={(event) => setTimeZone(event.target.value)}>
                {(ZONES.includes(timeZone) ? ZONES : [timeZone, ...ZONES]).map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
              </select>
            </span>
            <span style={{ display: "grid", gap: 4 }}>
              <label htmlFor={`${id}-file`}>WebEOC CSV export</label>
              <input id={`${id}-file`} type="file" accept=".csv,text/csv" disabled={busy !== null} style={FILL_STYLE}
                onChange={(event) => choose(event.currentTarget)} />
            </span>
          </> : null}
        </div>
        {boardId && target.loading && !target.data ? <Loading label="Loading the board…" /> : null}
        {target.error ? <ErrorNote message={target.error} /> : null}
        {target.data?.saved.updatedAt ? <p className="d21-muted">This board has a saved mapping, last saved {new Date(target.data.saved.updatedAt).toLocaleString()}.</p> : null}

        {columns.length ? <section aria-labelledby="webeoc-mapping-heading" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <h3 id="webeoc-mapping-heading" style={{ margin: 0, fontSize: "1em" }}>Board fields and their WebEOC columns</h3>
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <table className="eoc-table">
              <thead><tr><th scope="col">Board field</th><th scope="col">WebEOC column</th></tr></thead>
              <tbody>{fields.map((field) => <tr key={field.key}>
                <td>{field.label}{field.required && !field.condition ? " (required)" : ""}</td>
                <td><select aria-label={`Column for ${field.label}`} value={mapping[field.key] ?? ""} disabled={busy !== null} style={INPUT_STYLE}
                  onChange={(event) => {
                    const { [field.key]: _dropped, ...rest } = mapping;
                    setMapping(event.target.value ? { ...rest, [field.key]: event.target.value } : rest);
                  }}>
                  <option value="">Not imported</option>
                  {columns.map((column) => <option key={column} value={column}>{column}</option>)}
                </select></td>
              </tr>)}</tbody>
            </table>
          </div>
        </section> : null}

        {file && columns.length ? <div className="d21-toolbar">
          <span className="d21-muted">{file.name}</span>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionButton loading={busy === "saving"} loadingLabel="Saving…" disabled={busy !== null} onClick={() => void save()}>Save mapping</ActionButton>
            <ActionButton loading={busy === "checking"} loadingLabel="Checking…" disabled={busy !== null} onClick={() => void check(file, false)}>Check file</ActionButton>
            <ActionButton kind="primary" loading={busy === "importing"} loadingLabel="Importing…" disabled={busy !== null || !importable}
              onClick={() => void commit()}>{importable ? `Import ${plural(current.valid, "record")}` : "Import"}</ActionButton>
          </span>
        </div> : null}
        {busy === "checking" && !columns.length ? <p role="status">Checking {file?.name}…</p> : null}
        {error ? <p className="d21-error" role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {checked && !current ? <p className="d21-muted">The mapping or time zone changed; check the file again before importing.</p> : null}

        {current ? <section aria-labelledby="webeoc-result-heading" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <h3 id="webeoc-result-heading" style={{ margin: 0, fontSize: "1em" }}>{current.dryRun ? "Check result" : "Import result"}</h3>
          <p style={{ margin: 0 }}>{plural(current.rows, "row")} read: {current.dryRun
            ? `${current.valid} will be created`
            : `${current.created} created`}, {current.skipped} already imported, {current.rejected} rejected.</p>
          <p className="d21-muted">{current.provenance.length
            ? `Kept as provenance on each record's creation entry in the audit trail: ${current.provenance.join(", ")}. ` : ""}
            {current.provenance.some((column) => column.toLowerCase() === "dataid")
              ? "" : "The file has no dataid column, so importing it twice creates its records twice. "}
            {current.dropped.length ? `Not imported: ${current.dropped.join(", ")}.` : ""}</p>
          <div className="d21-toolbar">
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label htmlFor={`${id}-show`}>Show</label>
              <select id={`${id}-show`} value={show} style={INPUT_STYLE} onChange={(event) => setShow(event.target.value as typeof show)}>
                <option value="all">All rows</option>
                <option value="create">{current.dryRun ? "Will be created" : "Created"}</option>
                <option value="skip">Already imported</option>
                <option value="reject">Rejected</option>
              </select>
            </span>
            {current.rejected ? <ActionButton onClick={() => download(current)}>Download rejection report</ActionButton> : null}
          </div>
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <table className="eoc-table" aria-label="Row outcomes">
              <thead><tr><th scope="col">Row</th><th scope="col">WebEOC dataid</th><th scope="col">Outcome</th><th scope="col">Reason</th></tr></thead>
              <tbody>{listed.slice(0, SHOWN).map((o) => <tr key={o.row}>
                <td>{o.row}</td><td>{o.dataid ?? ""}</td><td>{outcomeLabel(o.outcome, current.dryRun)}</td><td>{o.reasons.join("; ")}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {listed.length > SHOWN ? <p className="d21-muted">Showing the first {SHOWN} of {listed.length} rows.</p> : null}
        </section> : null}
      </div>
    </Panel>
  );
}
