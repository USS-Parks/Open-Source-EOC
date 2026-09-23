import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { FormDefinitionSchema, type AnswerRecord, type FormDefinition } from "@openeoc/shared";
import { AuthError } from "../auth/service.js";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { uploadLimitsFromEnv, type BlobStore } from "../files/service.js";
import { importXlsFormWorkbook } from "./xlsx-import.js";
import { attachFormMedia, FormValidationError, getForm, listForms, storeForm, submitForm } from "./service.js";

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
/** The question a photo or audio file answers; a repeat entry reads `repeat[0].question`. */
const MediaFields = z.object({
  name: z.string().min(1).max(255),
  question: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.[\]-]*$/).max(200),
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

/**
 * A photo or audio answer for a record a form submission created, sent
 * after the record exists: multipart with the `question` field first and
 * one `file` part last, as the file upload route takes it. Registered
 * beside the file routes because it writes through the same blob store.
 */
export function formMediaRoutes(
  app: FastifyInstance,
  sql: Sql,
  store: BlobStore,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  const limits = uploadLimitsFromEnv();
  app.post(
    "/api/v1/forms/records/:recordId/attachments",
    { preHandler: authenticate },
    async (req, reply) => {
      const { recordId } = z.object({ recordId: z.string().uuid() }).parse(req.params);
      if (!req.isMultipart()) throw new AuthError(415, "upload must be multipart/form-data");
      const part = await req
        .file({ limits: { fileSize: limits.maxFileBytes + 1, files: 1, fields: 4, fieldSize: 1024, parts: 5 } })
        .catch((err: unknown) => {
          const status = (err as { statusCode?: unknown }).statusCode;
          const code = typeof status === "number" && status >= 400 && status < 500 ? status : 400;
          throw new AuthError(code, err instanceof Error ? err.message : "malformed upload");
        });
      if (!part) throw new AuthError(400, "a file part is required");
      const fields: Record<string, unknown> = { name: part.filename };
      for (const [key, entry] of Object.entries(part.fields)) {
        if (entry && !Array.isArray(entry) && entry.type === "field") fields[key] = entry.value;
      }
      const body = MediaFields.parse(fields);
      const result = await attachFormMedia(sql, store, req.principal, {
        recordId,
        question: body.question,
        name: body.name,
        contentType: part.mimetype,
        content: part.file,
      }, limits);
      return reply.status(201).send(result);
    },
  );
}
