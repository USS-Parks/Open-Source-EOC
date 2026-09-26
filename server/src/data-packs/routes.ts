import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { DataPackSchema } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import { AuthError, type Principal } from "../auth/service.js";
import { forgetPerson } from "../auth/principal-cache.js";
import { MAX_IMPORT_BYTES, readUploadedTable } from "../boards/transfer.js";
import { publishBoardEvent } from "../events/bus.js";
import { getImportReport, listImportReports, signOffImportReport } from "./import-reports.js";
import { importPeople, peopleImportTemplate } from "./people-import.js";
import {
  boardImportTemplate,
  getWebeocMapping,
  importWebeocRecords,
  saveWebeocMapping,
  TimeZoneSchema,
  WebeocMappingSchema,
  type WebeocMapping,
} from "./webeoc.js";
import { importSolutionPackage, listImportedPackages } from "./solution-import.js";
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
const JurisdictionParams = z.object({ jurisdictionId: z.string().uuid() });
const ReportParams = z.object({ reportId: z.string().uuid() });
const DryRunQuery = z.object({ dryRun: z.enum(["true", "false"]).default("false") }).strict();
const SignOffBody = z.object({ note: z.string().trim().max(2000).default("") }).strict();

/**
 * One uploaded table: at most `fields` multipart text fields before one
 * file part, read under the board import's size limit.
 */
async function uploadedTable(req: FastifyRequest, fields: number) {
  if (!req.isMultipart()) throw new AuthError(415, "import must be multipart/form-data");
  const part = await req
    .file({ limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields, fieldSize: 64 * 1024, parts: fields + 1 } })
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
  return { table: readUploadedTable(buffer), text, fileName: part.filename };
}

export function dataPackRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
  options: {
    readonly trustedTemplateKeys: readonly string[];
    /** Collaboration membership follows a position assignment, after the commit. */
    readonly syncPosition?: (principal: Principal, positionId: string) => Promise<void>;
  } = { trustedTemplateKeys: [] },
): void {
  /** Import a signed solution package (VA11): an instance admin who administers the jurisdiction its forms join. */
  app.post("/api/v1/jurisdictions/:jurisdictionId/solution-packages", { preHandler: authenticate }, async (req, reply) => {
    const jurisdictionId = z.string().uuid().parse((req.params as { jurisdictionId: string }).jurisdictionId);
    const summary = await withPerson(sql, req.principal.person.id, (tx) =>
      importSolutionPackage(tx, req.principal, jurisdictionId, req.body, options.trustedTemplateKeys),
    );
    return reply.status(201).send(summary);
  });

  /** Every signed solution package imported on this instance, newest first. */
  app.get("/api/v1/solution-packages", { preHandler: authenticate }, async (req) => {
    const packages = await withPerson(sql, req.principal.person.id, (tx) => listImportedPackages(tx, req.principal));
    return { packages };
  });

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
    const query = DryRunQuery.parse(req.query);
    const { table, text, fileName } = await uploadedTable(req, 2);
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
    const outcome = await withPerson(sql, req.principal.person.id, (tx) =>
      importWebeocRecords(tx, req.principal, boardId, table, { dryRun: query.dryRun === "true", mapping, timeZone, sourceName: fileName }));
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

  /** A fixed-taxonomy CSV template for the board's records (VC-13); writers of the board. */
  app.get("/api/v1/boards/:boardId/import-template", { preHandler: authenticate }, async (req, reply) => {
    const { boardId } = BoardParams.parse(req.params);
    const template = await withPerson(sql, req.principal.person.id, (tx) => boardImportTemplate(tx, req.principal, boardId));
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${template.fileName}"`)
      .send(template.csv);
  });

  /** The jurisdiction's import reports, newest first (VC-13). Administrators only. */
  app.get("/api/v1/jurisdictions/:jurisdictionId/import-reports", { preHandler: authenticate }, async (req) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    const page = z.object(pageQuery).strict().parse(req.query);
    return withPerson(sql, req.principal.person.id, (tx) => listImportReports(tx, req.principal, jurisdictionId, page));
  });

  app.get("/api/v1/import-reports/:reportId", { preHandler: authenticate }, async (req) => {
    const { reportId } = ReportParams.parse(req.params);
    return withPerson(sql, req.principal.person.id, (tx) => getImportReport(tx, req.principal, reportId));
  });

  /** An administrator signs a report off, once, with an optional note. */
  app.post("/api/v1/import-reports/:reportId/sign-off", { preHandler: authenticate }, async (req) => {
    const { reportId } = ReportParams.parse(req.params);
    const { note } = SignOffBody.parse(req.body ?? {});
    return withPerson(sql, req.principal.person.id, (tx) => signOffImportReport(tx, req.principal, reportId, note || null));
  });

  /** The people import's CSV template: its columns, the roles and this jurisdiction's positions. */
  app.get("/api/v1/jurisdictions/:jurisdictionId/people-import/template", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    const csv = await withPerson(sql, req.principal.person.id, (tx) => peopleImportTemplate(tx, req.principal, jurisdictionId));
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="people-import-template.csv"')
      .send(csv);
  });

  /**
   * A people file in (VC-13): multipart with an optional `password` field,
   * the first password of the run's new accounts, before one CSV or .xlsx
   * file part. `dryRun=true` checks every row and writes nothing.
   */
  app.post("/api/v1/jurisdictions/:jurisdictionId/people-import", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    const dryRun = DryRunQuery.parse(req.query).dryRun === "true";
    const { table, text, fileName } = await uploadedTable(req, 1);
    const password = dryRun ? undefined : text("password");
    const outcome = await withPerson(sql, req.principal.person.id, (tx) =>
      importPeople(tx, req.principal, jurisdictionId, table, { dryRun, password, sourceName: fileName }))
      .catch((err: unknown) => {
        // Another administrator made one of these accounts while this import ran.
        if ((err as { code?: unknown }).code === "23505") throw new AuthError(409, "an account in the file was made while the import ran; check the file again");
        throw err;
      });
    for (const personId of outcome.people) forgetPerson(personId);
    for (const positionId of outcome.positions) await options.syncPosition?.(req.principal, positionId);
    return reply.status(!dryRun && outcome.people.length > 0 ? 201 : 200).send(outcome.report);
  });
}
