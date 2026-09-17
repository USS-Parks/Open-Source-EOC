import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { EdxlError, emitResourceRequest, importResourceRequest } from "./service.js";

const EmitBody = z.object({ recipients: z.array(z.string().min(1)).optional() });
const ImportBody = z.object({ xml: z.string().min(1) });

export function edxlRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/boards/:boardId/records/:recordId/edxl",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId, recordId } = req.params as { boardId: string; recordId: string };
      const body = EmitBody.parse(req.body ?? {});
      try {
        const result = await withPerson(sql, req.principal.person.id, (tx) =>
          emitResourceRequest(tx, req.principal, boardId, recordId, body.recipients ?? []),
        );
        return reply.header("content-type", "application/emergency+xml").send(result.xml);
      } catch (err) {
        if (err instanceof EdxlError) return reply.status(400).send({ error: err.message });
        throw err;
      }
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/edxl/import",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = ImportBody.parse(req.body);
      try {
        const result = await withPerson(sql, req.principal.person.id, (tx) =>
          importResourceRequest(tx, req.principal, jurisdictionId, body.xml),
        );
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof EdxlError) return reply.status(400).send({ error: err.message });
        throw err;
      }
    },
  );
}
