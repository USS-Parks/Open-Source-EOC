import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { ackLinkBase } from "../notify/mass.js";
import {
  activatePlan,
  createPlan,
  getIncidentPlan,
  getPlan,
  listPlans,
  listPlanVersions,
  reviewPlan,
  updatePlan,
} from "./service.js";

const Id = z.string().uuid();

/** Executable plans (VC-09): authored by a jurisdiction's administrators, read by its members, activated into incidents. */
export function planRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get("/api/v1/jurisdictions/:jurisdictionId/plans", { preHandler: authenticate }, async (req) => {
    const jurisdictionId = Id.parse((req.params as { jurisdictionId: string }).jurisdictionId);
    const plans = await withPerson(sql, req.principal.person.id, (tx) => listPlans(tx, req.principal, jurisdictionId));
    return { plans };
  });

  app.post("/api/v1/jurisdictions/:jurisdictionId/plans", { preHandler: authenticate }, async (req, reply) => {
    const jurisdictionId = Id.parse((req.params as { jurisdictionId: string }).jurisdictionId);
    const plan = await withPerson(sql, req.principal.person.id, (tx) => createPlan(tx, req.principal, jurisdictionId, req.body));
    return reply.status(201).send(plan);
  });

  app.get("/api/v1/plans/:planId", { preHandler: authenticate }, async (req) => {
    const planId = Id.parse((req.params as { planId: string }).planId);
    return withPerson(sql, req.principal.person.id, (tx) => getPlan(tx, req.principal, planId));
  });

  app.put("/api/v1/plans/:planId", { preHandler: authenticate }, async (req) => {
    const planId = Id.parse((req.params as { planId: string }).planId);
    return withPerson(sql, req.principal.person.id, (tx) => updatePlan(tx, req.principal, planId, req.body));
  });

  app.get("/api/v1/plans/:planId/versions", { preHandler: authenticate }, async (req) => {
    const planId = Id.parse((req.params as { planId: string }).planId);
    const versions = await withPerson(sql, req.principal.person.id, (tx) => listPlanVersions(tx, req.principal, planId));
    return { versions };
  });

  app.post("/api/v1/plans/:planId/review", { preHandler: authenticate }, async (req) => {
    const planId = Id.parse((req.params as { planId: string }).planId);
    return withPerson(sql, req.principal.person.id, (tx) => reviewPlan(tx, req.principal, planId));
  });

  app.post("/api/v1/plans/:planId/activate", { preHandler: authenticate }, async (req, reply) => {
    const planId = Id.parse((req.params as { planId: string }).planId);
    const activation = await withPerson(sql, req.principal.person.id, (tx) =>
      activatePlan(tx, req.principal, planId, req.body, ackLinkBase(req)));
    return reply.status(201).send(activation);
  });

  app.get("/api/v1/incidents/:incidentId/plan", { preHandler: authenticate }, async (req) => {
    const incidentId = Id.parse((req.params as { incidentId: string }).incidentId);
    const plan = await withPerson(sql, req.principal.person.id, (tx) => getIncidentPlan(tx, incidentId));
    return { plan };
  });
}
