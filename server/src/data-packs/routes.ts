import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { DataPackSchema } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { listIncidentDatasets, loadDataset, registerDataPack } from "./service.js";

const IncidentId = z.string().uuid();
const DatasetId = z.string().uuid();
const LoadBody = z.union([
  z.object({ records: z.array(z.unknown()).max(10000) }).strict(),
  z.object({ error: z.string().trim().min(1).max(1000) }).strict(),
]);

export function dataPackRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get("/api/v1/incidents/:incidentId/datasets", { preHandler: authenticate }, async (req) => {
    const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
    const datasets = await withPerson(sql, req.principal.person.id, (tx) =>
      listIncidentDatasets(tx, req.principal, incidentId),
    );
    return { datasets };
  });

  app.post(
    "/api/v1/incidents/:incidentId/data-packs",
    { preHandler: authenticate },
    async (req, reply) => {
      const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
      const input = DataPackSchema.parse(req.body);
      const pack = await withPerson(sql, req.principal.person.id, (tx) =>
        registerDataPack(tx, req.principal, incidentId, input),
      );
      return reply.status(201).send({ pack });
    },
  );

  app.post(
    "/api/v1/data-packs/datasets/:datasetId/load",
    { preHandler: authenticate },
    async (req) => {
      const datasetId = DatasetId.parse((req.params as { datasetId: string }).datasetId);
      const outcome = LoadBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        loadDataset(tx, req.principal, datasetId, outcome),
      );
      return { result };
    },
  );
}
