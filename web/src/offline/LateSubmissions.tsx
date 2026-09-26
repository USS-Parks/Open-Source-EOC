import { useState } from "react";
import type { ApiClient, LateSubmission } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";
import { formatTime } from "../datasets/format.js";
import { Button, StatusBadge, TextField, type Status } from "../design/components.js";
import "./late-submissions.css";

const KIND: Readonly<Record<LateSubmission["kind"], string>> = {
  board: "Board records",
  message: "Message",
  task: "New task",
  task_completion: "Task completion",
};

const STATUS: Readonly<Record<LateSubmission["status"], { label: string; tone: Status }>> = {
  pending: { label: "Awaiting a decision", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
  refused: { label: "Refused", tone: "unknown" },
};

/** A captured value as words: a point as its coordinates, anything structured as short text. */
function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value !== "object") return String(value);
  const point = value as { type?: unknown; coordinates?: unknown };
  if (point.type === "Point" && Array.isArray(point.coordinates)) {
    const [longitude, latitude] = point.coordinates as number[];
    return `Point at latitude ${latitude}, longitude ${longitude}`;
  }
  const text = JSON.stringify(value);
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

function Detail(props: { item: LateSubmission }) {
  const { detail } = props.item;
  if (props.item.kind === "board") return <>
    {(detail.records ?? []).map((record) => <dl key={record.id} className="eoc-late-fields">
      {record.fields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{valueText(field.value)}</dd></div>)}
    </dl>)}
  </>;
  if (props.item.kind === "message") return <blockquote className="eoc-late-body">{detail.body}</blockquote>;
  if (props.item.kind === "task") return <dl className="eoc-late-fields">
    <div><dt>Task</dt><dd>{detail.item}</dd></div>
    <div><dt>Category</dt><dd>{detail.category}</dd></div>
    <div><dt>Due</dt><dd>{detail.dueAt ? formatTime(detail.dueAt) : "No due date"}</dd></div>
  </dl>;
  return <p className="eoc-late-note">TASK-{detail.number} {detail.item} marked complete.</p>;
}

/**
 * Work that reached an incident after it closed (AG-07), for the owner's
 * administrators to accept or refuse; a sender sees their own and its fate.
 * Accepting applies the work as its sender, so it waits for the incident to
 * be reopened; refusing keeps it, with the reason.
 */
export function LateSubmissions(props: {
  readonly client: Pick<ApiClient, "listLateSubmissions" | "acceptLateSubmission" | "refuseLateSubmission">;
  readonly incidentId: string;
  readonly canDecide: boolean;
  readonly closed: boolean;
}) {
  const [reload, setReload] = useState(0);
  const list = useAsync(() => props.client.listLateSubmissions(props.incidentId), [props.client, props.incidentId, reload]);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (work: () => Promise<string>) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      setNotice(await work());
      setRefusing(null); setReason("");
      setReload((value) => value + 1);
    } catch (reasonForError) {
      setError(reasonForError instanceof Error ? reasonForError.message : String(reasonForError));
    } finally {
      setBusy(false);
    }
  };

  const items = list.data ?? [];
  return <section aria-label="Late submissions" className="eoc-late">
    <h3 className="incidents-first">Late submissions</h3>
    <p className="eoc-late-note">Work queued on a device reaches the incident after it closed. It is not applied and not
      dropped: an administrator accepts it, which applies it as its sender once the incident is reopened, or refuses it
      with a reason.</p>
    {list.loading && !list.data ? <Loading label="Loading late submissions…" /> : null}
    {list.error && !list.data ? <ErrorNote message={list.error} /> : null}
    {list.data && items.length === 0 ? <p className="eoc-late-note">No work has reached this incident after it closed.</p> : null}
    {items.length ? <ul className="eoc-late-list">
      {items.map((item) => {
        const status = STATUS[item.status];
        const sender = `${item.submittedBy.displayName}${item.submittedBy.positionTitle ? `, ${item.submittedBy.positionTitle}` : ""}`;
        return <li key={item.id} aria-label={item.summary} className={item.status === "pending" ? "is-pending" : undefined}>
          <div className="eoc-late-head">
            <StatusBadge status={status.tone}>{status.label}</StatusBadge>
            <strong>{item.summary}</strong>
            <span>{KIND[item.kind]}</span>
          </div>
          <p className="eoc-late-note">Sent by {sender}. {item.capturedAt ? `Queued on the device ${formatTime(item.capturedAt)}; ` : ""}received {formatTime(item.receivedAt)}.</p>
          <Detail item={item} />
          {item.decidedBy && item.decidedAt ? <p className="eoc-late-note">
            {item.status === "accepted" ? "Accepted" : "Refused"} by {item.decidedBy.displayName} {formatTime(item.decidedAt)}{item.reason ? `: ${item.reason}` : "."}
          </p> : null}
          {props.canDecide && item.status === "pending" ? <div className="eoc-late-actions">
            <Button kind="primary" label={`Accept ${item.summary}`} disabled={busy || props.closed}
              onClick={() => void decide(async () => {
                const { conflicts } = await props.client.acceptLateSubmission(item.id);
                return conflicts
                  ? `Accepted ${item.summary}; ${conflicts} ${conflicts === 1 ? "record conflicts" : "records conflict"} with the board and ${conflicts === 1 ? "is" : "are"} kept for review.`
                  : `Accepted ${item.summary}.`;
              })}>Accept</Button>
            <Button label={`Refuse ${item.summary}`} disabled={busy} onClick={() => { setRefusing(item.id); setReason(""); }}>Refuse</Button>
            {props.closed ? <span className="eoc-late-note">Reopen the incident to accept: a closed incident takes no writes.</span> : null}
          </div> : null}
          {refusing === item.id ? <div className="eoc-late-refuse">
            <TextField label="Reason for refusing" value={reason} onChange={setReason} />
            <div className="eoc-late-actions">
              <Button kind="danger" disabled={busy || !reason.trim()} onClick={() => void decide(async () => {
                await props.client.refuseLateSubmission(item.id, reason.trim());
                return `Refused ${item.summary}.`;
              })}>Confirm refusal</Button>
              <Button disabled={busy} onClick={() => setRefusing(null)}>Keep it waiting</Button>
            </div>
          </div> : null}
        </li>;
      })}
    </ul> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert" className="eoc-text-critical">{error}</p> : null}
  </section>;
}
