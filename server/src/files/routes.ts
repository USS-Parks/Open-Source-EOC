import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { BlobStore, getFileMeta, listFiles, search, uploadFile } from "./service.js";

const UploadBody = z.object({
  name: z.string().min(1).max(255),
  contentType: z.string().min(1),
  dataBase64: z.string().min(1),
  attachedKind: z.enum(["none", "board", "record", "incident", "library"]).optional(),
  attachedId: z.string().uuid().optional(),
  supersedes: z.string().uuid().optional(),
});

const SearchQuery = z.object({ q: z.string().min(2).max(200) });
const FileListQuery = z.object({
  attachedKind: z.enum(["none", "board", "record", "incident", "library"]).optional(),
  attachedId: z.string().uuid().optional(),
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
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/files",
    { preHandler: authenticate, bodyLimit: 40 * 1024 * 1024 },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = UploadBody.parse(req.body);
      const content = Buffer.from(body.dataBase64, "base64");
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        uploadFile(tx, store, req.principal, {
          jurisdictionId,
          name: body.name,
          contentType: body.contentType,
          content,
          attachedKind: body.attachedKind,
          attachedId: body.attachedId,
          supersedes: body.supersedes,
        }),
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
