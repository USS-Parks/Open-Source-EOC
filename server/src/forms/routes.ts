import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { FormDefinitionSchema, type AnswerRecord, type FormDefinition } from "@openeoc/shared";
import { AuthError } from "../auth/service.js";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { importXlsFormWorkbook } from "./xlsx-import.js";
import { FormValidationError, getForm, listForms, storeForm, submitForm } from "./service.js";

const ImportBody = z.object({
  key: z.string().min(1),
  version: z.number().int().positive().optional(),
  title: z.string().optional(),
  boardTemplate: z.string().optional(),
  xlsxBase64: z.string().min(1),
});
const SubmitBody = z.object({
  jurisdictionId: z.string().uuid(),
  boardId: z.string().uuid(),
  answers: z.record(z.string(), z.unknown()),
});

export function formRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  // Import a real XLSForm .xlsx (base64 in JSON, matching the file upload
  // convention) and store the parsed definition.
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/forms/import",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = ImportBody.parse(req.body);
      const buffer = Buffer.from(body.xlsxBase64, "base64");
      let def: FormDefinition;
      try {
        def = importXlsFormWorkbook(buffer, {
          key: body.key,
          ...(body.version !== undefined ? { version: body.version } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.boardTemplate !== undefined ? { boardTemplate: body.boardTemplate } : {}),
        });
      } catch (err) {
        // A workbook the reader or the XLSForm rules refuse is the caller's to fix.
        throw new AuthError(400, err instanceof Error ? err.message : "unreadable XLSForm workbook");
      }
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        storeForm(tx, req.principal, jurisdictionId, def),
      );
      return reply.status(201).send(result);
    },
  );

  // Store an already-parsed form definition (JSON import path).
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/forms",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const def = FormDefinitionSchema.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        storeForm(tx, req.principal, jurisdictionId, def),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/forms",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const forms = await withPerson(sql, req.principal.person.id, (tx) =>
        listForms(tx, req.principal, jurisdictionId),
      );
      return reply.send({ forms });
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/forms/:key",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId, key } = req.params as { jurisdictionId: string; key: string };
      const def = await withPerson(sql, req.principal.person.id, (tx) =>
        getForm(tx, req.principal, jurisdictionId, key),
      );
      return reply.send(def);
    },
  );

  app.post("/api/v1/forms/:key/submit", { preHandler: authenticate }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const body = SubmitBody.parse(req.body);
    try {
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        submitForm(tx, req.principal, {
          jurisdictionId: body.jurisdictionId,
          formKey: key,
          boardId: body.boardId,
          answers: body.answers as AnswerRecord,
        }),
      );
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof FormValidationError) {
        return reply.status(422).send({ error: "form validation failed", errors: err.errors });
      }
      throw err;
    }
  });
}
