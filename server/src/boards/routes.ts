import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ViewConditionSchema, WorkflowAssignmentRequestSchema } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import { AuthError } from "../auth/service.js";
import { notifyBoardEvent, type BoardEvent } from "../notify/engine.js";
import { publishBoardEvent } from "../events/bus.js";
import { appendRecordRemoval } from "../sync/hub.js";
import { publishRecordRemoved } from "./removals.js";
import { queueRecordDeletion } from "../federation/service.js";
import {
  addLocalField,
  createBoard,
  createRecord,
  deleteRecord,
  getBoardReadShape,
  getBoardRecordDetail,
  getTemplateVersion,
  importTemplatePackage,
  listBoards,
  listRecordHistory,
  listRecordReferenceOptions,
  listTemplateVersions,
  listViewRecords,
  registerTemplate,
  setRecordArchived,
  updateRecord,
  upgradeBoard,
  visibleFields,
  visibleLayout,
  visibleViews,
  type ViewOptions,
} from "./service.js";
import {
  exportViewTable,
  ImportMappingSchema,
  importBoardRecords,
  MAX_IMPORT_BYTES,
  readUploadedTable,
  tableCsv,
  tableXlsx,
} from "./transfer.js";
import {
  approveWorkflowTransition,
  getRecordWorkflow,
  processWorkflowEscalation,
  requestWorkflowTransition,
  withdrawWorkflowTransition,
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
const WithdrawalBody = z.object({
  transitionKey: WorkflowKey,
  action: z.enum(["reject", "cancel"]),
  note: z.string().trim().min(1).max(500).optional(),
  idempotencyKey: IdempotencyKey,
}).strict();
const EscalationBody = z.object({
  ruleKey: WorkflowKey,
  occurrence: z.number().int().min(0).max(19),
  assignment: WorkflowAssignmentRequestSchema.optional(),
  idempotencyKey: IdempotencyKey,
}).strict();
const RecordParams = z.object({ boardId: z.string().uuid(), recordId: z.string().uuid() });
const IncidentQuery = z.object({ incidentId: z.string().uuid().optional() });
/** `field:dir` pairs, comma separated, most significant first. */
const SortParam = z.string().regex(/^[a-z][a-z0-9_]*:(asc|desc)(,[a-z][a-z0-9_]*:(asc|desc)){0,3}$/);
/** Request-time view refinements shared by the view and its export. */
const ViewQuery = {
  incidentId: z.string().uuid().optional(),
  archived: z.enum(["exclude", "include", "only"]).optional(),
  where: z.string().max(16_000).optional(),
  sort: SortParam.optional(),
  groupBy: WorkflowKey.optional(),
};

function viewOptions(query: { archived?: ViewOptions["archived"]; where?: string | undefined; sort?: string | undefined; groupBy?: string | undefined }): ViewOptions {
  let where: unknown = undefined;
  if (query.where !== undefined) {
    try {
      where = JSON.parse(query.where);
    } catch {
      throw new AuthError(400, "where must be a JSON array of conditions");
    }
  }
  return {
    archived: query.archived,
    where: where === undefined ? undefined : z.array(ViewConditionSchema).max(16).parse(where),
    sorts: query.sort?.split(",").map((pair) => {
      const [field, dir] = pair.split(":") as [string, "asc" | "desc"];
      return { field, dir };
    }),
    groupBy: query.groupBy,
  };
}

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

  /** Every published board template at its latest version, by title, to create a board from. */
  app.get("/api/v1/templates", { preHandler: authenticate }, async (req, reply) => {
    const rows = await withPerson(sql, req.principal.person.id, (tx) => tx`
      select * from (select distinct on (key) key, version, title from board_templates order by key, version desc) latest
      order by title, key`);
    return reply.send({
      templates: rows.map((row) => ({ key: row.key as string, version: row.version as number, title: row.title as string })),
    });
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
    // Notifications queue inside the write transaction; the outbox worker
    // delivers them, so no network call is awaited here.
    const { result, event } = await withPerson(sql, req.principal.person.id, async (tx) => {
      const result = await createRecord(tx, req.principal, boardId, data, incidentId);
      const event: BoardEvent = {
        jurisdictionId: result.jurisdictionId,
        boardId,
        boardKey: result.boardKey,
        recordId: result.id,
        event: "record.created",
        record: result.data,
      };
      await notifyBoardEvent(tx, req.principal, event);
      return { result, event };
    });
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
      const event = await withPerson(sql, req.principal.person.id, async (tx) => {
        const result = await updateRecord(tx, req.principal, boardId, recordId, patch, incidentId);
        if (!result.changed) return null;
        const event: BoardEvent = {
          jurisdictionId: result.jurisdictionId,
          boardId,
          boardKey: result.boardKey,
          recordId,
          event: "record.updated",
          record: result.data,
          previous: result.previous,
        };
        await notifyBoardEvent(tx, req.principal, event);
        return event;
      });
      if (event) publishBoardEvent(event);
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
    "/api/v1/boards/:boardId/records/:recordId/workflow/withdrawals",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId, recordId } = req.params as { boardId: string; recordId: string };
      const body = WithdrawalBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        withdrawWorkflowTransition(tx, req.principal, boardId, recordId, body));
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
      // holds on the board. The other parameters refine the view for this read.
      const query = z.object({ ...ViewQuery, ...pageQuery }).parse(req.query);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        listViewRecords(tx, req.principal, boardId, viewKey, query.incidentId,
          { ...viewOptions(query), cursor: query.cursor, limit: query.limit }),
      );
      return reply.send(result);
    },
  );

  // Every page of a view as one file, under the same refinements as the view.
  app.get(
    "/api/v1/boards/:boardId/views/:viewKey/export",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId, viewKey } = req.params as { boardId: string; viewKey: string };
      const query = z.object({ ...ViewQuery, format: z.enum(["csv", "xlsx"]).default("csv") }).parse(req.query);
      const table = await withPerson(sql, req.principal.person.id, (tx) =>
        exportViewTable(tx, req.principal, boardId, viewKey, query.incidentId, viewOptions(query)));
      if (query.format === "xlsx") {
        return reply
          .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
          .header("content-disposition", `attachment; filename="${viewKey}.xlsx"`)
          .send(Buffer.from(tableXlsx(table)));
      }
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${viewKey}.csv"`)
        .send(tableCsv(table));
    },
  );

  /**
   * Import a CSV or .xlsx upload into a board: multipart with an optional
   * `mapping` field (JSON, header to field key or null) before one file
   * part. `dryRun=true` validates and writes nothing; otherwise every row is
   * written in one transaction, or none when any row fails (422).
   */
  app.post("/api/v1/boards/:boardId/import", { preHandler: authenticate }, async (req, reply) => {
    const { boardId } = z.object({ boardId: z.string().uuid() }).parse(req.params);
    const query = z.object({
      incidentId: z.string().uuid().optional(),
      dryRun: z.enum(["true", "false"]).default("false"),
    }).strict().parse(req.query);
    if (!req.isMultipart()) throw new AuthError(415, "import must be multipart/form-data");
    const part = await req
      .file({ limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 2, fieldSize: 64 * 1024, parts: 3 } })
      .catch((err: unknown) => {
        const status = (err as { statusCode?: unknown }).statusCode;
        const code = typeof status === "number" && status >= 400 && status < 500 ? status : 400;
        throw new AuthError(code, err instanceof Error ? err.message : "malformed upload");
      });
    if (!part) throw new AuthError(400, "a file part is required");
    const buffer = await part.toBuffer().catch((err: unknown) => {
      const status = (err as { statusCode?: unknown }).statusCode;
      throw new AuthError(typeof status === "number" ? status : 400, "import file exceeds the size limit");
    });
    const mappingField = part.fields.mapping;
    let mapping: z.infer<typeof ImportMappingSchema> | undefined;
    if (mappingField && !Array.isArray(mappingField) && mappingField.type === "field") {
      try {
        mapping = ImportMappingSchema.parse(JSON.parse(String(mappingField.value)));
      } catch {
        throw new AuthError(400, "mapping must be a JSON object of header to field key");
      }
    }
    const table = readUploadedTable(buffer);
    const dryRun = query.dryRun === "true";
    const outcome = await withPerson(sql, req.principal.person.id, (tx) =>
      importBoardRecords(tx, req.principal, boardId, table, { dryRun, incidentId: query.incidentId, mapping }));
    // Imported records reach live views and dashboards; a bulk load sends no
    // per-record notifications.
    for (const record of outcome.created) {
      publishBoardEvent({
        jurisdictionId: outcome.jurisdictionId, boardId, boardKey: outcome.boardKey,
        recordId: record.id, event: "record.created", record: record.data,
      });
    }
    const status = outcome.result.errorCount > 0 ? (dryRun ? 200 : 422) : dryRun ? 200 : 201;
    return reply.status(status).send(outcome.result);
  });

  app.get("/api/v1/boards/:boardId/records/:recordId/history", { preHandler: authenticate }, async (req) => {
    const { boardId, recordId } = RecordParams.parse(req.params);
    const query = z.object({ ...IncidentQuery.shape, ...pageQuery }).strict().parse(req.query);
    const page = await withPerson(sql, req.principal.person.id, (tx) =>
      listRecordHistory(tx, req.principal, boardId, recordId, query.incidentId, query));
    return { entries: page.items, nextCursor: page.nextCursor };
  });

  for (const [action, archived] of [["archive", true], ["restore", false]] as const) {
    app.post(`/api/v1/boards/:boardId/records/:recordId/${action}`, { preHandler: authenticate }, async (req) => {
      const { boardId, recordId } = RecordParams.parse(req.params);
      return withPerson(sql, req.principal.person.id, (tx) =>
        setRecordArchived(tx, req.principal, boardId, recordId, archived));
    });
  }

  // Delete leaves a tombstone and removes the record from every sync
  // document in the same transaction; open sync sessions hear it after. The
  // board event only tells in-process listeners (live dashboards, sync row
  // caches) to recompute; it queues no notification.
  app.delete("/api/v1/boards/:boardId/records/:recordId", { preHandler: authenticate }, async (req) => {
    const { boardId, recordId } = RecordParams.parse(req.params);
    const deleted = await withPerson(sql, req.principal.person.id, async (tx) => {
      const result = await deleteRecord(tx, req.principal, boardId, recordId);
      await appendRecordRemoval(tx, boardId, recordId);
      // A jurisdiction-wide record's deletion goes to the board's peers too.
      if (result.incidentId === null) await queueRecordDeletion(tx, boardId, recordId, null);
      return result;
    });
    publishRecordRemoved({ boardId, recordId, incidentId: deleted.incidentId });
    publishBoardEvent({
      jurisdictionId: deleted.jurisdictionId, boardId, boardKey: deleted.boardKey,
      recordId, event: "record.updated", record: {}, previous: deleted.previous,
    });
    return { ok: true };
  });
}
