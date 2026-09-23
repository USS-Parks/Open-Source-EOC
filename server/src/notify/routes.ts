import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, decodeCursor, encodeCursor, pageQuery } from "../db/cursor.js";
import { AuthError } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { ChannelSchema, ConditionSchema, runScheduledRules } from "./engine.js";

const RuleBody = z.object({
  boardId: z.string().uuid().nullable().default(null),
  event: z.enum(["record.created", "record.updated", "scheduled"]),
  condition: ConditionSchema.default({ op: "any" }),
  channels: z.array(ChannelSchema).min(1),
  scheduleIntervalMinutes: z.number().int().positive().optional(),
});

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
      const [row] = await withPerson(sql, req.principal.person.id, (tx) => {
        return tx`
          insert into notification_rules
            (jurisdiction_id, board_id, event, condition, channels, webhook_secret,
             schedule_interval_minutes, created_by)
          values
            (${jurisdictionId}, ${body.boardId}, ${body.event},
             ${tx.json(body.condition as never)}, ${tx.json(body.channels as never)},
             ${secret}, ${body.scheduleIntervalMinutes ?? null}, ${req.principal.person.id})
          returning id`;
      });
      // The webhook secret is returned exactly once, at creation.
      return reply.status(201).send({ id: row!.id as string, webhookSecret: secret });
    },
  );

  app.get("/api/v1/notifications", { preHandler: authenticate }, async (req, reply) => {
    const page = z.object(pageQuery).parse(req.query);
    const after = decodeCursor(page.cursor, ["at", "id"]);
    const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await withPerson(sql, req.principal.person.id, (tx) => {
      return tx`
        select n.id, n.channel, n.title, n.body, n.status, n.detail,
          to_char(n.created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at,
          n.person_id, n.position_id, n.created_at, n.read_at,
          n.acknowledged_at, n.acknowledged_by,
          (n.person_id = ${req.principal.person.id} or (n.position_id is not null and exists (
            select 1 from position_assignments assignment
            where assignment.position_id = n.position_id
              and assignment.person_id = ${req.principal.person.id}
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
        ${after ? tx`where (n.created_at, n.id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : tx``}
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
