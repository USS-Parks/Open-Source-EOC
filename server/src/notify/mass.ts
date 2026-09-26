import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, pageQuery } from "../db/cursor.js";
import { AuthError, requireMember, requireWriter, type Principal } from "../auth/service.js";
import { hashToken } from "../auth/tokens.js";
import { recordAudit } from "../audit/service.js";
import { audienceLabel, resolveAudience, type AudienceRecord } from "../contacts/reach.js";
import { rateLimit } from "../security/rate-limit.js";

/**
 * Mass notification: one message to contact groups, chosen contacts, the
 * holders of positions and whoever is on call in a position (see
 * contacts/reach.ts), by email, SMS and in-app notice. Each recipient and
 * channel becomes one notification and, for email and SMS, one row in the
 * delivery queue, so the worker's retries, dead letters and receipts apply
 * unchanged.
 *
 * A broadcast notifies every contact at once. A call-down notifies them one
 * at a time in order: when the current contact has not acknowledged within
 * the interval the scheduler notifies the next, and the call-down stops once
 * enough contacts have acknowledged or no one is left to call.
 *
 * A broadcast may fall back from one device to the next: its SMS and email
 * go in the order chosen, each later one queued to go once the fallback
 * minutes have passed on the one before, and withdrawn by the database when
 * the recipient acknowledges first. A recipient with no address for a channel
 * moves straight on to the next. In-app notices go at once.
 *
 * Email and SMS carry a link with a per-recipient token that acknowledges for
 * that recipient only, for ACK_TTL_HOURS after it is sent. The link opens a
 * page with one button, so a mail scanner that fetches links cannot
 * acknowledge by itself. In-app recipients acknowledge the notification.
 * When the SMS channel is a gateway on the site network, a text also says to
 * answer by reply, which contacts/carriers.ts reads back; whoever runs a
 * call-down from its printed sheet enters acknowledgements there too (AG-05).
 *
 * A mass send is not a notification rule and no rule rate cap applies. It is
 * bounded instead by its size, at most MAX_RECIPIENTS contacts from the
 * directory admins maintain, and by the delivery worker's pace.
 */

export const MAX_RECIPIENTS = 500;
export const ACK_TTL_HOURS = 24;
const ACK_TOKEN = /^[A-Za-z0-9_-]{22}$/;
/** Link visits per source address per minute. */
const ACK_PER_MINUTE = 30;

const Channel = z.enum(["email", "sms", "inapp"]);
const Ids = (max: number) => z.array(z.string().uuid()).min(1).max(max);
/** Whom a send reaches: any of these parts, together. */
export const AudienceSchema = z.object({
  groupIds: Ids(20).optional(),
  contactIds: Ids(MAX_RECIPIENTS).optional(),
  positionIds: Ids(50).optional(),
  onCallPositionIds: Ids(50).optional(),
});
const Fallback = z.number().int().min(1).max(1440);
/** The answers a send asks for, answered on the acknowledgement link (VA8). */
const ResponseOptions = z.array(z.string().trim().min(1).max(60)).max(6)
  .refine((options) => new Set(options).size === options.length, "each answer must differ from the others");
const SendBody = AudienceSchema.extend({
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(2000),
  /** One contact group, as sends named it before they took several. */
  groupId: z.string().uuid().optional(),
  /** In order; with a fallback, the order SMS and email are tried in. */
  channels: z.array(Channel).min(1).max(3),
  mode: z.enum(["broadcast", "calldown"]),
  intervalMinutes: z.number().int().min(1).max(1440).optional(),
  /** A broadcast's minutes to wait for an acknowledgement before the next device. */
  fallbackMinutes: Fallback.optional(),
  acknowledgementsNeeded: z.number().int().min(1).max(MAX_RECIPIENTS).default(1),
  responseOptions: ResponseOptions.optional(),
});
export type MassSend = z.input<typeof SendBody>;

