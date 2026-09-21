import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AssessmentDecisionSchema,
  COMMUNITY_LIFELINES,
  CreateLifelineAssessmentSchema,
  LIFELINE_DEFINITION,
  LIFELINE_DOCTRINE_GAPS,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  createLifelineAssessment,
  decideLifelineAssessment,
  listCurrentLifelineAssessments,
  listLifelineAssessmentHistory,
} from "./service.js";

const IncidentId = z.string().uuid();

export function lifelineRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/incidents/:incidentId/lifeline-assessments",
    { preHandler: authenticate },
    async (req) => {
      const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
      const states = await withPerson(sql, req.principal.person.id, (tx) =>
        listCurrentLifelineAssessments(tx, req.principal, incidentId));
      return { definition: LIFELINE_DEFINITION, doctrineGaps: LIFELINE_DOCTRINE_GAPS, states };
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/lifeline-assessments",
    { preHandler: authenticate },
    async (req, reply) => {
      const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
      const body = CreateLifelineAssessmentSchema.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        createLifelineAssessment(tx, req.principal, incidentId, body));
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/incidents/:incidentId/lifeline-assessments/:lifeline/history",
    { preHandler: authenticate },
    async (req) => {
      const params = req.params as { incidentId: string; lifeline: string };
      const incidentId = IncidentId.parse(params.incidentId);
      const lifeline = COMMUNITY_LIFELINES.schema.parse(params.lifeline);
      const reports = await withPerson(sql, req.principal.person.id, (tx) =>
        listLifelineAssessmentHistory(tx, req.principal, incidentId, lifeline));
      return { reports };
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/lifeline-assessments/:lifeline/decisions",
    { preHandler: authenticate },
    async (req, reply) => {
      const params = req.params as { incidentId: string; lifeline: string };
      const incidentId = IncidentId.parse(params.incidentId);
      const lifeline = COMMUNITY_LIFELINES.schema.parse(params.lifeline);
      const body = AssessmentDecisionSchema.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        decideLifelineAssessment(tx, req.principal, incidentId, lifeline, body));
      return reply.status(201).send(result);
    },
  );
}
