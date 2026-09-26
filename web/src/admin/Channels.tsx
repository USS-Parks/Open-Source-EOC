import { useState } from "react";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import type {
  ApiClient,
  DeliveryHold,
  DeliveryHoldKind,
  NotificationChannelKind,
  NotificationChannelView,
  SmsReply,
} from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";
import "./admin.css";

/**
 * The jurisdiction's email relay and SMS provider, which notification rules
 * send through. Passwords and tokens are write-only: the screen shows a
 * fingerprint of the stored one. Nothing is sent until an administrator
 * saves a real relay or provider; the SMS fixture records messages instead.
 */
export function Channels(props: { client: ApiClient; jurisdictionId: string }) {
  const email = useAsync(() => props.client.getNotificationChannel(props.jurisdictionId, "email"), [props.jurisdictionId]);
  const sms = useAsync(() => props.client.getNotificationChannel(props.jurisdictionId, "sms"), [props.jurisdictionId]);
  const holds = useAsync(() => props.client.getDeliveryHolds(props.jurisdictionId), [props.jurisdictionId]);
  if (email.error || sms.error || holds.error) return <ErrorNote message={email.error ?? sms.error ?? holds.error ?? ""} />;
  if (!email.data || !sms.data || !holds.data) return <Loading label="Loading channels…" />;
  return (
    <div className="admin-tab">
      <EmailPanel client={props.client} jurisdictionId={props.jurisdictionId} view={email.data} onSaved={email.reload} />
      <SmsPanel client={props.client} jurisdictionId={props.jurisdictionId} view={sms.data} onChanged={sms.reload} />
      <HoldPanel client={props.client} jurisdictionId={props.jurisdictionId} holds={holds.data.holds} onSaved={holds.reload} />
    </div>
  );
}

const HOLD_LABELS: Readonly<Record<DeliveryHoldKind, string>> = {
  email: "Email",
  sms: "SMS",
  webhook: "Webhooks",
  ntfy: "Push (ntfy)",
};

const HOLD_BUTTONS: Readonly<Record<DeliveryHoldKind, string>> = {
  email: "email window",
  sms: "SMS window",
  webhook: "webhooks window",
  ntfy: "push window",
};

/**
 * How long each kind of message waits for a route before it expires. During
 * an outage a message is retried, never dropped, until its window closes;
 * an expired message can be resent from Notifications.
 */
