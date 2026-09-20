import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  IncidentParticipantGrantInputSchema, IncidentParticipantRevokeInputSchema,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  grantIncidentParticipant, listIncidentParticipants, revokeIncidentParticipant,
} from "./participation.js";

const IncidentId = z.string().uuid();

export function incidentParticipationRoutes(
  app: FastifyInstance, sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get("/api/v1/incidents/:incidentId/participants", {
    preHandler: authenticate,
  }, async (req) => {
    const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
    return withPerson(sql, req.principal.person.id, (tx) =>
      listIncidentParticipants(tx, req.principal, incidentId));
  });

  app.post("/api/v1/incidents/:incidentId/participants", {
    preHandler: authenticate,
  }, async (req, reply) => {
    const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
    const input = IncidentParticipantGrantInputSchema.parse(req.body);
    const participant = await withPerson(sql, req.principal.person.id, (tx) =>
      grantIncidentParticipant(tx, req.principal, incidentId, input));
    return reply.status(201).send({ participant });
  });

  app.post("/api/v1/incidents/:incidentId/participants/:participantId/revoke", {
    preHandler: authenticate,
  }, async (req) => {
    const { incidentId: rawIncidentId, participantId: rawParticipantId } = req.params as {
      incidentId: string; participantId: string;
    };
    const incidentId = IncidentId.parse(rawIncidentId);
    const participantId = IncidentId.parse(rawParticipantId);
    const { reason } = IncidentParticipantRevokeInputSchema.parse(req.body);
    const participant = await withPerson(sql, req.principal.person.id, (tx) =>
      revokeIncidentParticipant(tx, req.principal, incidentId, participantId, reason));
    return { participant };
  });
}
