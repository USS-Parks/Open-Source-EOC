import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  archiveForIncident,
  configureBackend,
  getBackendStatus,
  postAnnouncement,
  provisionForIncident,
  syncIncidentMembership,
} from "./service.js";

/**
 * Collaboration adapter and incident-space routes (VEOC-32, F15). Reading
 * backend status is open to members; configuring is an admin act. Provision,
 * sync, announce, and archive run under the caller's person context so RLS
 * and the audit trail apply. The default transport is a real HTTP call; the
 * adapters live behind a process boundary.
 */

const BackendBody = z.object({
  kind: z.enum(["mattermost", "matrix"]),
  baseUrl: z.string().url(),
  token: z.string().min(1).optional(),
  homeserver: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});
const AnnounceBody = z.object({
  section: z.string().min(1).optional(),
  text: z.string().min(1),
});

export function collabRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/collab",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const status = await withPerson(sql, req.principal.person.id, (tx) =>
        getBackendStatus(tx, req.principal, jurisdictionId),
      );
      return reply.send(status);
    },
  );

  app.put(
    "/api/v1/jurisdictions/:jurisdictionId/collab/backend",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = BackendBody.parse(req.body);
      const status = await withPerson(sql, req.principal.person.id, (tx) =>
        configureBackend(tx, req.principal, jurisdictionId, {
          kind: body.kind,
          baseUrl: body.baseUrl,
          ...(body.token !== undefined ? { token: body.token } : {}),
          ...(body.homeserver !== undefined ? { homeserver: body.homeserver } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        }),
      );
      return reply.send(status);
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/collab/provision",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        provisionForIncident(tx, req.principal, incidentId),
      );
      return reply.send(result);
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/collab/sync",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        syncIncidentMembership(tx, req.principal, incidentId),
      );
      return reply.send(result);
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/collab/announce",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const body = AnnounceBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        postAnnouncement(tx, req.principal, incidentId, body.section ?? null, body.text),
      );
      return reply.send(result);
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/collab/archive",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        archiveForIncident(tx, req.principal, incidentId),
      );
      return reply.send(result);
    },
  );
}
