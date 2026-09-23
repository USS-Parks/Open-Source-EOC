import { useEffect, useState } from "react";
import { Button, EnumSelect, Panel, TextField } from "../design/components.js";
import type { ApiClient, BoardListItem, NotificationChannel, NotificationRuleInput } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";

type ChannelKind = NotificationChannel["kind"];
type Draft = Readonly<Record<string, string>>;

const trimmed = (value: string | undefined) => (value ?? "").trim();
const listed = (value: string | undefined) => trimmed(value).split(/[\s,;]+/).filter(Boolean);

/**
 * The channel kinds a rule can use: a label, the fields an administrator
 * fills, and how they become the channel the server accepts. A new kind is
 * one entry here.
 */
export const CHANNEL_KINDS: Readonly<Record<ChannelKind, {
  readonly label: string;
  readonly fields: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  readonly build: (draft: Draft) => NotificationChannel;
}>> = {
  inapp: {
    label: "In-app notice",
    fields: [],
    build: () => ({ kind: "inapp", target: "requesting_position" }),
  },
  webhook: {
    label: "Webhook",
    fields: [{ key: "url", label: "Webhook URL" }],
    build: (d) => ({ kind: "webhook", url: trimmed(d.url) }),
  },
  ntfy: {
    label: "Push (ntfy)",
    fields: [{ key: "url", label: "Push server URL" }, { key: "topic", label: "Push topic" }],
    build: (d) => ({ kind: "ntfy", url: trimmed(d.url), topic: trimmed(d.topic) }),
  },
  email: {
    label: "Email",
    fields: [{ key: "to", label: "Email addresses, separated by commas" }],
    build: (d) => ({ kind: "email", to: listed(d.to) }),
  },
  sms: {
    label: "SMS",
    fields: [{ key: "to", label: "Phone numbers in E.164 form, separated by commas" }],
    build: (d) => ({ kind: "sms", to: listed(d.to) }),
  },
};

const EVENT_LABELS: Readonly<Record<NotificationRuleInput["event"], string>> = {
  "record.created": "A record is created",
  "record.updated": "A record is updated",
  scheduled: "On a schedule",
};
const CONDITION_LABELS: Readonly<Record<NotificationRuleInput["condition"]["op"], string>> = {
  any: "Every record",
  eq: "A field equals a value",
  changed_to: "A field changes to a value",
};
const INPUT_STYLE = {
  font: "inherit", minHeight: 44, padding: 6, borderRadius: 4, border: "1px solid var(--eoc-border)",
  background: "var(--eoc-surface)", color: "var(--eoc-text)",
} as const;

