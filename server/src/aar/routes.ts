import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { CAPABILITY_ELEMENT, CORE_CAPABILITIES } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  composeAndStoreAar,
  createCorrectiveAction,
  exportAarPdf,
  listCorrectiveActions,
  listObservations,
  recordObservation,
  setCorrectiveActionStatus,
} from "./service.js";

/**
 * Capability is one of the 32 National Preparedness Goal Core Capabilities;
 * the element is an HSEEP POETE element (or none). Both come from the
 * dictionary so the API rejects anything off-doctrine.
 */
const capabilitySchema = z.enum(CORE_CAPABILITIES.values as [string, ...string[]]);
const capabilityElementSchema = z.enum(CAPABILITY_ELEMENT.values as [string, ...string[]]);

/**
 * After-action and improvement-planning routes (VEOC-36). Observations are
 * captured during the incident; the AAR composes from them plus the
 * chronology; corrective actions are jurisdiction-scoped and outlive the
 * incident.
 */

const ObservationBody = z.object({
  capability: capabilitySchema,
  capabilityElement: capabilityElementSchema.optional(),
  kind: z.enum(["strength", "improvement"]),
  observation: z.string().min(1),
  recommendation: z.string().optional(),
});
const AarBody = z.object({
  overview: z.string().min(1),
  objectives: z.array(z.string().min(1)).optional(),
  period: z.string().optional(),
});
const CaBody = z.object({
  incidentId: z.string().uuid().optional(),
  capability: capabilitySchema,
  capabilityElement: capabilityElementSchema.optional(),
  recommendation: z.string().min(1),
  ownerPosition: z.string().uuid().optional(),
  ownerPerson: z.string().uuid().optional(),
  dueDate: z.string().optional(),
});
const StatusBody = z.object({ status: z.enum(["open", "in_progress", "complete"]) });

export function aarRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/incidents/:incidentId/aar/observations",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const body = ObservationBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        recordObservation(tx, req.principal, incidentId, {
          capability: body.capability,
          ...(body.capabilityElement !== undefined ? { capabilityElement: body.capabilityElement } : {}),
          kind: body.kind,
          observation: body.observation,
          ...(body.recommendation !== undefined ? { recommendation: body.recommendation } : {}),
        }),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/incidents/:incidentId/aar/observations",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const observations = await withPerson(sql, req.principal.person.id, (tx) =>
        listObservations(tx, req.principal, incidentId),
      );
      return reply.send({ observations });
    },
  );

  app.post("/api/v1/incidents/:incidentId/aar", { preHandler: authenticate }, async (req, reply) => {
    const { incidentId } = req.params as { incidentId: string };
    const body = AarBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      composeAndStoreAar(tx, req.principal, incidentId, {
        overview: body.overview,
        ...(body.objectives !== undefined ? { objectives: body.objectives } : {}),
        ...(body.period !== undefined ? { period: body.period } : {}),
      }),
    );
    return reply.status(201).send(result);
  });

  app.get("/api/v1/aar/:aarId/pdf", { preHandler: authenticate }, async (req, reply) => {
    const { aarId } = req.params as { aarId: string };
    const { filename, bytes } = await withPerson(sql, req.principal.person.id, (tx) =>
      exportAarPdf(tx, req.principal, aarId),
    );
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(Buffer.from(bytes));
  });

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/corrective-actions",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = CaBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        createCorrectiveAction(tx, req.principal, jurisdictionId, {
          capability: body.capability,
          ...(body.capabilityElement !== undefined ? { capabilityElement: body.capabilityElement } : {}),
          recommendation: body.recommendation,
          ...(body.incidentId !== undefined ? { incidentId: body.incidentId } : {}),
          ...(body.ownerPosition !== undefined ? { ownerPosition: body.ownerPosition } : {}),
          ...(body.ownerPerson !== undefined ? { ownerPerson: body.ownerPerson } : {}),
          ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
        }),
      );
      return reply.status(201).send(result);
    },
  );

  app.post("/api/v1/corrective-actions/:id/status", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = StatusBody.parse(req.body);
    await withPerson(sql, req.principal.person.id, (tx) =>
      setCorrectiveActionStatus(tx, req.principal, id, body.status),
    );
    return reply.send({ ok: true });
  });

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/corrective-actions",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const query = req.query as { status?: string; includeComplete?: string };
      const actions = await withPerson(sql, req.principal.person.id, (tx) =>
        listCorrectiveActions(tx, req.principal, jurisdictionId, {
          ...(query.status !== undefined ? { status: query.status } : {}),
          includeComplete: query.includeComplete === "true",
        }),
      );
      return reply.send({ correctiveActions: actions });
    },
  );
}
