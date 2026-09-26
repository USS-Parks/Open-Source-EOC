import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import { Icon } from "../design/icons/index.js";
import "../datasets/datasets.css";
import "./contacts.css";
import type { ApiClient } from "../app/api/client.js";
import { usePolled } from "../app/data/hooks.js";
import { ErrorNote, Loading, Scroll, SurfaceHeader } from "../app/screens/parts.js";
import { formatTime } from "../datasets/format.js";
import { AudiencePicker, DEFAULT_DELIVERY, DeliveryChoice, NO_AUDIENCE, deliveryOf, type AudienceParts } from "./Audience.js";
import { CallDownSheet } from "./CallDownSheet.js";
import {
  CHANNEL_LABELS,
  DELIVERY_LABELS,
  acknowledgedText,
  answersOf,
  audienceOf,
  deliveryDetail,
  stateLabel,
  stateStatus,
  type MassChannel,
  type MassNotificationDetail,
  type MassNotificationSummary,
  type MassRecipient,
} from "./model.js";

const MODES = ["broadcast", "calldown"] as const;
const MODE_LABELS = { broadcast: "Everyone at once", calldown: "Call-down, one contact at a time" };
/** How often an open receipt view refreshes itself. */
const RECEIPT_REFRESH_MS = 10_000;

/**
 * Mass notification: send one message to contact groups, chosen contacts,
 * the holders of positions and whoever is on call, by email, SMS and in-app
 * notice, to everyone at once or as a call-down, and follow each contact's
 * delivery receipts and acknowledgement. A broadcast may fall back from one
 * device to the next when a contact does not acknowledge. Members and
 * administrators send; viewers follow the sends.
 */
export function MassNotificationSurface(props: { client: ApiClient; jurisdictionId: string; canSend: boolean }) {
  const { client, jurisdictionId } = props;
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const [selected, setSelected] = useState<string | null>(null);
  // While a send's receipts are open the list refreshes with them, so both agree.
  const sends = usePolled(() => client.listMassNotifications(jurisdictionId), selected ? RECEIPT_REFRESH_MS : null, [jurisdictionId, nonce]);
  const [more, setMore] = useState<{ items: MassNotificationSummary[]; nextCursor: string | null } | null>(null);
  useEffect(() => setMore(null), [sends.data]);
  const list = [...(sends.data?.massNotifications ?? []), ...(more?.items ?? [])];
  const nextCursor = more ? more.nextCursor : (sends.data?.nextCursor ?? null);

  return (
    <Scroll>
      <SurfaceHeader title="Mass Notification" actions={<Button onClick={refresh}>Refresh</Button>} />
      <div className="d21-workspace">
        <div className="d21-workspace-intro">
          <Icon name="alerts" size={32} decorative />
          <div>
            <strong>Reach contacts and track who acknowledged</strong>
            <span>A broadcast notifies everyone at once, and can try each contact's next device when they do not acknowledge. A call-down notifies one contact at a time in order and moves to the next when the current one has not acknowledged in time. Positions reach whoever holds them now; on call reaches whoever is on shift. Email and SMS carry a link the recipient opens to acknowledge; through an SMS gateway on the site network a text reply answers too. Each send's receipts print a call-down sheet for voice or radio.</span>
          </div>
        </div>
        {props.canSend ? (
          <Compose client={client} jurisdictionId={jurisdictionId}
            onSent={(id) => { setSelected(id); refresh(); }} />
        ) : null}
        {selected ? (
          <Receipts client={client} id={selected} nonce={nonce} canEnter={props.canSend}
            onRefresh={refresh} onClose={() => setSelected(null)} />
        ) : null}
        <Panel title="Sends">
          {sends.error && !sends.data ? <ErrorNote message={sends.error} /> : null}
          {!sends.data && !sends.error ? <Loading label="Loading sends…" /> : null}
          {sends.data && list.length === 0 ? <p className="d21-muted">Nothing sent yet.</p> : null}
          <ul className="d21-readiness-list is-single">
            {list.map((m) => (
              <li key={m.id} className="d21-readiness-row" aria-label={`Send ${m.subject}`}>
                <div className="d21-readiness-title">
                  <div>
                    <strong>{m.subject}</strong>
                    <span>{m.sentBy} · {formatTime(m.createdAt)} · {m.audience} · {m.channels.map((c) => CHANNEL_LABELS[c]).join(", ")}</span>
                  </div>
                </div>
                <span className="d21-readiness-badge"><StatusBadge status={stateStatus(m.state)}>{stateLabel(m)}</StatusBadge></span>
                <div className="d21-card-actions is-start">
                  <Button onClick={() => setSelected(m.id)}>Show receipts</Button>
                </div>
              </li>
            ))}
          </ul>
          {nextCursor ? (
            <div className="d21-toolbar">
              <Button onClick={() => void client.listMassNotifications(jurisdictionId, { cursor: nextCursor })
                .then((page) => setMore({ items: [...(more?.items ?? []), ...page.massNotifications], nextCursor: page.nextCursor }))
                .catch(() => undefined)}>Load more sends</Button>
            </div>
          ) : null}
        </Panel>
      </div>
    </Scroll>
  );
}