function wholeNumber(text: string, label: string, min: number, max: number): number {
  const value = Number(text.trim());
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}: enter a whole number from ${min} to ${max}.`);
  return value;
}

/**
 * Notification rules for the jurisdiction's boards and the allowlist of
 * destinations webhook and push channels may reach. A rule with a webhook
 * channel returns its signing secret once, at creation; it is shown here once.
 */
export function Notifications(props: { client: ApiClient; jurisdictionId: string; boards: readonly BoardListItem[] }) {
  const allowlist = useAsync(() => props.client.getNotificationAllowlist(props.jurisdictionId), [props.jurisdictionId]);
  const [entries, setEntries] = useState("");
  useEffect(() => { if (allowlist.data) setEntries(allowlist.data.entries.join("\n")); }, [allowlist.data]);
  const [boardId, setBoardId] = useState("");
  const [event, setEvent] = useState<NotificationRuleInput["event"]>("record.created");
  const [op, setOp] = useState<NotificationRuleInput["condition"]["op"]>("any");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [every, setEvery] = useState("60");
  const [channels, setChannels] = useState<ReadonlyArray<{ kind: ChannelKind; draft: Draft }>>([{ kind: "inapp", draft: {} }]);
  const [rateMax, setRateMax] = useState("60");
  const [rateWindow, setRateWindow] = useState("10");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  // Feedback shows in the panel whose action produced it.
  const [where, setWhere] = useState<"allowlist" | "rule">("rule");

  const run = async (at: "allowlist" | "rule", operation: () => Promise<string>) => {
    setBusy(true); setError(null); setNotice(""); setWhere(at);
    try { setNotice(await operation()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };
  const feedback = (at: "allowlist" | "rule") => where !== at ? null : <>
    {error ? <p className="d21-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </>;
  const editChannel = (index: number, change: { kind?: ChannelKind; key?: string; value?: string }) =>
    setChannels((current) => current.map((channel, i) => i !== index ? channel
      : change.kind ? { kind: change.kind, draft: {} }
      : { ...channel, draft: { ...channel.draft, [change.key!]: change.value ?? "" } }));

  const saveAllowlist = () => run("allowlist", async () => {
    const saved = await props.client.setNotificationAllowlist(props.jurisdictionId, entries.split("\n").map((e) => e.trim()).filter(Boolean));
    setEntries(saved.entries.join("\n"));
    allowlist.reload();
    return saved.entries.length ? `Allowlist saved with ${saved.entries.length} ${saved.entries.length === 1 ? "destination" : "destinations"}.`
      : "Allowlist saved empty. No external destination is reachable.";
  });
  const createRule = () => run("rule", async () => {
    if (op !== "any" && !field.trim()) throw new Error("Enter the field key the condition checks.");
    const rule: NotificationRuleInput = {
      boardId: boardId || null,
      event,
      condition: op === "any" ? { op } : { op, field: field.trim(), value },
      channels: channels.map((channel) => CHANNEL_KINDS[channel.kind].build(channel.draft)),
      ...(event === "scheduled" ? { scheduleIntervalMinutes: wholeNumber(every, "Run every", 1, 10080) } : {}),
      rateLimit: {
        max: wholeNumber(rateMax, "Most deliveries per window", 1, 600),
        windowMinutes: wholeNumber(rateWindow, "Window", 1, 1440),
      },
    };
    const created = await props.client.createNotificationRule(props.jurisdictionId, rule);
    setSecret(created.webhookSecret);
    setCopied("");
    setChannels([{ kind: "inapp", draft: {} }]);
    return "Notification rule created.";
  });
  const copy = () => {
    if (!secret) return;
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard) { setCopied("Copying is unavailable here; select the secret and copy it."); return; }
    clipboard.writeText(secret).then(() => setCopied("Secret copied."),
      () => setCopied("Copying failed; select the secret and copy it."));
  };

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <Panel title="Webhook and push allowlist">
        <p className="d21-muted">Webhook and push channels reach only these destinations. Enter one per line: an https origin such as https://hooks.example.org, a host suffix such as *.example.org, or an http loopback origin. With no entries nothing external is reachable, and removing a destination fails what is still queued for it.</p>
        {allowlist.error ? <ErrorNote message={allowlist.error} /> : null}
        {!allowlist.data && !allowlist.error ? <Loading label="Loading the allowlist…" /> : null}
        {allowlist.data ? <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>Allowed destinations
            <textarea rows={4} value={entries} onChange={(e) => setEntries(e.target.value)} style={INPUT_STYLE} />
          </label>
          <div className="d21-toolbar">
            <span className="d21-muted">{allowlist.data.updatedAt ? `Last changed ${new Date(allowlist.data.updatedAt).toLocaleString()}.` : "Never set."} Each change is recorded in the audit trail.</span>
            <Button kind="primary" onClick={() => void saveAllowlist()}>Save allowlist</Button>
          </div>
        </fieldset> : null}
        {feedback("allowlist")}
      </Panel>
      <Panel title="Add a notification rule">
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
          <div className="d21-form-grid">
            <EnumSelect label="Board" values={["", ...props.boards.map((b) => b.id)]} value={boardId} onChange={setBoardId}
              labels={{ "": "Any board", ...Object.fromEntries(props.boards.map((b) => [b.id, b.title])) }} />
            <EnumSelect label="When" values={Object.keys(EVENT_LABELS)} value={event} labels={EVENT_LABELS}
              onChange={(v) => setEvent(v as NotificationRuleInput["event"])} />
            {event === "scheduled" ? <TextField label="Run every (minutes)" value={every} onChange={setEvery} /> : null}
            <EnumSelect label="Condition" values={Object.keys(CONDITION_LABELS)} value={op} labels={CONDITION_LABELS}
              onChange={(v) => setOp(v as NotificationRuleInput["condition"]["op"])} />
            {op !== "any" ? <>
              <TextField label="Field key" value={field} onChange={setField} />
              <TextField label="Value" value={value} onChange={setValue} />
            </> : null}
          </div>
          {channels.map((channel, index) => {
            const suffix = index === 0 ? "" : `, channel ${index + 1}`;
            return (
              <fieldset key={index} className="d21-form-section">
                <legend>Channel {index + 1}</legend>
                <div className="d21-form-section-grid">
                  <EnumSelect label={`Channel kind${suffix}`} values={Object.keys(CHANNEL_KINDS)} value={channel.kind}
                    labels={Object.fromEntries(Object.entries(CHANNEL_KINDS).map(([k, v]) => [k, v.label]))}
                    onChange={(v) => editChannel(index, { kind: v as ChannelKind })} />
                  {CHANNEL_KINDS[channel.kind].fields.map((f) => (
                    <TextField key={f.key} label={`${f.label}${suffix}`} value={channel.draft[f.key] ?? ""}
                      onChange={(v) => editChannel(index, { key: f.key, value: v })} />
                  ))}
                </div>
                {channels.length > 1 ? <div className="d21-card-actions">
                  <Button kind="quiet" onClick={() => setChannels((current) => current.filter((_, i) => i !== index))}>Remove channel {index + 1}</Button>
                </div> : null}
              </fieldset>
            );
          })}
          <fieldset className="d21-form-section">
            <legend>Rate cap</legend>
            <div className="d21-form-section-grid">
              <TextField label="Most deliveries per window" value={rateMax} onChange={setRateMax} />
              <TextField label="Window (minutes)" value={rateWindow} onChange={setRateWindow} />
            </div>
          </fieldset>
          <div className="d21-toolbar">
            <span className="d21-muted">Deliveries past the cap are counted, not sent. Webhook and push destinations must be on the allowlist.</span>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button onClick={() => setChannels((current) => [...current, { kind: "inapp", draft: {} }])}>Add channel</Button>
              <Button kind="primary" onClick={() => void createRule()}>Create rule</Button>
            </span>
          </div>
        </fieldset>
        {feedback("rule")}
      </Panel>
      {secret ? <Panel title="Signing secret for the new rule">
        <p className="d21-muted">The receiver checks the x-openeoc-signature header, sha256= and an HMAC-SHA256 of the request body with this secret. It is shown only now and cannot be read again.</p>
        <p className="d21-token" aria-label="Webhook signing secret">{secret}</p>
        <div className="d21-toolbar">
          <span className="d21-muted" role="status">{copied}</span>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={copy}>Copy secret</Button>
            <Button kind="quiet" onClick={() => setSecret(null)}>I have stored the secret</Button>
          </span>
        </div>
      </Panel> : null}
    </div>
  );
}
