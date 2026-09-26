import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError, principalForPerson, requireAdmin, requireWriter, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { E164, channelRefusal, readGatewayInbox, sendMessage, type InboundSms, type StoredChannel } from "../notify/channels.js";
import { ACK_TTL_HOURS } from "../notify/mass.js";
import {
  confirmActivityNumber, confirmation, decideActivity, fileAsPerson, isEcho, listActivityNumbers, mayReply, noticeFiled,
  parseActivityText, refusedByLog, sendActivityCode, type Refusal, type Reply,
} from "./sms-activity.js";

/**
 * Local carriers (AG-05): acknowledgements that come back without the
 * acknowledgement link, for when the host cannot be reached from a phone.
 *
 * Text replies. When the SMS channel is a gateway on the site network, the
 * server reads the phone's inbox: on the scheduler while a text it sent can
 * still be answered, or at once from Administration. A reply from a
 * recipient's number answers the latest send that texted that number while
 * its link is valid. A send that asks nothing is acknowledged by any reply;
 * one that asks a question takes an answer's number or its words, and any
 * other reply is kept and shown without recording anything. Each text is
 * read once, by the gateway's id. When texted activity logging is on, a text
 * starting with LOG or # is an activity entry (sms-activity.ts).
 *
 * The printed call-down sheet. Whoever runs a call-down by voice or radio
 * from a send's printed sheet enters afterward who was reached, when, and
 * their answer.
 */

/** How far the gateway's clock may run ahead of the server's and a reply still answer a text. */
const CLOCK_TOLERANCE_MS = 10 * 60_000;
const READ_TIMEOUT_MS = 10_000;

type Outcome = "acknowledged" | "answered" | "not_an_answer" | "unmatched" | "logged" | "refused";

export interface RepliesRead {
  readonly read: number;
  readonly acknowledged: number;
  readonly answered: number;
  readonly notAnAnswer: number;
  readonly unmatched: number;
  /** Activity texts filed on an activity log, and refused. */
  readonly logged: number;
  readonly refused: number;
}

/** The answer a reply picks, by its number or its words, or null when it picks none. */
export function replyChoice(text: string, options: readonly string[]): number | null {
  const reply = text.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "").toLowerCase();
  if (/^\d{1,2}$/.test(reply)) {
    const n = Number(reply) - 1;
    return n >= 0 && n < options.length ? n : null;
  }
  const i = options.findIndex((option) => option.toLowerCase() === reply);
  return i >= 0 ? i : null;
}

/**
 * Read the replies the jurisdiction's SMS gateway has received and record
 * what each answers. An administrator may; the scheduler acts as one.
 */
