import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { exportJurisdiction } from "./service.js";

export function exportRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/export",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const data = await withPerson(sql, req.principal.person.id, (tx) =>
        exportJurisdiction(tx, req.principal, jurisdictionId),
      );
      return reply
        .header("content-type", "application/json")
        .header(
          "content-disposition",
          `attachment; filename="openeoc-${data.jurisdiction.slug}-export.json"`,
        )
        .send(data);
    },
  );
}
