import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  compareIncidentImpact,
  getIncidentImpact,
  listImpactContributions,
} from "./service.js";

const IncidentId = z.string().uuid();
const DatasetId = z.string().uuid();
const Revision = z.coerce.number().int().positive();
const ImpactQuery = z.object({ revision: Revision.optional() });
const CompareQuery = z.object({
  fromRevision: Revision,
  toRevision: Revision.optional(),
});
const ContributionQuery = z.object({
  revision: Revision.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export function impactRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/incidents/:incidentId/impact",
    { preHandler: authenticate },
    async (req) => {
      const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
      const query = ImpactQuery.parse(req.query);
      return withPerson(sql, req.principal.person.id, (tx) =>
        getIncidentImpact(tx, req.principal, incidentId, query.revision),
      );
    },
  );

  app.get(
    "/api/v1/incidents/:incidentId/impact/compare",
    { preHandler: authenticate },
    async (req) => {
      const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
      const query = CompareQuery.parse(req.query);
      return withPerson(sql, req.principal.person.id, (tx) =>
        compareIncidentImpact(
          tx, req.principal, incidentId, query.fromRevision, query.toRevision,
        ),
      );
    },
  );

  app.get(
    "/api/v1/incidents/:incidentId/impact/sources/:datasetId/records",
    { preHandler: authenticate },
    async (req) => {
      const params = req.params as { incidentId: string; datasetId: string };
      const incidentId = IncidentId.parse(params.incidentId);
      const datasetId = DatasetId.parse(params.datasetId);
      const query = ContributionQuery.parse(req.query);
      return withPerson(sql, req.principal.person.id, (tx) =>
        listImpactContributions(
          tx, req.principal, incidentId, datasetId,
          query.revision, query.cursor, query.limit,
        ),
      );
    },
  );
}
