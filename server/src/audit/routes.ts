import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { correctAudit, exportChronology } from "./service.js";

const ChronologyQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  positionId: z.string().uuid().optional(),
});

const CorrectionBody = z.object({
  note: z.string().min(1).max(4000),
  fields: z.record(z.string(), z.unknown()).optional(),
});

export function auditRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/chronology",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const query = ChronologyQuery.parse(req.query);
      const entries = await withPerson(sql, req.principal.person.id, (tx) =>
        exportChronology(tx, req.principal, { jurisdictionId, ...query }),
      );
      return reply.send({ entries });
    },
  );

  app.post(
    "/api/v1/audit/:eventId/corrections",
    { preHandler: authenticate },
    async (req, reply) => {
      const { eventId } = req.params as { eventId: string };
      const body = CorrectionBody.parse(req.body);
      const id = await withPerson(sql, req.principal.person.id, (tx) =>
        correctAudit(tx, req.principal, eventId, body),
      );
      return reply.status(201).send({ id });
    },
  );
}