/** The notice an activation sends: whom it reaches, how, and optionally its words and answers. */
export const ActivationNoticeSchema = AudienceSchema.extend({
  channels: z.array(Channel).min(1).max(3),
  message: z.string().trim().min(1).max(2000).optional(),
  fallbackMinutes: Fallback.optional(),
  responseOptions: ResponseOptions.optional(),
});
export type ActivationNotice = z.infer<typeof ActivationNoticeSchema>;

type Row = Record<string, unknown>;

interface Mass {
  readonly id: string;
  readonly jurisdiction_id: string;
  readonly subject: string;
  readonly message: string;
  readonly channels: string[];
  readonly link_base: string;
  readonly incident_id: string | null;
  readonly fallback_minutes: number | null;
  readonly response_options: readonly string[];
  /** Texts can be answered by reply: an SMS gateway on the site network reads them back (AG-05). */
  readonly replies: boolean;
}

/** The answers in words for a message: "A, B or C". */
function answerList(options: readonly string[]): string {
  return options.length > 1 ? `${options.slice(0, -1).join(", ")} or ${options.at(-1)}` : options[0] ?? "";
}

async function smsReadsReplies(tx: Sql, jurisdictionId: string): Promise<boolean> {
  const [row] = await tx`select public.sms_reads_replies(${jurisdictionId}) as yes`;
  return Boolean(row?.yes);
}

/** A text's closing line: how to answer by reply when replies are read, else by the link. */
function smsAsk(mass: Mass, link: string): string {
  const asks = mass.response_options.length > 0;
  if (mass.replies) {
    return asks
      ? `Reply ${answerList(mass.response_options.map((option, i) => `${i + 1} for ${option}`))}, or answer at ${link}`
      : `Reply to acknowledge, or open ${link}`;
  }
  return asks ? `Answer ${answerList(mass.response_options)}: ${link}` : `Acknowledge: ${link}`;
}

/** Where acknowledgement links point: OPENEOC_PUBLIC_URL when set, else the address the sender reached. */
export function ackLinkBase(req: FastifyRequest): string {
  return (process.env.OPENEOC_PUBLIC_URL || `${req.protocol}://${req.host}`).replace(/\/+$/, "");
}

/**
 * Notify one recipient: issue its acknowledgement token and write its
 * notifications, with a queued delivery for each email and SMS. A channel
 * the contact has no address for is skipped; the receipts show it as such.
 * With a fallback, each email or SMS after the first is queued to go that
 * many minutes after the one before, by the database's clock, and marked so
 * the recipient's acknowledgement withdraws it.
 */
async function notifyRecipient(tx: Sql, mass: Mass, recipient: Row, now: Date): Promise<void> {
  const token = randomBytes(16).toString("base64url");
  await tx`
    update mass_notification_recipients
    set notified_at = ${now}, token_hash = ${hashToken(token)},
        token_expires_at = ${new Date(now.getTime() + ACK_TTL_HOURS * 3_600_000)}
    where id = ${recipient.id as string}`;
  const link = `${mass.link_base}/api/v1/ack/${token}`;
  // An in-app notice of an incident's send opens that incident.
  const about = { massNotificationId: mass.id, ...(mass.incident_id ? { incidentId: mass.incident_id } : {}) };
  let wait = 0;
  for (const channel of mass.channels) {
    const personId = (recipient.person_id as string | null) ?? null;
    const positionId = personId ? null : ((recipient.position_id as string | null) ?? null);
    if (channel === "inapp") {
      if (!personId && !positionId) continue;
      await tx`
        insert into notifications
          (jurisdiction_id, person_id, position_id, channel, title, body, status, detail, mass_recipient_id)
        values
          (${mass.jurisdiction_id}, ${personId}, ${positionId}, 'inapp', ${mass.subject}, ${mass.message},
           'delivered', ${tx.json(about as never)}, ${recipient.id as string})`;
      continue;
    }
    const to = (channel === "email" ? recipient.email : recipient.phone) as string | null;
    if (!to) continue;
    const after = wait;
    wait += mass.fallback_minutes ?? 0;
    // Chosen here, not returned: a member may write a notification it may not read back.
    const notificationId = randomUUID();
    const detail = tx.json({ to, title: mass.subject, ...about } as never);
    await tx`
      insert into notifications (id, jurisdiction_id, channel, title, body, status, detail, mass_recipient_id)
      values
        (${notificationId}, ${mass.jurisdiction_id}, ${channel}, ${mass.subject}, ${mass.message}, 'pending',
         ${after > 0
           ? tx`${detail}::jsonb || jsonb_build_object('fallbackAt', now() + make_interval(mins => ${after}))`
           : detail},
         ${recipient.id as string})`;
    const asks = mass.response_options.length > 0;
    const body = channel === "email"
      ? asks
        ? `${mass.message}\n\nAnswer ${answerList(mass.response_options)} at this link:\n${link}\n`
        : `${mass.message}\n\nAcknowledge that you received this message:\n${link}\n`
      : `${mass.subject}: ${mass.message} ${smsAsk(mass, link)}`;
    const headers = channel === "email" ? { subject: mass.subject } : {};
    await tx`
      insert into delivery_outbox (jurisdiction_id, notification_id, kind, target, headers, body, next_attempt_at)
      values (${mass.jurisdiction_id}, ${notificationId}, ${channel}, ${to}, ${tx.json(headers as never)}, ${body},
              now() + make_interval(mins => ${after}))`;
  }
}

