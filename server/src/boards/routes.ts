import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { notifyBoardEvent, type BoardEvent } from "../notify/engine.js";
import { publishBoardEvent } from "../events/bus.js";
import {
  addLocalField,
  createBoard,
  createRecord,
  getEffectiveBoard,
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
} from "./service.js";

const CreateBoardBody = z.object({
  templateKey: z.string().min(1),
  version: z.number().int().positive().optional(),
  title: z.string().min(1).optional(),
});
const UpgradeBody = z.object({ toVersion: z.number().int().positive() });
const RecordBody = z.record(z.string(), z.unknown());

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
    const board = await withPerson(sql, req.principal.person.id, (tx) =>
      getEffectiveBoard(tx, req.principal, boardId),
    );
    return reply.send({
      id: board.id,
      title: board.title,
      templateKey: board.template.key,
      templateVersion: board.template.version,
      role: board.role,
      fields: visibleFields(board),
      views: board.template.views,
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

  app.patch(
    "/api/v1/boards/:boardId/records/:recordId",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId, recordId } = req.params as { boardId: string; recordId: string };
      const patch = RecordBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        updateRecord(tx, req.principal, boardId, recordId, patch),
      );
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
      return reply.send({ ok: true });
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
