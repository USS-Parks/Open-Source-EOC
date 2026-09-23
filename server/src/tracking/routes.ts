import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import { getObject, registerObject, reunify, scanEvent } from "./service.js";

const RegisterBody = z.object({
  kind: z.string().min(1),
  label: z.string().min(1),
  tag: z.string().min(1).optional(),
  restricted: z.record(z.string(), z.unknown()).optional(),
  station: z.string().optional(),
  agency: z.string().optional(),
  location: z.string().optional(),
});
const ScanBody = z.object({
  tag: z.string().min(1),
  custodyState: z.string().min(1),
  station: z.string().optional(),
  agency: z.string().optional(),
  location: z.string().optional(),
  note: z.string().optional(),
});

export function trackingRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/tracked-objects",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = RegisterBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        registerObject(tx, req.principal, jurisdictionId, body),
      );
      return reply.status(201).send(result);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/tracked-objects/scan",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = ScanBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        scanEvent(tx, req.principal, jurisdictionId, body),
      );
      return reply.status(201).send(result);
    },
  );

  app.get("/api/v1/tracked-objects/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const page = z.object(pageQuery).parse(req.query);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      getObject(tx, req.principal, id, page),
    );
    return reply.send(result);
  });

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/reunification",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const q = req.query as { tag?: string; label?: string };
      const answers = await withPerson(sql, req.principal.person.id, (tx) =>
        reunify(tx, req.principal, jurisdictionId, {
          ...(q.tag ? { tag: q.tag } : {}),
          ...(q.label ? { label: q.label } : {}),
        }),
      );
      return reply.send({ answers });
    },
  );
}
