import { useCallback, useEffect, useState } from "react";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import { Icon } from "../design/icons/index.js";
import "../datasets/datasets.css";
import "./contacts.css";
import { readAllPages, type ApiClient } from "../app/api/client.js";
import { useAsync, usePolled } from "../app/data/hooks.js";
import { ErrorNote, Loading, Scroll, SurfaceHeader } from "../app/screens/parts.js";
import { formatTime } from "../datasets/format.js";
import {
  CHANNEL_LABELS,
  DELIVERY_LABELS,
  deliveryDetail,
  stateLabel,
  stateStatus,
  type MassChannel,
  type MassNotificationSummary,
} from "./model.js";

const CHANNELS: readonly MassChannel[] = ["email", "sms", "inapp"];
const MODES = ["broadcast", "calldown"] as const;
const MODE_LABELS = { broadcast: "Everyone at once", calldown: "Call-down, one contact at a time" };
const TARGETS = ["group", "contacts"] as const;
const TARGET_LABELS = { group: "A contact group", contacts: "Chosen contacts" };
/** How often an open receipt view refreshes itself. */
const RECEIPT_REFRESH_MS = 10_000;

/**
 * Mass notification: send one message to a contact group or chosen contacts
 * by email, SMS and in-app notice, to everyone at once or as a call-down, and
 * follow each contact's delivery receipts and acknowledgement. Members and
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
            <span>A broadcast notifies everyone at once. A call-down notifies one contact at a time in group order and moves to the next when the current one has not acknowledged in time. Email and SMS carry a link the recipient opens to acknowledge.</span>
          </div>
        </div>
        {props.canSend ? (
          <Compose client={client} jurisdictionId={jurisdictionId}
            onSent={(id) => { setSelected(id); refresh(); }} />
        ) : null}
        {selected ? (
          <Receipts client={client} id={selected} nonce={nonce}
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
                    <span>{m.sentBy} · {formatTime(m.createdAt)} · {m.groupName ?? "Chosen contacts"} · {m.channels.map((c) => CHANNEL_LABELS[c]).join(", ")}</span>
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
  const groups = useAsync(
    () => readAllPages((page) => client.listContactGroups(jurisdictionId, page).then((r) => ({ items: r.groups, nextCursor: r.nextCursor }))),
    [jurisdictionId],
  );
  const contacts = useAsync(
    () => readAllPages((page) => client.listContacts(jurisdictionId, "", page).then((r) => ({ items: r.contacts, nextCursor: r.nextCursor }))),
    [jurisdictionId],
  );
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<string>("group");
  const [groupId, setGroupId] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [channels, setChannels] = useState<Set<MassChannel>>(new Set(["email", "sms"]));
  const [mode, setMode] = useState<string>("broadcast");
  const [waitMinutes, setWaitMinutes] = useState("10");
  const [needed, setNeeded] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const groupList = groups.data ?? [];
  const group = groupList.some((g) => g.id === groupId) ? groupId : (groupList[0]?.id ?? "");
  const active = (contacts.data ?? []).filter((c) => c.active);

  const send = async () => {
    setBusy(true); setError(null); setNotice("");
    try {
      if (!subject.trim() || !message.trim()) throw new Error("Enter a subject and a message.");
      if (channels.size === 0) throw new Error("Choose at least one channel.");
      if (target === "group" && !group) throw new Error("Choose a contact group, or add one under Contacts.");
      if (target === "contacts" && chosen.length === 0) throw new Error("Choose at least one contact.");
      const minutes = Number(waitMinutes);
      const acknowledgements = Number(needed);
      if (mode === "calldown" && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440))
        throw new Error("Enter the minutes to wait for each acknowledgement, from 1 to 1440.");
      if (mode === "calldown" && !(Number.isInteger(acknowledgements) && acknowledgements >= 1))
        throw new Error("Enter how many acknowledgements end the call-down.");
      const sent = await client.sendMassNotification(jurisdictionId, {
        subject: subject.trim(),
        message: message.trim(),
        ...(target === "group" ? { groupId: group } : { contactIds: chosen }),
        channels: CHANNELS.filter((c) => channels.has(c)),
        mode: mode as "broadcast" | "calldown",
        ...(mode === "calldown" ? { intervalMinutes: minutes, acknowledgementsNeeded: acknowledgements } : {}),
      });
      setNotice(`${subject.trim()} sent.`);
      setSubject(""); setMessage(""); setChosen([]);
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
        <EnumSelect label="Send to" values={TARGETS} labels={TARGET_LABELS} value={target} onChange={setTarget} />
        {target === "group" ? (
          <EnumSelect label="Contact group" values={groupList.map((g) => g.id)}
            labels={Object.fromEntries(groupList.map((g) => [g.id, `${g.name} (${g.members.length})`]))}
            value={group} onChange={setGroupId} />
        ) : (
          <fieldset className="contacts-checks d21-form-grid-wide">
            <legend>Contacts, notified in the order chosen</legend>
            {active.map((c) => (
              <label key={c.id} className="contacts-check">
                <input type="checkbox" checked={chosen.includes(c.id)}
                  onChange={(e) => setChosen((list) => e.target.checked ? [...list, c.id] : list.filter((x) => x !== c.id))} />
                {c.name}
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="contacts-checks d21-form-grid-wide">
          <legend>Channels</legend>
          {CHANNELS.map((c) => (
            <label key={c} className="contacts-check">
              <input type="checkbox" checked={channels.has(c)} onChange={(e) => setChannels((set) => {
                const next = new Set(set);
                if (e.target.checked) next.add(c); else next.delete(c);
                return next;
              })} />
              {CHANNEL_LABELS[c]}
            </label>
          ))}
        </fieldset>
        <EnumSelect label="Mode" values={MODES} labels={MODE_LABELS} value={mode} onChange={setMode} />
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
        <span className="d21-muted">In-app notices reach contacts linked to an account or position. A contact without an address for a channel is skipped on that channel.</span>
        <Button kind="primary" disabled={busy} onClick={() => void send()}>Send notification</Button>
      </div>
    </Panel>
  );
}

/** One send's receipts. A refresh here also refreshes the list of sends, so both agree. */
function Receipts(props: { client: ApiClient; id: string; nonce: number; onRefresh: () => void; onClose: () => void }) {
  const { onRefresh } = props;
  const detail = usePolled(() => props.client.getMassNotification(props.id), RECEIPT_REFRESH_MS, [props.id, props.nonce]);
  const m = detail.data;
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
            <div><dt>Mode</dt><dd>{m.mode === "calldown" ? `Call-down, ${m.intervalMinutes} min per contact` : "Everyone at once"}</dd></div>
            <div><dt>Sent</dt><dd>{m.sentBy} · {formatTime(m.createdAt)}</dd></div>
            <div><dt>To</dt><dd>{m.groupName ?? "Chosen contacts"}</dd></div>
          </dl>
          <p className="contacts-message">{m.message}</p>
          <ol className="contacts-receipts">
            {m.recipients.map((r) => (
              <li key={r.id} className="d21-card" aria-label={`Receipt for ${r.name}`}>
                <div className="d21-card-header">
                  <div>
                    <strong>{r.priority}. {r.name}</strong>
                    <span>{r.notifiedAt ? `Notified ${formatTime(r.notifiedAt)}` : "Not called"}</span>
                  </div>
                  {r.acknowledgedAt ? (
                    <StatusBadge status="success">Acknowledged {r.acknowledgedVia === "app" ? "in the app" : "by link"} {formatTime(r.acknowledgedAt)}</StatusBadge>
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
                            <StatusBadge status={d.state === "failed" || d.state === "expired" ? "critical" : d.state === "retrying" ? "warning" : d.state === "queued" ? "unknown" : "success"}>{DELIVERY_LABELS[d.state]}</StatusBadge>
                            <span className="d21-muted">{deliveryDetail(d)}</span>
                          </> : <span className="d21-muted">{channel === "inapp" ? "No linked account or position" : `No ${CHANNEL_LABELS[channel].toLowerCase()} address`}</span>}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
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
