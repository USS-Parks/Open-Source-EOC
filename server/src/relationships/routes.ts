import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { OperationalRelationshipCreateSchema } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import { createOperationalRelationship, listOperationalRelationships } from "./service.js";

export function operationalRelationshipRoutes(app: FastifyInstance, sql: Sql, authenticate: (req: FastifyRequest) => Promise<void>): void {
  app.get("/api/v1/incidents/:incidentId/operational-relationships", { preHandler: authenticate }, async (req, reply) => {
    const { incidentId } = req.params as { incidentId: string };
    const page = z.object(pageQuery).parse(req.query);
    const { items, nextCursor } = await withPerson(sql, req.principal.person.id, (tx) => listOperationalRelationships(tx, req.principal, incidentId, page));
    return reply.send({ relationships: items, nextCursor });
  });
  app.post("/api/v1/incidents/:incidentId/operational-relationships", { preHandler: authenticate }, async (req, reply) => {
    const { incidentId } = req.params as { incidentId: string };
    const body = OperationalRelationshipCreateSchema.parse(req.body);
    return reply.status(201).send(await withPerson(sql, req.principal.person.id, (tx) => createOperationalRelationship(tx, req.principal, incidentId, body)));
  });
}
