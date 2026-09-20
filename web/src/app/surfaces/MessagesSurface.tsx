import { useState } from "react";
import { Button, EnumSelect, Panel, TextField } from "../../design/components.js";
import type { ApiClient, Message } from "../api/client.js";
import { useAsync, usePolled } from "../data/hooks.js";
import { EmptyState, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

/**
 * Native messaging (R6). Direct and position-addressed group threads that need
 * no external chat backend: a message to a seat reaches whoever currently holds
 * it. Threads and posting are offline-capable through the same API.
 */
export function MessagesSurface(props: { client: ApiClient; jurisdictionId: string }) {
  const [threadReload, setThreadReload] = useState(0);
  const [msgReload, setMsgReload] = useState(0);
  const threads = useAsync(
    () => props.client.listThreads(props.jurisdictionId),
    [props.jurisdictionId, threadReload],
  );
  const positions = useAsync(
    () => props.client.listPositions(props.jurisdictionId),
    [props.jurisdictionId],
  );
  const [selected, setSelected] = useState("");
  const [title, setTitle] = useState("");
  const [toPosition, setToPosition] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const threadList = threads.data ?? [];
  const posList = positions.data ?? [];
  const activeThread = selected || threadList[0]?.id || "";
  const activePosition = toPosition || posList[0]?.id || "";
  const messages = usePolled(
    () => (activeThread ? props.client.listMessages(activeThread) : Promise.resolve([] as Message[])),
    5000,
    [activeThread, msgReload],
  );

  const run = async (fn: () => Promise<unknown>) => {
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

  const create = () =>
    run(async () => {
      if (!activePosition) throw new Error("Pick a position to message.");
      const t = title.trim() || `To ${posList.find((p) => p.id === activePosition)?.title ?? "position"}`;
      const { id } = await props.client.createThread(props.jurisdictionId, {
        kind: "group",
        title: t,
        members: [{ kind: "position", id: activePosition }],
      });
      setTitle("");
      setSelected(id);
      setThreadReload((n) => n + 1);
    });

  const send = () =>
    run(async () => {
      if (!activeThread || !text.trim()) return;
      await props.client.postMessage(activeThread, text.trim());
      setText("");
      setMsgReload((n) => n + 1);
    });

  if (threads.loading && !threads.data) return <Loading label="Loading threads…" />;

  return (
    <Scroll>
      <SurfaceHeader title="Messages" />
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 16 }}>
          <Panel title="New thread">
            <div style={{ display: "grid", gap: 12 }}>
              <EnumSelect
                label="To position"
                values={posList.map((p) => p.id)}
                value={activePosition}
                onChange={setToPosition}
                labels={Object.fromEntries(posList.map((p) => [p.id, p.title]))}
              />
              <TextField label="Title" value={title} onChange={setTitle} />
              <Button kind="primary" onClick={create} disabled={busy || posList.length === 0}>
                Start thread
              </Button>
            </div>
          </Panel>
          <Panel title="Threads">
            {threadList.length === 0 ? (
              <p style={{ color: "var(--eoc-text-muted)", margin: 0 }}>No threads yet.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                {threadList.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(t.id)}
                      className="eoc-btn"
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        minHeight: 44,
                        borderRadius: 4,
                        cursor: "pointer",
                        border: "1px solid var(--eoc-border)",
                        background:
                          t.id === activeThread ? "var(--eoc-surface-raised)" : "var(--eoc-surface)",
                        color: "var(--eoc-text)",
                      }}
                    >
                      {t.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="Conversation">
          {!activeThread ? (
            <EmptyState label="No thread selected." hint="Start a thread or pick one on the left." />
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "grid",
                  gap: 8,
                  maxHeight: 420,
                  overflow: "auto",
                }}
              >
                {(messages.data ?? []).map((m) => (
                  <li key={m.id} style={{ borderBottom: "1px solid var(--eoc-border)", paddingBottom: 6 }}>
                    <div style={{ color: "var(--eoc-text-muted)", fontSize: "0.8em" }}>
                      {m.sender ?? "—"} · {new Date(m.at).toLocaleString()}
                    </div>
                    <div>{m.body}</div>
                  </li>
                ))}
                {(messages.data ?? []).length === 0 ? (
                  <li style={{ color: "var(--eoc-text-muted)" }}>No messages yet.</li>
                ) : null}
              </ul>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
                style={{ display: "flex", gap: 8, alignItems: "flex-end" }}
              >
                <div style={{ flex: 1 }}>
                  <TextField label="Message" value={text} onChange={setText} />
                </div>
                <Button type="submit" kind="primary" disabled={busy || !text.trim()}>
                  Send
                </Button>
              </form>
            </div>
          )}
        </Panel>
      </div>
      {error ? (
        <p role="alert" style={{ color: "var(--eoc-status-critical)", marginTop: 12 }}>
          {error}
        </p>
      ) : null}
    </Scroll>
  );
}
