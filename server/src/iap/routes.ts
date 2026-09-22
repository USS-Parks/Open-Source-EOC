import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { IapWorkspaceQuerySchema, WorkflowAssignmentRequestSchema } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  approveIap,
  buildForm,
  createIap,
  createIapRevision,
  exportIapPdf,
  exportIapRevisionPdf,
  getIap,
  markIapComplete,
  listIapRevisions,
  queryIapWorkspace,
  replaceIcs204Assignments,
  submitIapForApproval,
} from "./service.js";

/**
 * ICS form and IAP routes (VEOC-34, F5). Forms prefill from live incident
 * data; the IAP assembles the operational period's forms with a small amount
 * of human input, carries an approval step, and exports to PDF.
 */

const IapBody = z.object({
  operationalPeriod: z.string().min(1),
  objectives: z.array(z.string().min(1)).optional(),
  preparedBy: z.string().min(1).optional(),
  safetyMessage: z.string().min(1).optional(),
  formIds: z.array(z.string().min(1)).optional(),
  periodRevision: z.number().int().positive().optional(),
});

const Ics204ResourceBody = z.object({
  name: z.string().trim().min(1).max(240),
  identifier: z.string().trim().max(160).default(""),
  leader: z.string().trim().max(160).default(""),
  quantity: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(2000).default(""),
}).strict();

const Ics204AssignmentBody = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(240),
  supervisor: WorkflowAssignmentRequestSchema,
  tactics: z.array(z.string().trim().min(1).max(2000)).min(1).max(100),
  resources: z.array(Ics204ResourceBody).max(200),
}).strict();

const ReplaceIcs204Body = z.object({
  expectedContentRevision: z.number().int().positive(),
  assignments: z.array(Ics204AssignmentBody).min(1).max(100),
}).strict();

const CreateRevisionBody = z.object({
  assignments: z.array(Ics204AssignmentBody).min(1).max(100),
}).strict();

export function iapRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/incidents/:incidentId/ics-forms/:formId",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId, formId } = req.params as { incidentId: string; formId: string };
      const query = req.query as { period?: string; preparedBy?: string };
      const form = await withPerson(sql, req.principal.person.id, (tx) =>
        buildForm(tx, req.principal, incidentId, formId, {
          operationalPeriod: query.period ?? "",
          ...(query.preparedBy !== undefined ? { preparedBy: query.preparedBy } : {}),
        }),
      );
      return reply.send(form);
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/iap",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const body = IapBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        createIap(tx, req.principal, incidentId, {
          operationalPeriod: body.operationalPeriod,
          ...(body.objectives !== undefined ? { objectives: body.objectives } : {}),
          ...(body.preparedBy !== undefined ? { preparedBy: body.preparedBy } : {}),
          ...(body.safetyMessage !== undefined ? { safetyMessage: body.safetyMessage } : {}),
          ...(body.formIds !== undefined ? { formIds: body.formIds } : {}),
          ...(body.periodRevision !== undefined ? { periodRevision: body.periodRevision } : {}),
        }),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/incidents/:incidentId/iaps",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const query = IapWorkspaceQuerySchema.parse(req.query);
      const workspace = await withPerson(sql, req.principal.person.id, (tx) =>
        queryIapWorkspace(tx, req.principal, incidentId, query),
      );
      return reply.send(workspace);
    },
  );

  app.get("/api/v1/iap/:iapId", { preHandler: authenticate }, async (req, reply) => {
    const { iapId } = req.params as { iapId: string };
    const iap = await withPerson(sql, req.principal.person.id, (tx) => getIap(tx, req.principal, iapId));
    return reply.send(iap);
  });

  app.put("/api/v1/iap/:iapId/ics-204", { preHandler: authenticate }, async (req, reply) => {
    const { iapId } = req.params as { iapId: string };
    const body = ReplaceIcs204Body.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      replaceIcs204Assignments(tx, req.principal, iapId, body),
    );
    return reply.send(result);
  });

  app.post("/api/v1/iap/:iapId/revisions", { preHandler: authenticate }, async (req, reply) => {
    const { iapId } = req.params as { iapId: string };
    const body = CreateRevisionBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      createIapRevision(tx, req.principal, iapId, body.assignments),
    );
    return reply.status(201).send(result);
  });

  app.get("/api/v1/iap/:iapId/revisions", { preHandler: authenticate }, async (req, reply) => {
    const { iapId } = req.params as { iapId: string };
    const revisions = await withPerson(sql, req.principal.person.id, (tx) =>
      listIapRevisions(tx, req.principal, iapId),
    );
    return reply.send({ revisions });
  });

  app.get("/api/v1/iap/:iapId/revisions/:revision/pdf", {
    preHandler: authenticate,
  }, async (req, reply) => {
    const { iapId, revision: rawRevision } = req.params as { iapId: string; revision: string };
    const revision = z.coerce.number().int().positive().parse(rawRevision);
    const { filename, bytes } = await withPerson(sql, req.principal.person.id, (tx) =>
      exportIapRevisionPdf(tx, req.principal, iapId, revision),
    );
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(Buffer.from(bytes));
  });

  app.post("/api/v1/iap/:iapId/submit", { preHandler: authenticate }, async (req, reply) => {
    const { iapId } = req.params as { iapId: string };
    await withPerson(sql, req.principal.person.id, (tx) => submitIapForApproval(tx, req.principal, iapId));
    return reply.send({ ok: true });
  });

  app.post("/api/v1/iap/:iapId/approve", { preHandler: authenticate }, async (req, reply) => {
    const { iapId } = req.params as { iapId: string };
    await withPerson(sql, req.principal.person.id, (tx) => approveIap(tx, req.principal, iapId));
    return reply.send({ ok: true });
  });

  app.post("/api/v1/iap/:iapId/complete", { preHandler: authenticate }, async (req, reply) => {
    const { iapId } = req.params as { iapId: string };
    await withPerson(sql, req.principal.person.id, (tx) => markIapComplete(tx, req.principal, iapId));
    return reply.send({ ok: true });
  });

  app.get("/api/v1/iap/:iapId/pdf", { preHandler: authenticate }, async (req, reply) => {
    const { iapId } = req.params as { iapId: string };
    const { filename, bytes } = await withPerson(sql, req.principal.person.id, (tx) =>
      exportIapPdf(tx, req.principal, iapId),
    );
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(Buffer.from(bytes));
  });
}
