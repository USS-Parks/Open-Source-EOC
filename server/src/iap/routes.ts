import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { IapWorkspaceQuerySchema, WorkflowAssignmentRequestSchema } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery, splitPageQuery } from "../db/cursor.js";
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
import {
  SaveComponentSchema,
  componentPdf,
  createComponent,
  getComponent,
  listComponentVersions,
  listComponents,
  saveComponent,
} from "./components.js";

/**
 * ICS form and IAP routes (F5). Forms prefill from live incident
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

const CreateComponentBody = z.object({
  formId: z.string().min(1).max(20),
  periodRevision: z.number().int().positive(),
  label: z.string().max(200).optional(),
}).strict();

const ComponentListQuery = z.object({
  periodRevision: z.coerce.number().int().positive().optional(),
}).strict();

const ComponentPdfQuery = z.object({
  version: z.coerce.number().int().positive().optional(),
}).strict();

const IncidentParams = z.object({ incidentId: z.uuid() });
const ComponentParams = z.object({ componentId: z.uuid() });

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
      const { page, filters } = splitPageQuery(req.query);
      const query = IapWorkspaceQuerySchema.parse(filters);
      const workspace = await withPerson(sql, req.principal.person.id, (tx) =>
        queryIapWorkspace(tx, req.principal, incidentId, query, page),
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
    const page = z.object(pageQuery).parse(req.query);
    const { items, nextCursor } = await withPerson(sql, req.principal.person.id, (tx) =>
      listIapRevisions(tx, req.principal, iapId, page),
    );
    return reply.send({ revisions: items, nextCursor });
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

  // ICS forms kept as components of an operational period (VA37).
  app.get("/api/v1/incidents/:incidentId/ics-components", { preHandler: authenticate }, async (req, reply) => {
    const { incidentId } = IncidentParams.parse(req.params);
    const { periodRevision } = ComponentListQuery.parse(req.query);
    const components = await withPerson(sql, req.principal.person.id, (tx) =>
      listComponents(tx, req.principal, incidentId, periodRevision),
    );
    return reply.send({ components });
  });

  app.post("/api/v1/incidents/:incidentId/ics-components", { preHandler: authenticate }, async (req, reply) => {
    const { incidentId } = IncidentParams.parse(req.params);
    const body = CreateComponentBody.parse(req.body);
    const component = await withPerson(sql, req.principal.person.id, (tx) =>
      createComponent(tx, req.principal, incidentId, body),
    );
    return reply.status(201).send(component);
  });

  app.get("/api/v1/ics-components/:componentId", { preHandler: authenticate }, async (req, reply) => {
    const { componentId } = ComponentParams.parse(req.params);
    const component = await withPerson(sql, req.principal.person.id, (tx) =>
      getComponent(tx, req.principal, componentId),
    );
    return reply.send(component);
  });

  app.put("/api/v1/ics-components/:componentId", { preHandler: authenticate }, async (req, reply) => {
    const { componentId } = ComponentParams.parse(req.params);
    const body = SaveComponentSchema.parse(req.body);
    const component = await withPerson(sql, req.principal.person.id, (tx) =>
      saveComponent(tx, req.principal, componentId, body),
    );
    return reply.send(component);
  });

  app.get("/api/v1/ics-components/:componentId/versions", { preHandler: authenticate }, async (req, reply) => {
    const { componentId } = ComponentParams.parse(req.params);
    const versions = await withPerson(sql, req.principal.person.id, (tx) =>
      listComponentVersions(tx, req.principal, componentId),
    );
    return reply.send({ versions });
  });

  app.get("/api/v1/ics-components/:componentId/pdf", { preHandler: authenticate }, async (req, reply) => {
    const { componentId } = ComponentParams.parse(req.params);
    const { version } = ComponentPdfQuery.parse(req.query);
    const { filename, bytes } = await withPerson(sql, req.principal.person.id, (tx) =>
      componentPdf(tx, req.principal, componentId, version),
    );
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(Buffer.from(bytes));
  });
}
