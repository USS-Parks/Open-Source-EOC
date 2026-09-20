import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  STANDARD_INCIDENT_TEMPLATES,
  activateIncident,
  closeIncident,
  completeChecklistItem,
  createLibrary,
  getIncident,
  listIncidents,
} from "./service.js";
import {
  archiveForIncident,
  isBackendEnabled,
  provisionForIncident,
} from "../collab/service.js";

const ActivateBody = z.object({
  templateKey: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["incident", "daily_ops", "planned_event"]).optional(),
});

const LibraryBody = z.object({
  title: z.string().min(1),
  kind: z.enum(["scenario", "plan", "reference"]),
  body: z.string().default(""),
  forTemplate: z.string().optional(),
});

export function incidentRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/incidents",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = ActivateBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        activateIncident(tx, req.principal, jurisdictionId, body),
      );
      // Provision the collaboration space when a backend is enabled. Runs in
      // its own transaction, best-effort, so activation never depends on it.
      try {
        await withPerson(sql, req.principal.person.id, async (tx) => {
          if (await isBackendEnabled(tx, jurisdictionId))
            await provisionForIncident(tx, req.principal, result.incidentId);
        });
      } catch {
        // The incident is already activated; the space can be provisioned later.
      }
      return reply.status(201).send(result);
    },
  );

  app.get("/api/v1/incident-templates", { preHandler: authenticate }, async (_req, reply) => {
    const templates = STANDARD_INCIDENT_TEMPLATES.map((t) => ({ key: t.key, title: t.title }));
    return reply.send({ templates });
  });

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/incidents",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const incidents = await withPerson(sql, req.principal.person.id, (tx) =>
        listIncidents(tx, req.principal, jurisdictionId),
      );
      return reply.send({ incidents });
    },
  );

  app.get("/api/v1/incidents/:incidentId", { preHandler: authenticate }, async (req, reply) => {
    const { incidentId } = req.params as { incidentId: string };
    const detail = await withPerson(sql, req.principal.person.id, (tx) =>
      getIncident(tx, req.principal, incidentId),
    );
    return reply.send(detail);
  });

  app.post(
    "/api/v1/checklist-items/:itemId/complete",
    { preHandler: authenticate },
    async (req, reply) => {
      const { itemId } = req.params as { itemId: string };
      await withPerson(sql, req.principal.person.id, (tx) =>
        completeChecklistItem(tx, req.principal, itemId),
      );
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/close",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = req.params as { incidentId: string };
      await withPerson(sql, req.principal.person.id, (tx) =>
        closeIncident(tx, req.principal, incidentId),
      );
      // Deactivation archives the collaboration space (no-op if none exists).
      try {
        await withPerson(sql, req.principal.person.id, (tx) =>
          archiveForIncident(tx, req.principal, incidentId),
        );
      } catch {
        // The incident is closed; archiving can be retried.
      }
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/libraries",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = LibraryBody.parse(req.body);
      const id = await withPerson(sql, req.principal.person.id, (tx) =>
        createLibrary(tx, req.principal, jurisdictionId, body),
      );
      return reply.status(201).send({ id });
    },
  );
}