function Compose(props: { client: ApiClient; jurisdictionId: string; onSent: (id: string) => void }) {
  const { client, jurisdictionId } = props;
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [answers, setAnswers] = useState("");
  const [audience, setAudience] = useState<AudienceParts>(NO_AUDIENCE);
  const [delivery, setDelivery] = useState(DEFAULT_DELIVERY);
  const [mode, setMode] = useState<string>("broadcast");
  const [waitMinutes, setWaitMinutes] = useState("10");
  const [needed, setNeeded] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const send = async () => {
    setBusy(true); setError(null); setNotice("");
    try {
      if (!subject.trim() || !message.trim()) throw new Error("Enter a subject and a message.");
      const to = audienceOf(audience);
      if (!to) throw new Error("Choose whom to notify: a contact group, contacts, a position or who is on call.");
      const how = deliveryOf(delivery, mode === "broadcast");
      const responseOptions = answersOf(answers);
      const minutes = Number(waitMinutes);
      const acknowledgements = Number(needed);
      if (mode === "calldown" && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440))
        throw new Error("Enter the minutes to wait for each acknowledgement, from 1 to 1440.");
      if (mode === "calldown" && !(Number.isInteger(acknowledgements) && acknowledgements >= 1))
        throw new Error("Enter how many acknowledgements end the call-down.");
      const sent = await client.sendMassNotification(jurisdictionId, {
        subject: subject.trim(),
        message: message.trim(),
        ...to,
        ...how,
        ...(responseOptions.length ? { responseOptions } : {}),
        mode: mode as "broadcast" | "calldown",
        ...(mode === "calldown" ? { intervalMinutes: minutes, acknowledgementsNeeded: acknowledgements } : {}),
      });
      setNotice(`${subject.trim()} sent.`);
      setSubject(""); setMessage(""); setAnswers(""); setAudience(NO_AUDIENCE);
      props.onSent(sent.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The notification was not sent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Compose">
      <fieldset disabled={busy} className="d21-form-grid">
        <div className="d21-form-grid-wide"><TextField label="Subject" value={subject} onChange={setSubject} required /></div>
        <label className="contacts-field d21-form-grid-wide">Message<textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
        <label className="contacts-field d21-form-grid-wide">Answers to ask for (optional), one per line, up to six
          <textarea rows={3} value={answers} onChange={(e) => setAnswers(e.target.value)}
            placeholder={"Available\nNot available"} />
        </label>
        <AudiencePicker client={client} jurisdictionId={jurisdictionId} value={audience} onChange={setAudience} contacts />
        <EnumSelect label="Mode" values={MODES} labels={MODE_LABELS} value={mode} onChange={setMode} />
        <DeliveryChoice value={delivery} onChange={setDelivery} allowFallback={mode === "broadcast"} />
        {mode === "calldown" ? (
          <>
            <TextField label="Minutes to wait for each acknowledgement" value={waitMinutes} onChange={setWaitMinutes} />
            <TextField label="Acknowledgements that end the call-down" value={needed} onChange={setNeeded} />
          </>
        ) : null}
      </fieldset>
      {error ? <p className="d21-error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="d21-toolbar">
        <span className="d21-muted">In-app notices reach contacts linked to an account or position. A contact without an address for a channel is skipped on that channel, and a position holder with no contact card is reached in the app only.</span>
        <Button kind="primary" disabled={busy} onClick={() => void send()}>Send notification</Button>
      </div>
    </Panel>
  );
}

function modeText(m: MassNotificationDetail): string {
  if (m.mode === "calldown") return `Call-down, ${m.intervalMinutes} min per contact`;
  return m.fallbackMinutes
    ? `Everyone at once; the next device after ${m.fallbackMinutes} min without an acknowledgement`
    : "Everyone at once";
}

/**
 * Why a channel has no delivery for a recipient: no address for it, or, with
 * a fallback, an acknowledgement that came first and withdrew it unsent.
 */
function notSent(m: MassNotificationDetail, r: MassRecipient, channel: MassChannel): string {
  if (channel === "inapp") return "No linked account or position";
  const address = channel === "email" ? r.email : r.phone;
  if (m.fallbackMinutes && r.acknowledgedAt && address) return "Not needed: acknowledged before the fallback";
  return `No ${CHANNEL_LABELS[channel].toLowerCase()} address`;
}

/** One send's receipts. A refresh here also refreshes the list of sends, so both agree. */
function Receipts(props: { client: ApiClient; id: string; nonce: number; canEnter: boolean; onRefresh: () => void; onClose: () => void }) {
  const { onRefresh } = props;
  const detail = usePolled(() => props.client.getMassNotification(props.id), RECEIPT_REFRESH_MS, [props.id, props.nonce]);
  // A refresh keeps the receipts on screen, and what is typed into the call-down sheet, until the new ones arrive.
  const shown = useRef<MassNotificationDetail | null>(null);
  if (detail.data) shown.current = detail.data;
  const m = detail.data ?? (!detail.error && shown.current?.id === props.id ? shown.current : null);
  return (
    <Panel title={m ? `Receipts: ${m.subject}` : "Receipts"}>
      {detail.error && !m ? <ErrorNote message={detail.error} /> : null}
      {!m && !detail.error ? <Loading label="Loading receipts…" /> : null}
      {m ? (
        <div className="eoc-stack">
          <div className="d21-card-actions is-start">
            <StatusBadge status={stateStatus(m.state)}>{stateLabel(m)}</StatusBadge>
          </div>
          <dl className="d21-metrics">
            <div><dt>Mode</dt><dd>{modeText(m)}</dd></div>
            <div><dt>Sent</dt><dd>{m.sentBy} · {formatTime(m.createdAt)}</dd></div>
            <div><dt>To</dt><dd>{m.audience}</dd></div>
          </dl>
          <p className="contacts-message">{m.message}</p>
          {m.responses.length ? (
            <dl className="d21-metrics" aria-label="Answers">
              {m.responses.map((r) => <div key={r.option}><dt>{r.option}</dt><dd>{r.count}</dd></div>)}
              <div><dt>No answer yet</dt><dd>{m.contactCount - m.responses.reduce((sum, r) => sum + r.count, 0)}</dd></div>
            </dl>
          ) : null}
          <ol className="contacts-receipts">
            {m.recipients.map((r) => (
              <li key={r.id} className="d21-card" aria-label={`Receipt for ${r.name}`}>
                <div className="d21-card-header">
                  <div>
                    <strong>{r.priority}. {r.name}</strong>
                    {r.reachedThrough ? <span>{r.reachedThrough}</span> : null}
                    <span>{r.notifiedAt ? `Notified ${formatTime(r.notifiedAt)}` : "Not called"}</span>
                  </div>
                  {r.acknowledgedAt ? (
                    <StatusBadge status="success">{acknowledgedText(r)} {formatTime(r.acknowledgedAt)}</StatusBadge>
                  ) : r.notifiedAt ? <StatusBadge status="warning">Not acknowledged</StatusBadge> : null}
                </div>
                {r.notifiedAt ? (
                  <ul className="contacts-deliveries">
                    {m.channels.map((channel) => {
                      const d = r.deliveries.find((x) => x.channel === channel);
                      return (
                        <li key={channel}>
                          <strong>{CHANNEL_LABELS[channel]}</strong>
                          {d ? <>
                            <span>{d.address ?? ""}</span>
                            <StatusBadge status={d.state === "failed" || d.state === "expired" ? "critical" : d.state === "retrying" ? "warning" : d.state === "queued" || d.state === "scheduled" ? "unknown" : "success"}>{DELIVERY_LABELS[d.state]}</StatusBadge>
                            <span className="d21-muted">{d.state === "scheduled" && d.dueAt ? `Goes at ${formatTime(d.dueAt)}` : deliveryDetail(d)}</span>
                          </> : <span className="d21-muted">{notSent(m, r, channel)}</span>}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {r.replies.length ? (
                  <ul className="contacts-replies" aria-label={`Text replies from ${r.name}`}>
                    {r.replies.map((reply) => (
                      <li key={reply.receivedAt + reply.body}>
                        Text reply {formatTime(reply.receivedAt)}: “{reply.body}”{reply.outcome === "not_an_answer" ? " (not one of the answers)" : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
          <CallDownSheet client={props.client} send={m} canEnter={props.canEnter} onRecorded={onRefresh} />
        </div>
      ) : null}
      <div className="d21-toolbar">
        <span className="d21-muted">Receipts refresh every few seconds while open.</span>
        <div className="d21-card-actions">
          <Button onClick={onRefresh}>Refresh receipts</Button>
          <Button onClick={props.onClose}>Close receipts</Button>
        </div>
      </div>
    </Panel>
  );
}
