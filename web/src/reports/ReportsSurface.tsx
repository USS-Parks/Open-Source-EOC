import { useCallback, useEffect, useMemo, useState } from "react";
import { choiceLabel, type FieldDef } from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import { Icon } from "../design/icons/index.js";
import "../datasets/datasets.css";
import "./reports.css";
import {
  readAllPages,
  type ApiClient,
  type BoardListItem,
  type ReportDefinition,
  type ReportFormat,
  type ReportResult,
  type ReportSchedule,
  type ReportTotalFunction,
  type SavedReport,
  type SavedReportDetail,
} from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading, Scroll, SurfaceHeader } from "../app/screens/parts.js";
import { saveFile } from "../admin/labels.js";
import { NO_REFINEMENT, ViewRefineControls, type ViewRefinement } from "../boards/ViewRefine.js";
import { formatTime } from "../datasets/format.js";

const FORMATS: readonly ReportFormat[] = ["pdf", "xlsx", "csv"];
const FORMAT_LABELS: Readonly<Record<ReportFormat, string>> = { pdf: "PDF", xlsx: "Excel", csv: "CSV" };
const FUNCTIONS: readonly ReportTotalFunction[] = ["sum", "avg", "min", "max"];
const FUNCTION_LABELS: Readonly<Record<ReportTotalFunction, string>> = { sum: "Sum", avg: "Average", min: "Minimum", max: "Maximum" };
/** Rows a run shows on screen; downloads carry every row. */
const SHOWN_ROWS = 100;

type Mode = { kind: "none" } | { kind: "build"; report?: SavedReport } | { kind: "open"; id: string };

/**
 * Reports: saved definitions over a board with conditions, grouping, totals
 * and sort, run as the person viewing them and downloaded as PDF, Excel or
 * CSV, and optionally sent or stored on a schedule. Members and viewers run
 * reports; writers build them; the owner or an administrator changes one.
 */
export function ReportsSurface(props: {
  client: ApiClient;
  jurisdictionId: string;
  boards: readonly BoardListItem[];
  incidentId: string | null;
  incidentName: string | null;
  incidentBoardIds: ReadonlySet<string>;
  canBuild: boolean;
}) {
  const { client, jurisdictionId } = props;
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const reports = useAsync(() => client.listReports(jurisdictionId), [jurisdictionId, nonce]);
  const [more, setMore] = useState<{ items: SavedReport[]; nextCursor: string | null } | null>(null);
  useEffect(() => setMore(null), [reports.data]);
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const list = [...(reports.data?.reports ?? []), ...(more?.items ?? [])];
  const nextCursor = more ? more.nextCursor : (reports.data?.nextCursor ?? null);

  return (
    <Scroll>
      <SurfaceHeader title="Reports" actions={<div className="d21-card-actions">
        {props.canBuild ? <Button kind="primary" onClick={() => setMode({ kind: "build" })}>New report</Button> : null}
        <Button onClick={refresh}>Refresh</Button>
      </div>} />
      <div className="d21-workspace">
        <div className="d21-workspace-intro">
          <Icon name="sitrep" size={32} decorative />
          <div>
            <strong>Tables, groups and totals from a board</strong>
            <span>A report picks a board&apos;s columns, the records to include, up to two groupings and totals. Every run reads the board as the person running it, so records and fields that person cannot read are left out.</span>
          </div>
        </div>
        {mode.kind === "build" ? (
          <Builder key={mode.report?.id ?? "new"} client={client} jurisdictionId={jurisdictionId} boards={props.boards}
            incidentId={props.incidentId} incidentName={props.incidentName} incidentBoardIds={props.incidentBoardIds}
            {...(mode.report ? { report: mode.report } : {})}
            onSaved={(report) => { setMode({ kind: "open", id: report.id }); refresh(); }}
            onCancel={() => setMode(mode.report ? { kind: "open", id: mode.report.id } : { kind: "none" })} />
        ) : null}
        {mode.kind === "open" ? (
          <ReportDetail key={mode.id} client={client} jurisdictionId={jurisdictionId} id={mode.id} nonce={nonce}
            canBuild={props.canBuild} onEdit={(report) => setMode({ kind: "build", report })}
            onClose={() => setMode({ kind: "none" })}
            onChanged={refresh} onDeleted={() => { setMode({ kind: "none" }); refresh(); }} />
        ) : null}
        <Panel title="Saved reports">
          {reports.error && !reports.data ? <ErrorNote message={reports.error} /> : null}
          {!reports.data && !reports.error ? <Loading label="Loading reports…" /> : null}
          {reports.data && list.length === 0 ? <p className="d21-muted">No reports yet.</p> : null}
          <ul className="d21-readiness-list is-single">
            {list.map((report) => (
              <li key={report.id} className="d21-readiness-row" aria-label={`Report ${report.name}`}>
                <div className="d21-readiness-title">
                  <div>
                    <strong>{report.name}</strong>
                    <span>{report.boardTitle ?? "Board unavailable"} · {report.owner.displayName} · {scheduleText(report.schedule)}</span>
                  </div>
                </div>
                <div className="d21-card-actions is-start">
                  <Button onClick={() => setMode({ kind: "open", id: report.id })}>Open {report.name}</Button>
                </div>
              </li>
            ))}
          </ul>
          {nextCursor ? (
            <div className="d21-toolbar">
              <Button onClick={() => void client.listReports(jurisdictionId, { cursor: nextCursor })
                .then((page) => setMore({ items: [...(more?.items ?? []), ...page.reports], nextCursor: page.nextCursor }))
                .catch(() => undefined)}>Load more reports</Button>
            </div>
          ) : null}
        </Panel>
      </div>
    </Scroll>
  );
}

