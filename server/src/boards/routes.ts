import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { WorkflowAssignmentRequestSchema } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { notifyBoardEvent, type BoardEvent } from "../notify/engine.js";
import { publishBoardEvent } from "../events/bus.js";
import {
  addLocalField,
  createBoard,
  createRecord,
  getBoardReadShape,
  getBoardRecordDetail,
  getTemplateVersion,
  importTemplatePackage,
  listBoards,
  listRecordReferenceOptions,
  listTemplateVersions,
  listViewRecords,
  registerTemplate,
  updateRecord,
  upgradeBoard,
  visibleFields,
  visibleLayout,
  visibleViews,
} from "./service.js";
import {
  approveWorkflowTransition,
  getRecordWorkflow,
  processWorkflowEscalation,
  requestWorkflowTransition,
} from "./workflow-runtime.js";

const CreateBoardBody = z.object({
  templateKey: z.string().min(1),
  version: z.number().int().positive().optional(),
  title: z.string().min(1).optional(),
});
const UpgradeBody = z.object({ toVersion: z.number().int().positive() });
const RecordBody = z.record(z.string(), z.unknown());
const WorkflowKey = z.string().regex(/^[a-z][a-z0-9_]*$/);
const IdempotencyKey = z.string().trim().min(1).max(200);
const TransitionBody = z.object({
  transitionKey: WorkflowKey,
  assignment: WorkflowAssignmentRequestSchema.optional(),
  idempotencyKey: IdempotencyKey,
}).strict();
const ApprovalBody = z.object({
  transitionKey: WorkflowKey,
  ruleKey: WorkflowKey,
  idempotencyKey: IdempotencyKey,
}).strict();
const EscalationBody = z.object({
  ruleKey: WorkflowKey,
  occurrence: z.number().int().min(0).max(19),
  assignment: WorkflowAssignmentRequestSchema.optional(),
  idempotencyKey: IdempotencyKey,
}).strict();

export interface BoardRouteOptions {
  readonly trustedTemplateKeys: readonly string[];
}

