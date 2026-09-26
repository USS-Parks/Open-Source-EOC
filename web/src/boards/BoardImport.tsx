import { useState } from "react";
import type { FieldDef } from "@openeoc/shared";
import type { BoardImportResult } from "../app/api/client.js";
import { ActionButton } from "../design/controls.js";
import "./board-tools.css";

export type ImportRun = (
  file: Blob,
  options: { dryRun: boolean; mapping?: Readonly<Record<string, string | null>> },
) => Promise<BoardImportResult>;

type Mapping = Readonly<Record<string, string | null>>;

/**
 * Import a CSV or Excel file, or an Esri JSON feature set (VC-26), into a
 * board in three steps: the server reads the headings (an Esri file's
 * attribute names and its geometry) and proposes a field for each, the
 * operator confirms or changes the mapping, and a dry run lists every row
 * error. Import is offered only after a dry run of the current file and
 * mapping is clean, because a commit writes every row or none.
 */
export function BoardImport(props: {
  readonly fields: readonly FieldDef[];
  readonly run: ImportRun;
  readonly onImported: (created: number) => void;
}) {
  const writable = props.fields.filter((field) => !field.calculation);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [checked, setChecked] = useState<{ mapping: string; result: BoardImportResult } | null>(null);
  const [busy, setBusy] = useState<"reading" | "checking" | "importing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const labels = new Map(props.fields.map((field) => [field.key, field.label]));
  const current = checked && checked.mapping === JSON.stringify(mapping) ? checked.result : null;
  const clean = current !== null && current.errorCount === 0 && current.rows > 0;

  async function choose(input: HTMLInputElement) {
    const next = input.files?.[0] ?? null;
    // Cleared so the same file name can be chosen again once it is corrected.
    input.value = "";
    if (!next) return;
    setFile(next);
    setChecked(null);
    setError(null);
    setBusy("reading");
    try {
      // The first dry run reads the headings and proposes the mapping, keeping
      // the choices made for a corrected file's headings; its result is also
      // the check of exactly that mapping.
      const result = await props.run(next, { dryRun: true, ...(headers.length ? { mapping } : {}) });
      const proposed: Record<string, string | null> = {};
      for (const [header, key] of Object.entries(result.mapping)) proposed[header] = key;
      for (const header of result.ignored) proposed[header] = null;
      setHeaders(Object.keys(proposed));
      setMapping(proposed);
      setChecked({ mapping: JSON.stringify(proposed), result });
    } catch (reason) {
      setHeaders([]);
      setMapping({});
      setError(reason instanceof Error ? reason.message : "The file could not be read.");
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    if (!file) return;
    setError(null);
    setBusy("checking");
    try {
      setChecked({ mapping: JSON.stringify(mapping), result: await props.run(file, { dryRun: true, mapping }) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The file could not be checked.");
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!file || !clean) return;
    setError(null);
    setBusy("importing");
    try {
      const result = await props.run(file, { dryRun: false, mapping });
      props.onImported(result.created);
    } catch (reason) {
      setChecked(null);
      setError(`${reason instanceof Error ? reason.message : "The import failed."} Nothing was imported; check the file again.`);
    } finally {
      setBusy(null);
    }
  }

  return <div className="board-import">
    <p>Choose a CSV or Excel file with a heading row. Each heading maps to a board field; an <code>id</code> column
      is never imported, because an import creates new records. Nothing is written until the check passes and you
      choose Import, and then every row is written or none is. To fix row errors, correct the file and choose it
      again; the column mapping is kept.</p>
    <p>An Esri JSON file, such as an ArcGIS layer&apos;s query saved with <code>f=json</code>, imports one record per
      feature: each attribute is a column, and its shape, in WGS 84 (4326) or Web Mercator (3857), goes to the
      board&apos;s map field as the <code>geometry</code> column. Its rows are numbered by feature, from 1.</p>
    <label className="board-refine__control"><span>File to import</span>
      <input type="file" accept=".csv,.xlsx,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={busy !== null} onChange={(event) => void choose(event.currentTarget)} />
    </label>
    {busy === "reading" ? <p role="status">Reading {file?.name}…</p> : null}
    {headers.length ? <section aria-labelledby="board-import-mapping">
      <h3 id="board-import-mapping">Map columns to fields</h3>
      <table>
        <thead><tr><th scope="col">Column heading</th><th scope="col">Board field</th></tr></thead>
        <tbody>{headers.map((header) => <tr key={header}>
          <td>{header}</td>
          <td><select aria-label={`Field for column ${header}`} value={mapping[header] ?? ""}
            onChange={(event) => setMapping({ ...mapping, [header]: event.target.value || null })}>
            <option value="">Do not import</option>
            {writable.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
          </select></td>
        </tr>)}</tbody>
      </table>
    </section> : null}
    {file && headers.length ? <div className="board-refine__actions">
      <ActionButton loading={busy === "checking"} loadingLabel="Checking…" disabled={busy !== null}
        onClick={() => void check()}>Check file</ActionButton>
      <ActionButton kind="primary" loading={busy === "importing"} loadingLabel="Importing…"
        disabled={busy !== null || !clean} onClick={() => void commit()}>
        {clean ? `Import ${current.rows} record${current.rows === 1 ? "" : "s"}` : "Import"}
      </ActionButton>
    </div> : null}
    {current ? <section aria-labelledby="board-import-check" role="status">
      <h3 id="board-import-check">Check result</h3>
      <p>{current.rows} row{current.rows === 1 ? "" : "s"} read. {current.errorCount === 0
        ? current.rows ? "No errors: ready to import." : "The file has no data rows."
        : `${current.errorCount} error${current.errorCount === 1 ? "" : "s"}; fix the file or the mapping and check again.`}</p>
      {current.errors.length ? <table aria-label="Row errors">
        <thead><tr><th scope="col">Row</th><th scope="col">Field</th><th scope="col">Problem</th></tr></thead>
        <tbody>{current.errors.map((item, index) => <tr key={index}>
          <td>{item.row}</td><td>{item.field ? labels.get(item.field) ?? item.field : ""}</td><td>{item.message}</td>
        </tr>)}</tbody>
      </table> : null}
      {current.errors.length < current.errorCount
        ? <p>The first {current.errors.length} errors are listed.</p> : null}
    </section> : checked ? <p>The mapping changed; check the file again before importing.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
