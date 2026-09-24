import { useEffect, useRef, useState } from "react";
import type { BoardTemplate } from "@openeoc/shared";
import { EnumSelect, TextField } from "../../design/components.js";
import { ActionButton } from "../../design/controls.js";
import type { ApiClient, BoardListItem } from "../api/client.js";
import { ApiError } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { EmptyState, ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";
import { Designer } from "../../boards/Designer.js";

export interface TemplatesSurfaceProps {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly boards: readonly BoardListItem[];
  readonly isInstanceAdmin: boolean;
  readonly isJurisdictionAdmin: boolean;
  readonly boardId?: string;
  readonly onOpenBoard: (boardId: string) => void;
  readonly onDesignBoard: (boardId: string) => void;
  /** Called once a board is created, so the lists that hold the boards read them again. */
  readonly onBoardsChanged?: () => void;
}

type Feedback = { readonly status: "success" | "warning"; readonly title: string; readonly detail: string };
type PendingAction =
  | { readonly kind: "create"; readonly key: string; readonly version: number; readonly title: string }
  | { readonly kind: "upgrade"; readonly version: number };

/**
 * Mounted administration surface for the existing versioned template engine.
 * It publishes immutable definitions, then explicitly creates or upgrades a
 * board through the existing server routes. A published version and an applied
 * board upgrade are reported as separate outcomes.
 */
export function TemplatesSurface(props: TemplatesSurfaceProps) {
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const scopeKey = `${props.jurisdictionId}:${props.boardId ?? "new"}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  useEffect(() => {
    setCreating(false);
    setFeedback(null);
    setPending(null);
  }, [scopeKey]);
  const board = useAsync(
    () => props.boardId ? props.client.getBoard(props.boardId) : Promise.resolve(null),
    [props.boardId],
  );
  const template = useAsync(
    () => board.data
      ? props.client.getTemplateVersion(board.data.templateKey, board.data.templateVersion)
      : Promise.resolve(null),
    [board.data?.templateKey, board.data?.templateVersion],
  );
  const versions = useAsync(
    () => board.data ? props.client.listTemplateVersions(board.data.templateKey) : Promise.resolve([]),
    [board.data?.templateKey],
  );
  const positions = useAsync(() => props.client.listPositions(props.jurisdictionId), [props.jurisdictionId]);

  if (!props.isInstanceAdmin || !props.isJurisdictionAdmin) {
    return <EmptyState label="Board customization is unavailable for this account."
      hint="Publishing templates requires an instance administrator who also administers the selected jurisdiction." />;
  }

  const boardCreated = (id: string) => {
    props.onBoardsChanged?.();
    props.onOpenBoard(id);
  };

  if (!props.boardId && !creating) {
    return <TemplateIndex client={props.client} jurisdictionId={props.jurisdictionId} boards={props.boards} onCreate={() => {
      setFeedback(null);
      setCreating(true);
    }} onDesign={props.onDesignBoard} onBoardCreated={boardCreated} />;
  }

  if (props.boardId && board.loading && !board.data) return <Loading label="Loading board configuration…" />;
  if (props.boardId && board.error && !board.data) return <ErrorNote message={board.error} />;
  if (props.boardId && template.loading && !template.data) return <Loading label="Loading template version…" />;
  if (props.boardId && template.error && !template.data) return <ErrorNote message={template.error} />;

  const base = template.data ?? undefined;
  const identity = base ? `${base.key}:${base.version}` : "new-template";

  async function publish(next: BoardTemplate) {
    const activeScope = scopeKey;
    setFeedback(null);
    setPending(null);
    const published = await props.client.publishTemplate(next);
    if (scopeRef.current !== activeScope) return;
    if (!props.boardId) {
      try {
        const created = await props.client.createBoard(props.jurisdictionId, {
          templateKey: published.key,
          version: published.version,
          title: next.title,
        });
        if (scopeRef.current !== activeScope) return;
        setFeedback({ status: "success", title: `Version ${published.version} published`,
          detail: "A board was created from this version." });
        boardCreated(created.id);
      } catch (error) {
        if (scopeRef.current !== activeScope) return;
        setPending({ kind: "create", key: published.key, version: published.version, title: next.title });
        setFeedback({ status: "warning", title: `Version ${published.version} published`,
          detail: `The template is available, but a board was not created. ${messageFor(error)}` });
      }
      return;
    }
    try {
      const result = await props.client.upgradeBoard(props.boardId, published.version);
      if (scopeRef.current !== activeScope) return;
      setFeedback({ status: "success", title: `Version ${published.version} published and applied`,
        detail: result.dropped.length
          ? `Local fields replaced by the template: ${result.dropped.join(", ")}.`
          : "Existing records and local customizations passed migration checks." });
      props.onOpenBoard(props.boardId);
    } catch (error) {
      if (scopeRef.current !== activeScope) return;
      setPending({ kind: "upgrade", version: published.version });
      setFeedback({ status: "warning", title: `Version ${published.version} published; board unchanged`,
        detail: migrationFeedback(error) });
    }
  }

  async function retryPending() {
    if (!pending) return;
    const activeScope = scopeKey;
    const action = pending;
    setPending(null);
    setFeedback(null);
    if (action.kind === "create") {
      try {
        const created = await props.client.createBoard(props.jurisdictionId, {
          templateKey: action.key, version: action.version, title: action.title,
        });
        if (scopeRef.current !== activeScope) return;
        boardCreated(created.id);
      } catch (error) {
        if (scopeRef.current !== activeScope) return;
        setPending(action);
        setFeedback({ status: "warning", title: `Version ${action.version} is published`,
          detail: `The board was not created. ${messageFor(error)}` });
      }
      return;
    }
    if (!props.boardId) return;
    try {
      await props.client.upgradeBoard(props.boardId, action.version);
      if (scopeRef.current !== activeScope) return;
      props.onOpenBoard(props.boardId);
    } catch (error) {
      if (scopeRef.current !== activeScope) return;
      setPending(action);
      setFeedback({ status: "warning", title: `Version ${action.version} is published; board unchanged`,
        detail: migrationFeedback(error) });
    }
  }

  return <Scroll>
    <SurfaceHeader title={base ? `Customize ${base.title}` : "Create board template"}
      actions={<ActionButton kind="secondary" onClick={() => {
        if (props.boardId) props.onOpenBoard(props.boardId);
        else setCreating(false);
      }}>{props.boardId ? "Return to board" : "Cancel"}</ActionButton>} />
    {feedback ? <div className={`board-template-feedback is-${feedback.status}`} role="status">
      <strong>{feedback.title}</strong><p>{feedback.detail}</p>
      {pending ? <ActionButton onClick={() => void retryPending()}>
        {pending.kind === "create" ? "Create board from published version" : `Retry applying version ${pending.version}`}
      </ActionButton> : null}
    </div> : null}
    {positions.error ? <ErrorNote message={`Position choices unavailable: ${positions.error}`} /> : null}
    <Designer key={identity} {...(base ? { base } : {})} positions={positions.data ?? []}
      client={props.client} jurisdictionId={props.jurisdictionId}
      {...(props.boardId ? { boardId: props.boardId } : {})}
      onSave={publish} saveLabel={base ? `Publish and apply version ${base.version + 1}` : "Publish and create board"} />
    {base ? <section className="board-template-versions" aria-label="Version history">
      <h2>Version history</h2>
      {versions.loading && !versions.data ? <Loading label="Loading versions…" /> : null}
      {versions.error ? <ErrorNote message={versions.error} /> : null}
      <ol>{(versions.data ?? []).map((version) => <li key={version.version}>
        <span>Version {version.version}</span>
        <span>{version.version === base.version ? "Applied to this board" : "Published"}</span>
      </li>)}</ol>
    </section> : null}
  </Scroll>;
}

function TemplateIndex(props: {
  client: ApiClient;
  jurisdictionId: string;
  boards: readonly BoardListItem[];
  onCreate: () => void;
  onDesign: (boardId: string) => void;
  onBoardCreated: (boardId: string) => void;
}) {
  const templates = useAsync(() => props.client.listTemplates(), [props.client]);
  const [templateKey, setTemplateKey] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = templates.data?.find((t) => t.key === templateKey) ?? templates.data?.[0];
  const createBoard = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const created = await props.client.createBoard(props.jurisdictionId, {
        templateKey: chosen.key, version: chosen.version, ...(title.trim() ? { title: title.trim() } : {}),
      });
      props.onBoardCreated(created.id);
    } catch (cause) {
      setError(`The board was not created. ${messageFor(cause)}`);
      setBusy(false);
    }
  };
  return <Scroll>
    <SurfaceHeader title="Templates" actions={<ActionButton kind="primary" onClick={props.onCreate}>
      Create template
    </ActionButton>} />
    <p className="board-template-intro">Published templates are immutable. Open a configured board to publish its next version.</p>
    <section className="board-template-versions" aria-label="Create a board from a published template" style={{ marginBottom: 14 }}>
      <h2>Create a board from a published template</h2>
      {templates.error ? <ErrorNote message={templates.error} /> : null}
      {!templates.data && !templates.error ? <Loading label="Loading published templates…" /> : null}
      {templates.data?.length === 0 ? <p>No template is published yet.</p> : null}
      {chosen ? <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
        <EnumSelect label="Published template" values={templates.data!.map((t) => t.key)} value={chosen.key}
          labels={Object.fromEntries(templates.data!.map((t) => [t.key, `${t.title} (version ${t.version})`]))}
          onChange={setTemplateKey} />
        <TextField label="Board title" value={title} onChange={setTitle} />
        <p className="d21-muted" style={{ margin: 0 }}>Left blank, the board takes the template's title, {chosen.title}.</p>
        <div><ActionButton onClick={() => void createBoard()}>Create board</ActionButton></div>
        {error ? <p role="alert">{error}</p> : null}
      </fieldset> : null}
    </section>
    {props.boards.length === 0 ? <EmptyState label="No configured boards."
      hint="Create a template to provision the first board." /> : <div className="board-template-list">
      {props.boards.map((board) => <article key={board.id}>
        <div><h2>{board.title}</h2><p>{board.templateKey} · version {board.templateVersion}</p></div>
        <ActionButton onClick={() => props.onDesign(board.id)}>Customize</ActionButton>
      </article>)}
    </div>}
  </Scroll>;
}

function migrationFeedback(error: unknown): string {
  const message = messageFor(error);
  const marker = "template upgrade incompatible with records: ";
  const start = message.indexOf(marker);
  if (start === -1) return `Migration was not applied. ${message}`;
  try {
    const parsed = JSON.parse(message.slice(start + marker.length)) as Array<{ id?: string; issues?: string[] }>;
    if (!Array.isArray(parsed) || parsed.length === 0) return "Migration was not applied because existing records are incompatible.";
    return `Migration was not applied. ${parsed.map((item) =>
      `Record ${item.id ?? "unknown"}: ${(item.issues ?? ["incompatible values"]).join("; ")}`).join(" ")}`;
  } catch {
    return "Migration was not applied because existing records are incompatible with the published version.";
  }
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "The server rejected the request.";
}