function scheduleText(schedule: ReportSchedule | null): string {
  if (!schedule) return "Not scheduled";
  const when = schedule.cadence.kind === "interval"
    ? `every ${schedule.cadence.minutes} minutes`
    : `daily at ${schedule.cadence.time} (${schedule.cadence.timeZone})`;
  return `${FORMAT_LABELS[schedule.format]} ${when}`;
}

function valueText(value: unknown, type?: string): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  if (typeof value === "object") return JSON.stringify(value);
  return type === "enum" ? choiceLabel(String(value)) : String(value);
}

/** A run on screen: its rows, then the counts and totals per group and for all records. */
function ResultView(props: { result: ReportResult; label: string }) {
  const r = props.result;
  const shown = [...r.groupBy, ...r.columns.filter((c) => !r.groupBy.some((g) => g.key === c.key))];
  const rows = r.rows.slice(0, SHOWN_ROWS);
  const aggregates = (totals: Readonly<Record<string, number | null>>) =>
    r.totals.map((t) => <td key={t.key}>{totals[t.key] === null ? "None" : valueText(totals[t.key])}</td>);
  return (
    <section aria-label={props.label} className="reports-result">
      {r.omitted.length ? <p className="d21-muted" role="note">Left out because you cannot read them: {r.omitted.join(", ")}</p> : null}
      <p className="d21-muted">Showing {rows.length} of {r.total.count} record{r.total.count === 1 ? "" : "s"}.</p>
      <div className="reports-scroll">
        <table className="eoc-table" aria-label={`${props.label} rows`}>
          <thead><tr>{shown.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, i) => <tr key={i}>{shown.map((c) => <td key={c.key}>{valueText(row[c.key], c.type)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      {r.groupBy.length || r.totals.length ? (
        <div className="reports-scroll">
          <table className="eoc-table" aria-label={`${props.label} totals`}>
            <thead><tr>
              <th>{r.groupBy.map((g) => g.label).join(" / ") || "Group"}</th><th>Records</th>
              {r.totals.map((t) => <th key={t.key}>{t.label}</th>)}
            </tr></thead>
            <tbody>
              {r.groups.map((g) => (
                <tr key={`${g.first}-${g.level}`} className={g.level === 1 ? "reports-group" : undefined}>
                  <td>{g.values.map((v, k) => (v === null ? "(no value)" : valueText(v, r.groupBy[k]?.type))).join(" / ")}</td><td>{g.count}</td>
                  {aggregates(g.totals)}
                </tr>
              ))}
              <tr className="reports-group"><td>All records</td><td>{r.total.count}</td>{aggregates(r.total.totals)}</tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function Builder(props: {
  client: ApiClient;
  jurisdictionId: string;
  boards: readonly BoardListItem[];
  incidentId: string | null;
  incidentName: string | null;
  incidentBoardIds: ReadonlySet<string>;
  report?: SavedReport;
  onSaved: (report: SavedReport) => void;
  onCancel: () => void;
}) {
  const { client, report } = props;
  const [name, setName] = useState(report?.name ?? "");
  const [boardId, setBoardId] = useState(report?.boardId ?? props.boards[0]?.id ?? "");
  const [scoped, setScoped] = useState(Boolean(report?.incidentId));
  const [columns, setColumns] = useState<readonly string[]>(report?.definition.columns ?? []);
  const [refine, setRefine] = useState<ViewRefinement>(report ? {
    where: report.definition.where, sorts: report.definition.sorts,
    groupBy: report.definition.groupBy[0] ?? null, archived: report.definition.archived,
  } : NO_REFINEMENT);
  const [thenBy, setThenBy] = useState(report?.definition.groupBy[1] ?? "");
  const [totals, setTotals] = useState<ReadonlyArray<{ field: string; fn: ReportTotalFunction }>>(report?.definition.totals ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const board = useAsync(() => (boardId ? client.getBoard(boardId) : Promise.resolve(null)), [boardId]);
  const fields: readonly FieldDef[] = board.data?.id === boardId ? board.data.fields : [];
  const numeric = fields.filter((f) => f.type === "number");
  const groupable = fields.filter((f) => f.type !== "geometry" && !f.calculation);
  const scopeId = report?.incidentId ?? (props.incidentId && props.incidentBoardIds.has(boardId) ? props.incidentId : null);

  // A new board starts from its first readable fields and no refinements.
  useEffect(() => {
    if (!board.data || board.data.id !== boardId || columns.some((key) => fields.some((f) => f.key === key))) return;
    setColumns(fields.filter((f) => f.type !== "geometry").slice(0, 4).map((f) => f.key));
  }, [board.data, boardId]);

  const definition: ReportDefinition = useMemo(() => ({
    columns: fields.filter((f) => columns.includes(f.key)).map((f) => f.key),
    where: refine.where,
    groupBy: [refine.groupBy, refine.groupBy ? thenBy : ""].filter((key): key is string => Boolean(key) && key !== null)
      .filter((key, i, all) => all.indexOf(key) === i),
    totals,
    sorts: refine.sorts,
    archived: refine.archived,
  }), [fields, columns, refine, thenBy, totals]);
  const incidentId = scoped ? scopeId : null;
  const request = JSON.stringify({ boardId, incidentId, definition });

  const [preview, setPreview] = useState<ReportResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    if (!boardId || definition.columns.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      client.previewReport(props.jurisdictionId, { boardId, incidentId, definition })
        .then((result) => { if (!cancelled) { setPreview(result); setPreviewError(null); } })
        .catch((cause: unknown) => { if (!cancelled) setPreviewError(cause instanceof Error ? cause.message : "Preview failed."); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [request]);

  const chooseBoard = (next: string) => {
    if (next === boardId) return;
    setBoardId(next);
    setColumns([]);
    setRefine(NO_REFINEMENT);
    setThenBy("");
    setTotals([]);
    setScoped(false);
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (!name.trim()) throw new Error("Enter a name for the report.");
      if (definition.columns.length === 0) throw new Error("Choose at least one column.");
      const input = { name: name.trim(), boardId, incidentId, definition, schedule: report?.schedule ?? null };
      props.onSaved(report ? await client.updateReport(report.id, input) : await client.createReport(props.jurisdictionId, input));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The report was not saved.");
    } finally {
      setBusy(false);
    }
  };

  const fieldLabels = Object.fromEntries(fields.map((f) => [f.key, f.label]));
  return (
    <Panel title={report ? `Edit report: ${report.name}` : "New report"}>
      <div className="d21-form-grid">
        <TextField label="Report name" value={name} onChange={setName} required />
        <EnumSelect label="Board" values={props.boards.map((b) => b.id)}
          labels={Object.fromEntries(props.boards.map((b) => [b.id, b.title]))} value={boardId} onChange={chooseBoard} />
        {scopeId ? (
          <label className="reports-check d21-form-grid-wide">
            <input type="checkbox" checked={scoped} onChange={(e) => setScoped(e.target.checked)} />
            Only records of the incident {report?.incidentId && report.incidentId !== props.incidentId ? "this report was built for" : props.incidentName ?? "in view"}
          </label>
        ) : null}
        {board.error ? <div className="d21-form-grid-wide"><ErrorNote message={board.error} /></div> : null}
        <fieldset className="reports-checks d21-form-grid-wide">
          <legend>Columns</legend>
          {fields.map((f) => (
            <label key={f.key} className="reports-check">
              <input type="checkbox" checked={columns.includes(f.key)}
                onChange={(e) => setColumns((list) => (e.target.checked ? [...list, f.key] : list.filter((k) => k !== f.key)))} />
              {f.label}
            </label>
          ))}
        </fieldset>
        <div className="d21-form-grid-wide">
          <ViewRefineControls fields={fields} value={refine} onApply={setRefine} />
        </div>
        <EnumSelect label="Then group by" values={["", ...groupable.filter((f) => f.key !== refine.groupBy).map((f) => f.key)]}
          labels={{ "": refine.groupBy ? "No second grouping" : "Group by a field first", ...fieldLabels }}
          value={refine.groupBy ? thenBy : ""} onChange={setThenBy} selectProps={{ disabled: !refine.groupBy }} />
        <fieldset className="reports-totals d21-form-grid-wide">
          <legend>Totals</legend>
          <p className="d21-muted">Each group and all records get a count. Add sums, averages, minimums or maximums of number fields.</p>
          {totals.map((total, i) => (
            <div key={i} className="reports-total-row">
              <EnumSelect label={`Total ${i + 1} field`} values={numeric.map((f) => f.key)} labels={fieldLabels} value={total.field}
                onChange={(field) => setTotals(totals.map((t, j) => (j === i ? { ...t, field } : t)))} />
              <EnumSelect label={`Total ${i + 1} function`} values={FUNCTIONS} labels={FUNCTION_LABELS} value={total.fn}
                onChange={(fn) => setTotals(totals.map((t, j) => (j === i ? { ...t, fn: fn as ReportTotalFunction } : t)))} />
              <Button onClick={() => setTotals(totals.filter((_, j) => j !== i))}>Remove total {i + 1}</Button>
            </div>
          ))}
          <div><Button disabled={numeric.length === 0 || totals.length >= 16}
            onClick={() => setTotals([...totals, { field: numeric[0]!.key, fn: "sum" }])}>Add total</Button></div>
        </fieldset>
      </div>
      {error ? <p className="d21-error" role="alert">{error}</p> : null}
      <div className="d21-toolbar">
        <span className="d21-muted">The preview below runs as you and shows the first rows; groups and totals cover every record.</span>
        <div className="d21-card-actions">
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button kind="primary" disabled={busy} onClick={() => void save()}>Save report</Button>
        </div>
      </div>
      <h3 className="reports-heading">Preview</h3>
      {previewError ? <ErrorNote message={previewError} /> : null}
      {preview && definition.columns.length ? <ResultView result={preview} label="Preview" />
        : !previewError ? <p className="d21-muted">Choose a board and columns to see a preview.</p> : null}
    </Panel>
  );
}

function ReportDetail(props: {
  client: ApiClient;
  jurisdictionId: string;
  id: string;
  nonce: number;
  canBuild: boolean;
  onEdit: (report: SavedReport) => void;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { client, id } = props;
  const [own, setOwn] = useState(0);
  const detail = useAsync(() => client.getReport(id), [id, props.nonce, own]);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // A reload keeps the report on screen, so the schedule form and its notice stay.
  const [shown, setShown] = useState<SavedReportDetail | null>(null);
  useEffect(() => { if (detail.data) setShown(detail.data); }, [detail.data]);
  const report = detail.data ?? shown;

  const act = async (work: () => Promise<void>, failure: string) => {
    setBusy(true); setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setBusy(false);
    }
  };
  const download = (format: ReportFormat) => act(async () => {
    const slug = (report?.name ?? "report").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
    saveFile(await client.downloadReport(id, format), `${slug}.${format}`);
  }, "The report was not downloaded.");

  if (detail.error && !report) return <ErrorNote message={detail.error} />;
  if (!report) return <Loading label="Loading report…" />;
  return (
    <Panel title={`Report: ${report.name}`}>
      <p className="d21-muted">
        {report.boardTitle ?? "Board unavailable"}{report.incidentId ? " · one incident" : ""} · built by {report.owner.displayName} · updated {formatTime(report.updatedAt)}
      </p>
      <div className="d21-card-actions is-start">
        <Button kind="primary" disabled={busy} onClick={() => void act(async () => setResult(await client.runReport(id)), "The report did not run.")}>Run</Button>
        {FORMATS.map((format) => (
          <Button key={format} disabled={busy} onClick={() => void download(format)}>Download {FORMAT_LABELS[format]}</Button>
        ))}
        {report.canEdit && props.canBuild ? <Button onClick={() => props.onEdit(report)}>Edit</Button> : null}
        {report.canEdit ? <Button kind="danger" onClick={() => setConfirming(true)}>Delete</Button> : null}
        <Button onClick={props.onClose}>Close</Button>
      </div>
      {confirming ? (
        <div className="d21-toolbar" role="group" aria-label="Confirm delete">
          <span>Delete {report.name}? Its schedule and run history go with it.</span>
          <div className="d21-card-actions">
            <Button onClick={() => setConfirming(false)}>Keep report</Button>
            <Button kind="danger" disabled={busy}
              onClick={() => void act(async () => { await client.deleteReport(id); props.onDeleted(); }, "The report was not deleted.")}>
              Delete report
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="d21-error" role="alert">{error}</p> : null}
      {result ? <ResultView result={result} label="Run" /> : null}
      <h3 className="reports-heading">Schedule</h3>
      {report.canEdit ? (
        <ScheduleEditor client={client} jurisdictionId={props.jurisdictionId} report={report}
          onSaved={() => { setOwn((n) => n + 1); props.onChanged(); }} />
      ) : <p className="d21-muted">{scheduleText(report.schedule)}</p>}
      <h3 className="reports-heading">Recent scheduled runs</h3>
      {report.runs.length === 0 ? <p className="d21-muted">No scheduled runs yet.</p> : (
        <ul className="reports-runs" aria-label="Recent scheduled runs">
          {report.runs.map((run) => (
            <li key={run.id}>
              <StatusBadge status={run.outcome === "delivered" ? "success" : run.outcome === "queued" ? "unknown" : run.outcome === "partial" ? "warning" : "critical"}>
                {run.outcome === "delivered" ? "Delivered" : run.outcome === "queued" ? "Emails queued" : run.outcome === "partial" ? "Partly delivered" : "Failed"}
              </StatusBadge>
              <span>{formatTime(run.ranAt)} · {run.rows ?? "no"} records · as {run.ranAs}</span>
              {typeof run.detail.error === "string" ? <span className="d21-muted">{run.detail.error}</span> : null}
              {run.outcome === "queued" ? <span className="d21-muted">Each email's delivery shows under Notifications.</span> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ScheduleEditor(props: { client: ApiClient; jurisdictionId: string; report: SavedReportDetail; onSaved: () => void }) {
  const { client, report } = props;
  const current = report.schedule;
  const [kind, setKind] = useState<string>(current?.cadence.kind ?? "daily");
  const [minutes, setMinutes] = useState(String(current?.cadence.kind === "interval" ? current.cadence.minutes : 60));
  const [time, setTime] = useState(current?.cadence.kind === "daily" ? current.cadence.time : "07:00");
  const [timeZone, setTimeZone] = useState(current?.cadence.kind === "daily" ? current.cadence.timeZone
    : Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [format, setFormat] = useState<string>(current?.format ?? "pdf");
  const [emails, setEmails] = useState((current?.emails ?? []).join(", "));
  const [contactIds, setContactIds] = useState<readonly string[]>(current?.contactIds ?? []);
  const [storeFile, setStoreFile] = useState(current?.storeFile ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const contacts = useAsync(
    () => readAllPages((page) => client.listContacts(props.jurisdictionId, "", page).then((r) => ({ items: r.contacts, nextCursor: r.nextCursor }))),
    [props.jurisdictionId],
  );

  const save = async (schedule: ReportSchedule | null) => {
    setBusy(true); setError(null); setNotice("");
    try {
      await client.updateReport(report.id, {
        name: report.name, boardId: report.boardId, incidentId: report.incidentId, definition: report.definition, schedule,
      });
      setNotice(schedule ? "Schedule saved." : "Schedule removed.");
      props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The schedule was not saved.");
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    const every = Number(minutes);
    if (kind === "interval" && !(Number.isInteger(every) && every >= 15 && every <= 10_080)) {
      setError("Enter the minutes between runs, from 15 to 10080.");
      return;
    }
    const addresses = emails.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
    if (addresses.length === 0 && contactIds.length === 0 && !storeFile) {
      setError("Send to at least one address or contact, or store the file.");
      return;
    }
    void save({
      cadence: kind === "interval" ? { kind: "interval", minutes: every } : { kind: "daily", time, timeZone: timeZone.trim() },
      format: format as ReportFormat, emails: addresses, contactIds, storeFile,
    });
  };

  const withEmail = (contacts.data ?? []).filter((c) => c.active);
  return (
    <div className="reports-schedule">
      <p className="d21-muted">
        {current ? `${scheduleText(current)}. Next run ${report.nextRunAt ? formatTime(report.nextRunAt) : "not set"}.` : "Not scheduled."}
        {" "}A scheduled run reads the board as {report.owner.displayName}, the report&apos;s owner; everyone who receives it sees what they can read.
      </p>
      <fieldset disabled={busy} className="d21-form-grid">
        <EnumSelect label="Runs" values={["daily", "interval"]} labels={{ daily: "Every day at a time", interval: "Every so many minutes" }}
          value={kind} onChange={setKind} />
        {kind === "interval" ? <TextField label="Minutes between runs" value={minutes} onChange={setMinutes} /> : (
          <>
            <label className="reports-field">Time of day<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            <TextField label="Time zone" value={timeZone} onChange={setTimeZone} />
          </>
        )}
        <EnumSelect label="Format" values={FORMATS} labels={FORMAT_LABELS} value={format} onChange={setFormat} />
        <div className="d21-form-grid-wide"><TextField label="Email addresses" value={emails} onChange={setEmails} /></div>
        <fieldset className="reports-checks d21-form-grid-wide">
          <legend>Contacts, sent to each one&apos;s first email address</legend>
          {withEmail.length === 0 ? <span className="d21-muted">No contacts in the directory.</span> : null}
          {withEmail.map((c) => (
            <label key={c.id} className="reports-check">
              <input type="checkbox" checked={contactIds.includes(c.id)}
                onChange={(e) => setContactIds((list) => (e.target.checked ? [...list, c.id] : list.filter((x) => x !== c.id)))} />
              {c.name}
            </label>
          ))}
        </fieldset>
        <label className="reports-check d21-form-grid-wide">
          <input type="checkbox" checked={storeFile} onChange={(e) => setStoreFile(e.target.checked)} />
          Store each run in Files
        </label>
      </fieldset>
      {error ? <p className="d21-error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="d21-card-actions is-start">
        <Button kind="primary" disabled={busy} onClick={submit}>Save schedule</Button>
        {current ? <Button disabled={busy} onClick={() => void save(null)}>Remove schedule</Button> : null}
      </div>
    </div>
  );
}
