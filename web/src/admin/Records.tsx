import { useEffect, useState } from "react";
import { Button, Panel } from "../design/components.js";
import type { ApiClient, SignedAuditPage } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";
import { DATA_CLASS_LABELS, saveFile } from "./labels.js";

/**
 * Records retention per data class, the audit trail export and the
 * jurisdiction export. Nothing is purged until a period is set; the audit
 * trail itself is never purged and leaves only by export.
 */
export function Records(props: { client: ApiClient; jurisdictionId: string }) {
  const policies = useAsync(() => props.client.getRetention(props.jurisdictionId), [props.jurisdictionId]);
  // Days per class as typed; an empty field keeps the class indefinitely.
  const [days, setDays] = useState<Record<string, string>>({});
  useEffect(() => {
    if (policies.data) setDays(Object.fromEntries(policies.data.map((p) => [p.dataClass, p.retentionDays?.toString() ?? ""])));
  }, [policies.data]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const run = async (operation: () => Promise<string>) => {
    setBusy(true); setError(null); setNotice("");
    try { setNotice(await operation()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The request failed."); }
    finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const changes = (policies.data ?? []).map((p) => {
      const text = (days[p.dataClass] ?? "").trim();
      const value = text === "" ? null : Number(text);
      if (value !== null && !(Number.isInteger(value) && value >= 1 && value <= 36500))
        throw new Error(`${DATA_CLASS_LABELS[p.dataClass] ?? "A data class"}: enter whole days from 1 to 36500, or leave it empty to keep everything.`);
      return { dataClass: p.dataClass, retentionDays: value, changed: value !== p.retentionDays };
    }).filter((change) => change.changed).map(({ dataClass, retentionDays }) => ({ dataClass, retentionDays }));
    if (changes.length === 0) return "No retention period changed.";
    await props.client.setRetention(props.jurisdictionId, changes);
    policies.reload();
    return "Retention periods saved.";
  });
  const exportCsv = () => run(async () => {
    let csv = "";
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await props.client.auditExportCsvPage(props.jurisdictionId, cursor);
      // Every page repeats the header row; keep the first one only.
      csv += pages === 0 ? page.csv : page.csv.slice(page.csv.indexOf("\n") + 1);
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);
    saveFile(new Blob([csv], { type: "text/csv" }), "audit-export.csv");
    return `Audit trail downloaded as CSV (${pages} ${pages === 1 ? "page" : "pages"}).`;
  });
  const exportSigned = () => run(async () => {
    const pages: SignedAuditPage[] = [];
    let cursor: string | undefined;
    do {
      const page = await props.client.auditExportSignedPage(props.jurisdictionId, cursor);
      pages.push(page);
      cursor = page.page.nextCursor ?? undefined;
    } while (cursor);
    saveFile(new Blob([JSON.stringify(pages, null, 2)], { type: "application/json" }), "audit-export.json");
    return `Audit trail downloaded as signed JSON (${pages.length} ${pages.length === 1 ? "page" : "pages"}).`;
  });
  const exportJurisdiction = () => run(async () => {
    saveFile(await props.client.exportJurisdiction(props.jurisdictionId), "jurisdiction-export.tar.gz");
    return "Jurisdiction export downloaded.";
  });

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      {error ? <p className="d21-error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <Panel title="Retention">
        {policies.error ? <ErrorNote message={policies.error} /> : null}
        {!policies.data && !policies.error ? <Loading label="Loading retention periods…" /> : null}
        {policies.data ? <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
          <p className="d21-muted">Rows older than the period are deleted by the hourly purge. Leave a period empty to keep that class indefinitely. The audit trail and incident records are never purged.</p>
          <div className="d21-form-section-grid">
            {policies.data.map((p) => (
              <div key={p.dataClass} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label htmlFor={`retention-${p.dataClass}`}>{DATA_CLASS_LABELS[p.dataClass] ?? "Other records"} (days)</label>
                <input id={`retention-${p.dataClass}`} type="number" min={1} max={36500} inputMode="numeric" value={days[p.dataClass] ?? ""}
                  placeholder="Keep indefinitely"
                  onChange={(event) => setDays((current) => ({ ...current, [p.dataClass]: event.target.value }))}
                  style={{ font: "inherit", minHeight: 44, padding: 6, borderRadius: 4, border: "1px solid var(--eoc-border)",
                    background: "var(--eoc-surface)", color: "var(--eoc-text)" }} />
                <span className="d21-muted">{p.updatedAt ? `Set ${new Date(p.updatedAt).toLocaleString()}` : "Never set"}</span>
              </div>
            ))}
          </div>
          <div className="d21-toolbar">
            <span className="d21-muted">Each change is recorded in the audit trail.</span>
            <Button kind="primary" onClick={() => void save()}>Save retention</Button>
          </div>
        </fieldset> : null}
      </Panel>
      <Panel title="Audit trail export">
        <p className="d21-muted">CSV opens in a spreadsheet; cells that could run as formulas are quoted. Signed JSON carries a keyed signature per page for verification and needs the server's secret key.</p>
        <div className="d21-toolbar">
          <span className="d21-muted">The whole trail of this jurisdiction downloads, oldest first.</span>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button disabled={busy} onClick={() => void exportCsv()}>Download audit CSV</Button>
            <Button disabled={busy} onClick={() => void exportSigned()}>Download signed JSON</Button>
          </span>
        </div>
      </Panel>
      <Panel title="Jurisdiction export">
        <p className="d21-muted">One .tar.gz archive. Its export.json holds boards and records, sitreps, lifelines, incidents, IAPs, AARs, resource requests, tasks, assessments and file details; its files folder holds each stored file, named by its SHA-256.</p>
        <div className="d21-toolbar">
          <span className="d21-muted">It holds only what your account can read in this jurisdiction.</span>
          <Button disabled={busy} onClick={() => void exportJurisdiction()}>Export jurisdiction</Button>
        </div>
      </Panel>
    </div>
  );
}
