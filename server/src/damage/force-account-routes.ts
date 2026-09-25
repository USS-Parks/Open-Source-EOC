import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  forceAccountSummary,
  importEquipmentRates,
  listRates,
  recordEquipmentHours,
  removeEquipmentHours,
  rollUpForceAccount,
  setLaborRate,
} from "./force-account.js";

const Id = z.string().uuid();
const SummaryQuery = z.object({ timeZone: z.string().min(1).max(64).default("UTC") }).strict();

/** FEMA Public Assistance force account: rates, equipment hours, the incident's summary and its roll-up. */
export function forceAccountRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get("/api/v1/jurisdictions/:jurisdictionId/pa-rates", { preHandler: authenticate }, async (req) => {
    const jurisdictionId = Id.parse((req.params as { jurisdictionId: string }).jurisdictionId);
    return withPerson(sql, req.principal.person.id, (tx) => listRates(tx, req.principal, jurisdictionId));
  });

  app.put("/api/v1/jurisdictions/:jurisdictionId/pa-labor-rates/:personId", { preHandler: authenticate }, async (req) => {
    const params = req.params as { jurisdictionId: string; personId: string };
    const jurisdictionId = Id.parse(params.jurisdictionId);
    const personId = Id.parse(params.personId);
    return withPerson(sql, req.principal.person.id, (tx) => setLaborRate(tx, req.principal, jurisdictionId, personId, req.body));
  });

  app.post("/api/v1/jurisdictions/:jurisdictionId/pa-equipment-rates", { preHandler: authenticate }, async (req, reply) => {
    const jurisdictionId = Id.parse((req.params as { jurisdictionId: string }).jurisdictionId);
    const result = await withPerson(sql, req.principal.person.id, (tx) => importEquipmentRates(tx, req.principal, jurisdictionId, req.body));
    return reply.status(201).send(result);
  });

  app.get("/api/v1/incidents/:incidentId/force-account", { preHandler: authenticate }, async (req) => {
    const incidentId = Id.parse((req.params as { incidentId: string }).incidentId);
    const { timeZone } = SummaryQuery.parse(req.query);
    return withPerson(sql, req.principal.person.id, (tx) => forceAccountSummary(tx, req.principal, incidentId, timeZone));
  });

  app.post("/api/v1/incidents/:incidentId/force-account/roll-up", { preHandler: authenticate }, async (req) => {
    const incidentId = Id.parse((req.params as { incidentId: string }).incidentId);
    return withPerson(sql, req.principal.person.id, (tx) => rollUpForceAccount(tx, req.principal, incidentId, req.body));
  });

  app.post("/api/v1/incidents/:incidentId/equipment-hours", { preHandler: authenticate }, async (req, reply) => {
    const incidentId = Id.parse((req.params as { incidentId: string }).incidentId);
    const result = await withPerson(sql, req.principal.person.id, (tx) => recordEquipmentHours(tx, req.principal, incidentId, req.body));
    return reply.status(201).send(result);
  });

  app.delete("/api/v1/equipment-hours/:hoursId", { preHandler: authenticate }, async (req, reply) => {
    const hoursId = Id.parse((req.params as { hoursId: string }).hoursId);
    await withPerson(sql, req.principal.person.id, (tx) => removeEquipmentHours(tx, req.principal, hoursId));
    return reply.status(204).send();
  });
}
