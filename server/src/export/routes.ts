import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Sql } from "../db/client.js";
import type { BlobStore } from "../files/service.js";
import { exportJurisdictionArchive } from "./service.js";

export function exportRoutes(
  app: FastifyInstance,
  sql: Sql,
  store: BlobStore,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/export",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const { slug, archive } = await exportJurisdictionArchive(sql, store, req.principal, jurisdictionId);
      return reply
        .header("content-type", "application/gzip")
        .header("content-disposition", `attachment; filename="openeoc-${slug}-export.tar.gz"`)
        .send(archive);
    },
  );
}
