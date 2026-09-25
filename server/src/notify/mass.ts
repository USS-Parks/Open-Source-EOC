import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, pageQuery } from "../db/cursor.js";
import { AuthError, requireMember, requireWriter, type Principal } from "../auth/service.js";
import { hashToken } from "../auth/tokens.js";
import { recordAudit } from "../audit/service.js";
import { rateLimit } from "../security/rate-limit.js";

/**
 * Mass notification: one message to a contact group or a list of contacts,
 * by email, SMS and in-app notice. Each contact and channel becomes one
 * notification and, for email and SMS, one row in the delivery queue, so the
 * worker's retries, dead letters and receipts apply unchanged.
 *
 * A broadcast notifies every contact at once. A call-down notifies them one
 * at a time in order: when the current contact has not acknowledged within
 * the interval the scheduler notifies the next, and the call-down stops once
 * enough contacts have acknowledged or no one is left to call.
 *
 * Email and SMS carry a link with a per-recipient token that acknowledges for
 * that recipient only, for ACK_TTL_HOURS after it is sent. The link opens a
 * page with one button, so a mail scanner that fetches links cannot
 * acknowledge by itself. In-app recipients acknowledge the notification.
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
const SendBody = z.object({
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(2000),
  groupId: z.string().uuid().optional(),
  contactIds: z.array(z.string().uuid()).min(1).max(MAX_RECIPIENTS).optional(),
  channels: z.array(Channel).min(1).max(3),
  mode: z.enum(["broadcast", "calldown"]),
  intervalMinutes: z.number().int().min(1).max(1440).optional(),
  acknowledgementsNeeded: z.number().int().min(1).max(MAX_RECIPIENTS).default(1),
});
export type MassSend = z.input<typeof SendBody>;

type Row = Record<string, unknown>;

interface Mass {
  readonly id: string;
  readonly jurisdiction_id: string;
  readonly subject: string;
  readonly message: string;
  readonly channels: string[];
  readonly link_base: string;
}

/**
 * Notify one recipient: issue its acknowledgement token and write its
 * notifications, with a queued delivery for each email and SMS. A channel
 * the contact has no address for is skipped; the receipts show it as such.
 */
