import { useState, type CSSProperties } from "react";
import { Button, Panel, StatusBadge, TextField } from "../../design/components.js";
import type { ApiClient, SearchHit } from "../api/client.js";
import { readAsBase64 } from "../data/files.js";
import { Scroll, SurfaceHeader } from "../screens/parts.js";

const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "6px 8px",
  border: "1px solid var(--eoc-border)",
  borderRadius: 4,
};

/**
 * The file library and platform search (R5, B10). Upload a document or photo
 * to the content-addressed store, and search records, libraries, files, and
 * the chronology, all under the caller's own permissions.
 */
export function FilesSurface(props: { client: ApiClient; jurisdictionId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = () =>
    run(async () => {
      if (!file) return;
      const dataBase64 = await readAsBase64(file);
      const r = await props.client.uploadFile(props.jurisdictionId, {
        name: file.name,
        contentType: file.type || "application/octet-stream",
        dataBase64,
      });
      setUploadMsg(`Uploaded ${file.name} (version ${r.version}).`);
      setFile(null);
    });

  const doSearch = () =>
    run(async () => {
      setHits(await props.client.searchJurisdiction(props.jurisdictionId, q));
    });

  const download = (id: string, name: string) =>
    run(async () => {
      const blob = await props.client.downloadFile(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

  return (
    <Scroll>
      <SurfaceHeader title="Files & Search" />
      <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
        <Panel title="Upload a file">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="file"
              aria-label="File to upload"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button kind="primary" onClick={upload} disabled={busy || !file}>
              Upload
            </Button>
          </div>
          {uploadMsg ? (
            <p style={{ color: "var(--eoc-status-success)", margin: "8px 0 0" }}>{uploadMsg}</p>
          ) : null}
        </Panel>

        <Panel title="Search">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              doSearch();
            }}
            style={{ display: "flex", gap: 8, alignItems: "flex-end" }}
          >
            <div style={{ flex: 1 }}>
              <TextField label="Query" value={q} onChange={setQ} />
            </div>
            <Button type="submit" disabled={busy || q.trim().length < 2}>
              Search
            </Button>
          </form>
          {hits ? (
            hits.length === 0 ? (
              <p style={{ color: "var(--eoc-text-muted)", margin: "12px 0 0" }}>No results.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 6 }}>
                {hits.map((h) => (
                  <li key={`${h.kind}-${h.id}`} style={row}>
                    <StatusBadge status="info">{h.kind}</StatusBadge>
                    <span style={{ flex: 1 }}>{h.title}</span>
                    {h.kind === "file" ? (
                      <Button onClick={() => download(h.id, h.title)} disabled={busy}>
                        Download
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </Panel>

        {error ? (
          <p role="alert" style={{ color: "var(--eoc-status-critical)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </Scroll>
  );
}