export async function readSmsReplies(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<RepliesRead> {
  requireAdmin(actor, jurisdictionId);
  const { stored, since, activitySince } = await withPerson(sql, actor.person.id, async (tx) => {
    const [channel] = await tx`
      select settings, secret_envelope, activity_log_since from notification_channels
      where jurisdiction_id = ${jurisdictionId} and kind = 'sms'`;
    const [open] = await tx`
      select min(r.notified_at) as since from mass_notification_recipients r
      join mass_notifications m on m.id = r.mass_notification_id
      where r.jurisdiction_id = ${jurisdictionId} and r.phone is not null
        and r.token_expires_at > now() and 'sms' = any(m.channels)`;
    return {
      stored: channel ? { settings: channel.settings as unknown, secret: channel.secret_envelope as string | null } as StoredChannel : null,
      since: (open?.since as Date | null | undefined) ?? null,
      activitySince: (channel?.activity_log_since as Date | null | undefined) ?? null,
    };
  });
  if ((stored?.settings as { provider?: unknown } | undefined)?.provider !== "gateway")
    throw new AuthError(409, "the SMS channel is not a gateway on the site network");
  const refused = await channelRefusal("sms", stored, []);
  if (refused) throw new AuthError(409, refused);
  const lookback = Date.now() - ACK_TTL_HOURS * 3_600_000;
  // Activity texts are read back as far as a reply is, and never from before logging was turned on.
  const activityFrom = activitySince ? Math.max(activitySince.getTime(), lookback) : Infinity;
  const from = new Date(Math.min(since?.getTime() ?? lookback, activityFrom) - CLOCK_TOLERANCE_MS);
  let texts: InboundSms[];
  try {
    texts = await readGatewayInbox(stored!, from, { timeoutMs });
  } catch (err) {
    throw new AuthError(502, `the SMS gateway could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const counts: Record<Outcome, number> = { acknowledged: 0, answered: 0, not_an_answer: 0, unmatched: 0, logged: 0, refused: 0 };
  const replies: Reply[] = [];
  const known = await withPerson(sql, actor.person.id, (tx) => tx`
    select gateway_message_id from sms_replies
    where jurisdiction_id = ${jurisdictionId} and gateway_message_id = any(${texts.map((t) => t.id)}::text[])`);
  const seen = new Set(known.map((k) => k.gateway_message_id as string));
  // Oldest first, so a later reply changes an answer last.
  for (const text of [...texts].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())) {
    if (seen.has(text.id)) continue;
    seen.add(text.id);
    // A text is read first now, by the server's clock, so once logging is on it may be an entry.
    const kept = await readOne(sql, actor, jurisdictionId, text, activitySince !== null);
    if (!kept) continue;
    counts[kept.outcome] += 1;
    if (kept.reply) replies.push(kept.reply);
  }
  // Replies go once each text is kept, so one that fails never files a text twice.
  // ponytail: best effort without a retry; the Channels screen shows what each text did and answered.
  for (const reply of replies) {
    await sendMessage("sms", stored!, { jurisdictionId, to: reply.to, subject: "", body: reply.body }, { timeoutMs })
      .catch(() => undefined);
  }
  return {
    read: Object.values(counts).reduce((sum, n) => sum + n, 0),
    acknowledged: counts.acknowledged,
    answered: counts.answered,
    notAnAnswer: counts.not_an_answer,
    unmatched: counts.unmatched,
    logged: counts.logged,
    refused: counts.refused,
  };
}

interface Kept {
  readonly outcome: Outcome;
  readonly reply: Reply | null;
}

/**
 * Keep one text with what it did, and what the phone answers when it may
 * still answer this hour. Null when another reader kept it first.
 */
async function keep(
  tx: Sql,
  jurisdictionId: string,
  text: InboundSms,
  row: {
    readonly outcome: Outcome; readonly refusal?: Refusal | null; readonly personId?: string | null;
    readonly recipientId?: string | null; readonly recordId?: string | null; readonly reply?: Reply | null;
  },
): Promise<Kept | null> {
  const reply = row.reply && await mayReply(tx, jurisdictionId) ? row.reply : null;
  const [inserted] = await tx`
    insert into sms_replies
      (jurisdiction_id, gateway_message_id, sender, body, received_at, recipient_id, outcome, refusal,
       person_id, record_id, reply)
    values (${jurisdictionId}, ${text.id}, ${text.sender}, ${text.text}, ${text.receivedAt},
            ${row.recipientId ?? null}, ${row.outcome}, ${row.refusal ?? null}, ${row.personId ?? null},
            ${row.recordId ?? null}, ${reply?.body ?? null})
    on conflict (jurisdiction_id, gateway_message_id) do nothing
    returning id`;
  return inserted ? { outcome: row.outcome, reply } : null;
}

/** SQLSTATEs worth another try: serialization failure, deadlock, lock not available. */
const TRANSIENT = new Set(["40001", "40P01", "55P03"]);
const TRIES = 3;

/**
 * One text in its own transaction, under the jurisdiction's reader lock, so
 * it is kept and answered once and the hourly limits count what every reader
 * kept, while no lock is held past the text. A transient failure is tried
 * again, and if it persists the text is left for the next read; any other
 * failure is kept as failed, and the other texts go on. Null when another
 * reader kept the text, or it is left for the next read.
 */
async function readOne(
  sql: Sql,
  reader: Principal,
  jurisdictionId: string,
  text: InboundSms,
  activityOn: boolean,
): Promise<Kept | null> {
  for (let tries = 1; tries <= TRIES; tries += 1) {
    try {
      return await withPerson(sql, reader.person.id, async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`sms-reader:${jurisdictionId}`}, 0))`;
        const [done] = await tx`
          select 1 from sms_replies where jurisdiction_id = ${jurisdictionId} and gateway_message_id = ${text.id}`;
        return done ? null : readText(tx, reader, jurisdictionId, text, activityOn);
      });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (typeof code === "string" && TRANSIENT.has(code)) continue;
      return withPerson(sql, reader.person.id, (tx) =>
        keep(tx, jurisdictionId, { ...text, receivedAt: new Date() }, { outcome: "refused", refusal: "failed" }))
        .catch(() => null);
    }
  }
  return null;
}