function HoldPanel(props: { client: ApiClient; jurisdictionId: string; holds: readonly DeliveryHold[]; onSaved: () => void }) {
  const [hours, setHours] = useState<Record<string, string>>(
    () => Object.fromEntries(props.holds.map((h) => [h.kind, String(h.hours)])));
  const action = useAction();
  const save = (kind: DeliveryHoldKind) => action.run(async () => {
    const value = Number(hours[kind]);
    if (!Number.isInteger(value) || value < 1 || value > 720) throw new Error("Enter whole hours from 1 to 720 (thirty days).");
    await props.client.setDeliveryHold(props.jurisdictionId, kind, value);
    props.onSaved();
    return `${HOLD_LABELS[kind]} now waits up to ${value} hour${value === 1 ? "" : "s"} for a route.`;
  });
  return (
    <Panel title="When a message cannot go out">
      <fieldset disabled={action.busy} className="eoc-fieldset eoc-stack">
        <p className="d21-muted">
          If a relay, provider or target cannot be reached, each message waits and is retried until its window below
          closes, then reads "Expired, not sent" and can be resent from Notifications. Nothing is dropped sooner.
          A message the relay or provider refuses fails at once.
        </p>
        <ul className="d21-readiness-list" aria-label="How long messages wait for a route">
          {props.holds.map((hold) => (
            <li key={hold.kind} className="d21-readiness-row">
              <div className="d21-card-actions is-start is-bottom">
                <TextField label={`${HOLD_LABELS[hold.kind]}: hours to wait`} value={hours[hold.kind] ?? ""}
                  onChange={(value) => setHours((all) => ({ ...all, [hold.kind]: value }))} />
                <Button onClick={() => void save(hold.kind)}>Save {HOLD_BUTTONS[hold.kind]}</Button>
              </div>
              <span className="d21-readiness-badge">
                <StatusBadge status="unknown">{hold.isDefault ? "Default, 72 hours" : `Set to ${hold.hours} hours`}</StatusBadge>
              </span>
            </li>
          ))}
        </ul>
        {action.status}
      </fieldset>
    </Panel>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const run = async (operation: () => Promise<string>) => {
    setBusy(true); setError(null); setNotice("");
    try { setNotice(await operation()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };
  const status = <>
    {error ? <p className="d21-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </>;
  return { busy, run, status };
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

function Fingerprint(props: { view: NotificationChannelView; what: string }) {
  return props.view.credentialFingerprint
    ? <span className="d21-muted">Stored {props.what} fingerprint <code>{props.view.credentialFingerprint}</code>. Leave the field empty to keep it.</span>
    : null;
}

function TestSend(props: {
  client: ApiClient; jurisdictionId: string; kind: NotificationChannelKind; label: string; button: string;
  run: (operation: () => Promise<string>) => Promise<void>; onSent?: () => void;
}) {
  const [to, setTo] = useState("");
  return (
    <div className="d21-card-actions is-start is-bottom">
      <TextField label={props.label} value={to} onChange={setTo} />
      <Button onClick={() => void props.run(async () => {
        if (!to.trim()) throw new Error(`Enter a ${props.label.toLowerCase()}.`);
        const { receipt } = await props.client.testNotificationChannel(props.jurisdictionId, props.kind, to.trim());
        props.onSent?.();
        if (receipt.provider === "fixture") return `Test message to ${to.trim()} recorded by the fixture provider (fixture: not sent).`;
        const answer = text(receipt.response) || (text(receipt.messageId) ? `message ${text(receipt.messageId)}` : "accepted");
        return `Test message to ${to.trim()} delivered: ${answer}.`;
      })}>{props.button}</Button>
    </div>
  );
}

function EmailPanel(props: { client: ApiClient; jurisdictionId: string; view: NotificationChannelView; onSaved: () => void }) {
  const saved = props.view.settings ?? {};
  const [host, setHost] = useState(text(saved.host));
  const [port, setPort] = useState(saved.port ? String(saved.port) : "587");
  const [security, setSecurity] = useState(text(saved.security) || "starttls");
  const [username, setUsername] = useState(text(saved.username));
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState(text(saved.from));
  const action = useAction();
  const save = () => action.run(async () => {
    if (!host.trim() || !from.trim()) throw new Error("Enter the relay host and the from address.");
    const settings = {
      host: host.trim(), port: Number(port), security, from: from.trim(),
      ...(username.trim() ? { username: username.trim() } : {}),
    };
    await props.client.saveNotificationChannel(props.jurisdictionId, "email", { settings, ...(password ? { secret: password } : {}) });
    setPassword("");
    props.onSaved();
    return "Email settings saved.";
  });
  return (
    <Panel title="Email (SMTP relay)">
      <fieldset disabled={action.busy} className="eoc-fieldset eoc-stack">
        <div className="d21-form-grid">
          <TextField label="Relay host" value={host} onChange={setHost} required />
          <TextField label="Relay port" value={port} onChange={setPort} required />
          <EnumSelect label="Connection security" values={["starttls", "tls", "none"]} value={security} onChange={setSecurity}
            labels={{ starttls: "STARTTLS", tls: "TLS from the start", none: "None (local relay without sign-in)" }} />
          <TextField label="From address" value={from} onChange={setFrom} required />
          <TextField label="Relay user name" value={username} onChange={setUsername} />
          <TextField label="Relay password" type="password" value={password} onChange={setPassword} />
        </div>
        <Fingerprint view={props.view} what="password" />
        {action.status}
        <div className="d21-toolbar">
          <span className="d21-muted">Rules send one email per recipient through this relay. The password is stored encrypted and never shown again.</span>
          <Button kind="primary" onClick={() => void save()}>Save email settings</Button>
        </div>
        {props.view.settings ? <TestSend client={props.client} jurisdictionId={props.jurisdictionId} kind="email"
          label="Test email recipient" button="Send test email" run={action.run} /> : null}
      </fieldset>
    </Panel>
  );
}

const PROVIDER_LABELS = {
  fixture: "Fixture (records messages, sends nothing)",
  http: "HTTP provider (form POST with basic auth)",
  gateway: "SMS gateway on the site network (a phone's SIM)",
};

const REPLY_OUTCOMES: Readonly<Record<SmsReply["outcome"], { text: string; status: "success" | "warning" | "unknown" }>> = {
  acknowledged: { text: "Acknowledged", status: "success" },
  answered: { text: "Answered", status: "success" },
  not_an_answer: { text: "Not one of the answers", status: "warning" },
  unmatched: { text: "No send to this number", status: "unknown" },
};

function SmsPanel(props: { client: ApiClient; jurisdictionId: string; view: NotificationChannelView; onChanged: () => void }) {
  const saved = props.view.settings ?? {};
  const [provider, setProvider] = useState(text(saved.provider) || "fixture");
  const [url, setUrl] = useState(text(saved.url));
  const [username, setUsername] = useState(text(saved.username));
  const [token, setToken] = useState("");
  const [from, setFrom] = useState(text(saved.from));
  const action = useAction();
  const save = () => action.run(async () => {
    const settings = provider === "fixture"
      ? { provider }
      : provider === "gateway"
        ? { provider, url: url.trim(), username: username.trim() }
        : { provider, url: url.trim(), username: username.trim(), from: from.trim() };
    await props.client.saveNotificationChannel(props.jurisdictionId, "sms", { settings, ...(token ? { secret: token } : {}) });
    setToken("");
    props.onChanged();
    return "SMS settings saved.";
  });
  const readNow = () => action.run(async () => {
    const read = await props.client.readSmsReplies(props.jurisdictionId);
    props.onChanged();
    return read.read === 0
      ? "No new replies on the gateway."
      : `Read ${read.read} new ${read.read === 1 ? "reply" : "replies"}: ${read.acknowledged + read.answered} recorded, ${read.notAnAnswer} not one of the answers, ${read.unmatched} with no send to the number.`;
  });
  const recorded = props.view.fixtureMessages ?? [];
  const replies = props.view.replies ?? [];
  const gateway = saved.provider === "gateway";
  return (
    <Panel title="SMS">
      <fieldset disabled={action.busy} className="eoc-fieldset eoc-stack">
        <div className="d21-form-grid">
          <EnumSelect label="SMS provider" values={["fixture", "http", "gateway"]} value={provider} onChange={setProvider}
            labels={PROVIDER_LABELS} />
          {provider === "http" ? <>
            <TextField label="Provider URL" value={url} onChange={setUrl} required />
            <TextField label="Provider account" value={username} onChange={setUsername} required />
            <TextField label="Provider token" type="password" value={token} onChange={setToken} />
            <TextField label="From number" value={from} onChange={setFrom} required />
          </> : null}
          {provider === "gateway" ? <>
            <TextField label="Gateway address" value={url} onChange={setUrl} required />
            <TextField label="Gateway user name" value={username} onChange={setUsername} required />
            <TextField label="Gateway password" type="password" value={token} onChange={setToken} />
          </> : null}
        </div>
        {provider !== "fixture" ? <Fingerprint view={props.view} what={provider === "gateway" ? "password" : "token"} /> : null}
        {action.status}
        <div className="d21-toolbar">
          <span className="d21-muted">{provider === "http"
            ? "The provider URL must be on the notification allowlist. Numbers use E.164 form, for example +17075551234."
            : provider === "gateway"
              ? "Run SMS Gateway for Android in Local Server mode on a phone with a SIM on this network, and enter the address, user name and password it shows, such as http://192.168.1.20:8080. Texts go out through the phone while it has a signal; replies are read from it every half minute while a text can still be answered."
              : "The fixture keeps the last messages on this server so a rule can be tried without sending anything."}</span>
          <Button kind="primary" onClick={() => void save()}>Save SMS settings</Button>
        </div>
        {props.view.settings ? <TestSend client={props.client} jurisdictionId={props.jurisdictionId} kind="sms"
          label="Test phone number" button="Send test SMS" run={action.run} onSent={props.onChanged} /> : null}
        {gateway || replies.length > 0 ? (
          <div className="d21-toolbar">
            <span className="d21-muted">Replies from the gateway's phone acknowledge or answer the latest send to that number.</span>
            {gateway ? <Button onClick={() => void readNow()}>Read replies now</Button> : null}
          </div>
        ) : null}
        {replies.length > 0 ? <ul className="d21-readiness-list" aria-label="Replies read from the gateway">
          {replies.map((reply) => (
            <li key={reply.id} className="d21-readiness-row" aria-label={`Reply from ${reply.sender}`}>
              <div className="d21-readiness-title">
                <div>
                  <strong>{reply.recipient ? `${reply.recipient} (${reply.sender})` : reply.sender}</strong>
                  <span>“{reply.body}”{reply.subject ? ` to ${reply.subject}` : ""}</span>
                </div>
              </div>
              <span className="d21-readiness-badge">
                <StatusBadge status={REPLY_OUTCOMES[reply.outcome].status}>{REPLY_OUTCOMES[reply.outcome].text}</StatusBadge>
              </span>
            </li>
          ))}
        </ul> : null}
        {recorded.length > 0 ? <ul className="d21-readiness-list" aria-label="Fixture messages">
          {recorded.map((m) => (
            <li key={m.messageId} className="d21-readiness-row" aria-label={`Fixture message to ${m.to}`}>
              <div className="d21-readiness-title">
                <div>
                  <strong>{m.to}</strong>
                  <span>{m.body}</span>
                </div>
              </div>
              <span className="d21-readiness-badge"><StatusBadge status="unknown">fixture: not sent</StatusBadge></span>
            </li>
          ))}
        </ul> : null}
      </fieldset>
    </Panel>
  );
}