async function notifyRecipient(tx: Sql, mass: Mass, recipient: Row, now: Date): Promise<void> {
  const token = randomBytes(16).toString("base64url");
  await tx`
    update mass_notification_recipients
    set notified_at = ${now}, token_hash = ${hashToken(token)},
        token_expires_at = ${new Date(now.getTime() + ACK_TTL_HOURS * 3_600_000)}
    where id = ${recipient.id as string}`;
  const link = `${mass.link_base}/api/v1/ack/${token}`;
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
           'delivered', ${tx.json({ massNotificationId: mass.id } as never)}, ${recipient.id as string})`;
      continue;
    }
    const to = (channel === "email" ? recipient.email : recipient.phone) as string | null;
    if (!to) continue;
    // Chosen here, not returned: a member may write a notification it may not read back.
    const notificationId = randomUUID();
    await tx`
      insert into notifications (id, jurisdiction_id, channel, title, body, status, detail, mass_recipient_id)
      values
        (${notificationId}, ${mass.jurisdiction_id}, ${channel}, ${mass.subject}, ${mass.message}, 'pending',
         ${tx.json({ to, title: mass.subject, massNotificationId: mass.id } as never)}, ${recipient.id as string})`;
    const body = channel === "email"
      ? `${mass.message}\n\nAcknowledge that you received this message:\n${link}\n`
      : `${mass.subject}: ${mass.message} Acknowledge: ${link}`;
    const headers = channel === "email" ? { subject: mass.subject } : {};
    await tx`
      insert into delivery_outbox (jurisdiction_id, notification_id, kind, target, headers, body)
      values (${mass.jurisdiction_id}, ${notificationId}, ${channel}, ${to}, ${tx.json(headers as never)}, ${body})`;
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
  if ((body.groupId === undefined) === (body.contactIds === undefined))
    throw new AuthError(422, "send to a contact group or to a list of contacts");
  if (body.mode === "calldown" && body.intervalMinutes === undefined)
    throw new AuthError(422, "a call-down needs the minutes to wait for each acknowledgement");
  const channels = [...new Set(body.channels)];
  return withPerson(sql, actor.person.id, async (tx) => {
    let groupName: string | null = null;
    let contacts: Row[];
    if (body.groupId) {
      const [group] = await tx`
        select name from contact_groups where id = ${body.groupId} and jurisdiction_id = ${jurisdictionId}`;
      if (!group) throw new AuthError(404, "contact group not found");
      groupName = group.name as string;
      contacts = await tx`
        select c.id, c.name, c.emails, c.phones, c.person_id, c.position_id
        from contact_group_members m join contacts c on c.id = m.contact_id
        where m.group_id = ${body.groupId} and c.active
        order by m.priority`;
    } else {
      const ids = [...new Set(body.contactIds)];
      const found = await tx`
        select id, name, emails, phones, person_id, position_id from contacts
        where jurisdiction_id = ${jurisdictionId} and active and id = any(${ids}::uuid[])`;
      const byId = new Map(found.map((c) => [c.id as string, c]));
      if (byId.size !== ids.length) throw new AuthError(422, "every contact must be an active contact in this jurisdiction");
      contacts = ids.map((id) => byId.get(id)!);
    }
    if (contacts.length === 0) throw new AuthError(422, "the group has no active contacts");
    if (contacts.length > MAX_RECIPIENTS) throw new AuthError(422, `send to at most ${MAX_RECIPIENTS} contacts at once`);
    const [row] = await tx`
      insert into mass_notifications
        (jurisdiction_id, subject, message, group_id, group_name, channels, mode, interval_minutes,
         acknowledgements_needed, link_base, sent_by, created_at)
      values
        (${jurisdictionId}, ${body.subject}, ${body.message}, ${body.groupId ?? null}, ${groupName},
         ${channels}::text[], ${body.mode}, ${body.mode === "calldown" ? body.intervalMinutes! : null},
         ${body.acknowledgementsNeeded}, ${linkBase}, ${actor.person.id}, ${now})
      returning id`;
    const mass: Mass = {
      id: row!.id as string,
      jurisdiction_id: jurisdictionId,
      subject: body.subject,
      message: body.message,
      channels,
      link_base: linkBase,
    };
    const recipients = await tx`
      insert into mass_notification_recipients
        (mass_notification_id, jurisdiction_id, priority, contact_id, name, email, phone, person_id, position_id)
      select ${mass.id}, ${jurisdictionId}, x.priority, x.id, c.name, c.emails[1], c.phones[1],
             c.person_id, c.position_id
      from unnest(${contacts.map((c) => c.id as string)}::uuid[]) with ordinality as x(id, priority)
      join contacts c on c.id = x.id
      returning id, priority, email, phone, person_id, position_id`;
    for (const recipient of recipients) {
      if (body.mode === "broadcast" || Number(recipient.priority) === 1) await notifyRecipient(tx, mass, recipient, now);
    }
    await recordAudit(tx, actor, {
      jurisdictionId,
      category: "notification.mass_sent",
      subjectTable: "mass_notifications",
      subjectId: mass.id,
      payload: { mode: body.mode, channels, recipients: contacts.length, groupId: body.groupId ?? null },
    });
    return { id: mass.id };
  });
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
        acknowledgements_needed
      from mass_notifications
      where jurisdiction_id = ${jurisdictionId} and mode = 'calldown' and completed_at is null
      order by created_at
      for update skip locked`;
    let notified = 0;
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
        await notifyRecipient(tx, mass as unknown as Mass, next, now);
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
    intervalMinutes: r.interval_minutes as number | null,
    acknowledgementsNeeded: r.acknowledgements_needed as number,
    sentBy: r.sent_by_name as string,
    createdAt: (r.created_at as Date).toISOString(),
    completedAt: r.completed_at ? (r.completed_at as Date).toISOString() : null,
    contactCount: Number(r.recipients),
    notified: Number(r.notified),
    acknowledged: Number(r.acknowledged),
    state: stateOf(r),
  };
}

