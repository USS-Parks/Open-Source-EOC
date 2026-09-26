import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError, principalForPerson, requireAdmin, requireWriter, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { channelRefusal, readGatewayInbox, type InboundSms, type StoredChannel } from "../notify/channels.js";
import { ACK_TTL_HOURS } from "../notify/mass.js";

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
 * read once, by the gateway's id.
 *
 * The printed call-down sheet. Whoever runs a call-down by voice or radio
 * from a send's printed sheet enters afterward who was reached, when, and
 * their answer.
 */

/** How far the gateway's clock may run ahead of the server's and a reply still answer a text. */
const CLOCK_TOLERANCE_MS = 10 * 60_000;
const READ_TIMEOUT_MS = 10_000;

type Outcome = "acknowledged" | "answered" | "not_an_answer" | "unmatched";

export interface RepliesRead {
  readonly read: number;
  readonly acknowledged: number;
  readonly answered: number;
  readonly notAnAnswer: number;
  readonly unmatched: number;
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
  const { stored, since } = await withPerson(sql, actor.person.id, async (tx) => {
    const [channel] = await tx`
      select settings, secret_envelope from notification_channels
      where jurisdiction_id = ${jurisdictionId} and kind = 'sms'`;
    const [open] = await tx`
      select min(r.notified_at) as since from mass_notification_recipients r
      join mass_notifications m on m.id = r.mass_notification_id
      where r.jurisdiction_id = ${jurisdictionId} and r.phone is not null
        and r.token_expires_at > now() and 'sms' = any(m.channels)`;
    return {
      stored: channel ? { settings: channel.settings as unknown, secret: channel.secret_envelope as string | null } as StoredChannel : null,
      since: (open?.since as Date | null | undefined) ?? null,
    };
  });
  if ((stored?.settings as { provider?: unknown } | undefined)?.provider !== "gateway")
    throw new AuthError(409, "the SMS channel is not a gateway on the site network");
  const refused = await channelRefusal("sms", stored, []);
  if (refused) throw new AuthError(409, refused);
  const from = new Date((since?.getTime() ?? Date.now() - ACK_TTL_HOURS * 3_600_000) - CLOCK_TOLERANCE_MS);
  let texts: InboundSms[];
  try {
    texts = await readGatewayInbox(stored!, from, { timeoutMs });
  } catch (err) {
    throw new AuthError(502, `the SMS gateway could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  return withPerson(sql, actor.person.id, async (tx) => {
    const counts: Record<Outcome, number> = { acknowledged: 0, answered: 0, not_an_answer: 0, unmatched: 0 };
    const known = await tx`
      select gateway_message_id from sms_replies
      where jurisdiction_id = ${jurisdictionId} and gateway_message_id = any(${texts.map((t) => t.id)}::text[])`;
    const seen = new Set(known.map((k) => k.gateway_message_id as string));
    // Oldest first, so a later reply changes an answer last.
    for (const text of [...texts].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())) {
      if (seen.has(text.id)) continue;
      seen.add(text.id);
      const digits = text.sender.replace(/\D/g, "");
      // A sender may come in national form, so numbers match on their last ten digits.
      const [recipient] = digits.length >= 7 ? await tx`
        select r.id, m.response_options from mass_notification_recipients r
        join mass_notifications m on m.id = r.mass_notification_id
        where r.jurisdiction_id = ${jurisdictionId} and 'sms' = any(m.channels) and r.notified_at is not null
          and right(regexp_replace(r.phone, '[^0-9]', '', 'g'), 10) = right(${digits}, 10)
          and r.notified_at <= ${new Date(text.receivedAt.getTime() + CLOCK_TOLERANCE_MS)}
          and r.token_expires_at > ${text.receivedAt}
        order by r.notified_at desc, r.id limit 1` : [];
      let outcome: Outcome = "unmatched";
      if (recipient) {
        const options = recipient.response_options as string[];
        const choice = options.length > 0 ? replyChoice(text.text, options) : null;
        outcome = options.length === 0 ? "acknowledged" : choice === null ? "not_an_answer" : "answered";
        if (outcome !== "not_an_answer")
          await tx`select public.record_mass_acknowledgement(${recipient.id as string}, 'sms', ${choice}, ${text.receivedAt})`;
      }
      await tx`
        insert into sms_replies (jurisdiction_id, gateway_message_id, sender, body, received_at, recipient_id, outcome)
        values (${jurisdictionId}, ${text.id}, ${text.sender}, ${text.text}, ${text.receivedAt},
                ${(recipient?.id as string | undefined) ?? null}, ${outcome})
        on conflict (jurisdiction_id, gateway_message_id) do nothing`;
      counts[outcome] += 1;
    }
    return {
      read: Object.values(counts).reduce((sum, n) => sum + n, 0),
      acknowledged: counts.acknowledged,
      answered: counts.answered,
      notAnAnswer: counts.not_an_answer,
      unmatched: counts.unmatched,
    };
  });
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
