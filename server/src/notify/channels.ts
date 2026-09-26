import { randomUUID } from "node:crypto";
import type { ConnectionOptions } from "node:tls";
import { E164PhoneSchema } from "@openeoc/shared";
import { z } from "zod";
import { decryptSecret } from "../secrets/envelope.js";
import { destinationRefusal, isInternalAddress, type Resolve } from "./allowlist.js";
import { sendMail, type MailAttachment } from "./smtp.js";

/**
 * Email and SMS channels. Each jurisdiction configures one SMTP relay and one
 * SMS provider; the relay password or provider token is stored
 * envelope-encrypted. Recipients are people, not endpoints, so the
 * destination allowlist does not apply to addresses or numbers. It does apply
 * to an HTTP SMS provider's URL, which is an outbound HTTP destination like a
 * webhook: checked when the provider is configured and again before each send.
 *
 * An SMS gateway is hardware on the site network (AG-05): an Android phone
 * running SMS Gateway for Android (Apache-2.0) in its Local Server mode, whose
 * SIM sends each text while a tower stands. It is not an outbound destination
 * beyond the site, so instead of the allowlist its address must be an IP
 * address in a private, loopback or link-local range, which needs no name
 * lookup in an enclave. The server reads replies from the phone's inbox, so
 * the phone needs neither the internet nor the host's certificate.
 *
 * The fixture SMS provider sends nothing. It records each message in memory
 * so tests and the Administration screen can show what would have gone out.
 */

export const E164 = E164PhoneSchema;

export const EmailSettings = z.object({
  host: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9.:-]+$/, "enter a host name or address"),
  port: z.number().int().min(1).max(65535),
  security: z.enum(["starttls", "tls", "none"]),
  username: z.string().min(1).max(200).optional(),
  from: z.email(),
});
export type EmailSettings = z.infer<typeof EmailSettings>;

export const SmsSettings = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("fixture") }),
  z.object({
    provider: z.literal("http"),
    url: z.url({ protocol: /^https?$/ }),
    username: z.string().min(1).max(200),
    from: E164,
  }),
  z.object({
    provider: z.literal("gateway"),
    url: z.url({ protocol: /^https?$/ }),
    username: z.string().min(1).max(200),
    /** File texted activity on the ICS 214 activity log (contacts/sms-activity.ts); off unless set. */
    activityLog: z.boolean().optional(),
  }),
]);
export type SmsSettings = z.infer<typeof SmsSettings>;

/** Why an SMS gateway at this address may not be used, or null when it may. */
export function gatewayRefusal(url: string): string | null {
  return isInternalAddress(new URL(url).hostname)
    ? null
    : "an SMS gateway's address must be an IP address on the site network, such as http://192.168.1.20:8080";
}

/** A gateway endpoint under the address the phone shows, with or without a trailing slash. */
function gatewayUrl(base: string, path: string): URL {
  return new URL(path, base.endsWith("/") ? base : `${base}/`);
}

const basicAuth = (username: string, secret: string | null) =>
  `Basic ${Buffer.from(`${username}:${secret ?? ""}`, "utf8").toString("base64")}`;

/** A text the gateway's phone received. */
export interface InboundSms {
  readonly id: string;
  readonly sender: string;
  readonly text: string;
  /** By the phone's clock. */
  readonly receivedAt: Date;
}

const InboxEntry = z.object({
  // Printable ASCII: the id is kept as sent and is what makes a text read once.
  id: z.string().regex(/^[!-~]{1,200}$/),
  sender: z.string().min(1).max(40),
  contentPreview: z.string(),
  createdAt: z.string().refine((at) => !Number.isNaN(Date.parse(at))),
});

/**
 * The texts the gateway's phone received since `since`, read from its inbox
 * (`GET /inbox`). Throws when the gateway cannot be reached or answers with
 * an error.
 */
