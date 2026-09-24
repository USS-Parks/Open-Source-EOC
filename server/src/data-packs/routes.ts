import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { DataPackSchema } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError } from "../auth/service.js";
import { MAX_IMPORT_BYTES, readUploadedTable } from "../boards/transfer.js";
import { publishBoardEvent } from "../events/bus.js";
import {
  getWebeocMapping,
  importWebeocRecords,
  saveWebeocMapping,
  TimeZoneSchema,
  WebeocMappingSchema,
  type WebeocMapping,
} from "./webeoc.js";
import {
  listCatalogForIncident,
  listDatasetItems,
  listIncidentDatasets,
  loadDataset,
  onboardCatalogSource,
  registerDataPack,
} from "./service.js";

const IncidentId = z.string().uuid();
const DatasetId = z.string().uuid();
const BboxParam = z.string().transform((raw, ctx) => {
  const values = raw.split(",").map((value) => Number(value.trim()));
  if (
    values.length !== 4 || values.some((value) => !Number.isFinite(value)) ||
    values[0]! < -180 || values[2]! > 180 || values[1]! < -90 || values[3]! > 90 ||
    values[0]! >= values[2]! || values[1]! >= values[3]!
  ) {
    ctx.addIssue({ code: "custom", message: "bbox must be west,south,east,north in WGS84" });
    return z.NEVER;
  }
  return values as [number, number, number, number];
});
const ItemsQuery = z.object({
  bbox: BboxParam.optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
}).strict();
const LoadBody = z.union([
  z.object({ records: z.array(z.unknown()).max(10000) }).strict(),
  z.object({ error: z.string().trim().min(1).max(1000) }).strict(),
]);
const BoardParams = z.object({ boardId: z.string().uuid() });
const SaveMappingBody = z.object({ mapping: WebeocMappingSchema, timeZone: TimeZoneSchema.nullable().default(null) }).strict();

export function dataPackRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get("/api/v1/incidents/:incidentId/datasets", { preHandler: authenticate }, async (req) => {
    const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
    const datasets = await withPerson(sql, req.principal.person.id, (tx) =>
      listIncidentDatasets(tx, req.principal, incidentId),
    );
    return { datasets };
  });

  app.post(
    "/api/v1/incidents/:incidentId/data-packs",
    { preHandler: authenticate },
    async (req, reply) => {
      const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
      const input = DataPackSchema.parse(req.body);
      const pack = await withPerson(sql, req.principal.person.id, (tx) =>
        registerDataPack(tx, req.principal, incidentId, input),
      );
      return reply.status(201).send({ pack });
    },
  );

  app.post(
    "/api/v1/data-packs/datasets/:datasetId/load",
    { preHandler: authenticate },
    async (req) => {
      const datasetId = DatasetId.parse((req.params as { datasetId: string }).datasetId);
      const outcome = LoadBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        loadDataset(tx, req.principal, datasetId, outcome),
      );
      return { result };
    },
  );

  app.get("/api/v1/datasets/:datasetId/items", { preHandler: authenticate }, async (req, reply) => {
    const datasetId = DatasetId.parse((req.params as { datasetId: string }).datasetId);
    const query = ItemsQuery.parse(req.query);
    const fc = await withPerson(sql, req.principal.person.id, (tx) =>
      listDatasetItems(tx, req.principal, datasetId, query),
    );
    return reply.header("content-type", "application/geo+json").send(fc);
  });

  app.get("/api/v1/incidents/:incidentId/catalog", { preHandler: authenticate }, async (req) => {
    const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
    const sources = await withPerson(sql, req.principal.person.id, (tx) =>
      listCatalogForIncident(tx, req.principal, incidentId),
    );
    return { sources };
  });

  app.post(
    "/api/v1/incidents/:incidentId/catalog/:sourceId/onboard",
    { preHandler: authenticate },
    async (req, reply) => {
      const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
      const { sourceId } = req.params as { sourceId: string };
      const pack = await withPerson(sql, req.principal.person.id, (tx) =>
        onboardCatalogSource(tx, req.principal, incidentId, sourceId),
      );
      return reply.status(201).send({ pack });
    },
  );

  app.get("/api/v1/boards/:boardId/webeoc-mapping", { preHandler: authenticate }, async (req) => {
    const { boardId } = BoardParams.parse(req.params);
    return withPerson(sql, req.principal.person.id, (tx) => getWebeocMapping(tx, req.principal, boardId));
  });

  app.put("/api/v1/boards/:boardId/webeoc-mapping", { preHandler: authenticate }, async (req) => {
    const { boardId } = BoardParams.parse(req.params);
    const body = SaveMappingBody.parse(req.body);
    return withPerson(sql, req.principal.person.id, (tx) => saveWebeocMapping(tx, req.principal, boardId, body));
  });

  /**
   * A WebEOC board export in: multipart with optional `mapping` (JSON, board
   * field to column) and `timeZone` fields before one CSV file part.
   * `dryRun=true` reports every row and writes nothing; otherwise the valid
   * rows are written in one transaction and the rejected rows reported.
   */
  app.post("/api/v1/boards/:boardId/webeoc-import", { preHandler: authenticate }, async (req, reply) => {
    const { boardId } = BoardParams.parse(req.params);
    const query = z.object({ dryRun: z.enum(["true", "false"]).default("false") }).strict().parse(req.query);
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
    const text = (name: string) => {
      const field = part.fields[name];
      return field && !Array.isArray(field) && field.type === "field" ? String(field.value) : undefined;
    };
    let mapping: WebeocMapping | undefined;
    const mappingText = text("mapping");
    if (mappingText !== undefined) {
      try {
        mapping = WebeocMappingSchema.parse(JSON.parse(mappingText));
      } catch {
        throw new AuthError(400, "mapping must be a JSON object of board field to column");
      }
    }
    const zone = text("timeZone");
    const timeZone = zone === undefined || zone === "" ? undefined : TimeZoneSchema.safeParse(zone).data;
    if (zone && !timeZone) throw new AuthError(400, "unknown time zone");
    const table = readUploadedTable(buffer);
    const outcome = await withPerson(sql, req.principal.person.id, (tx) =>
      importWebeocRecords(tx, req.principal, boardId, table, { dryRun: query.dryRun === "true", mapping, timeZone }));
    // Imported records reach live views and dashboards; a bulk load sends no
    // per-record notifications.
    for (const record of outcome.created) {
      publishBoardEvent({
        jurisdictionId: outcome.jurisdictionId, boardId, boardKey: outcome.boardKey,
        recordId: record.id, event: "record.created", record: record.data,
      });
    }
    return reply.status(outcome.report.created > 0 ? 201 : 200).send(outcome.report);
  });
}
