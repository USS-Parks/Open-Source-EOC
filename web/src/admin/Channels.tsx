import { useState } from "react";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import type { ApiClient, NotificationChannelKind, NotificationChannelView } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";

/**
 * The jurisdiction's email relay and SMS provider, which notification rules
 * send through. Passwords and tokens are write-only: the screen shows a
 * fingerprint of the stored one. Nothing is sent until an administrator
 * saves a real relay or provider; the SMS fixture records messages instead.
 */
export function Channels(props: { client: ApiClient; jurisdictionId: string }) {
  const email = useAsync(() => props.client.getNotificationChannel(props.jurisdictionId, "email"), [props.jurisdictionId]);
  const sms = useAsync(() => props.client.getNotificationChannel(props.jurisdictionId, "sms"), [props.jurisdictionId]);
  if (email.error || sms.error) return <ErrorNote message={email.error ?? sms.error ?? ""} />;
  if (!email.data || !sms.data) return <Loading label="Loading channels…" />;
  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <EmailPanel client={props.client} jurisdictionId={props.jurisdictionId} view={email.data} onSaved={email.reload} />
      <SmsPanel client={props.client} jurisdictionId={props.jurisdictionId} view={sms.data} onChanged={sms.reload} />
    </div>
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
    <div className="d21-card-actions" style={{ alignItems: "flex-end", justifyContent: "flex-start" }}>
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
      <fieldset disabled={action.busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
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
      : { provider, url: url.trim(), username: username.trim(), from: from.trim() };
    await props.client.saveNotificationChannel(props.jurisdictionId, "sms", { settings, ...(token ? { secret: token } : {}) });
    setToken("");
    props.onChanged();
    return "SMS settings saved.";
  });
  const recorded = props.view.fixtureMessages ?? [];
  return (
    <Panel title="SMS">
      <fieldset disabled={action.busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
        <div className="d21-form-grid">
          <EnumSelect label="SMS provider" values={["fixture", "http"]} value={provider} onChange={setProvider}
            labels={{ fixture: "Fixture (records messages, sends nothing)", http: "HTTP provider (form POST with basic auth)" }} />
          {provider === "http" ? <>
            <TextField label="Provider URL" value={url} onChange={setUrl} required />
            <TextField label="Provider account" value={username} onChange={setUsername} required />
            <TextField label="Provider token" type="password" value={token} onChange={setToken} />
            <TextField label="From number" value={from} onChange={setFrom} required />
          </> : null}
        </div>
        {provider === "http" ? <Fingerprint view={props.view} what="token" /> : null}
        {action.status}
        <div className="d21-toolbar">
          <span className="d21-muted">{provider === "http"
            ? "The provider URL must be on the notification allowlist. Numbers use E.164 form, for example +17075551234."
            : "The fixture keeps the last messages on this server so a rule can be tried without sending anything."}</span>
          <Button kind="primary" onClick={() => void save()}>Save SMS settings</Button>
        </div>
        {props.view.settings ? <TestSend client={props.client} jurisdictionId={props.jurisdictionId} kind="sms"
          label="Test phone number" button="Send test SMS" run={action.run} onSent={props.onChanged} /> : null}
        {recorded.length > 0 ? <ul className="d21-readiness-list" aria-label="Fixture messages">
          {recorded.map((m) => (
            <li key={m.messageId} className="d21-readiness-row" aria-label={`Fixture message to ${m.to}`}>
              <div className="d21-readiness-title">
                <div>
                  <strong>{m.to}</strong>
                  <span>{m.body}</span>
                </div>
              </div>
              <span style={{ alignSelf: "start" }}><StatusBadge status="unknown">fixture: not sent</StatusBadge></span>
            </li>
          ))}
        </ul> : null}
      </fieldset>
    </Panel>
  );
}