/**
 * Send a mass notification. `linkBase` is the address acknowledgement links
 * point at, such as https://eoc.example.org.
 */
export async function sendMassNotification(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: MassSend,
  linkBase: string,
  now = new Date(),
): Promise<{ id: string }> {
  requireWriter(actor, jurisdictionId);
  const body = SendBody.parse(input);
  const { id } = await withPerson(sql, actor.person.id, (tx) =>
    sendMassNotificationIn(tx, actor, jurisdictionId, body, linkBase, { now }));
  return { id };
}

/**
 * Send inside the caller's transaction, so an activation and its notice
 * commit together. Returns the send and how many recipients it reached.
 */
export async function sendMassNotificationIn(
  tx: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: MassSend,
  linkBase: string,
  options: { readonly now?: Date; readonly incidentId?: string } = {},
): Promise<{ id: string; recipients: number }> {
  requireWriter(actor, jurisdictionId);
  const body = SendBody.parse(input);
  const now = options.now ?? new Date();
  if (body.groupId && body.groupIds) throw new AuthError(422, "name one contact group or a list of groups, not both");
  const groupIds = body.groupId ? [body.groupId] : body.groupIds;
  if (!groupIds && !body.contactIds && !body.positionIds && !body.onCallPositionIds)
    throw new AuthError(422, "send to a contact group, chosen contacts, a position or whoever is on call");
  if (body.mode === "calldown" && body.intervalMinutes === undefined)
    throw new AuthError(422, "a call-down needs the minutes to wait for each acknowledgement");
  const channels = [...new Set(body.channels)];
  if (body.fallbackMinutes !== undefined && body.mode !== "broadcast")
    throw new AuthError(422, "a fallback applies to a broadcast; a call-down moves on to the next contact instead");
  if (body.fallbackMinutes !== undefined && channels.filter((c) => c !== "inapp").length < 2)
    throw new AuthError(422, "a fallback needs both SMS and email, in the order to try them");
  const { recipients: reached, audience } = await resolveAudience(tx, jurisdictionId, {
    groupIds, contactIds: body.contactIds, positionIds: body.positionIds, onCallPositionIds: body.onCallPositionIds,
  }, now);
  if (reached.length === 0)
    throw new AuthError(422, "no one to notify: what was chosen has no active contact, holder or person on shift");
  if (reached.length > MAX_RECIPIENTS) throw new AuthError(422, `send to at most ${MAX_RECIPIENTS} contacts at once`);
  // One group alone is also recorded as the send's group, as sends were before audiences.
  const soleGroup = audience.groups.length === 1 ? audience.groups[0]! : null;
  const [row] = await tx`
    insert into mass_notifications
      (jurisdiction_id, subject, message, group_id, group_name, channels, mode, interval_minutes,
       acknowledgements_needed, link_base, sent_by, created_at, incident_id, audience, fallback_minutes,
       response_options)
    values
      (${jurisdictionId}, ${body.subject}, ${body.message}, ${soleGroup?.id ?? null}, ${soleGroup?.name ?? null},
       ${channels}::text[], ${body.mode}, ${body.mode === "calldown" ? body.intervalMinutes! : null},
       ${body.acknowledgementsNeeded}, ${linkBase}, ${actor.person.id}, ${now}, ${options.incidentId ?? null},
       ${tx.json(audience as never)}, ${body.fallbackMinutes ?? null}, ${body.responseOptions ?? []}::text[])
    returning id`;
  const mass: Mass = {
    id: row!.id as string,
    jurisdiction_id: jurisdictionId,
    subject: body.subject,
    message: body.message,
    channels,
    link_base: linkBase,
    incident_id: options.incidentId ?? null,
    fallback_minutes: body.fallbackMinutes ?? null,
    response_options: body.responseOptions ?? [],
    replies: channels.includes("sms") && await smsReadsReplies(tx, jurisdictionId),
  };
  const column = <K extends keyof (typeof reached)[number]>(key: K) => reached.map((r) => r[key]);
  const recipients = await tx`
    insert into mass_notification_recipients
      (mass_notification_id, jurisdiction_id, priority, contact_id, name, email, phone, person_id, position_id,
       reached_through)
    select ${mass.id}, ${jurisdictionId}, x.priority, x.contact_id, x.name, x.email, x.phone, x.person_id,
           x.position_id, x.through
    from unnest(${column("contactId") as string[]}::uuid[], ${column("name")}::text[],
                ${column("email") as string[]}::text[], ${column("phone") as string[]}::text[],
                ${column("personId") as string[]}::uuid[], ${column("positionId") as string[]}::uuid[],
                ${column("through")}::text[])
      with ordinality as x(contact_id, name, email, phone, person_id, position_id, through, priority)
    returning id, priority, email, phone, person_id, position_id`;
  for (const recipient of recipients) {
    if (body.mode === "broadcast" || Number(recipient.priority) === 1) await notifyRecipient(tx, mass, recipient, now);
  }
  await recordAudit(tx, actor, {
    jurisdictionId,
    ...(options.incidentId ? { incidentId: options.incidentId } : {}),
    category: "notification.mass_sent",
    subjectTable: "mass_notifications",
    subjectId: mass.id,
    payload: {
      mode: body.mode, channels, recipients: reached.length, groupId: soleGroup?.id ?? null,
      audience: audienceLabel(audience, null), fallbackMinutes: body.fallbackMinutes ?? null,
    },
  });
  return { id: mass.id, recipients: reached.length };
}