/**
 * What one text does: answer the latest send to its number, or, when
 * activity logging is on and it starts with LOG or #, file or refuse an
 * activity entry (sms-activity.ts). The product's own text coming back does
 * neither.
 */
async function readText(
  tx: Sql,
  reader: Principal,
  jurisdictionId: string,
  text: InboundSms,
  activityOn: boolean,
): Promise<Kept | null> {
  if (isEcho(text.text)) return keep(tx, jurisdictionId, text, { outcome: "refused", refusal: "echo" });
  const marked = activityOn && parseActivityText(text.text).marked;
  const digits = text.sender.replace(/\D/g, "");
  // A sender may come in national form, so numbers match on their last ten digits.
  const [recipient] = digits.length >= 7 && !marked ? await tx`
    select r.id, m.response_options from mass_notification_recipients r
    join mass_notifications m on m.id = r.mass_notification_id
    where r.jurisdiction_id = ${jurisdictionId} and 'sms' = any(m.channels) and r.notified_at is not null
      and right(regexp_replace(r.phone, '[^0-9]', '', 'g'), 10) = right(${digits}, 10)
      and r.notified_at <= ${new Date(text.receivedAt.getTime() + CLOCK_TOLERANCE_MS)}
      and r.token_expires_at > ${text.receivedAt}
    order by r.notified_at desc, r.id limit 1` : [];
  if (recipient) {
    const options = recipient.response_options as string[];
    const choice = options.length > 0 ? replyChoice(text.text, options) : null;
    const outcome = options.length === 0 ? "acknowledged" : choice === null ? "not_an_answer" : "answered";
    if (outcome !== "not_an_answer")
      await tx`select public.record_mass_acknowledgement(${recipient.id as string}, 'sms', ${choice}, ${text.receivedAt})`;
    return keep(tx, jurisdictionId, text, { outcome, recipientId: recipient.id as string });
  }
  if (!marked) return keep(tx, jurisdictionId, text, { outcome: "unmatched" });
  const decision = await decideActivity(tx, jurisdictionId, text);
  if (decision.kind === "unmatched") return keep(tx, jurisdictionId, text, { outcome: "unmatched" });
  if (decision.kind === "refused") return keep(tx, jurisdictionId, text, { outcome: "refused", ...decision });
  const { filing } = decision;
  const filed = await fileAsPerson(tx, reader.person.id, text, filing);
  if (filed === "refused") {
    return keep(tx, jurisdictionId, text,
      { outcome: "refused", refusal: "refused_by_log", personId: filing.personId, reply: refusedByLog(filing) });
  }
  await noticeFiled(tx, jurisdictionId, filing, filed.recordId);
  return keep(tx, jurisdictionId, text,
    { outcome: "logged", personId: filing.personId, recordId: filed.recordId, reply: confirmation(filing) });
}

/**
 * The scheduler's job: read each gateway that has replies to wait for. A
 * gateway that cannot be reached is logged and tried again on the next run.
 */
export async function readDueSmsReplies(sql: Sql, log: Pick<FastifyBaseLogger, "warn">): Promise<number> {
  const due = await sql`select * from sms_reply_readers()`;
  let read = 0;
  for (const row of due) {
    const jurisdictionId = row.jurisdiction_id as string;
    try {
      read += (await readSmsReplies(sql, await principalForPerson(sql, row.person_id as string), jurisdictionId)).read;
    } catch (err) {
      // ponytail: warns every run while a phone is off; back off per gateway if that is too loud.
      log.warn({ err, jurisdictionId }, "SMS gateway replies not read");
    }
  }
  return read;
}

