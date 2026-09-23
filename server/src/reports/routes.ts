import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import { renderReport } from "./render.js";
import {
  createReport,
  deleteReport,
  getReport,
  listReports,
  previewReport,
  runSavedReport,
  updateReport,
} from "./service.js";

const JurisdictionParams = z.object({ jurisdictionId: z.string().uuid() });
const ReportParams = z.object({ reportId: z.string().uuid() });

export function reportRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get("/api/v1/jurisdictions/:jurisdictionId/reports", { preHandler: authenticate }, async (req) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    const page = z.object(pageQuery).strict().parse(req.query);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      listReports(tx, req.principal, jurisdictionId, page));
    return { reports: result.items, nextCursor: result.nextCursor };
  });

  app.post("/api/v1/jurisdictions/:jurisdictionId/reports", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    const report = await withPerson(sql, req.principal.person.id, (tx) =>
      createReport(tx, req.principal, jurisdictionId, req.body));
    return reply.status(201).send(report);
  });

  // The builder's live preview: an unsaved definition, its first rows and every total.
  app.post("/api/v1/jurisdictions/:jurisdictionId/reports/preview", { preHandler: authenticate }, async (req) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    return withPerson(sql, req.principal.person.id, (tx) =>
      previewReport(tx, req.principal, jurisdictionId, req.body));
  });

  app.get("/api/v1/reports/:reportId", { preHandler: authenticate }, async (req) => {
    const { reportId } = ReportParams.parse(req.params);
    return withPerson(sql, req.principal.person.id, (tx) => getReport(tx, req.principal, reportId));
  });

  app.put("/api/v1/reports/:reportId", { preHandler: authenticate }, async (req) => {
    const { reportId } = ReportParams.parse(req.params);
    return withPerson(sql, req.principal.person.id, (tx) => updateReport(tx, req.principal, reportId, req.body));
  });

  app.delete("/api/v1/reports/:reportId", { preHandler: authenticate }, async (req) => {
    const { reportId } = ReportParams.parse(req.params);
    await withPerson(sql, req.principal.person.id, (tx) => deleteReport(tx, req.principal, reportId));
    return { ok: true };
  });

  // Run a saved report as the caller: JSON for the screen, or a PDF, Excel or CSV file.
  app.get("/api/v1/reports/:reportId/output", { preHandler: authenticate }, async (req, reply) => {
    const { reportId } = ReportParams.parse(req.params);
    const { format } = z.object({ format: z.enum(["json", "pdf", "xlsx", "csv"]).default("json") }).strict().parse(req.query);
    const { name, result } = await withPerson(sql, req.principal.person.id, (tx) =>
      runSavedReport(tx, req.principal, reportId));
    if (format === "json") return { name, ...result };
    const file = renderReport(result, format, { name, runAs: req.principal.person.displayName });
    return reply
      .header("content-type", format === "csv" ? "text/csv; charset=utf-8" : file.contentType)
      .header("content-disposition", `attachment; filename="${file.filename}"`)
      .send(Buffer.from(file.content));
  });
}