export function boardRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
  options: BoardRouteOptions,
): void {
  app.post("/api/v1/templates", { preHandler: authenticate }, async (req, reply) => {
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      registerTemplate(tx, req.principal, req.body),
    );
    return reply.status(201).send(result);
  });

  app.post("/api/v1/templates/import", { preHandler: authenticate }, async (req, reply) => {
    const imported = await withPerson(sql, req.principal.person.id, (tx) =>
      importTemplatePackage(tx, req.principal, req.body, options.trustedTemplateKeys),
    );
    return reply.status(201).send({ imported });
  });

  app.get("/api/v1/templates/:key/versions", { preHandler: authenticate }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const versions = await withPerson(sql, req.principal.person.id, (tx) =>
      listTemplateVersions(tx, key),
    );
    return reply.send({ versions });
  });

  app.get("/api/v1/templates/:key/versions/:version", { preHandler: authenticate }, async (req, reply) => {
    const { key, version: rawVersion } = req.params as { key: string; version: string };
    const version = z.coerce.number().int().positive().parse(rawVersion);
    const template = await withPerson(sql, req.principal.person.id, (tx) =>
      getTemplateVersion(tx, key, version),
    );
    return reply.send(template);
  });

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/boards",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = CreateBoardBody.parse(req.body);
      const id = await withPerson(sql, req.principal.person.id, (tx) =>
        createBoard(tx, req.principal, jurisdictionId, body.templateKey, body.version, body.title),
      );
      return reply.status(201).send({ id });
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/boards",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const boards = await withPerson(sql, req.principal.person.id, (tx) =>
        listBoards(tx, req.principal, jurisdictionId),
      );
      return reply.send({ boards });
    },
  );

  app.get("/api/v1/boards/:boardId", { preHandler: authenticate }, async (req, reply) => {
    const { boardId } = req.params as { boardId: string };
    const { incidentId } = z.object({ incidentId: z.string().uuid().optional() }).strict().parse(req.query);
    const shape = await withPerson(sql, req.principal.person.id, (tx) =>
      getBoardReadShape(tx, req.principal, boardId, incidentId),
    );
    const { board } = shape;
    return reply.send({
      id: board.id,
      title: board.title,
      templateKey: board.template.key,
      templateVersion: board.template.version,
      role: board.role,
      canContribute: shape.canContribute,
      fields: visibleFields(board),
      views: visibleViews(board),
      inputLayout: visibleLayout(board, board.template.inputLayout),
      detailLayout: visibleLayout(board, board.template.detailLayout),
    });
  });

  app.post(
    "/api/v1/boards/:boardId/local-fields",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId } = req.params as { boardId: string };
      await withPerson(sql, req.principal.person.id, (tx) =>
        addLocalField(tx, req.principal, boardId, req.body),
      );
      return reply.status(201).send({ ok: true });
    },
  );

  app.post("/api/v1/boards/:boardId/upgrade", { preHandler: authenticate }, async (req, reply) => {
    const { boardId } = req.params as { boardId: string };
    const body = UpgradeBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      upgradeBoard(tx, req.principal, boardId, body.toVersion),
    );
    return reply.send(result);
  });

  app.post("/api/v1/boards/:boardId/records", { preHandler: authenticate }, async (req, reply) => {
    const { boardId } = req.params as { boardId: string };
    // Optional incident scope: a participant contributes a record to a board
    // the incident uses (VEOC-79B1). Absent, the record is jurisdiction-local.
    const { incidentId } = z.object({ incidentId: z.string().uuid().optional() }).parse(req.query);
    const data = RecordBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      createRecord(tx, req.principal, boardId, data, incidentId),
    );
    // Post-commit fan-out: delivery never runs inside the mutating tx.
    const event: BoardEvent = {
      jurisdictionId: result.jurisdictionId,
      boardId,
      boardKey: result.boardKey,
      recordId: result.id,
      event: "record.created",
      record: result.data,
    };
    await notifyBoardEvent(sql, req.principal, event);
    publishBoardEvent(event);
    return reply.status(201).send({ id: result.id });
  });

  app.get("/api/v1/boards/:boardId/records/:recordId/detail", { preHandler: authenticate }, async (req) => {
    const { boardId, recordId } = z.object({ boardId: z.string().uuid(), recordId: z.string().uuid() }).parse(req.params);
    const { incidentId } = z.object({ incidentId: z.string().uuid().optional() }).strict().parse(req.query);
    return withPerson(sql, req.principal.person.id, (tx) =>
      getBoardRecordDetail(tx, req.principal, boardId, recordId, incidentId));
  });

  app.patch(
    "/api/v1/boards/:boardId/records/:recordId",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId, recordId } = req.params as { boardId: string; recordId: string };
      const { incidentId } = z.object({ incidentId: z.string().uuid().optional() }).strict().parse(req.query);
      const patch = RecordBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        updateRecord(tx, req.principal, boardId, recordId, patch, incidentId),
      );
      if (result.changed) {
        const event: BoardEvent = {
          jurisdictionId: result.jurisdictionId,
          boardId,
          boardKey: result.boardKey,
          recordId,
          event: "record.updated",
          record: result.data,
          previous: result.previous,
        };
        await notifyBoardEvent(sql, req.principal, event);
        publishBoardEvent(event);
      }
      return reply.send({ ok: true });
    },
  );

  app.get(
    "/api/v1/boards/:boardId/records/:recordId/workflow",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId, recordId } = req.params as { boardId: string; recordId: string };
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        getRecordWorkflow(tx, req.principal, boardId, recordId));
      return reply.send(result);
    },
  );

  app.post(
    "/api/v1/boards/:boardId/records/:recordId/workflow/transitions",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId, recordId } = req.params as { boardId: string; recordId: string };
      const body = TransitionBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        requestWorkflowTransition(tx, req.principal, boardId, recordId, body));
      return reply.send(result);
    },
  );

  app.post(
    "/api/v1/boards/:boardId/records/:recordId/workflow/approvals",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId, recordId } = req.params as { boardId: string; recordId: string };
      const body = ApprovalBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        approveWorkflowTransition(tx, req.principal, boardId, recordId, body));
      return reply.send(result);
    },
  );

  app.post(
    "/api/v1/boards/:boardId/records/:recordId/workflow/escalations",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId, recordId } = req.params as { boardId: string; recordId: string };
      const body = EscalationBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        processWorkflowEscalation(tx, req.principal, boardId, recordId, body));
      return reply.send(result);
    },
  );

  app.get(
    "/api/v1/boards/:boardId/record-references/:fieldKey",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId, fieldKey } = req.params as { boardId: string; fieldKey: string };
      const query = z.object({
        incidentId: z.string().uuid(),
        after: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }).parse(req.query);
      const options = await withPerson(sql, req.principal.person.id, (tx) =>
        listRecordReferenceOptions(tx, req.principal, query.incidentId, boardId, fieldKey, query.after, query.limit),
      );
      return reply.send({ options });
    },
  );

  app.get(
    "/api/v1/boards/:boardId/views/:viewKey",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId, viewKey } = req.params as { boardId: string; viewKey: string };
      // Optional incident scope: narrow the view to the records this incident
      // holds on the board (VEOC-79B2).
      const { incidentId } = z.object({ incidentId: z.string().uuid().optional() }).parse(req.query);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        listViewRecords(tx, req.principal, boardId, viewKey, incidentId),
      );
      return reply.send(result);
    },
  );
}