/**
 * Advance the jurisdiction's open call-downs as of `now`: finish one that
 * has enough acknowledgements; when its current contact has acknowledged or
 * the interval has passed, notify the next contact, or finish it when no one
 * is left. The scheduler runs this as a jurisdiction admin; tests call it
 * directly with a clock. Returns how many contacts were notified.
 */
export async function runDueCalldowns(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  now = new Date(),
): Promise<number> {
  return withPerson(sql, actor.person.id, async (tx) => {
    // The row lock keeps an overlapping run during a leader handover from calling twice.
    const open = await tx`
      select id, jurisdiction_id, subject, message, channels, link_base, interval_minutes,
        acknowledgements_needed, incident_id, fallback_minutes, response_options
      from mass_notifications
      where jurisdiction_id = ${jurisdictionId} and mode = 'calldown' and completed_at is null
      order by created_at
      for update skip locked`;
    let notified = 0;
    const replies = open.length > 0 && await smsReadsReplies(tx, jurisdictionId);
    for (const mass of open) {
      const recipients = await tx`
        select id, priority, email, phone, person_id, position_id, notified_at, acknowledged_at
        from mass_notification_recipients where mass_notification_id = ${mass.id as string}
        order by priority`;
      const acknowledged = recipients.filter((r) => r.acknowledged_at).length;
      const latest = recipients.filter((r) => r.notified_at).at(-1);
      const next = recipients.find((r) => !r.notified_at);
      const waited = !latest || Boolean(latest.acknowledged_at)
        || (latest.notified_at as Date).getTime() <= now.getTime() - Number(mass.interval_minutes) * 60_000;
      if (acknowledged < Number(mass.acknowledgements_needed) && !waited) continue;
      if (acknowledged < Number(mass.acknowledgements_needed) && next) {
        await notifyRecipient(tx, { ...mass, replies } as unknown as Mass, next, now);
        notified += 1;
      } else {
        await tx`update mass_notifications set completed_at = ${now} where id = ${mass.id as string}`;
      }
    }
    return notified;
  });
}

