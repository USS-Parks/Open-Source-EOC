import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { connect as netConnect, isIP, type Socket } from "node:net";
import { hostname } from "node:os";
import { connect as tlsConnect, type ConnectionOptions } from "node:tls";

/**
 * A minimal SMTP submission client: one message to one recipient per
 * connection. Implicit TLS or STARTTLS (never downgraded to plain text when
 * STARTTLS was asked for), AUTH PLAIN or LOGIN, multi-line replies, and a
 * base64 text body and attachments so no line needs dot-stuffing or exceeds
 * the line limit.
 * Every connection carries an idle timeout.
 */

export interface SmtpRelay {
  readonly host: string;
  readonly port: number;
  readonly security: "starttls" | "tls" | "none";
  readonly username?: string | undefined;
  readonly from: string;
}

export interface SmtpReceipt {
  /** The relay's final reply to the message, for example "250 2.0.0 Ok: queued as 4Xk2". */
  readonly response: string;
  readonly queueId: string | null;
  readonly messageId: string;
}

/**
 * A relay's permanent refusal of this sender, recipient or message (a 5xx
 * reply to MAIL, RCPT or the message itself). Retrying cannot succeed, so the
 * delivery is dead-lettered at once. Refusals at sign-in stay ordinary
 * failures: an administrator can correct the relay settings while retries run.
 */
export class SmtpRefused extends Error {}

/** A file sent with a message, as a base64 MIME part. */
export interface MailAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Uint8Array;
}

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly attachments?: readonly MailAttachment[] | undefined;
}

export async function sendMail(
  relay: SmtpRelay,
  password: string | null,
  message: MailMessage,
  options: { readonly timeoutMs: number; readonly tls?: ConnectionOptions | undefined },
): Promise<SmtpReceipt> {
  // SNI takes a host name, never an address.
  const identity = { host: relay.host, ...(isIP(relay.host) ? {} : { servername: relay.host }), ...options.tls };
  let socket: Socket =
    relay.security === "tls"
      ? tlsConnect({ port: relay.port, ...identity })
      : netConnect({ host: relay.host, port: relay.port });
  const replies = replyReader();
  const attach = (s: Socket) => {
    s.setTimeout(options.timeoutMs, () => s.destroy(new Error("SMTP relay timed out")));
    s.on("data", replies.feed);
    s.on("error", replies.fail);
    s.on("close", () => replies.fail(new Error("SMTP relay closed the connection")));
  };
  const expect = async (codes: readonly number[], permanent = false): Promise<string[]> => {
    const reply = await replies.next();
    const code = Number(reply[0]!.slice(0, 3));
    if (codes.includes(code)) return reply;
    const text = `SMTP relay answered ${reply.join(" ")}`;
    throw permanent && code >= 500 ? new SmtpRefused(text) : new Error(text);
  };
  // The command itself is never echoed into an error: AUTH lines carry the password.
  const command = (line: string, codes: readonly number[], permanent = false) => {
    socket.write(`${line}\r\n`);
    return expect(codes, permanent);
  };
  attach(socket);
  try {
    await expect([220]);
    // An address literal when the host name is not fully qualified, as RFC 5321 asks.
    const name = hostname().includes(".") ? hostname() : "[127.0.0.1]";
    let ehlo = await command(`EHLO ${name}`, [250]);
    if (relay.security === "starttls") {
      if (!ehlo.some((l) => /^250[- ]STARTTLS\b/i.test(l))) throw new Error("SMTP relay does not offer STARTTLS");
      await command("STARTTLS", [220]);
      socket.removeAllListeners("data");
      socket.setTimeout(0);
      const secured = tlsConnect({ socket, ...identity });
      secured.setTimeout(options.timeoutMs, () => secured.destroy(new Error("SMTP relay timed out")));
      await once(secured, "secureConnect");
      socket = secured;
      attach(socket);
      ehlo = await command(`EHLO ${name}`, [250]);
    }
    if (relay.username) {
      const offered = ehlo.find((l) => /^250[- ]AUTH[ =]/i.test(l))?.toUpperCase() ?? "";
      const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
      if (/\bPLAIN\b/.test(offered)) {
        await command(`AUTH PLAIN ${b64(`\0${relay.username}\0${password ?? ""}`)}`, [235]);
      } else if (/\bLOGIN\b/.test(offered)) {
        await command("AUTH LOGIN", [334]);
        await command(b64(relay.username), [334]);
        await command(b64(password ?? ""), [235]);
      } else {
        throw new Error("SMTP relay offers neither AUTH PLAIN nor AUTH LOGIN");
      }
    }
    await command(`MAIL FROM:<${relay.from}>`, [250], true);
    await command(`RCPT TO:<${message.to}>`, [250, 251], true);
    await command("DATA", [354], true);
    const messageId = `${randomUUID()}@${relay.from.split("@")[1]}`;
    const accepted = await command(`${render(relay.from, message, messageId)}\r\n.`, [250], true);
    socket.end("QUIT\r\n");
    const response = accepted.join(" ");
    return { response, queueId: /queued as ([\w.-]+)/i.exec(response)?.[1] ?? null, messageId };
  } catch (err) {
    socket.destroy();
    throw err;
  }
}

