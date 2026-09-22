import type { FastifyInstance, FastifyRequest } from "fastify";
import { OperationalRelationshipCreateSchema } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { createOperationalRelationship, listOperationalRelationships } from "./service.js";

export function operationalRelationshipRoutes(app: FastifyInstance, sql: Sql, authenticate: (req: FastifyRequest) => Promise<void>): void {
  app.get("/api/v1/incidents/:incidentId/operational-relationships", { preHandler: authenticate }, async (req, reply) => {
    const { incidentId } = req.params as { incidentId: string };
    return reply.send({ relationships: await withPerson(sql, req.principal.person.id, (tx) => listOperationalRelationships(tx, req.principal, incidentId)) });
  });
  app.post("/api/v1/incidents/:incidentId/operational-relationships", { preHandler: authenticate }, async (req, reply) => {
    const { incidentId } = req.params as { incidentId: string };
    const body = OperationalRelationshipCreateSchema.parse(req.body);
    return reply.status(201).send(await withPerson(sql, req.principal.person.id, (tx) => createOperationalRelationship(tx, req.principal, incidentId, body)));
  });
}
