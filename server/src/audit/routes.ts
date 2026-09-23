import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import { DATA_CLASS_NAMES, getRetention, setRetention } from "../retention/service.js";
import { auditCsv, auditExportPage, signAuditPage } from "./export.js";
import { correctAudit, listChronology } from "./service.js";

const ChronologyQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  positionId: z.string().uuid().optional(),
  ...pageQuery,
});

const CorrectionBody = z.object({
  note: z.string().min(1).max(4000),
  fields: z.record(z.string(), z.unknown()).optional(),
});

const ExportQuery = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  ...pageQuery,
});

const RetentionBody = z.object({
  policies: z
    .array(
      z.object({
        dataClass: z.enum(DATA_CLASS_NAMES),
        retentionDays: z.number().int().min(1).max(36500).nullable(),
      }),
    )
    .min(1)
    .max(DATA_CLASS_NAMES.length),
});

export function auditRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/chronology",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const query = ChronologyQuery.parse(req.query);
      const page = await withPerson(sql, req.principal.person.id, (tx) =>
        listChronology(tx, req.principal, { jurisdictionId, ...query }),
      );
      return reply.send(page);
    },
  );

  app.post(
    "/api/v1/audit/:eventId/corrections",
    { preHandler: authenticate },
    async (req, reply) => {
      const { eventId } = req.params as { eventId: string };
      const body = CorrectionBody.parse(req.body);
      const id = await withPerson(sql, req.principal.person.id, (tx) =>
        correctAudit(tx, req.principal, eventId, body),
      );
      return reply.status(201).send({ id });
    },
  );

  // One page per request; follow `x-next-cursor` (CSV) or `page.nextCursor` (JSON).
  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/audit/export",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const { format, ...query } = ExportQuery.parse(req.query);
      const page = await withPerson(sql, req.principal.person.id, (tx) =>
        auditExportPage(tx, req.principal, { jurisdictionId, ...query }),
      );
      if (format === "json") return reply.send(signAuditPage(page));
      if (page.nextCursor) reply.header("x-next-cursor", page.nextCursor);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="audit-export.csv"')
        .send(auditCsv(page.entries));
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/retention",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const policies = await withPerson(sql, req.principal.person.id, (tx) =>
        getRetention(tx, req.principal, jurisdictionId),
      );
      return reply.send({ policies });
    },
  );

  app.put(
    "/api/v1/jurisdictions/:jurisdictionId/retention",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = RetentionBody.parse(req.body);
      const policies = await withPerson(sql, req.principal.person.id, (tx) =>
        setRetention(tx, req.principal, jurisdictionId, body.policies),
      );
      return reply.send({ policies });
    },
  );
}
