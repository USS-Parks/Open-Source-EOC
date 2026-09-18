import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { emitCot, ingestCot } from "./service.js";

const IngestBody = z.object({ xml: z.string().min(1) });
const EmitBody = z.object({
  staleMinutes: z.number().int().positive().optional(),
  type: z.string().optional(),
});

export function cotRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/cot/ingest",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = IngestBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        ingestCot(tx, req.principal, jurisdictionId, body.xml),
      );
      return reply.status(201).send(result);
    },
  );

  app.post(
    "/api/v1/boards/:boardId/records/:recordId/cot",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId, recordId } = req.params as { boardId: string; recordId: string };
      const body = EmitBody.parse(req.body ?? {});
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        emitCot(tx, req.principal, boardId, recordId, body),
      );
      return reply.header("content-type", "application/xml").send(result.xml);
    },
  );
}
