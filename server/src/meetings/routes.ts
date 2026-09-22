import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  configureMeetingBridge,
  getMeetingConfig,
  listBriefings,
  listBridges,
  openBridge,
  runDueBriefings,
  scheduleBriefing,
} from "./service.js";

/**
 * Meeting-bridge and briefing routes. Reading config is open to
 * members; configuring is admin. Opening a bridge is a member action (one
 * click). Briefings are scheduled by members and fired by an admin runner.
 */

const ConfigBody = z.object({
  baseUrl: z.string().url(),
  appId: z.string().min(1).optional(),
  secret: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});
const BridgeBody = z.object({ section: z.string().min(1).optional() });
const BriefingBody = z.object({
  title: z.string().min(1),
  scheduledAt: z.coerce.date(),
  section: z.string().min(1).optional(),
});

export function meetingRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/meetings/config",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const status = await withPerson(sql, req.principal.person.id, (tx) =>
        getMeetingConfig(tx, req.principal, jurisdictionId),
      );
      return reply.send(status);
    },
  );

  app.put(
    "/api/v1/jurisdictions/:jurisdictionId/meetings/config",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = ConfigBody.parse(req.body);
      const status = await withPerson(sql, req.principal.person.id, (tx) =>
        configureMeetingBridge(tx, req.principal, jurisdictionId, {
          baseUrl: body.baseUrl,
          ...(body.appId !== undefined ? { appId: body.appId } : {}),
          ...(body.secret !== undefined ? { secret: body.secret } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        }),
      );
      return reply.send(status);
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/meetings",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const body = BridgeBody.parse(req.body ?? {});
      const bridge = await withPerson(sql, req.principal.person.id, (tx) =>
        openBridge(tx, req.principal, incidentId, body.section ?? null),
      );
      return reply.send(bridge);
    },
  );

  app.get(
    "/api/v1/incidents/:incidentId/meetings",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const bridges = await withPerson(sql, req.principal.person.id, (tx) =>
        listBridges(tx, req.principal, incidentId),
      );
      return reply.send({ meetings: bridges });
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/briefings",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const body = BriefingBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        scheduleBriefing(tx, req.principal, incidentId, {
          title: body.title,
          scheduledAt: body.scheduledAt,
          ...(body.section !== undefined ? { section: body.section } : {}),
        }),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/incidents/:incidentId/briefings",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const briefings = await withPerson(sql, req.principal.person.id, (tx) =>
        listBriefings(tx, req.principal, incidentId),
      );
      return reply.send({ briefings });
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/briefings/run-due",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        runDueBriefings(tx, req.principal, jurisdictionId),
      );
      return reply.send(result);
    },
  );
}