async function readSummaries(
  tx: Sql,
  filter: { jurisdictionId?: string; id?: string; after?: string[] | null; limit?: number },
): Promise<Row[]> {
  return tx`
    select m.id, m.subject, m.message, m.mode, m.channels, m.group_name, m.interval_minutes,
      m.acknowledgements_needed, m.created_at, m.completed_at, m.jurisdiction_id,
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
 * A delivery's state in plain terms: queued; retrying, which the screen calls
 * waiting for a route; sent; failed, when refused; expired, when held past
 * its window with no route; or, in the app, delivered.
 */
function deliveryState(d: Row): "queued" | "retrying" | "sent" | "failed" | "expired" | "delivered" {
  if (d.channel === "inapp") return "delivered";
  if (d.status === "delivered") return "sent";
  if (d.status === "expired") return "expired";
  if (d.status === "dead" || d.status === "failed") return "failed";
  return d.error ? "retrying" : "queued";
}

/** The public link's pages: plain HTML, no data beyond what the page says. */
function ackPage(reply: FastifyReply, status: number, title: string, text: string, button: boolean) {
  const form = button
    ? `<form method="post" enctype="text/plain"><button type="submit">Acknowledge</button></form>`
    : "";
  return reply
    .status(status)
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .header("content-security-policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
    .send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:32rem;padding:0 1rem;line-height:1.5}
button{font:inherit;padding:.75rem 1.5rem;min-height:44px}</style></head>
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
      const linkBase = (process.env.OPENEOC_PUBLIC_URL || `${req.protocol}://${req.host}`).replace(/\/+$/, "");
      const sent = await sendMassNotification(sql, req.principal, jurisdictionId, req.body as MassSend, linkBase);
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
          notified_at, token_expires_at, acknowledged_at, acknowledged_via
        from mass_notification_recipients where mass_notification_id = ${massNotificationId}
        order by priority`;
      const deliveries = await tx`select * from mass_notification_deliveries(${massNotificationId})`;
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
          notifiedAt: r.notified_at ? (r.notified_at as Date).toISOString() : null,
          linkExpiresAt: r.token_expires_at ? (r.token_expires_at as Date).toISOString() : null,
          acknowledgedAt: r.acknowledged_at ? (r.acknowledged_at as Date).toISOString() : null,
          acknowledgedVia: r.acknowledged_via as "link" | "app" | null,
          deliveries: deliveries
            .filter((d) => d.recipient_id === r.id)
            .map((d) => ({
              channel: d.channel as "email" | "sms" | "inapp",
              address: d.address as string | null,
              state: deliveryState(d),
              attempts: Number(d.attempts),
              error: d.error as string | null,
              receipt: d.receipt as Record<string, unknown> | null,
              at: (d.updated_at as Date).toISOString(),
            })),
        })),
      };
    });
    return reply.send(detail);
  });

  // The acknowledgement link. No sign-in: the token alone names one
  // recipient of one send. Opening it shows a button; pressing the button
  // records the acknowledgement. Neither page shows anything about the send.
  const acknowledge = async (req: FastifyRequest, reply: FastifyReply, record: boolean) => {
    if (!rateLimit(`ack:${req.ip}`, ACK_PER_MINUTE, 60_000).allowed)
      return ackPage(reply, 429, "Try again shortly", "Too many requests from this address. Wait a minute and try again.", false);
    const { token } = req.params as { token: string };
    const [row] = ACK_TOKEN.test(token)
      ? await sql`select acknowledge_mass_token(${hashToken(token)}, ${record}) as ok`
      : [{ ok: false }];
    if (!row?.ok)
      return ackPage(reply, 404, "Link not valid", "This acknowledgement link is not valid or has expired.", false);
    return record
      ? ackPage(reply, 200, "Acknowledged", "Your acknowledgement is recorded. You can close this page.", false)
      : ackPage(reply, 200, "Acknowledge this message", "Select Acknowledge to confirm that you received the message.", true);
  };
  app.get("/api/v1/ack/:token", (req, reply) => acknowledge(req, reply, false));
  app.post("/api/v1/ack/:token", (req, reply) => acknowledge(req, reply, true));
}