type State = "sent" | "calling" | "acknowledged" | "unacknowledged";

function stateOf(r: Row): State {
  if (r.mode === "broadcast") return "sent";
  if (Number(r.acknowledged) >= Number(r.acknowledgements_needed)) return "acknowledged";
  return r.completed_at ? "unacknowledged" : "calling";
}

function summaryView(r: Row) {
  return {
    id: r.id as string,
    subject: r.subject as string,
    mode: r.mode as "broadcast" | "calldown",
    channels: r.channels as string[],
    groupName: r.group_name as string | null,
    audience: audienceLabel(r.audience as Partial<AudienceRecord> | null, r.group_name as string | null),
    incidentId: r.incident_id as string | null,
    intervalMinutes: r.interval_minutes as number | null,
    fallbackMinutes: r.fallback_minutes as number | null,
    acknowledgementsNeeded: r.acknowledgements_needed as number,
    sentBy: r.sent_by_name as string,
    createdAt: (r.created_at as Date).toISOString(),
    completedAt: r.completed_at ? (r.completed_at as Date).toISOString() : null,
    contactCount: Number(r.recipients),
    notified: Number(r.notified),
    acknowledged: Number(r.acknowledged),
    state: stateOf(r),
    // Each answer the send asked for, with how many chose it, in the order asked.
    responses: (r.response_options as string[]).map((option) => ({
      option,
      count: Number((r.response_counts as Record<string, number> | null)?.[option] ?? 0),
    })),
  };
}

async function readSummaries(
  tx: Sql,
  filter: { jurisdictionId?: string; id?: string; after?: string[] | null; limit?: number },
): Promise<Row[]> {
  return tx`
    select m.id, m.subject, m.message, m.mode, m.channels, m.group_name, m.interval_minutes,
      m.acknowledgements_needed, m.created_at, m.completed_at, m.jurisdiction_id,
      m.audience, m.incident_id, m.fallback_minutes, m.response_options,
      (select jsonb_object_agg(x.response, x.n) from (
         select r.response, count(*) as n from mass_notification_recipients r
         where r.mass_notification_id = m.id and r.response is not null group by r.response) x) as response_counts,
      p.display_name as sent_by_name,
      to_char(m.created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at,
      (select count(*) from mass_notification_recipients r where r.mass_notification_id = m.id) as recipients,
      (select count(r.notified_at) from mass_notification_recipients r where r.mass_notification_id = m.id) as notified,
      (select count(r.acknowledged_at) from mass_notification_recipients r where r.mass_notification_id = m.id) as acknowledged
    from mass_notifications m
    join persons p on p.id = m.sent_by
    where true
      ${filter.jurisdictionId ? tx`and m.jurisdiction_id = ${filter.jurisdictionId}` : tx``}
      ${filter.id ? tx`and m.id = ${filter.id}` : tx``}
      ${filter.after ? tx`and (m.created_at, m.id) < (${filter.after[0]!}::text::timestamptz, ${filter.after[1]!}::uuid)` : tx``}
    order by m.created_at desc, m.id desc
    limit ${filter.limit ?? 1}`;
}