const SheetEntries = z.object({
  entries: z.array(z.object({
    recipientId: z.string().uuid(),
    /** When they were reached; now when left out. */
    at: z.iso.datetime({ offset: true }).optional(),
    /** One of the send's answers, in its words, when the send asked a question. */
    response: z.string().trim().min(1).max(60).optional(),
  })).min(1).max(500),
});

export function carrierRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  /** The caller's numbers that may log activity by text where it is on, and whether each is confirmed. */
  app.get("/api/v1/me/sms-numbers", { preHandler: authenticate }, async (req, reply) =>
    reply.send({ numbers: await listActivityNumbers(sql, req.principal) }));

  const NumberBody = z.object({ jurisdictionId: z.string().uuid(), phone: E164 });
  /** Text a code to one of the caller's registered numbers. */
  app.post("/api/v1/me/sms-numbers/code", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId, phone } = NumberBody.parse(req.body);
    return reply.send(await sendActivityCode(sql, req.principal, jurisdictionId, phone));
  });
  /** Confirm the number with the code texted to it; only then does it file activity. */
  app.post("/api/v1/me/sms-numbers/confirm", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId, phone, code } = NumberBody.extend({ code: z.string().regex(/^\s*\d{6}\s*$/) }).parse(req.body);
    await confirmActivityNumber(sql, req.principal, jurisdictionId, phone, code);
    return reply.send({ confirmed: true });
  });

  /** Read the SMS gateway's replies now, as the scheduler does on its own. */
  app.post("/api/v1/jurisdictions/:jurisdictionId/sms-replies/read", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = z.object({ jurisdictionId: z.string().uuid() }).parse(req.params);
    return reply.send(await readSmsReplies(sql, req.principal, jurisdictionId));
  });

  /**
   * Enter acknowledgements from a send's printed call-down sheet: who was
   * reached, when, and the answer each gave. Writers of the send's
   * jurisdiction may. The entries are recorded together or not at all.
   */
  app.post("/api/v1/mass-notifications/:massNotificationId/acknowledgements", { preHandler: authenticate }, async (req, reply) => {
    const { massNotificationId } = z.object({ massNotificationId: z.string().uuid() }).parse(req.params);
    const { entries } = SheetEntries.parse(req.body);
    const recorded = await withPerson(sql, req.principal.person.id, async (tx) => {
      const [mass] = await tx`
        select jurisdiction_id, response_options from mass_notifications where id = ${massNotificationId}`;
      if (!mass) throw new AuthError(404, "mass notification not found");
      const jurisdictionId = mass.jurisdiction_id as string;
      requireWriter(req.principal, jurisdictionId);
      const options = mass.response_options as string[];
      const recipients = await tx`
        select id, name from mass_notification_recipients where mass_notification_id = ${massNotificationId}`;
      const names = new Map(recipients.map((r) => [r.id as string, r.name as string]));
      for (const entry of entries) {
        const name = names.get(entry.recipientId);
        if (!name) throw new AuthError(422, "an entry names someone this send did not reach");
        const choice = options.length > 0 ? options.indexOf(entry.response ?? "") : null;
        if (choice === -1) throw new AuthError(422, `choose one of the send's answers for ${name}`);
        const [row] = await tx`
          select public.record_mass_acknowledgement(${entry.recipientId}, 'sheet', ${choice}, ${entry.at ?? null}) as ok`;
        if (!row?.ok) throw new AuthError(422, `the acknowledgement for ${name} was not recorded`);
      }
      await recordAudit(tx, req.principal, {
        jurisdictionId,
        category: "notification.mass_acknowledgements_entered",
        subjectTable: "mass_notifications",
        subjectId: massNotificationId,
        payload: { via: "sheet", entries },
      });
      return entries.length;
    });
    return reply.send({ recorded });
  });
}
