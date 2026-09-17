import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { authorAlert, CapValidationError, getAlert, ingestAlert, listAlerts } from "./service.js";

const AuthorBody = z.object({
  alert: z.record(z.string(), z.unknown()),
  incidentId: z.string().uuid().optional(),
});
const IngestBody = z.object({ xml: z.string().min(1) });

export function capRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/cap/alerts",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = AuthorBody.parse(req.body);
      try {
        const result = await withPerson(sql, req.principal.person.id, (tx) =>
          authorAlert(tx, req.principal, jurisdictionId, body.alert, body.incidentId),
        );
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof CapValidationError)
          return reply.status(422).send({ error: "CAP validation failed", issues: err.issues });
        throw err;
      }
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/cap/ingest",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = IngestBody.parse(req.body);
      try {
        const result = await withPerson(sql, req.principal.person.id, (tx) =>
          ingestAlert(tx, req.principal, jurisdictionId, body.xml),
        );
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof CapValidationError)
          return reply.status(422).send({ error: "CAP validation failed", issues: err.issues });
        throw err;
      }
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/cap/alerts",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const alerts = await withPerson(sql, req.principal.person.id, (tx) =>
        listAlerts(tx, req.principal, jurisdictionId),
      );
      return reply.send({ alerts });
    },
  );

  app.get("/api/v1/cap/alerts/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { format?: string };
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      getAlert(tx, req.principal, id),
    );
    if (q.format === "xml") return reply.header("content-type", "application/cap+xml").send(result.xml);
    return reply.send(result);
  });
}