/**
 * A delivery's state in plain terms: scheduled, a fallback waiting its turn;
 * queued; retrying, which the screen calls waiting for a route; sent; failed,
 * when refused; expired, when held past its window with no route; or, in the
 * app, delivered.
 */
function deliveryState(d: Row, now: Date): "scheduled" | "queued" | "retrying" | "sent" | "failed" | "expired" | "delivered" {
  if (d.channel === "inapp") return "delivered";
  if (d.status === "delivered") return "sent";
  if (d.status === "expired") return "expired";
  if (d.status === "dead" || d.status === "failed") return "failed";
  if (d.error) return "retrying";
  return Number(d.attempts) === 0 && d.due_at && (d.due_at as Date).getTime() > now.getTime() ? "scheduled" : "queued";
}

/** The public link's pages: plain HTML, no data beyond what the page says. */
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * `answers` null shows no form; empty, one Acknowledge button; otherwise a
 * button for each answer, which posts its place in the list.
 */
function ackPage(reply: FastifyReply, status: number, title: string, text: string, answers: readonly string[] | null) {
  const buttons = answers?.length
    ? answers.map((answer, i) => `<button type="submit" name="response" value="${i}">${escapeHtml(answer)}</button>`).join(" ")
    : `<button type="submit">Acknowledge</button>`;
  const form = answers ? `<form method="post" enctype="text/plain">${buttons}</form>` : "";
  return reply
    .status(status)
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .header("content-security-policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
    .send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:32rem;padding:0 1rem;line-height:1.5}
button{font:inherit;padding:.75rem 1.5rem;min-height:44px;margin:0 .5rem .5rem 0}</style></head>
<body><h1>${title}</h1><p>${text}</p>${form}</body></html>`);
}

export function massNotificationRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/mass-notifications",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = z.object({ jurisdictionId: z.string().uuid() }).parse(req.params);
      requireMember(req.principal, jurisdictionId);
      const page = z.object(pageQuery).parse(req.query);
      const after = decodeCursor(page.cursor, ["at", "id"]);
      const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
      const rows = await withPerson(sql, req.principal.person.id, (tx) =>
        readSummaries(tx, { jurisdictionId, after, limit: limit + 1 }),
      );
      const cut = cutPage(rows, limit, (r) => [r.page_at as string, r.id as string]);
      return reply.send({ massNotifications: cut.items.map(summaryView), nextCursor: cut.nextCursor });
    },
  );

  /**
   * Send. Acknowledgement links point at OPENEOC_PUBLIC_URL when it is set,
   * otherwise at the address the sender reached this server on.
   */
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/mass-notifications",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = z.object({ jurisdictionId: z.string().uuid() }).parse(req.params);
      const sent = await sendMassNotification(sql, req.principal, jurisdictionId, req.body as MassSend, ackLinkBase(req));
      return reply.status(201).send(sent);
    },
  );

  app.get("/api/v1/mass-notifications/:massNotificationId", { preHandler: authenticate }, async (req, reply) => {
    const { massNotificationId } = z.object({ massNotificationId: z.string().uuid() }).parse(req.params);
    const detail = await withPerson(sql, req.principal.person.id, async (tx) => {
      const [mass] = await readSummaries(tx, { id: massNotificationId });
      if (!mass) throw new AuthError(404, "mass notification not found");
      requireMember(req.principal, mass.jurisdiction_id as string);
      const recipients = await tx`
        select id, priority, contact_id, name, email, phone, person_id, position_id,
          notified_at, token_expires_at, acknowledged_at, acknowledged_via, reached_through, response
        from mass_notification_recipients where mass_notification_id = ${massNotificationId}
        order by priority`;
      const deliveries = await tx`select * from mass_notification_deliveries(${massNotificationId})`;
      // Texts read back from an SMS gateway, each with what it recorded.
      const replies = await tx`
        select s.recipient_id, s.body, s.received_at, s.outcome from sms_replies s
        join mass_notification_recipients r on r.id = s.recipient_id
        where r.mass_notification_id = ${massNotificationId}
        order by s.received_at, s.id`;
      const [clock] = await tx`select now() as now`;
      const now = clock!.now as Date;
      return {
        ...summaryView(mass),
        message: mass.message as string,
        recipients: recipients.map((r) => ({
          id: r.id as string,
          priority: r.priority as number,
          contactId: r.contact_id as string | null,
          name: r.name as string,
          email: r.email as string | null,
          phone: r.phone as string | null,
          inApp: Boolean(r.person_id || r.position_id),
          reachedThrough: r.reached_through as string | null,
          response: r.response as string | null,
          notifiedAt: r.notified_at ? (r.notified_at as Date).toISOString() : null,
          linkExpiresAt: r.token_expires_at ? (r.token_expires_at as Date).toISOString() : null,
          acknowledgedAt: r.acknowledged_at ? (r.acknowledged_at as Date).toISOString() : null,
          acknowledgedVia: r.acknowledged_via as "link" | "app" | "sms" | "sheet" | null,
          replies: replies
            .filter((s) => s.recipient_id === r.id)
            .map((s) => ({
              body: s.body as string,
              receivedAt: (s.received_at as Date).toISOString(),
              outcome: s.outcome as "acknowledged" | "answered" | "not_an_answer",
            })),
          deliveries: deliveries
            .filter((d) => d.recipient_id === r.id)
            .map((d) => ({
              channel: d.channel as "email" | "sms" | "inapp",
              address: d.address as string | null,
              state: deliveryState(d, now),
              attempts: Number(d.attempts),
              error: d.error as string | null,
              receipt: d.receipt as Record<string, unknown> | null,
              at: (d.updated_at as Date).toISOString(),
              dueAt: d.due_at ? (d.due_at as Date).toISOString() : null,
            })),
        })),
      };
    });
    return reply.send(detail);
  });

  // The acknowledgement link. No sign-in: the token alone names one
  // recipient of one send. Opening it shows a button; pressing the button
  // records the acknowledgement. Neither page shows anything about the send.
  // A send that asks a question shows its answers instead, and the answer
  // chosen is the acknowledgement; the recipient may change it later.
  const acknowledge = async (req: FastifyRequest, reply: FastifyReply, record: boolean) => {
    if (!rateLimit(`ack:${req.ip}`, ACK_PER_MINUTE, 60_000).allowed)
      return ackPage(reply, 429, "Try again shortly", "Too many requests from this address. Wait a minute and try again.", null);
    const invalid = () => ackPage(reply, 404, "Link not valid", "This acknowledgement link is not valid or has expired.", null);
    const { token } = req.params as { token: string };
    if (!ACK_TOKEN.test(token)) return invalid();
    const hashed = hashToken(token);
    const [found] = await sql`select mass_token_options(${hashed}) as options`;
    const answers = found?.options as string[] | null | undefined;
    if (!answers) return invalid();
    const ask = answers.length > 0;
    const choose = (status: number, text: string) => ackPage(reply, status, ask ? "Answer this message" : "Acknowledge this message", text, answers);
    if (!record)
      return choose(200, ask ? "Choose your answer. It is recorded as your acknowledgement." : "Select Acknowledge to confirm that you received the message.");
    const picked = /(?:^|\n)response=(\d{1,2})\r?(?:\n|$)/.exec(typeof req.body === "string" ? req.body : "");
    const choice = ask && picked ? Number(picked[1]) : null;
    if (ask && (choice === null || choice >= answers.length)) return choose(400, "Choose one of the answers.");
    const [row] = await sql`select acknowledge_mass_token(${hashed}, true, ${choice}) as ok`;
    if (!row?.ok) return invalid();
    return ackPage(reply, 200, "Acknowledged", ask
      ? `Your answer, ${escapeHtml(answers[choice!]!)}, is recorded. You can close this page, or open the link again to change it.`
      : "Your acknowledgement is recorded. You can close this page.", null);
  };
  app.get("/api/v1/ack/:token", (req, reply) => acknowledge(req, reply, false));
  app.post("/api/v1/ack/:token", (req, reply) => acknowledge(req, reply, true));
}
