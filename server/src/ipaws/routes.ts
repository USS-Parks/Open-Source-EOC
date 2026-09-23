import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  acknowledgeMoa,
  cancelSend,
  configure,
  confirmSend,
  getStatus,
  listSendRequests,
  requestSend,
  setEnabled,
} from "./service.js";

/**
 * IPAWS-OPEN administration and transmission routes (R2). Reading
 * status is open to members; configuring, acknowledging the MOA, toggling
 * enablement, and transmitting are admin acts, each run under the caller's
 * person context so RLS and the audit trail apply. A handshake or an alert
 * send answers 202 with a pending request that a different admin confirms.
 */

const ConfigBody = z.object({
  environment: z.enum(["test", "production"]),
  cogId: z.string().min(1),
  endpointUrl: z.string().url(),
  credential: z.string().min(1).optional(),
});
const MoaBody = z.object({ reference: z.string().min(1) });
const EnableBody = z.object({ enabled: z.boolean() });
const TestBody = z.object({ alertId: z.string().uuid() });
const SendParams = z.object({ jurisdictionId: z.string().uuid(), sendId: z.string().uuid() });

export function ipawsRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/ipaws",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const status = await withPerson(sql, req.principal.person.id, (tx) =>
        getStatus(tx, req.principal, jurisdictionId),
      );
      return reply.send(status);
    },
  );

  app.put(
    "/api/v1/jurisdictions/:jurisdictionId/ipaws/config",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = ConfigBody.parse(req.body);
      const status = await withPerson(sql, req.principal.person.id, (tx) =>
        configure(tx, req.principal, jurisdictionId, {
          environment: body.environment,
          cogId: body.cogId,
          endpointUrl: body.endpointUrl,
          ...(body.credential !== undefined ? { credential: body.credential } : {}),
        }),
      );
      return reply.send(status);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/ipaws/moa",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = MoaBody.parse(req.body);
      const status = await withPerson(sql, req.principal.person.id, (tx) =>
        acknowledgeMoa(tx, req.principal, jurisdictionId, body.reference),
      );
      return reply.send(status);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/ipaws/enable",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = EnableBody.parse(req.body);
      const status = await withPerson(sql, req.principal.person.id, (tx) =>
        setEnabled(tx, req.principal, jurisdictionId, body.enabled),
      );
      return reply.send(status);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/ipaws/test",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = TestBody.parse(req.body);
      const request = await withPerson(sql, req.principal.person.id, (tx) =>
        requestSend(tx, req.principal, jurisdictionId, body.alertId, "handshake"),
      );
      return reply.status(202).send(request);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/ipaws/sends",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const sends = await withPerson(sql, req.principal.person.id, (tx) =>
        listSendRequests(tx, req.principal, jurisdictionId),
      );
      return reply.send({ sends });
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/ipaws/sends/:sendId/confirm",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId, sendId } = SendParams.parse(req.params);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        confirmSend(tx, req.principal, jurisdictionId, sendId),
      );
      return reply.send(result);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/ipaws/sends/:sendId/cancel",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId, sendId } = SendParams.parse(req.params);
      const request = await withPerson(sql, req.principal.person.id, (tx) =>
        cancelSend(tx, req.principal, jurisdictionId, sendId),
      );
      return reply.send(request);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/cap/alerts/:alertId/ipaws",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId, alertId } = req.params as { jurisdictionId: string; alertId: string };
      const request = await withPerson(sql, req.principal.person.id, (tx) =>
        requestSend(tx, req.principal, jurisdictionId, alertId, "live"),
      );
      return reply.status(202).send(request);
    },
  );
}
