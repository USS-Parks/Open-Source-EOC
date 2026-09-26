import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../design/components.js";
import type { ApiClient } from "../app/api/client.js";
import { formatTime } from "../datasets/format.js";
import { acknowledgedText, type MassNotificationDetail, type SheetEntry } from "./model.js";

/** A time of day typed on the sheet, as the latest such moment not after now. */
export function timeReached(hhmm: string, now = new Date()): string | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return undefined;
  const at = new Date(now);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (at.getTime() > now.getTime()) at.setDate(at.getDate() - 1);
  return at.toISOString();
}

interface Row { reached: boolean; time: string; answer: string }

/**
 * A send's call-down on paper (AG-05): when texts and email cannot go out or
 * cannot be answered, whoever runs the call-down prints the list, reaches
 * each person by voice or radio, and enters afterward who was reached, when,
 * and the answer each gave.
 */
export function CallDownSheet(props: {
  client: Pick<ApiClient, "recordMassAcknowledgements">;
  send: MassNotificationDetail;
  canEnter: boolean;
  onRecorded: () => void;
}) {
  const m = props.send;
  const options = m.responses.map((r) => r.option);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const row = (id: string): Row => rows[id] ?? { reached: false, time: "", answer: "" };
  const change = (id: string, part: Partial<Row>) => setRows((all) => ({ ...all, [id]: { ...row(id), ...part } }));

  const enter = async () => {
    setBusy(true); setError(null); setNotice("");
    try {
      const entries: SheetEntry[] = m.recipients.filter((r) => row(r.id).reached).map((r) => {
        const { time, answer } = row(r.id);
        if (time.trim() && !timeReached(time)) throw new Error(`Enter the time ${r.name} was reached as hours and minutes, such as 14:05.`);
        if (options.length && !answer) throw new Error(`Choose ${r.name}'s answer.`);
        const at = timeReached(time);
        return { recipientId: r.id, ...(at ? { at } : {}), ...(answer ? { response: answer } : {}) };
      });
      if (!entries.length) throw new Error("Tick each person you reached.");
      const { recorded } = await props.client.recordMassAcknowledgements(m.id, entries);
      setRows({});
      setNotice(`${recorded} acknowledgement${recorded === 1 ? "" : "s"} entered from the call-down sheet.`);
      props.onRecorded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The acknowledgements were not entered.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="eoc-stack" aria-labelledby={`sheet-${m.id}`}>
      <h3 id={`sheet-${m.id}`} className="contacts-sheet-title">Call-down sheet</h3>
      <p className="d21-muted contacts-flush">Print the list to reach each person by voice or radio when texts and email cannot go out or cannot be
        answered. Mark who you reached, when, and their answer, then enter them here.</p>
      <div className="d21-card-actions is-start">
        <Button kind="primary" onClick={() => window.print()}>Print call-down sheet</Button>
      </div>
      {createPortal(<PrintedSheet send={m} options={options} />, document.body)}
      {props.canEnter ? (
        <fieldset className="contacts-fieldset" disabled={busy}>
          <legend className="contacts-legend">Enter from the call-down sheet</legend>
          <ol className="contacts-sheet-rows">
            {m.recipients.map((r) => (
              <li key={r.id} className="contacts-sheet-row">
                <label className="contacts-check">
                  <input type="checkbox" checked={row(r.id).reached} onChange={(e) => change(r.id, { reached: e.target.checked })} />
                  Reached {r.name}
                </label>
                <span className="d21-muted">{r.phone ?? "No phone"}{r.acknowledgedAt ? ` · ${acknowledgedText(r)} ${formatTime(r.acknowledgedAt)}` : ""}</span>
                <label className="contacts-field">Time {r.name} was reached
                  <input type="time" value={row(r.id).time} onChange={(e) => change(r.id, { time: e.target.value })} />
                </label>
                {options.length ? (
                  <label className="contacts-field">Answer from {r.name}
                    <select value={row(r.id).answer} onChange={(e) => change(r.id, { answer: e.target.value })}>
                      <option value="">Choose an answer</option>
                      {options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                ) : null}
              </li>
            ))}
          </ol>
          {error ? <p className="d21-error" role="alert">{error}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
          <div className="d21-toolbar">
            <span className="d21-muted">A time left empty is taken as now. The first acknowledgement's time stands; a later entry can change an answer.</span>
            <Button kind="primary" onClick={() => void enter()}>Enter acknowledgements</Button>
          </div>
        </fieldset>
      ) : null}
    </section>
  );
}

/** The paper itself: printed alone, with blank columns to fill by hand. */
function PrintedSheet(props: { send: MassNotificationDetail; options: readonly string[] }) {
  const m = props.send;
  return (
    <div className="contacts-sheet-print" aria-hidden="true">
      <h1>Call-down sheet: {m.subject}</h1>
      <p>Sent {formatTime(m.createdAt)} by {m.sentBy} · {m.audience}</p>
      <p><strong>Message:</strong> {m.message}</p>
      <p>{props.options.length
        ? `Ask for an answer: ${props.options.map((o, i) => `${i + 1} ${o}`).join(", ")}.`
        : "Ask each person to confirm they received the message."}</p>
      <table>
        <thead>
          <tr><th>#</th><th>Name</th><th>Phone</th><th>Already acknowledged</th><th>Reached at</th><th>Answer</th><th>Called by</th></tr>
        </thead>
        <tbody>
          {m.recipients.map((r) => (
            <tr key={r.id}>
              <td>{r.priority}</td>
              <td>{r.name}</td>
              <td>{r.phone ?? "No phone"}</td>
              <td>{r.acknowledgedAt ? acknowledgedText(r) : ""}</td>
              <td />
              <td>{props.options.map((o, i) => `☐ ${i + 1} ${o}`).join("  ")}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      <p>Enter who was reached on the Mass Notification screen: open this send's receipts, then Enter from the call-down sheet.</p>
    </div>
  );
}
