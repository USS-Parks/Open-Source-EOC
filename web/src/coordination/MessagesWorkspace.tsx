import { useEffect, useMemo, useState } from "react";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import type { ApiClient, Thread, ThreadRecipient } from "../app/api/client.js";
import { useAsync, usePolled } from "../app/data/hooks.js";
import { EmptyState, Loading, SurfaceHeader } from "../app/screens/parts.js";
import { saveFile } from "../admin/labels.js";
import "./workspace.css";

export interface MessagesWorkspaceProps {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly incidentId?: string | null;
  readonly incidentName?: string | null;
  /** Jurisdiction administrators also set message retention and incident-record inclusion. */
  readonly isAdmin?: boolean;
}

function recipientDescription(recipient: ThreadRecipient): string {
  if (recipient.kind === "person") return recipient.label;
  const holders = recipient.currentHolders.length > 0
    ? `current: ${recipient.currentHolders.join(", ")}`
    : "currently unassigned";
  return `${recipient.label} (${holders})`;
}

function recipientSummary(thread: Thread): string {
  return thread.recipients.map(recipientDescription).join("; ") || "Recipient context unavailable";
}

export function MessagesWorkspace(props: MessagesWorkspaceProps) {
  const [scope, setScope] = useState(props.incidentId ? "incident" : "all");
  const [selected, setSelected] = useState<string | null>(null);
  const [toPosition, setToPosition] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadThreads, setReloadThreads] = useState(0);
  const [reloadMessages, setReloadMessages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState("");
  const [inIncidentRecord, setInIncidentRecord] = useState(true);
  const [settingsSaved, setSettingsSaved] = useState<string | null>(null);

  const threads = useAsync(
    () => props.client.listThreads(props.jurisdictionId),
    [props.client, props.jurisdictionId, reloadThreads],
  );
  const positions = useAsync(
    () => props.client.listPositions(props.jurisdictionId),
    [props.client, props.jurisdictionId],
  );
  const visibleThreads = useMemo(
    () => (threads.data ?? []).filter((thread) =>
      scope === "all" || (props.incidentId !== null && props.incidentId !== undefined
        && thread.incidentId === props.incidentId)),
    [props.incidentId, scope, threads.data],
  );
  const activeThread = visibleThreads.some((thread) => thread.id === selected)
    ? selected
    : visibleThreads[0]?.id ?? null;
  const activeSummary = visibleThreads.find((thread) => thread.id === activeThread) ?? null;
  const messages = usePolled(
    () => activeThread ? props.client.listMessages(activeThread) : Promise.resolve([]),
    5000,
    [props.client, activeThread, reloadMessages],
  );

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

  const createThread = () => void run(async () => {
    if (!toPosition) throw new Error("Choose a recipient position.");
    const position = (positions.data ?? []).find((candidate) => candidate.id === toPosition);
    const result = await props.client.createThread(props.jurisdictionId, {
      kind: "group",
      title: title.trim() || `To ${position?.title ?? "position"}`,
      ...(scope === "incident" && props.incidentId ? { incidentId: props.incidentId } : {}),
      members: [{ kind: "position", id: toPosition }],
    });
    setTitle("");
    setSelected(result.id);
    setReloadThreads((value) => value + 1);
  });

  const send = () => void run(async () => {
    if (!activeThread || !text.trim()) return;
    await props.client.postMessage(activeThread, text.trim());
    setText("");
    setStored("Message stored in the thread.");
    setReloadMessages((value) => value + 1);
  });

  const exportThread = () => void run(async () => {
    if (!activeSummary) return;
    const lines = await props.client.exportThread(activeSummary.id);
    const name = (activeSummary.title || "thread").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "thread";
    saveFile(new Blob([lines.map((line) => `${line}\n`).join("")], { type: "text/plain" }), `${name}.txt`);
    setStored(`Thread exported with ${lines.length} ${lines.length === 1 ? "message" : "messages"}.`);
  });

  const saveSettings = () => void run(async () => {
    setSettingsSaved(null);
    const days = retentionDays.trim() === "" ? null : Number(retentionDays.trim());
    if (days !== null && !(Number.isInteger(days) && days >= 1)) throw new Error("Enter retention as whole days, or leave it empty to keep messages.");
    await props.client.setMessagingSettings(props.jurisdictionId, { retentionDays: days, inIncidentRecord });
    setSettingsSaved("Message settings saved.");
  });

  const positionOptions = positions.data ?? [];
  const selectedPosition = positionOptions.some((position) => position.id === toPosition)
    ? toPosition
    : positionOptions[0]?.id ?? "";
  useEffect(() => {
    if (selectedPosition !== toPosition && selectedPosition) setToPosition(selectedPosition);
  }, [selectedPosition, toPosition]);

  if (threads.loading && !threads.data) return <Loading label="Loading message threads..." />;

  return (
    <div className="d27-workspace d27-messages">
      <div className="d27-messages-header">
        <SurfaceHeader
          title="Messages"
          actions={props.incidentId ? (
            <EnumSelect
              label="Thread scope"
              values={["incident", "all"]}
              value={scope}
              onChange={setScope}
              labels={{ incident: props.incidentName ? `${props.incidentName} threads` : "Selected incident", all: "All threads" }}
            />
          ) : undefined}
        />
      </div>
      <p className="d27-boundary">
        Messages are stored in the operational thread. Delivery, read, and acknowledgement receipts are not available in this messaging service.
      </p>
      <div className="d27-message-grid">
        <div className="d27-stack">
          <Panel title="New thread">
            <div className="d27-form-stack">
              <EnumSelect
                label="Recipient position"
                values={positionOptions.map((position) => position.id)}
                value={selectedPosition}
                onChange={setToPosition}
                labels={Object.fromEntries(positionOptions.map((position) => [position.id, position.title]))}
                selectProps={{ disabled: busy || positionOptions.length === 0 }}
              />
              <TextField label="Thread title" value={title} onChange={setTitle} />
              <Button kind="primary" onClick={createThread} disabled={busy || !selectedPosition}>
                Start thread
              </Button>
            </div>
          </Panel>
          <Panel title={scope === "incident" ? "Incident threads" : "Threads"}>
            {visibleThreads.length === 0 ? (
              <EmptyState
                label={scope === "incident" ? "No threads for this incident." : "No threads yet."}
                hint="Start a thread with an authorized jurisdiction position."
              />
            ) : (
              <ul className="d27-thread-list">
                {visibleThreads.map((thread) => (
                  <li key={thread.id}>
                    <button
                      type="button"
                      className="d27-thread"
                      aria-current={thread.id === activeThread ? "true" : undefined}
                      onClick={() => {
                        setSelected(thread.id);
                        setStored(null);
                      }}
                    >
                      <span>{thread.title || "Untitled thread"}</span>
                      <small>{recipientSummary(thread)}</small>
                      <small>{thread.incidentId ? "Incident thread" : "Jurisdiction thread"}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {props.isAdmin ? (
            <Panel title="Message settings">
              <div className="d27-form-stack">
                <p className="d27-muted">Saving sets both values for the jurisdiction; the values in effect are not shown here. Messages older than the retention period are no longer shown or exported.</p>
                <TextField label="Message retention in days (empty keeps all)" value={retentionDays} onChange={setRetentionDays} />
                <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 32 }}>
                  <input type="checkbox" checked={inIncidentRecord} onChange={(event) => setInIncidentRecord(event.target.checked)} />
                  Record incident thread messages in the incident audit trail
                </label>
                <Button onClick={saveSettings} disabled={busy}>Save message settings</Button>
                {settingsSaved ? <p role="status" className="d27-success">{settingsSaved}</p> : null}
              </div>
            </Panel>
          ) : null}
        </div>
        <Panel title="Conversation">
          {!activeSummary ? (
            <EmptyState label="No thread selected." hint="Start a thread or choose one from the list." />
          ) : (
            <div className="d27-conversation">
              <div className="d27-recipient-context">
                <span>Recipients</span>
                <strong>{recipientSummary(activeSummary)}</strong>
                <StatusBadge status={activeSummary.incidentId ? "info" : "unknown"}>
                  {activeSummary.incidentId ? "Incident context" : "Jurisdiction context"}
                </StatusBadge>
                <Button onClick={exportThread} disabled={busy}>Export thread</Button>
              </div>
              {messages.loading && !messages.data ? <Loading label="Loading messages..." /> : null}
              {messages.error ? <p role="alert" className="d27-error">{messages.error}</p> : null}
              <ol className="d27-message-list" aria-label="Stored messages">
                {(messages.data ?? []).map((message) => (
                  <li key={message.id}>
                    <div>
                      <strong>{message.sender ?? "Unknown sender"}</strong>
                      {message.senderPosition ? <span> - {message.senderPosition}</span> : null}
                      <time dateTime={message.at}> - {new Date(message.at).toLocaleString()}</time>
                    </div>
                    <p>{message.body}</p>
                    <small>Stored</small>
                  </li>
                ))}
              </ol>
              {(messages.data ?? []).length === 0 && !messages.loading
                ? <p className="d27-muted">No messages in this thread.</p>
                : null}
              <form className="d27-compose" onSubmit={(event) => { event.preventDefault(); send(); }}>
                <TextField label="Message" value={text} onChange={setText} />
                <Button type="submit" kind="primary" disabled={busy || !text.trim()}>Send</Button>
              </form>
              {stored ? <p role="status" className="d27-success">{stored}</p> : null}
            </div>
          )}
        </Panel>
      </div>
      {error || threads.error || positions.error ? (
        <p role="alert" className="d27-error">{error ?? threads.error ?? positions.error}</p>
      ) : null}
    </div>
  );
}