/**
 * The message as sent after DATA, dot-stuffed, without the terminating line.
 * With attachments it is multipart/mixed: the text part, then one base64 part
 * per file. Every part is base64, so no line starts with a dot or runs long.
 */
export function render(from: string, message: MailMessage, messageId: string): string {
  const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64").match(/.{1,76}/g) ?? [];
  const text = ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "",
    ...base64(Buffer.from(message.body, "utf8"))];
  const files = message.attachments ?? [];
  const boundary = `=_openeoc_${randomUUID()}`;
  const body = files.length === 0 ? text : [
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...text,
    ...files.flatMap((file) => {
      // A name the relay and the reader cannot mistake for header syntax.
      const name = file.filename.replace(/[^\w. -]/g, "_").slice(0, 120) || "attachment";
      return [
        `--${boundary}`,
        `Content-Type: ${file.contentType.replace(/[^\w.+/-]/g, "")}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        "Content-Transfer-Encoding: base64",
        "",
        ...base64(file.content),
      ];
    }),
    `--${boundary}--`,
  ];
  const lines = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    ...body,
  ];
  return lines.join("\r\n").replace(/^\./gm, "..");
}

/** Plain printable ASCII as is; anything else as folded RFC 2047 UTF-8 encoded words. */
function encodeHeader(value: string): string {
  const text = value.replace(/[\r\n]+/g, " ");
  if (/^[\x20-\x7e]{0,900}$/.test(text)) return text;
  const chars = Array.from(text);
  const words: string[] = [];
  for (let i = 0; i < chars.length; i += 10) {
    words.push(`=?UTF-8?B?${Buffer.from(chars.slice(i, i + 10).join(""), "utf8").toString("base64")}?=`);
  }
  return words.join("\r\n ");
}

/** Collects complete replies (all lines up to the one without a hyphen) as the socket delivers them. */
function replyReader() {
  let buffer = "";
  let lines: string[] = [];
  const ready: string[][] = [];
  let failure: Error | null = null;
  let wake: (() => void) | null = null;
  return {
    feed: (chunk: Buffer) => {
      buffer += chunk.toString("latin1");
      for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        lines.push(line);
        if (!/^\d{3}-/.test(line)) {
          ready.push(lines);
          lines = [];
        }
      }
      wake?.();
    },
    fail: (err: Error) => {
      failure ??= err;
      wake?.();
    },
    next: async (): Promise<string[]> => {
      while (ready.length === 0) {
        if (failure) throw failure;
        await new Promise<void>((resolve) => (wake = resolve));
        wake = null;
      }
      return ready.shift()!;
    },
  };
}
