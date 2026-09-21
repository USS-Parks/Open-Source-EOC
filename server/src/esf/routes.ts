import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AssessmentDecisionSchema,
  CALIFORNIA_ESFS,
  CreateEsfAssessmentSchema,
  EMERGENCY_SUPPORT_FUNCTIONS,
  ESF_CROSSWALK_V1,
  ESF_DEFINITIONS,
  ESF_DOCTRINE_GAPS,
  EsfFrameworkSchema,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  createEsfAssessment,
  decideEsfAssessment,
  listCurrentEsfAssessments,
  listEsfAssessmentHistory,
} from "./service.js";

const IncidentId = z.string().uuid();

function parseEsf(framework: "federal" | "california", value: string): string {
  return framework === "federal"
    ? EMERGENCY_SUPPORT_FUNCTIONS.schema.parse(value)
    : CALIFORNIA_ESFS.schema.parse(value);
}

export function esfRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/incidents/:incidentId/esf-assessments",
    { preHandler: authenticate },
    async (req) => {
      const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
      const states = await withPerson(sql, req.principal.person.id, (tx) =>
        listCurrentEsfAssessments(tx, req.principal, incidentId));
      return {
        definitions: ESF_DEFINITIONS,
        crosswalk: ESF_CROSSWALK_V1,
        doctrineGaps: ESF_DOCTRINE_GAPS,
        states,
      };
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/esf-assessments",
    { preHandler: authenticate },
    async (req, reply) => {
      const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
      const body = CreateEsfAssessmentSchema.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        createEsfAssessment(tx, req.principal, incidentId, body));
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/incidents/:incidentId/esf-assessments/:framework/:esf/history",
    { preHandler: authenticate },
    async (req) => {
      const params = req.params as { incidentId: string; framework: string; esf: string };
      const incidentId = IncidentId.parse(params.incidentId);
      const framework = EsfFrameworkSchema.parse(params.framework);
      const esf = parseEsf(framework, params.esf);
      const reports = await withPerson(sql, req.principal.person.id, (tx) =>
        listEsfAssessmentHistory(tx, req.principal, incidentId, framework, esf));
      return { reports };
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/esf-assessments/:framework/:esf/decisions",
    { preHandler: authenticate },
    async (req, reply) => {
      const params = req.params as { incidentId: string; framework: string; esf: string };
      const incidentId = IncidentId.parse(params.incidentId);
      const framework = EsfFrameworkSchema.parse(params.framework);
      const esf = parseEsf(framework, params.esf);
      const body = AssessmentDecisionSchema.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        decideEsfAssessment(tx, req.principal, incidentId, framework, esf, body));
      return reply.status(201).send(result);
    },
  );
}
