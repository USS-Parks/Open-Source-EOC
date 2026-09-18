import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { approveIap, buildForm, createIap, exportIapPdf, getIap } from "./service.js";

/**
 * ICS form and IAP routes (VEOC-34, F5). Forms prefill from live incident
 * data; the IAP assembles the operational period's forms with a small amount
 * of human input, carries an approval step, and exports to PDF.
 */

const IapBody = z.object({
  operationalPeriod: z.string().min(1),
  objectives: z.array(z.string().min(1)).optional(),
  preparedBy: z.string().min(1).optional(),
  safetyMessage: z.string().min(1).optional(),
  formIds: z.array(z.string().min(1)).optional(),
});

export function iapRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/incidents/:incidentId/ics-forms/:formId",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId, formId } = req.params as { incidentId: string; formId: string };
      const query = req.query as { period?: string; preparedBy?: string };
      const form = await withPerson(sql, req.principal.person.id, (tx) =>
        buildForm(tx, req.principal, incidentId, formId, {
          operationalPeriod: query.period ?? "",
          ...(query.preparedBy !== undefined ? { preparedBy: query.preparedBy } : {}),
        }),
      );
      return reply.send(form);
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/iap",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const body = IapBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        createIap(tx, req.principal, incidentId, {
          operationalPeriod: body.operationalPeriod,
          ...(body.objectives !== undefined ? { objectives: body.objectives } : {}),
          ...(body.preparedBy !== undefined ? { preparedBy: body.preparedBy } : {}),
          ...(body.safetyMessage !== undefined ? { safetyMessage: body.safetyMessage } : {}),
          ...(body.formIds !== undefined ? { formIds: body.formIds } : {}),
        }),
      );
      return reply.status(201).send(result);
    },
  );

  app.get("/api/v1/iap/:iapId", { preHandler: authenticate }, async (req, reply) => {
    const { iapId } = req.params as { iapId: string };
    const iap = await withPerson(sql, req.principal.person.id, (tx) => getIap(tx, req.principal, iapId));
    return reply.send(iap);
  });

  app.post("/api/v1/iap/:iapId/approve", { preHandler: authenticate }, async (req, reply) => {
    const { iapId } = req.params as { iapId: string };
    await withPerson(sql, req.principal.person.id, (tx) => approveIap(tx, req.principal, iapId));
    return reply.send({ ok: true });
  });

  app.get("/api/v1/iap/:iapId/pdf", { preHandler: authenticate }, async (req, reply) => {
    const { iapId } = req.params as { iapId: string };
    const { filename, bytes } = await withPerson(sql, req.principal.person.id, (tx) =>
      exportIapPdf(tx, req.principal, iapId),
    );
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(Buffer.from(bytes));
  });
}
