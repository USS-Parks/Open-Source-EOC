import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import { PA_CATEGORIES, PA_ITEM_STATUSES } from "@openeoc/shared";
import { AuthError } from "../auth/service.js";
import {
  aggregate,
  createAssessment,
  createPaItem,
  enablePublicIntake,
  exportDeclaration,
  importBaseline,
  listAssessments,
  listPaItems,
  moderate,
  submitPublicReport,
  updatePaItem,
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
// Every figure is operator-entered; the statewide pair has no default, so the
// statewide indicator is computed only when the operator supplies both.
const Thresholds = z.object({
  population: z.number().int().positive(),
  paPerCapitaIndicator: z.number().min(0).default(4.6),
  iaResidenceThreshold: z.number().int().min(0).default(25),
  statePopulation: z.number().int().positive().optional(),
  statewidePerCapitaIndicator: z.number().min(0).optional(),
});
const DeclarationBody = Thresholds.extend({ incident: z.string().min(1) });
const PaItemBody = z.object({
  incidentId: z.string().uuid().nullable().optional(),
  applicant: z.string().trim().min(1).max(300),
  category: PA_CATEGORIES.schema,
  site: z.string().max(500).nullable().optional(),
  description: z.string().max(4000).default(""),
  estimatedCostCents: z.number().int().min(0),
  insured: z.boolean().nullable().optional(),
  percentComplete: z.number().int().min(0).max(100).default(0),
  status: z.enum(PA_ITEM_STATUSES).default("submitted"),
  location: Location.nullable().optional(),
});

export function damageRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
  options: { shelterCensus: boolean },
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
      const page = z.object(pageQuery).parse(req.query);
      const { items, nextCursor } = await withPerson(sql, req.principal.person.id, (tx) =>
        listAssessments(tx, req.principal, jurisdictionId, {
          ...(q.status ? { status: q.status } : {}),
          ...(q.source ? { source: q.source } : {}),
        }, page),
      );
      return reply.send({ assessments: items, nextCursor });
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
        aggregate(tx, req.principal, jurisdictionId, t, options.shelterCensus),
      );
      return reply.send(summary);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/damage/declaration",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const { incident, ...thresholds } = DeclarationBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, async (tx) => {
        // Read the name inside the actor's context so jurisdictions RLS admits
        // it; a bare read on the base connection now returns nothing.
        const [jur] = await tx`select name from jurisdictions where id = ${jurisdictionId}`;
        return exportDeclaration(
          tx,
          req.principal,
          jurisdictionId,
          thresholds,
          { jurisdiction: (jur?.name as string) ?? "Jurisdiction", incident },
          options.shelterCensus,
        );
      });
      return reply.send(result);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/damage/pa-items",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const page = z.object(pageQuery).parse(req.query);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        listPaItems(tx, req.principal, jurisdictionId, page),
      );
      return reply.send(result);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/damage/pa-items",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = PaItemBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        createPaItem(tx, req.principal, jurisdictionId, body),
      );
      return reply.status(201).send(result);
    },
  );

  app.put("/api/v1/damage/pa-items/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = PaItemBody.parse(req.body);
    await withPerson(sql, req.principal.person.id, (tx) => updatePaItem(tx, req.principal, id, body));
    return reply.send({ ok: true });
  });
}
