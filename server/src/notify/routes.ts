import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, decodeCursor, encodeCursor, pageQuery } from "../db/cursor.js";
import { AuthError, requireAdmin, requireMember, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { encryptSecret, fingerprint, hasSecretKey } from "../secrets/envelope.js";
import { admittedBy, normalizeEntry } from "./allowlist.js";
import {
  E164,
  EmailSettings,
  SmsSettings,
  channelRefusal,
  fixtureMessages,
  sendMessage,
  type MessageKind,
} from "./channels.js";
import { ChannelSchema, ConditionSchema, runScheduledRules, type Channel } from "./engine.js";

/** The outbound delivery kinds a hold window applies to. */
const DELIVERY_KINDS = ["email", "sms", "webhook", "ntfy"] as const;
/** How long a delivery waits for a route when its jurisdiction set no window (decision 2). */
const DEFAULT_HOLD_HOURS = 72;
/** The longest window an administrator may set: thirty days. */
const MAX_HOLD_HOURS = 720;
const RuleEvent = z.enum(["record.created", "record.updated", "scheduled"]);
// External deliveries a rule may queue per window; the rest are suppressed.
const RateLimit = z.object({
  max: z.number().int().min(1).max(600),
  windowMinutes: z.number().int().min(1).max(1440),
});
const RuleBody = z.object({
  boardId: z.string().uuid().nullable().default(null),
  event: RuleEvent,
  condition: ConditionSchema.default({ op: "any" }),
  channels: z.array(ChannelSchema).min(1),
  scheduleIntervalMinutes: z.number().int().positive().optional(),
  rateLimit: RateLimit.default({ max: 60, windowMinutes: 10 }),
});
/** A change to a rule: any of its fields, and whether it is paused. */
const RulePatch = z.object({
  enabled: z.boolean(),
  boardId: z.string().uuid().nullable(),
  event: RuleEvent,
  condition: ConditionSchema,
  channels: z.array(ChannelSchema).min(1),
  scheduleIntervalMinutes: z.number().int().positive().nullable(),
  rateLimit: RateLimit,
}).partial().strict();
const RuleParams = z.object({ ruleId: z.string().uuid() });

/**
 * Refuse a channel whose destination is off the jurisdiction's allowlist, or
 * an email or SMS channel the jurisdiction has not configured.
 */
async function checkChannels(tx: Sql, jurisdictionId: string, channels: readonly Channel[]): Promise<void> {
  const [list] = await tx`
    select entries from notification_allowlists where jurisdiction_id = ${jurisdictionId}`;
  const configured = await tx`
    select kind from notification_channels where jurisdiction_id = ${jurisdictionId}`;
  for (const channel of channels) {
    if ((channel.kind === "webhook" || channel.kind === "ntfy") && !admittedBy((list?.entries as string[]) ?? [], channel.url))
      throw new AuthError(422, `${channel.url} is not on this jurisdiction's notification allowlist`);
    if ((channel.kind === "email" || channel.kind === "sms") && !configured.some((c) => c.kind === channel.kind))
      throw new AuthError(422, `configure the ${channel.kind === "email" ? "email" : "SMS"} channel before adding a rule that uses it`);
  }
}

/** A live rule the caller administers, under row-level security; anything else is not found. */
async function administeredRule(tx: Sql, actor: Principal, ruleId: string): Promise<Record<string, unknown>> {
  const [rule] = await tx`select * from notification_rules where id = ${ruleId} and removed_at is null`;
  if (!rule) throw new AuthError(404, "notification rule not found");
  requireAdmin(actor, rule.jurisdiction_id as string);
  return rule;
}

const AllowlistBody = z.object({ entries: z.array(z.string().min(1).max(300)).max(100) });

const ChannelParams = z.object({ jurisdictionId: z.string().uuid(), kind: z.enum(["email", "sms"]) });
const ChannelBody = z.object({
  settings: z.unknown(),
  // The relay password or provider token; omit it to keep the stored one.
  secret: z.string().min(1).max(500).optional(),
});

const TEST_SUBJECT = "OpenEOC test message";
const TEST_BODY = "This is a test message from OpenEOC. The channel is working.";

async function channelView(tx: Sql, jurisdictionId: string, kind: MessageKind) {
  const [row] = await tx`
    select settings, secret_fingerprint, updated_at from notification_channels
    where jurisdiction_id = ${jurisdictionId} and kind = ${kind}`;
  return {
    kind,
    settings: (row?.settings as Record<string, unknown> | undefined) ?? null,
    credentialFingerprint: (row?.secret_fingerprint as string | null | undefined) ?? null,
    updatedAt: row ? (row.updated_at as Date).toISOString() : null,
    secretStorageAvailable: hasSecretKey(),
    ...(kind === "sms" ? { fixtureMessages: fixtureMessages(jurisdictionId).slice(0, 20) } : {}),
  };
}

export function notifyRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/notification-rules",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const m = req.principal.memberships.find((x) => x.jurisdictionId === jurisdictionId);
      if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
      const body = RuleBody.parse(req.body);
      const needsSecret = body.channels.some((c) => c.kind === "webhook");
      const secret = needsSecret ? randomBytes(24).toString("hex") : null;
      const id = await withPerson(sql, req.principal.person.id, async (tx) => {
        await checkChannels(tx, jurisdictionId, body.channels);
        const [row] = await tx`
          insert into notification_rules
            (jurisdiction_id, board_id, event, condition, channels, webhook_secret,
             schedule_interval_minutes, rate_limit_max, rate_limit_window_minutes, created_by)
          values
            (${jurisdictionId}, ${body.boardId}, ${body.event},
             ${tx.json(body.condition as never)}, ${tx.json(body.channels as never)},
             ${secret}, ${body.scheduleIntervalMinutes ?? null}, ${body.rateLimit.max},
             ${body.rateLimit.windowMinutes}, ${req.principal.person.id})
          returning id`;
        await recordAudit(tx, req.principal, {
          jurisdictionId,
          category: "notification.rule_created",
          subjectTable: "notification_rules",
          subjectId: row!.id as string,
          payload: body,
        });
        return row!.id as string;
      });
      // The webhook secret is returned exactly once, at creation.
      return reply.status(201).send({ id, webhookSecret: secret });
    },
  );

  /** The jurisdiction's rules, oldest first, without their signing secrets. Administrators only, as creation is. */
  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/notification-rules",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      requireAdmin(req.principal, jurisdictionId);
      const page = z.object(pageQuery).parse(req.query);
      const after = decodeCursor(page.cursor, ["at", "id"]);
      const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
      const rows = await withPerson(sql, req.principal.person.id, (tx) => tx`
        select r.id, r.board_id, b.title as board_title, r.event, r.condition, r.channels,
          r.schedule_interval_minutes, r.rate_limit_max, r.rate_limit_window_minutes, r.enabled, r.created_at,
          to_char(r.created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
        from notification_rules r left join boards b on b.id = r.board_id
        where r.jurisdiction_id = ${jurisdictionId} and r.removed_at is null
          ${after ? tx`and (r.created_at, r.id) > (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : tx``}
        order by r.created_at, r.id limit ${limit + 1}`);
      const last = rows.length > limit ? rows[limit - 1]! : null;
      return reply.send({
        rules: rows.slice(0, limit).map((row) => ({
          id: row.id as string,
          boardId: (row.board_id as string | null) ?? null,
          boardTitle: (row.board_title as string | null) ?? null,
          event: row.event as string,
          condition: row.condition as unknown,
          channels: row.channels as unknown,
          scheduleIntervalMinutes: (row.schedule_interval_minutes as number | null) ?? null,
          rateLimit: { max: row.rate_limit_max as number, windowMinutes: row.rate_limit_window_minutes as number },
          enabled: row.enabled as boolean,
          createdAt: (row.created_at as Date).toISOString(),
        })),
        nextCursor: last ? encodeCursor([last.page_at as string, last.id as string]) : null,
      });
    },
  );

  /**
   * Change a rule: pause or resume it, or replace any field the create form
   * sets. New channels are checked as at creation; a pause alone is not, so a
   * rule whose destination has left the allowlist can still be paused. A rule
   * that gains its first webhook gets a signing secret, returned once here.
   */
  app.patch("/api/v1/notification-rules/:ruleId", { preHandler: authenticate }, async (req, reply) => {
    const { ruleId } = RuleParams.parse(req.params);
    const body = RulePatch.parse(req.body);
    const secret = await withPerson(sql, req.principal.person.id, async (tx) => {
      const rule = await administeredRule(tx, req.principal, ruleId);
      const jurisdictionId = rule.jurisdiction_id as string;
      if (body.channels) await checkChannels(tx, jurisdictionId, body.channels);
      const fresh = !rule.webhook_secret && body.channels?.some((c) => c.kind === "webhook")
        ? randomBytes(24).toString("hex")
        : null;
      const rateLimit = body.rateLimit ?? { max: rule.rate_limit_max as number, windowMinutes: rule.rate_limit_window_minutes as number };
      await tx`
        update notification_rules set
          enabled = ${body.enabled ?? (rule.enabled as boolean)},
          board_id = ${body.boardId === undefined ? (rule.board_id as string | null) : body.boardId},
          event = ${body.event ?? (rule.event as string)},
          condition = ${tx.json((body.condition ?? rule.condition) as never)},
          channels = ${tx.json((body.channels ?? rule.channels) as never)},
          schedule_interval_minutes = ${body.scheduleIntervalMinutes === undefined
            ? (rule.schedule_interval_minutes as number | null) : body.scheduleIntervalMinutes},
          rate_limit_max = ${rateLimit.max}, rate_limit_window_minutes = ${rateLimit.windowMinutes},
          webhook_secret = ${fresh ?? (rule.webhook_secret as string | null)}
        where id = ${ruleId}`;
      await recordAudit(tx, req.principal, {
        jurisdictionId,
        category: "notification.rule_changed",
        subjectTable: "notification_rules",
        subjectId: ruleId,
        payload: body,
      });
      return fresh;
    });
    return reply.send({ id: ruleId, webhookSecret: secret });
  });

  /** Remove a rule. It stops firing and leaves the list; what it already sent stays logged. */
  app.delete("/api/v1/notification-rules/:ruleId", { preHandler: authenticate }, async (req, reply) => {
    const { ruleId } = RuleParams.parse(req.params);
    await withPerson(sql, req.principal.person.id, async (tx) => {
      const rule = await administeredRule(tx, req.principal, ruleId);
      await tx`update notification_rules set enabled = false, removed_at = now() where id = ${ruleId}`;
      await recordAudit(tx, req.principal, {
        jurisdictionId: rule.jurisdiction_id as string,
        category: "notification.rule_removed",
        subjectTable: "notification_rules",
        subjectId: ruleId,
        payload: {},
      });
    });
    return reply.send({ ok: true });
  });

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/notification-allowlist",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      requireAdmin(req.principal, jurisdictionId);
      const [row] = await withPerson(sql, req.principal.person.id, (tx) => {
        return tx`
          select entries, updated_at from notification_allowlists
          where jurisdiction_id = ${jurisdictionId}`;
      });
      return reply.send({
        entries: (row?.entries as string[] | undefined) ?? [],
        updatedAt: row ? (row.updated_at as Date).toISOString() : null,
      });
    },
  );

  /**
   * Replace the destinations webhook and push rules may reach. With no
   * entries nothing external is reachable, and the worker refuses queued
   * deliveries to a destination removed here.
   */
  app.put(
    "/api/v1/jurisdictions/:jurisdictionId/notification-allowlist",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      requireAdmin(req.principal, jurisdictionId);
      const body = AllowlistBody.parse(req.body);
      const entries = [
        ...new Set(
          body.entries.map((raw) => {
            const entry = normalizeEntry(raw);
            if (!entry)
              throw new AuthError(
                422,
                `${raw} is not an allowed destination: use an https origin, a *.host suffix, or an http loopback origin`,
              );
            return entry;
          }),
        ),
      ];
      await withPerson(sql, req.principal.person.id, async (tx) => {
        await tx`
          insert into notification_allowlists (jurisdiction_id, entries, updated_by)
          values (${jurisdictionId}, ${entries}::text[], ${req.principal.person.id})
          on conflict (jurisdiction_id) do update set
            entries = excluded.entries, updated_by = excluded.updated_by, updated_at = now()`;
        await recordAudit(tx, req.principal, {
          jurisdictionId,
          category: "notification.allowlist_updated",
          subjectTable: "notification_allowlists",
          subjectId: jurisdictionId,
          payload: { entries },
        });
      });
      return reply.send({ entries });
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/notification-channels/:kind",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId, kind } = ChannelParams.parse(req.params);
      requireAdmin(req.principal, jurisdictionId);
      return reply.send(
        await withPerson(sql, req.principal.person.id, (tx) => channelView(tx, jurisdictionId, kind)),
      );
    },
  );

  /**
   * Configure the jurisdiction's SMTP relay or SMS provider. The password or
   * token is stored envelope-encrypted and never returned; a fingerprint
   * identifies it. An HTTP SMS provider must be on the notification allowlist.
   */
  app.put(
    "/api/v1/jurisdictions/:jurisdictionId/notification-channels/:kind",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId, kind } = ChannelParams.parse(req.params);
      requireAdmin(req.principal, jurisdictionId);
      const body = ChannelBody.parse(req.body);
      const settings = kind === "email" ? EmailSettings.parse(body.settings) : SmsSettings.parse(body.settings);
      if ("security" in settings && settings.security === "none" && settings.username)
        throw new AuthError(422, "a relay that needs a sign-in must use STARTTLS or TLS");
      // The relay needs a password only with a user name; the fixture provider needs nothing.
      const needsSecret = "provider" in settings ? settings.provider === "http" : settings.username !== undefined;
      if (needsSecret && body.secret !== undefined && !hasSecretKey())
        throw new AuthError(409, "server not provisioned for secret storage (OPENEOC_SECRET_KEY unset)");
      const view = await withPerson(sql, req.principal.person.id, async (tx) => {
        if ("provider" in settings && settings.provider === "http") {
          const [list] = await tx`
            select entries from notification_allowlists where jurisdiction_id = ${jurisdictionId}`;
          if (!admittedBy((list?.entries as string[] | undefined) ?? [], settings.url))
            throw new AuthError(422, `${settings.url} is not on this jurisdiction's notification allowlist`);
        }
        const [existing] = await tx`
          select secret_envelope, secret_fingerprint from notification_channels
          where jurisdiction_id = ${jurisdictionId} and kind = ${kind}`;
        const fresh = needsSecret && body.secret !== undefined;
        const envelope = !needsSecret
          ? null
          : fresh
            ? encryptSecret(body.secret!)
            : ((existing?.secret_envelope as string | null | undefined) ?? null);
        if (needsSecret && !envelope)
          throw new AuthError(422, kind === "email" ? "enter the relay password" : "enter the provider token");
        const print = !needsSecret
          ? null
          : fresh
            ? fingerprint(body.secret!)
            : ((existing?.secret_fingerprint as string | null | undefined) ?? null);
        await tx`
          insert into notification_channels
            (jurisdiction_id, kind, settings, secret_envelope, secret_fingerprint, updated_by)
          values
            (${jurisdictionId}, ${kind}, ${tx.json(settings as never)}, ${envelope}, ${print},
             ${req.principal.person.id})
          on conflict (jurisdiction_id, kind) do update set
            settings = excluded.settings, secret_envelope = excluded.secret_envelope,
            secret_fingerprint = excluded.secret_fingerprint,
            updated_by = excluded.updated_by, updated_at = now()`;
        await recordAudit(tx, req.principal, {
          jurisdictionId,
          category: "notification.channel_configured",
          subjectTable: "notification_channels",
          subjectId: jurisdictionId,
          payload: { kind, settings, secretSet: fresh },
        });
        return channelView(tx, jurisdictionId, kind);
      });
      return reply.send(view);
    },
  );

  /** Send one test message now, outside the queue, and answer with what the relay or provider said. */
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/notification-channels/:kind/test",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId, kind } = ChannelParams.parse(req.params);
      requireAdmin(req.principal, jurisdictionId);
      const { to } = z.object({ to: kind === "email" ? z.email() : E164 }).parse(req.body);
      const { stored, allowlist } = await withPerson(sql, req.principal.person.id, async (tx) => {
        const [row] = await tx`
          select settings, secret_envelope from notification_channels
          where jurisdiction_id = ${jurisdictionId} and kind = ${kind}`;
        const [list] = await tx`
          select entries from notification_allowlists where jurisdiction_id = ${jurisdictionId}`;
        return {
          stored: row ? { settings: row.settings as unknown, secret: row.secret_envelope as string | null } : null,
          allowlist: (list?.entries as string[] | undefined) ?? [],
        };
      });
      const refused = await channelRefusal(kind, stored, allowlist);
      if (refused) throw new AuthError(409, refused);
      let receipt: Record<string, unknown>;
      try {
        receipt = await sendMessage(
          kind,
          stored!,
          { jurisdictionId, to, subject: TEST_SUBJECT, body: TEST_BODY },
          { timeoutMs: 10_000 },
        );
      } catch (err) {
        throw new AuthError(502, `the test message was not sent: ${err instanceof Error ? err.message : String(err)}`);
      }
      await withPerson(sql, req.principal.person.id, (tx) =>
        recordAudit(tx, req.principal, {
          jurisdictionId,
          category: "notification.channel_tested",
          subjectTable: "notification_channels",
          subjectId: jurisdictionId,
          payload: { kind, to, receipt },
        }),
      );
      return reply.send({ receipt });
    },
  );

  app.get("/api/v1/notifications", { preHandler: authenticate }, async (req, reply) => {
    const page = z.object(pageQuery).parse(req.query);
    const after = decodeCursor(page.cursor, ["at", "id"]);
    const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
    const me = req.principal.person.id;
    const rows = await withPerson(sql, me, (tx) => {
      return tx`
        select n.id, n.channel, n.title, n.body, n.status, n.detail,
          to_char(n.created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at,
          n.person_id, n.position_id, n.created_at, n.read_at,
          n.acknowledged_at, n.acknowledged_by,
          (n.person_id = ${me} or (n.position_id is not null and exists (
            select 1 from position_assignments assignment
            where assignment.position_id = n.position_id
              and assignment.person_id = ${me}
              and assignment.revoked_at is null
          ))) as assigned_to_current_actor,
          recipient.display_name as recipient_name, position.title as position_title,
          acknowledger.display_name as acknowledged_by_name,
          incident.id as incident_id, incident.name as incident_name
        from notifications n
        left join persons recipient on recipient.id = n.person_id
        left join positions position on position.id = n.position_id
        left join persons acknowledger on acknowledger.id = n.acknowledged_by
        left join incidents incident on incident.id = n.incident_id
        -- The page's candidates, from each source the read policy allows through its
        -- own index (notification_page); the policy still applies to every row here.
        where n.id = any(array(select page.id from public.notification_page(
          ${after ? after[0]! : null}::text::timestamptz, ${after ? after[1]! : null}::uuid, ${limit + 1}) page))
        order by n.created_at desc, n.id desc limit ${limit + 1}`;
    });
    const last = rows.length > limit ? rows[limit - 1]! : null;
    const notifications = rows.slice(0, limit).map(({ page_at: _pageAt, ...row }) => {
      const detail = row.detail as Record<string, unknown>;
      const destination = row.position_id
        ? `Position · ${String(row.position_title ?? "Assigned position")}`
        : row.person_id
          ? `Person · ${String(row.recipient_name ?? "Personal inbox")}`
          : row.channel === "webhook" && detail.url
            ? `Webhook · ${String(detail.url)}`
            : row.channel === "ntfy" && detail.topic
              ? `Push topic · ${String(detail.topic)}`
              : (row.channel === "email" || row.channel === "sms") && detail.to
                ? `${row.channel === "email" ? "Email" : "SMS"} · ${String(detail.to)}`
                : "Configured external channel";
      return { ...row, destination };
    });
    return reply.send({
      notifications,
      nextCursor: last ? encodeCursor([last.page_at as string, last.id as string]) : null,
    });
  });

  app.post(
    "/api/v1/notifications/:notificationId/read",
    { preHandler: authenticate },
    async (req, reply) => {
      const { notificationId } = req.params as { notificationId: string };
      await withPerson(sql, req.principal.person.id, async (tx) => {
        const [updated] = await tx`update notifications set read_at = now()
          where id = ${notificationId} and read_at is null
            and (person_id = ${req.principal.person.id}
              or (position_id is not null and exists (
                select 1 from position_assignments assignment
                where assignment.position_id = notifications.position_id
                  and assignment.person_id = ${req.principal.person.id}
                  and assignment.revoked_at is null)))
          returning id`;
        if (updated) return;
        const [assigned] = await tx`select id from notifications
          where id = ${notificationId}
            and (person_id = ${req.principal.person.id}
              or (position_id is not null and exists (
                select 1 from position_assignments assignment
                where assignment.position_id = notifications.position_id
                  and assignment.person_id = ${req.principal.person.id}
                  and assignment.revoked_at is null)))`;
        if (!assigned) throw new AuthError(404, "notification not found");
      });
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/api/v1/notifications/:notificationId/acknowledge",
    { preHandler: authenticate },
    async (req, reply) => {
      const { notificationId } = req.params as { notificationId: string };
      const result = await withPerson(sql, req.principal.person.id, async (tx) => {
        const [updated] = await tx`
          update notifications set acknowledged_at = now(), acknowledged_by = ${req.principal.person.id}
          where id = ${notificationId} and acknowledged_at is null
            and (person_id = ${req.principal.person.id}
              or (position_id is not null and exists (
                select 1 from position_assignments assignment
                where assignment.position_id = notifications.position_id
                  and assignment.person_id = ${req.principal.person.id}
                  and assignment.revoked_at is null)))
          returning id, jurisdiction_id, acknowledged_at, acknowledged_by`;
        if (updated) {
          await recordAudit(tx, req.principal, {
            jurisdictionId: updated.jurisdiction_id as string,
            category: "notification.acknowledged",
            subjectTable: "notifications",
            subjectId: updated.id as string,
            payload: {},
          });
          return { row: updated, changed: true };
        }
        const [existing] = await tx`
          select id, jurisdiction_id, acknowledged_at, acknowledged_by
          from notifications where id = ${notificationId}
            and (person_id = ${req.principal.person.id}
              or (position_id is not null and exists (
                select 1 from position_assignments assignment
                where assignment.position_id = notifications.position_id
                  and assignment.person_id = ${req.principal.person.id}
                  and assignment.revoked_at is null)))`;
        if (!existing) throw new AuthError(404, "notification not found");
        return { row: existing, changed: false };
      });

      return reply.send({
        ok: true,
        acknowledged_at: (result.row.acknowledged_at as Date).toISOString(),
        acknowledged_by: result.row.acknowledged_by as string,
      });
    },
  );

  // Queue a failed or expired delivery again with a fresh hold. An
  // administrator of the notification's jurisdiction may; the database
  // refuses anyone else and anything still pending or already delivered.
  app.post(
    "/api/v1/notifications/:notificationId/resend",
    { preHandler: authenticate },
    async (req, reply) => {
      const { notificationId } = z.object({ notificationId: z.string().uuid() }).parse(req.params);
      const deliveryId = await withPerson(sql, req.principal.person.id, async (tx) => {
        const [note] = await tx`select id, jurisdiction_id, status from notifications where id = ${notificationId}`;
        if (!note) throw new AuthError(404, "notification not found");
        const jurisdictionId = note.jurisdiction_id as string;
        requireAdmin(req.principal, jurisdictionId);
        const [queued] = await tx`select public.resend_delivery(${notificationId}) as id`;
        const id = (queued?.id as string | null) ?? null;
        if (!id) throw new AuthError(409, "only a failed or expired delivery can be resent");
        await recordAudit(tx, req.principal, {
          jurisdictionId,
          category: "notification.resent",
          subjectTable: "notifications",
          subjectId: notificationId,
          payload: { deliveryId: id, previousStatus: note.status as string },
        });
        return id;
      });
      return reply.status(202).send({ ok: true, deliveryId });
    },
  );

  // How long each kind of outbound delivery waits for a route before it
  // expires. A kind with no row holds for the default 72 hours.
  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/delivery-holds",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = z.object({ jurisdictionId: z.string().uuid() }).parse(req.params);
      requireMember(req.principal, jurisdictionId);
      const rows = await withPerson(sql, req.principal.person.id, (tx) => tx`
        select kind, hold_hours, updated_at from delivery_hold_windows
        where jurisdiction_id = ${jurisdictionId}`);
      const byKind = new Map(rows.map((r) => [r.kind as string, r]));
      return reply.send({
        holds: DELIVERY_KINDS.map((kind) => {
          const row = byKind.get(kind);
          return {
            kind,
            hours: row ? Number(row.hold_hours) : DEFAULT_HOLD_HOURS,
            isDefault: !row,
            updatedAt: row ? (row.updated_at as Date).toISOString() : null,
          };
        }),
      });
    },
  );

  app.put(
    "/api/v1/jurisdictions/:jurisdictionId/delivery-holds/:kind",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId, kind } = z
        .object({ jurisdictionId: z.string().uuid(), kind: z.enum(DELIVERY_KINDS) })
        .parse(req.params);
      const { hours } = z.object({ hours: z.number().int().min(1).max(MAX_HOLD_HOURS) }).parse(req.body);
      requireAdmin(req.principal, jurisdictionId);
      await withPerson(sql, req.principal.person.id, async (tx) => {
        const [before] = await tx`
          select hold_hours from delivery_hold_windows
          where jurisdiction_id = ${jurisdictionId} and kind = ${kind}`;
        await tx`
          insert into delivery_hold_windows (jurisdiction_id, kind, hold_hours, updated_by, updated_at)
          values (${jurisdictionId}, ${kind}, ${hours}, ${req.principal.person.id}, now())
          on conflict (jurisdiction_id, kind) do update
          set hold_hours = excluded.hold_hours, updated_by = excluded.updated_by, updated_at = now()`;
        await recordAudit(tx, req.principal, {
          jurisdictionId,
          category: "notification.hold_set",
          subjectTable: "delivery_hold_windows",
          subjectId: jurisdictionId,
          payload: { kind, hours, previousHours: before ? Number(before.hold_hours) : DEFAULT_HOLD_HOURS },
        });
      });
      return reply.send({ kind, hours, isDefault: false });
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/notifications/run-scheduled",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const m = req.principal.memberships.find((x) => x.jurisdictionId === jurisdictionId);
      if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
      const fired = await runScheduledRules(sql, req.principal, jurisdictionId);
      return reply.send({ fired });
    },
  );
}
