import { useEffect, useMemo, useState } from "react";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import type {
  ApiClient,
  FileAttachmentKind,
  FileMetaRef,
  SearchHit,
} from "../app/api/client.js";
import { readAsBase64 } from "../app/data/files.js";
import { EmptyState, Loading, SurfaceHeader } from "../app/screens/parts.js";
import "./workspace.css";

export interface RecordFileContext {
  readonly boardId: string;
  readonly recordId: string;
  readonly label: string;
}

export interface FilesWorkspaceProps {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly incidentId?: string | null;
  readonly incidentName?: string | null;
  readonly recordContext?: RecordFileContext | null;
  readonly onOpenRecord?: (boardId: string, recordId: string, incidentId: string | null) => void;
  readonly onOpenIncident?: (incidentId: string) => void;
  readonly onReturn?: () => void;
}

type FileScope = "all" | "incident" | "record";
type Preview =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image" | "pdf"; readonly url: string }
  | { readonly kind: "unsupported"; readonly reason: string };

function contextLabel(file: FileMetaRef): string {
  switch (file.attachedKind) {
    case "record": return "Board record";
    case "board": return "Board";
    case "incident": return "Incident";
    case "library": return "Reference library";
    default: return "Jurisdiction library";
  }
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function listOptions(
  scope: FileScope,
  incidentId: string | null | undefined,
  record: RecordFileContext | null | undefined,
) {
  if (scope === "record" && record) {
    return { attachedKind: "record" as const, attachedId: record.recordId, limit: 40 };
  }
  if (scope === "incident" && incidentId) {
    return { attachedKind: "incident" as const, attachedId: incidentId, limit: 40 };
  }
  return { limit: 40 };
}

export function FilesWorkspace(props: FilesWorkspaceProps) {
  const [scope, setScope] = useState<FileScope>(props.recordContext ? "record" : props.incidentId ? "incident" : "all");
  const [files, setFiles] = useState<readonly FileMetaRef[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<FileMetaRef | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<FileScope>(props.recordContext ? "record" : props.incidentId ? "incident" : "all");
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopeValues = useMemo(() => [
    "all",
    ...(props.incidentId ? ["incident"] : []),
    ...(props.recordContext ? ["record"] : []),
  ] as FileScope[], [props.incidentId, props.recordContext]);
  const scopeLabels = {
    all: "All files",
    incident: props.incidentName ? `${props.incidentName} files` : "Selected incident",
    record: props.recordContext ? `Record: ${props.recordContext.label}` : "Selected record",
  };

  useEffect(() => {
    if (!scopeValues.includes(scope)) setScope(scopeValues[0]!);
    if (!scopeValues.includes(target)) setTarget(scopeValues[0]!);
  }, [scope, scopeValues, target]);

  useEffect(() => {
    let active = true;
    setLibraryLoading(true);
    setLibraryError(null);
    props.client.listFiles(props.jurisdictionId, listOptions(scope, props.incidentId, props.recordContext))
      .then((page) => {
        if (!active) return;
        setFiles(page.files);
        setCursor(page.nextCursor);
        setSelected((current) => current && page.files.some((item) => item.id === current.id) ? current : page.files[0] ?? null);
      })
      .catch((reason: unknown) => {
        if (active) setLibraryError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLibraryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.client, props.incidentId, props.jurisdictionId, props.recordContext, reload, scope]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setPreview(null);
    if (!selected) return () => { active = false; };
    setPreviewLoading(true);
    props.client.downloadFile(selected.id)
      .then(async (blob) => {
        if (!active) return;
        if (selected.contentType.startsWith("text/") || selected.contentType === "application/json" || selected.contentType === "application/geo+json") {
          setPreview(selected.size <= 1024 * 1024
            ? { kind: "text", text: await blob.text() }
            : { kind: "unsupported", reason: "Text preview is limited to 1 MB. Download the file to review it." });
          return;
        }
        if (selected.contentType.startsWith("image/")) {
          objectUrl = URL.createObjectURL(blob);
          setPreview({ kind: "image", url: objectUrl });
          return;
        }
        if (selected.contentType === "application/pdf") {
          objectUrl = URL.createObjectURL(blob);
          setPreview({ kind: "pdf", url: objectUrl });
          return;
        }
        setPreview({ kind: "unsupported", reason: "Preview is unavailable for this file type. The stored file can still be downloaded." });
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [props.client, selected]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const upload = () => void run(async () => {
    if (!file) return;
    const attachment = target === "record" && props.recordContext
      ? { attachedKind: "record" as FileAttachmentKind, attachedId: props.recordContext.recordId }
      : target === "incident" && props.incidentId
        ? { attachedKind: "incident" as FileAttachmentKind, attachedId: props.incidentId }
        : {};
    const result = await props.client.uploadFile(props.jurisdictionId, {
      name: file.name,
      contentType: file.type || "application/octet-stream",
      dataBase64: await readAsBase64(file),
      ...attachment,
    });
    setUploadMessage(`Stored ${file.name} as version ${result.version}.`);
    setFile(null);
    setReload((value) => value + 1);
    const meta = await props.client.fileMeta(result.id);
    setSelected(meta);
  });

  const search = () => void run(async () => {
    setHits(await props.client.searchJurisdiction(props.jurisdictionId, query.trim()));
  });

  const chooseSearchHit = (hit: SearchHit) => void run(async () => {
    if (hit.kind === "file") {
      setSelected(await props.client.fileMeta(hit.id));
      return;
    }
    if (hit.kind === "record" && hit.boardId) props.onOpenRecord?.(hit.boardId, hit.id, hit.incidentId ?? null);
  });

  const download = (meta: FileMetaRef) => void run(async () => {
    const blob = await props.client.downloadFile(meta.id);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = meta.name;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  const loadMore = () => void run(async () => {
    if (!cursor) return;
    const page = await props.client.listFiles(props.jurisdictionId, {
      ...listOptions(scope, props.incidentId, props.recordContext),
      cursor,
    });
    setFiles((current) => [...current, ...page.files]);
    setCursor(page.nextCursor);
  });

  const openSource = (meta: FileMetaRef) => {
    if (meta.attachedKind === "record" && meta.attachedBoardId && meta.attachedId) {
      props.onOpenRecord?.(meta.attachedBoardId, meta.attachedId, meta.attachedIncidentId ?? null);
    } else if (meta.attachedKind === "incident" && meta.attachedId) {
      props.onOpenIncident?.(meta.attachedId);
    }
  };

  return (
    <div className="d27-workspace d27-files">
      <SurfaceHeader
        title="Files"
        actions={props.onReturn ? <Button onClick={props.onReturn}>Return to record</Button> : undefined}
      />
      <div className="d27-file-grid">
        <div className="d27-stack">
          <Panel title="Upload in context">
            <div className="d27-form-stack">
              <EnumSelect
                label="Attach to"
                values={scopeValues}
                value={target}
                onChange={(value) => setTarget(value as FileScope)}
                labels={{ ...scopeLabels, all: "Jurisdiction file library" }}
              />
              <label className="d27-file-input">
                <span>File</span>
                <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              </label>
              <Button kind="primary" onClick={upload} disabled={busy || !file}>Upload</Button>
              {uploadMessage ? <p role="status" className="d27-success">{uploadMessage}</p> : null}
            </div>
          </Panel>
          <Panel title="Find operational material">
            <form className="d27-search" onSubmit={(event) => { event.preventDefault(); search(); }}>
              <TextField label="Search records and files" value={query} onChange={setQuery} />
              <Button type="submit" disabled={busy || query.trim().length < 2}>Search</Button>
            </form>
            {hits ? (
              hits.length > 0 ? (
                <ul className="d27-search-results">
                  {hits.map((hit) => (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <StatusBadge status="info">{hit.kind}</StatusBadge>
                      <span>{hit.title}</span>
                      {hit.kind === "file" || (hit.kind === "record" && hit.boardId) ? (
                        <Button onClick={() => chooseSearchHit(hit)}>
                          {hit.kind === "file" ? "Preview" : "Open record"}
                        </Button>
                      ) : <small>Search result only</small>}
                    </li>
                  ))}
                </ul>
              ) : <p className="d27-muted">No results.</p>
            ) : null}
          </Panel>
        </div>

        <Panel title="File library">
          <div className="d27-library-heading">
            <EnumSelect
              label="File scope"
              values={scopeValues}
              value={scope}
              onChange={(value) => setScope(value as FileScope)}
              labels={scopeLabels}
            />
            <span>{files.length} loaded</span>
          </div>
          {libraryLoading ? <Loading label="Loading files..." /> : null}
          {libraryError ? <p role="alert" className="d27-error">{libraryError}</p> : null}
          {!libraryLoading && files.length === 0 ? (
            <EmptyState label="No files in this scope." hint="Upload a file or choose another scope." />
          ) : (
            <ul className="d27-file-list">
              {files.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={selected?.id === item.id ? "true" : undefined}
                    onClick={() => setSelected(item)}
                  >
                    <strong>{item.name}</strong>
                    <span>{contextLabel(item)} - {fileSize(item.size)} - version {item.version}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {cursor ? <Button onClick={loadMore} disabled={busy}>Load more files</Button> : null}
        </Panel>

        <Panel title="File preview">
          {!selected ? (
            <EmptyState label="No file selected." hint="Choose a file from the library or search results." />
          ) : (
            <div className="d27-preview">
              <div className="d27-preview-heading">
                <div>
                  <h3>{selected.name}</h3>
                  <p>{selected.contentType} - {fileSize(selected.size)}</p>
                </div>
                <div className="d27-preview-actions">
                  {(selected.attachedKind === "record" || selected.attachedKind === "incident") && selected.attachedId ? (
                    <Button onClick={() => openSource(selected)}>
                      {selected.attachedKind === "record" ? "Open source record" : "Open incident"}
                    </Button>
                  ) : null}
                  <Button onClick={() => download(selected)} disabled={busy}>Download</Button>
                </div>
              </div>
              {selected.uploadedBy ? (
                <p className="d27-provenance">
                  Uploaded by {selected.uploadedBy.displayName}
                  {selected.uploadedBy.positionTitle ? ` (${selected.uploadedBy.positionTitle})` : ""}
                  {selected.createdAt ? ` on ${new Date(selected.createdAt).toLocaleString()}` : ""}
                  . Context: {contextLabel(selected)}.
                </p>
              ) : null}
              {previewLoading ? <Loading label="Loading preview..." /> : null}
              {preview?.kind === "text" ? <pre className="d27-text-preview">{preview.text}</pre> : null}
              {preview?.kind === "image" ? <img className="d27-image-preview" src={preview.url} alt={`Preview of ${selected.name}`} /> : null}
              {preview?.kind === "pdf" ? <iframe className="d27-pdf-preview" src={preview.url} title={`Preview of ${selected.name}`} /> : null}
              {preview?.kind === "unsupported" ? <p className="d27-muted">{preview.reason}</p> : null}
            </div>
          )}
        </Panel>
      </div>
      {error ? <p role="alert" className="d27-error">{error}</p> : null}
    </div>
  );
}
