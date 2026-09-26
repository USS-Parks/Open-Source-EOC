import { useId, useState } from "react";
import { Panel, TextField } from "../design/components.js";
import { ActionButton } from "../design/controls.js";
import type { ApiClient, ImportRowOutcome, PeopleImportReport } from "../app/api/client.js";
import { OUTCOME_LABELS } from "./ImportReports.js";
import { saveFile } from "./labels.js";
import "./admin.css";

/** Rows listed on screen; the import report on the Records tab holds every row. */
const SHOWN = 200;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Bring people in from a CSV or Excel file (VC-13): each row's email, name,
 * role here and any positions. Checking the file reports every row and
 * changes nothing; importing makes the accounts, memberships and position
 * assignments the check showed, and refuses the rest with the reason. New
 * accounts get the first password typed here, never one from the file.
 */
export function PeopleImport(props: { client: ApiClient; jurisdictionId: string; onImported: () => void }) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PeopleImportReport | null>(null);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState<"all" | ImportRowOutcome>("all");
  const [busy, setBusy] = useState<"template" | "checking" | "importing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const run = async (step: NonNullable<typeof busy>, operation: () => Promise<string | void>) => {
    setBusy(step); setError(null); setNotice("");
    try { setNotice((await operation()) ?? ""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The request failed."); }
    finally { setBusy(null); }
  };
  const template = () => run("template", async () => {
    saveFile(await props.client.peopleImportTemplate(props.jurisdictionId), "people-import-template.csv");
    return "Template downloaded. Replace the listed roles and positions with one row per person.";
  });
  const check = (chosen: File) => run("checking", async () => {
    setResult(await props.client.importPeople(props.jurisdictionId, chosen, { dryRun: true }));
  });
  const choose = (input: HTMLInputElement) => {
    const next = input.files?.[0] ?? null;
    // Cleared so a corrected file of the same name can be chosen again.
    input.value = "";
    if (!next) return;
    setFile(next);
    setResult(null);
    void check(next);
  };
  const needsPassword = result?.dryRun === true && result.created > 0;
  const importable = result?.dryRun === true && result.created + result.updated > 0;
  const commit = () => run("importing", async () => {
    if (!file) return;
    if (needsPassword && password.length < 12) throw new Error("Enter a first password of at least 12 characters for the new accounts.");
    const report = await props.client.importPeople(props.jurisdictionId, file, { dryRun: false, ...(needsPassword ? { password } : {}) });
    setResult(report);
    setPassword("");
    props.onImported();
    return `Imported ${plural(report.created, "new account")}; ${report.updated} updated, ${report.skipped} skipped, ${report.refused} refused. The import report waits for sign-off on the Records tab.`;
  });
  const outcomeLabel = (outcome: ImportRowOutcome, dryRun: boolean) =>
    dryRun && outcome === "created" ? "Will be created" : dryRun && outcome === "updated" ? "Will be updated" : OUTCOME_LABELS[outcome];
  const listed = result ? result.outcomes.filter((o) => show === "all" || o.outcome === show) : [];

  return (
    <Panel title="Import people">
      <div className="admin-stack">
        <p className="d21-muted">A CSV or Excel file with a row per person: email, name, role (admin, member or viewer) and any positions, separated by semicolons. Check the file first; nothing changes until you choose Import. An account that already exists keeps its name and password and is added here; the role of someone already a member here is changed on this tab, not by a file.</p>
        <div className="d21-form-section-grid">
          <span className="admin-label">
            <label htmlFor={`${id}-file`}>People file (CSV or Excel)</label>
            <input id={`${id}-file`} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy !== null} className="admin-input is-bounded is-fill" onChange={(event) => choose(event.currentTarget)} />
          </span>
          <div className="admin-end">
            <ActionButton loading={busy === "template"} loadingLabel="Downloading…" disabled={busy !== null} onClick={() => void template()}>
              Download template</ActionButton>
          </div>
        </div>
        {busy === "checking" ? <p role="status">Checking {file?.name}…</p> : null}
        {error ? <p className="d21-error" role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}

        {result ? <section aria-labelledby={`${id}-result`} className="admin-section">
          <h3 id={`${id}-result`}>{result.dryRun ? "Check result" : "Import result"}</h3>
          <p className="eoc-flush">{plural(result.rows, "row")} read: {result.dryRun ? `${plural(result.created, "new account")}, ${result.updated} to update` : `${result.created} created, ${result.updated} updated`}, {result.skipped} skipped, {result.refused} refused.</p>
          {result.dropped.length ? <p className="d21-muted">Not read: {result.dropped.join(", ")}.</p> : null}
          {needsPassword ? <>
            <TextField label="First password for the new accounts" type="password" value={password} onChange={setPassword} required />
            <p className="d21-muted">Every new account in this file gets this first password, at least 12 characters. Give it to each person by a separate channel and have them change it at their first sign-in. It is not kept anywhere but as its hash.</p>
          </> : null}
          {result.dryRun ? <div className="d21-toolbar">
            <span className="d21-muted">{file?.name}</span>
            <ActionButton kind="primary" loading={busy === "importing"} loadingLabel="Importing…" disabled={busy !== null || !importable}
              onClick={() => void commit()}>{importable ? `Import ${plural(result.created + result.updated, "person", "people")}` : "Import"}</ActionButton>
          </div> : null}
          <div className="d21-toolbar">
            <span className="eoc-inline">
              <label htmlFor={`${id}-show`}>Show</label>
              <select id={`${id}-show`} value={show} className="admin-input is-bounded" onChange={(event) => setShow(event.target.value as typeof show)}>
                <option value="all">All rows</option>
                {(Object.keys(OUTCOME_LABELS) as ImportRowOutcome[]).map((outcome) =>
                  <option key={outcome} value={outcome}>{outcomeLabel(outcome, result.dryRun)}</option>)}
              </select>
            </span>
          </div>
          <div className="admin-scroll">
            <table className="eoc-table" aria-label="People rows and their outcomes">
              <thead><tr><th scope="col">Row</th><th scope="col">Email</th><th scope="col">Outcome</th><th scope="col">Detail</th></tr></thead>
              <tbody>{listed.slice(0, SHOWN).map((o) => <tr key={o.row}>
                <td>{o.row}</td><td className="admin-wrap">{o.email ?? ""}</td><td>{outcomeLabel(o.outcome, result.dryRun)}</td>
                <td className="admin-wrap">{o.detail}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {listed.length > SHOWN ? <p className="d21-muted">Showing the first {SHOWN} of {listed.length} rows.</p> : null}
        </section> : null}
      </div>
    </Panel>
  );
}
