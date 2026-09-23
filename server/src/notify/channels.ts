import { randomUUID } from "node:crypto";
import type { ConnectionOptions } from "node:tls";
import { z } from "zod";
import { decryptSecret } from "../secrets/envelope.js";
import { destinationRefusal, type Resolve } from "./allowlist.js";
import { sendMail } from "./smtp.js";

/**
 * Email and SMS channels. Each jurisdiction configures one SMTP relay and one
 * SMS provider; the relay password or provider token is stored
 * envelope-encrypted. Recipients are people, not endpoints, so the
 * destination allowlist does not apply to addresses or numbers. It does apply
 * to an HTTP SMS provider's URL, which is an outbound HTTP destination like a
 * webhook: checked when the provider is configured and again before each send.
 *
 * The fixture SMS provider sends nothing. It records each message in memory
 * so tests and the Administration screen can show what would have gone out.
 */

export const E164 = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, "phone numbers use E.164 form, for example +17075551234");

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
]);
export type SmsSettings = z.infer<typeof SmsSettings>;

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
  // The common shape of hosted SMS APIs: a form POST with basic auth.
  const res = await fetch(sms.url, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sms.username}:${secret ?? ""}`, "utf8").toString("base64")}`,
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
