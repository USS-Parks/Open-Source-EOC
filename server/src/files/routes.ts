import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, requireWriter } from "../auth/service.js";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  BlobStore,
  getFileMeta,
  listFileFolders,
  listFiles,
  search,
  uploadFile,
  uploadLimitsFromEnv,
} from "./service.js";

/** Text fields of a multipart upload; they must precede the file part. */
const UploadFields = z.object({
  name: z.string().min(1).max(255),
  attachedKind: z.enum(["none", "board", "record", "incident", "library"]).optional(),
  attachedId: z.string().uuid().optional(),
  supersedes: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
});

const SearchQuery = z.object({ q: z.string().min(2).max(200) });
const FileListQuery = z.object({
  attachedKind: z.enum(["none", "board", "record", "incident", "library"]).optional(),
  attachedId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Build a Content-Disposition value a stored filename can never break out of.
 * Upload accepts any characters in the name, so a name holding a quote, CR or
 * LF would otherwise inject header syntax. The ASCII fallback strips quotes,
 * backslashes and non-printables; the RFC 5987 form percent-encodes the rest.
 */
function attachmentHeader(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function fileRoutes(
  app: FastifyInstance,
  sql: Sql,
  store: BlobStore,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  const limits = uploadLimitsFromEnv();
  void app.register(multipart);

  /**
   * Streaming upload: multipart/form-data with the text fields first and one
   * `file` part last, whose own Content-Type is the stored type. The bytes go
   * straight to disk; nothing buffers the file in memory.
   */
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/files",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      // Refuse before reading a byte of the body.
      requireWriter(req.principal, jurisdictionId);
      if (!req.isMultipart()) throw new AuthError(415, "upload must be multipart/form-data");
      // One byte over the limit reaches the store, which refuses it with 413.
      const part = await req
        .file({ limits: { fileSize: limits.maxFileBytes + 1, files: 1, fields: 8, fieldSize: 4096, parts: 9 } })
        .catch((err: unknown) => {
          // Parser limits carry their own 4xx status; anything else here is a malformed body.
          const status = (err as { statusCode?: unknown }).statusCode;
          const code = typeof status === "number" && status >= 400 && status < 500 ? status : 400;
          throw new AuthError(code, err instanceof Error ? err.message : "malformed upload");
        });
      if (!part) throw new AuthError(400, "a file part is required");
      const fields: Record<string, unknown> = { name: part.filename };
      for (const [key, entry] of Object.entries(part.fields)) {
        if (entry && !Array.isArray(entry) && entry.type === "field") fields[key] = entry.value;
      }
      const body = UploadFields.parse(fields);
      const result = await uploadFile(
        sql,
        store,
        req.principal,
        {
          jurisdictionId,
          name: body.name,
          contentType: part.mimetype,
          content: part.file,
          attachedKind: body.attachedKind,
          attachedId: body.attachedId,
          supersedes: body.supersedes,
          folderId: body.folderId,
        },
        limits,
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/files",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const query = FileListQuery.parse(req.query);
      const page = await withPerson(sql, req.principal.person.id, (tx) =>
        listFiles(tx, req.principal, jurisdictionId, query),
      );
      return reply.send(page);
    },
  );

  app.get("/api/v1/incidents/:incidentId/file-folders", { preHandler: authenticate }, async (req, reply) => {
    const { incidentId } = z.object({ incidentId: z.string().uuid() }).parse(req.params);
    const folders = await withPerson(sql, req.principal.person.id, (tx) =>
      listFileFolders(tx, req.principal, incidentId),
    );
    return reply.send({ folders });
  });

  app.get("/api/v1/files/:fileId", { preHandler: authenticate }, async (req, reply) => {
    const { fileId } = req.params as { fileId: string };
    const meta = await withPerson(sql, req.principal.person.id, (tx) =>
      getFileMeta(tx, fileId),
    );
    return reply.send(meta);
  });

  app.get(
    "/api/v1/files/:fileId/content",
    { preHandler: authenticate },
    async (req, reply) => {
      const { fileId } = req.params as { fileId: string };
      const meta = await withPerson(sql, req.principal.person.id, (tx) =>
        getFileMeta(tx, fileId),
      );
      const content = await store.get(meta.sha256);
      return reply
        .header("content-type", meta.contentType)
        .header("content-disposition", attachmentHeader(meta.name))
        .send(content);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/search",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const { q } = SearchQuery.parse(req.query);
      const hits = await withPerson(sql, req.principal.person.id, (tx) =>
        search(tx, req.principal, jurisdictionId, q),
      );
      return reply.send({ hits });
    },
  );
}