export async function readGatewayInbox(stored: StoredChannel, since: Date, options: SendOptions): Promise<InboundSms[]> {
  const sms = SmsSettings.parse(stored.settings);
  if (sms.provider !== "gateway") throw new Error("the SMS channel is not a gateway on the site network");
  const url = gatewayUrl(sms.url, "inbox");
  // ponytail: one page, the newest 500 in the window; page by offset if a
  // phone ever takes more texts than that between two reads.
  url.search = new URLSearchParams({ type: "SMS", from: since.toISOString(), limit: "500" }).toString();
  const res = await fetch(url, {
    headers: { authorization: basicAuth(sms.username, stored.secret ? decryptSecret(stored.secret) : null) },
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!res.ok) throw new Error(`SMS gateway responded ${res.status}`);
  // An entry this server cannot read is left on the phone rather than holding back the rest.
  return z.array(z.unknown()).parse(await res.json()).flatMap((entry) => {
    const m = InboxEntry.safeParse(entry);
    const sender = m.success ? storableText(m.data.sender).trim() : "";
    return m.success && sender
      ? [{ id: m.data.id, sender, text: storableText(m.data.contentPreview).slice(0, 1600), receivedAt: new Date(m.data.createdAt) }]
      : [];
  });
}

/**
 * Text as the database keeps it: no control characters but tab and newline
 * (PostgreSQL refuses NUL in text and JSON), and no unpaired surrogate, which
 * becomes U+FFFD.
 */
export function storableText(text: string): string {
  const kept = text.replace(/\p{Cc}/gu, (c) => (c === "\n" || c === "\t" ? c : ""));
  return (kept as string & { toWellFormed(): string }).toWellFormed();
}

export type MessageKind = "email" | "sms";

/** A channel as stored: its settings and the still-encrypted secret. */
export interface StoredChannel {
  readonly settings: unknown;
  readonly secret: string | null;
}

export interface Message {
  readonly jurisdictionId: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  /** Files sent with an email; SMS carries text only. */
  readonly attachments?: readonly MailAttachment[] | undefined;
}

export interface SendOptions {
  readonly timeoutMs: number;
  /** Extra TLS options for the SMTP connection, such as a private CA. */
  readonly tls?: ConnectionOptions | undefined;
}

export interface FixtureMessage {
  readonly jurisdictionId: string;
  readonly messageId: string;
  readonly to: string;
  readonly body: string;
  readonly at: string;
}

// ponytail: per-process and capped; the fixture exists for development and
// tests, and a real provider's receipts land in the delivery row instead.
const fixtureLog: FixtureMessage[] = [];

/** The fixture provider's recent messages for a jurisdiction, newest first. */
export function fixtureMessages(jurisdictionId: string): FixtureMessage[] {
  return fixtureLog.filter((m) => m.jurisdictionId === jurisdictionId).reverse();
}

/** The circuit a delivery belongs to: the relay or provider, never the recipient. */
export function channelKey(kind: MessageKind, stored: StoredChannel): string {
  if (kind === "email") {
    const relay = EmailSettings.parse(stored.settings);
    return `smtp://${relay.host}:${relay.port}`;
  }
  const sms = SmsSettings.parse(stored.settings);
  return sms.provider === "fixture" ? "sms:fixture" : new URL(sms.url).origin;
}

/** Why a message on this channel may not be sent, or null when it may. */
export async function channelRefusal(
  kind: MessageKind,
  stored: StoredChannel | null,
  allowlist: readonly string[],
  resolve?: Resolve,
): Promise<string | null> {
  const name = kind === "email" ? "email" : "SMS";
  if (!stored) return `${name} is not configured for this jurisdiction`;
  const parsed = (kind === "email" ? EmailSettings : SmsSettings).safeParse(stored.settings);
  if (!parsed.success) return `the ${name} settings are not valid`;
  if ("provider" in parsed.data && parsed.data.provider === "http") {
    return destinationRefusal(allowlist, parsed.data.url, resolve);
  }
  if ("provider" in parsed.data && parsed.data.provider === "gateway") return gatewayRefusal(parsed.data.url);
  return null;
}

/**
 * Send one message and return what the relay or provider answered on
 * acceptance. Throws on any refusal, error or timeout. The caller checks
 * {@link channelRefusal} first.
 */
export async function sendMessage(
  kind: MessageKind,
  stored: StoredChannel,
  message: Message,
  options: SendOptions,
): Promise<Record<string, unknown>> {
  const secret = stored.secret ? decryptSecret(stored.secret) : null;
  if (kind === "email") {
    const relay = EmailSettings.parse(stored.settings);
    return { ...(await sendMail(relay, secret, message, options)) };
  }
  const sms = SmsSettings.parse(stored.settings);
  if (sms.provider === "fixture") {
    const messageId = `fixture-${randomUUID()}`;
    fixtureLog.push({
      jurisdictionId: message.jurisdictionId,
      messageId,
      to: message.to,
      body: message.body,
      at: new Date().toISOString(),
    });
    fixtureLog.splice(0, Math.max(0, fixtureLog.length - 200));
    return { provider: "fixture", messageId, sent: false };
  }
  if (sms.provider === "gateway") {
    // Accepted (202) means the phone queued the text; it goes when the SIM has a signal.
    const res = await fetch(gatewayUrl(sms.url, "messages"), {
      method: "POST",
      headers: { authorization: basicAuth(sms.username, secret), "content-type": "application/json" },
      body: JSON.stringify({ textMessage: { text: message.body }, phoneNumbers: [message.to] }),
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!res.ok) throw new Error(`SMS gateway responded ${res.status}`);
    const answer = (await res.json().catch(() => ({}))) as { id?: unknown; state?: unknown };
    return {
      provider: "gateway",
      messageId: typeof answer.id === "string" ? answer.id : null,
      status: typeof answer.state === "string" ? answer.state : null,
    };
  }
  // The common shape of hosted SMS APIs: a form POST with basic auth.
  const res = await fetch(sms.url, {
    method: "POST",
    headers: {
      authorization: basicAuth(sms.username, secret),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: message.to, From: sms.from, Body: message.body }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!res.ok) throw new Error(`SMS provider responded ${res.status}`);
  const answer = (await res.json().catch(() => ({}))) as { sid?: unknown; id?: unknown; status?: unknown };
  const messageId = answer.sid ?? answer.id;
  return {
    provider: "http",
    messageId: typeof messageId === "string" ? messageId : null,
    status: typeof answer.status === "string" ? answer.status : null,
  };
}
