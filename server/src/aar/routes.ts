import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AAR_ACTION_PRIORITIES,
  AAR_ACTION_STATUSES,
  CAPABILITY_ELEMENT,
  CORE_CAPABILITIES,
  WorkflowAssignmentRequestSchema,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import {
  composeAndStoreAar,
  createCorrectiveAction,
  exportAarPdf,
  getAarAnalytics,
  getCorrectiveAction,
  listCorrectiveActions,
  listObservations,
  recordObservation,
  setCorrectiveActionStatus,
  updateCorrectiveAction,
} from "./service.js";

/**
 * Capability is one of the 32 National Preparedness Goal Core Capabilities;
 * the element is an HSEEP POETE element (or none). Both come from the
 * dictionary so the API rejects anything off-doctrine.
 */
const capabilitySchema = z.enum(CORE_CAPABILITIES.values as [string, ...string[]]);
const capabilityElementSchema = z.enum(CAPABILITY_ELEMENT.values as [string, ...string[]]);
const prioritySchema = z.enum(AAR_ACTION_PRIORITIES);
const statusSchema = z.enum(AAR_ACTION_STATUSES);
const periodRevisionSchema = z.coerce.number().int().positive();

/**
 * After-action and improvement-planning routes. Observations are
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
  periodRevision: z.number().int().positive().optional(),
});
const AarBody = z.object({
  overview: z.string().min(1),
  objectives: z.array(z.string().min(1)).optional(),
  period: z.string().optional(),
  periodRevision: z.number().int().positive().optional(),
}).refine((body) => body.period === undefined || body.periodRevision === undefined, {
  message: "choose legacy period text or an authoritative period revision",
});
const CaBody = z.object({
  incidentId: z.string().uuid().optional(),
  capability: capabilitySchema,
  capabilityElement: capabilityElementSchema.optional(),
  recommendation: z.string().min(1),
  priority: prioritySchema.optional(),
  periodRevision: z.number().int().positive().optional(),
  assignment: WorkflowAssignmentRequestSchema.optional(),
  ownerPosition: z.string().uuid().optional(),
  ownerPerson: z.string().uuid().optional(),
  dueDate: z.iso.date().optional(),
}).superRefine((body, ctx) => {
  if ([body.assignment, body.ownerPosition, body.ownerPerson].filter((value) => value !== undefined).length > 1)
    ctx.addIssue({ code: "custom", message: "choose one corrective action owner" });
  if (body.periodRevision !== undefined && body.incidentId === undefined)
    ctx.addIssue({ code: "custom", message: "period revision requires an incident" });
});
const StatusBody = z.object({ status: statusSchema });
const ActionUpdateBody = z.object({
  expectedRevision: z.number().int().nonnegative(),
  priority: prioritySchema.optional(),
  assignment: WorkflowAssignmentRequestSchema.nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
  status: statusSchema.optional(),
}).refine((body) => body.priority !== undefined || body.assignment !== undefined
  || body.dueDate !== undefined || body.status !== undefined, {
  message: "at least one corrective action field must change",
});

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
          ...(body.periodRevision !== undefined ? { periodRevision: body.periodRevision } : {}),
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
      const { periodRevision, ...page } = z.object({ periodRevision: periodRevisionSchema.optional(), ...pageQuery }).parse(req.query);
      const { items, nextCursor } = await withPerson(sql, req.principal.person.id, (tx) =>
        listObservations(tx, req.principal, incidentId, { periodRevision }, page),
      );
      return reply.send({ observations: items, nextCursor });
    },
  );

  app.get("/api/v1/incidents/:incidentId/aar/analytics", { preHandler: authenticate }, async (req, reply) => {
    const { incidentId } = req.params as { incidentId: string };
    const query = z.object({ periodRevision: periodRevisionSchema.optional() }).parse(req.query);
    return reply.send(await withPerson(sql, req.principal.person.id, (tx) =>
      getAarAnalytics(tx, req.principal, incidentId, query),
    ));
  });

  app.post("/api/v1/incidents/:incidentId/aar", { preHandler: authenticate }, async (req, reply) => {
    const { incidentId } = req.params as { incidentId: string };
    const body = AarBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      composeAndStoreAar(tx, req.principal, incidentId, {
        overview: body.overview,
        ...(body.objectives !== undefined ? { objectives: body.objectives } : {}),
        ...(body.period !== undefined ? { period: body.period } : {}),
        ...(body.periodRevision !== undefined ? { periodRevision: body.periodRevision } : {}),
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
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.periodRevision !== undefined ? { periodRevision: body.periodRevision } : {}),
          ...(body.assignment !== undefined ? { assignment: body.assignment } : {}),
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

  app.get("/api/v1/corrective-actions/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await withPerson(sql, req.principal.person.id, (tx) =>
      getCorrectiveAction(tx, req.principal, id),
    ));
  });

  app.patch("/api/v1/corrective-actions/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = ActionUpdateBody.parse(req.body);
    return reply.send(await withPerson(sql, req.principal.person.id, (tx) =>
      updateCorrectiveAction(tx, req.principal, id, body),
    ));
  });

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/corrective-actions",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const query = z.object({
        status: statusSchema.optional(),
        priority: prioritySchema.optional(),
        capability: capabilitySchema.optional(),
        incidentId: z.string().uuid().optional(),
        periodRevision: periodRevisionSchema.optional(),
        includeComplete: z.enum(["true", "false"]).optional(),
        ...pageQuery,
      }).parse(req.query);
      const { items, nextCursor } = await withPerson(sql, req.principal.person.id, (tx) =>
        listCorrectiveActions(tx, req.principal, jurisdictionId, {
          ...(query.status !== undefined ? { status: query.status } : {}),
          ...(query.priority !== undefined ? { priority: query.priority } : {}),
          ...(query.capability !== undefined ? { capability: query.capability } : {}),
          ...(query.incidentId !== undefined ? { incidentId: query.incidentId } : {}),
          ...(query.periodRevision !== undefined ? { periodRevision: query.periodRevision } : {}),
          includeComplete: query.includeComplete === "true",
        }, query),
      );
      return reply.send({ correctiveActions: items, nextCursor });
    },
  );
}
