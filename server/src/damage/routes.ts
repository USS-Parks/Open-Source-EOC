import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError } from "../auth/service.js";
import {
  aggregate,
  createAssessment,
  enablePublicIntake,
  exportDeclaration,
  importBaseline,
  listAssessments,
  moderate,
  submitPublicReport,
} from "./service.js";

const Location = z.object({ lon: z.number(), lat: z.number() });
const BaselineImportBody = z.object({
  rows: z
    .array(
      z.object({
        parcelId: z.string().min(1),
        address: z.string().min(1),
        structureType: z.string().min(1),
        replacementValue: z.number().min(0),
        location: Location.optional(),
      }),
    )
    .min(1),
});
const AssessmentBody = z.object({
  baselineId: z.string().uuid().optional(),
  address: z.string().min(1),
  structureType: z.string().min(1),
  degree: z.string().min(1),
  ownership: z.string().optional(),
  insured: z.boolean().nullable().optional(),
  estimatedLoss: z.number().min(0),
  notes: z.string().optional(),
  location: Location.optional(),
});
const ReportBody = z.object({
  address: z.string().min(1),
  structureType: z.string().min(1),
  degree: z.string().min(1),
  estimatedLoss: z.number().min(0).optional(),
  reporterContact: z.string().optional(),
  notes: z.string().optional(),
  location: Location.optional(),
});
const ModerateBody = z.object({ decision: z.enum(["approved", "rejected"]) });
const Thresholds = z.object({
  population: z.number().int().positive(),
  paPerCapitaIndicator: z.number().min(0).default(4.6),
  iaResidenceThreshold: z.number().int().min(0).default(25),
});
const DeclarationBody = Thresholds.extend({ incident: z.string().min(1) });

export function damageRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/damage/baseline",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = BaselineImportBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        importBaseline(tx, req.principal, jurisdictionId, body.rows),
      );
      return reply.status(201).send(result);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/damage/assessments",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = AssessmentBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        createAssessment(tx, req.principal, jurisdictionId, body),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/damage/assessments",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const q = req.query as { status?: string; source?: string };
      const rows = await withPerson(sql, req.principal.person.id, (tx) =>
        listAssessments(tx, req.principal, jurisdictionId, {
          ...(q.status ? { status: q.status } : {}),
          ...(q.source ? { source: q.source } : {}),
        }),
      );
      return reply.send({ assessments: rows });
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/damage/intake/enable",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        enablePublicIntake(tx, req.principal, jurisdictionId),
      );
      return reply.status(201).send(result);
    },
  );

  // Public self-report intake: no user session, token-authenticated.
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/damage/report",
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const token = String(req.headers["x-intake-token"] ?? "");
      if (!token) throw new AuthError(401, "missing intake token");
      const body = ReportBody.parse(req.body);
      const result = await submitPublicReport(sql, jurisdictionId, token, body);
      return reply.status(202).send(result);
    },
  );

  app.post(
    "/api/v1/damage/assessments/:id/moderate",
    { preHandler: authenticate },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = ModerateBody.parse(req.body);
      await withPerson(sql, req.principal.person.id, (tx) =>
        moderate(tx, req.principal, id, body.decision),
      );
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/damage/summary",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const t = Thresholds.parse(req.body ?? {});
      const summary = await withPerson(sql, req.principal.person.id, (tx) =>
        aggregate(tx, req.principal, jurisdictionId, t),
      );
      return reply.send(summary);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/damage/declaration",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = DeclarationBody.parse(req.body);
      const [jur] = await sql`select name from jurisdictions where id = ${jurisdictionId}`;
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        exportDeclaration(
          tx,
          req.principal,
          jurisdictionId,
          {
            population: body.population,
            paPerCapitaIndicator: body.paPerCapitaIndicator,
            iaResidenceThreshold: body.iaResidenceThreshold,
          },
          { jurisdiction: (jur?.name as string) ?? "Jurisdiction", incident: body.incident },
        ),
      );
      return reply.send(result);
    },
  );
}
