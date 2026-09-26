import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  createVolunteer,
  deployVolunteer,
  removeDeployment,
  updateDeployment,
  updateVolunteer,
  volunteerRoster,
} from "./service.js";

const Id = z.string().uuid();
const RosterQuery = z.object({ timeZone: z.string().min(1).max(64).default("UTC") }).strict();

/** Volunteer and CERT roster (VC-20): entries, their deployments on incidents, and the hours those make. */
export function volunteerRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  const jurisdiction = (req: FastifyRequest) => ({ jurisdictionId: Id.parse((req.params as { jurisdictionId: string }).jurisdictionId) });
  const incident = (req: FastifyRequest) => ({ incidentId: Id.parse((req.params as { incidentId: string }).incidentId) });

  app.get("/api/v1/jurisdictions/:jurisdictionId/volunteers", { preHandler: authenticate }, async (req) => {
    const scope = jurisdiction(req);
    const { timeZone } = RosterQuery.parse(req.query);
    return withPerson(sql, req.principal.person.id, (tx) => volunteerRoster(tx, req.principal, scope, timeZone));
  });

  app.get("/api/v1/incidents/:incidentId/volunteers", { preHandler: authenticate }, async (req) => {
    const scope = incident(req);
    const { timeZone } = RosterQuery.parse(req.query);
    return withPerson(sql, req.principal.person.id, (tx) => volunteerRoster(tx, req.principal, scope, timeZone));
  });

  app.post("/api/v1/jurisdictions/:jurisdictionId/volunteers", { preHandler: authenticate }, async (req, reply) => {
    const scope = jurisdiction(req);
    const created = await withPerson(sql, req.principal.person.id, (tx) => createVolunteer(tx, req.principal, scope, req.body));
    return reply.status(201).send(created);
  });

  app.post("/api/v1/incidents/:incidentId/volunteers", { preHandler: authenticate }, async (req, reply) => {
    const scope = incident(req);
    const created = await withPerson(sql, req.principal.person.id, (tx) => createVolunteer(tx, req.principal, scope, req.body));
    return reply.status(201).send(created);
  });

  app.put("/api/v1/volunteers/:volunteerId", { preHandler: authenticate }, async (req) => {
    const volunteerId = Id.parse((req.params as { volunteerId: string }).volunteerId);
    return withPerson(sql, req.principal.person.id, (tx) => updateVolunteer(tx, req.principal, volunteerId, req.body));
  });

  app.post("/api/v1/volunteers/:volunteerId/deployments", { preHandler: authenticate }, async (req, reply) => {
    const volunteerId = Id.parse((req.params as { volunteerId: string }).volunteerId);
    const created = await withPerson(sql, req.principal.person.id, (tx) => deployVolunteer(tx, req.principal, volunteerId, req.body));
    return reply.status(201).send(created);
  });

  app.put("/api/v1/volunteer-deployments/:deploymentId", { preHandler: authenticate }, async (req) => {
    const deploymentId = Id.parse((req.params as { deploymentId: string }).deploymentId);
    return withPerson(sql, req.principal.person.id, (tx) => updateDeployment(tx, req.principal, deploymentId, req.body));
  });

  app.delete("/api/v1/volunteer-deployments/:deploymentId", { preHandler: authenticate }, async (req, reply) => {
    const deploymentId = Id.parse((req.params as { deploymentId: string }).deploymentId);
    await withPerson(sql, req.principal.person.id, (tx) => removeDeployment(tx, req.principal, deploymentId));
    return reply.status(204).send();
  });
}
