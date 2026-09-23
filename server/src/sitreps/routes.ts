import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import {
  composeSitrep,
  currentLifelines,
  getSitrep,
  listSitreps,
  setLifeline,
} from "./service.js";

const SetLifelineBody = z.object({
  lifeline: z.string().min(1),
  status: z.string().min(1),
  note: z.string().optional(),
});
const ComposeBody = z.object({
  period: z.string().min(1),
  incidentId: z.string().uuid().optional(),
});
const ListQuery = z.object({ incidentId: z.string().uuid().optional(), ...pageQuery });

export function sitrepRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/lifelines",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const lifelines = await withPerson(sql, req.principal.person.id, (tx) =>
        currentLifelines(tx, req.principal, jurisdictionId),
      );
      return reply.send({ lifelines });
    },
  );

  app.put(
    "/api/v1/jurisdictions/:jurisdictionId/lifelines",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = SetLifelineBody.parse(req.body);
      const lifelines = await withPerson(sql, req.principal.person.id, (tx) =>
        setLifeline(tx, req.principal, jurisdictionId, body),
      );
      return reply.send({ lifelines });
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/sitreps",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = ComposeBody.parse(req.body);
      const sitrep = await withPerson(sql, req.principal.person.id, (tx) =>
        composeSitrep(tx, req.principal, jurisdictionId, body),
      );
      return reply.status(201).send(sitrep);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/sitreps",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const query = ListQuery.parse(req.query);
      const { items, nextCursor } = await withPerson(sql, req.principal.person.id, (tx) =>
        listSitreps(tx, req.principal, jurisdictionId, query.incidentId, query),
      );
      return reply.send({ sitreps: items, nextCursor });
    },
  );

  app.get("/api/v1/sitreps/:sitrepId", { preHandler: authenticate }, async (req, reply) => {
    const { sitrepId } = req.params as { sitrepId: string };
    const sitrep = await withPerson(sql, req.principal.person.id, (tx) =>
      getSitrep(tx, req.principal, sitrepId),
    );
    return reply.send(sitrep);
  });
}
