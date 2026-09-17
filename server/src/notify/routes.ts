import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError } from "../auth/service.js";
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
    const rows = await withPerson(sql, req.principal.person.id, (tx) => {
      return tx`
        select id, channel, title, body, status, position_id, created_at, read_at
        from notifications order by created_at desc limit 100`;
    });
    return reply.send({ notifications: rows });
  });

  app.post(
    "/api/v1/notifications/:notificationId/read",
    { preHandler: authenticate },
    async (req, reply) => {
      const { notificationId } = req.params as { notificationId: string };
      await withPerson(sql, req.principal.person.id, (tx) => {
        return tx`update notifications set read_at = now()
          where id = ${notificationId} and read_at is null`;
      });
      return reply.send({ ok: true });
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
