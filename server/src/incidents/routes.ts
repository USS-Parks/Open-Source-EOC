import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  IncidentAreaUpdateSchema,
  TaskCompletionRequestSchema,
  TaskListQuerySchema,
  TaskMetadataPatchSchema,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { splitPageQuery } from "../db/cursor.js";
import { closeWithdrawnGuestSockets } from "../sync/routes.js";
import { getIncidentArea, listIncidentAreaHistory, reviseIncidentArea } from "./area.js";
import { incidentParticipationRoutes } from "./participation-routes.js";
import {
  STANDARD_INCIDENT_TEMPLATES,
  activateIncident,
  changeIncidentLifecycle,
  closeIncident,
  completeChecklistItem,
  createLibrary,
  getIncident,
  listIncidentOverview,
  listIncidents,
  type IncidentLifecycleChange,
} from "./service.js";
import {
  archiveForIncident,
  isBackendEnabled,
  provisionForIncident,
} from "../collab/service.js";
import {
  completeIncidentTask,
  listIncidentTasks,
  updateIncidentTask,
} from "./tasks.js";

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
const IncidentId = z.string().uuid();
const ArchiveQuery = z.object({
  archived: z.enum(["exclude", "include", "only"]).default("exclude"),
}).strict();

export function incidentRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  incidentParticipationRoutes(app, sql, authenticate);
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
      const { archived } = ArchiveQuery.parse(req.query);
      const incidents = await withPerson(sql, req.principal.person.id, (tx) =>
        listIncidents(tx, req.principal, jurisdictionId, archived),
      );
      return reply.send({ incidents });
    },
  );

  app.get("/api/v1/jurisdictions/:jurisdictionId/incidents/overview", { preHandler: authenticate }, async (req) => {
    const { jurisdictionId } = req.params as { jurisdictionId: string };
    const { page, filters } = splitPageQuery(req.query);
    const { archived } = ArchiveQuery.parse(filters);
    const { items, nextCursor } = await withPerson(sql, req.principal.person.id, (tx) =>
      listIncidentOverview(tx, req.principal, jurisdictionId, archived, page));
    return { incidents: items, nextCursor };
  });

  const lifecycle = (change: IncidentLifecycleChange) => async (req: FastifyRequest) => {
    const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
    await withPerson(sql, req.principal.person.id, (tx) =>
      changeIncidentLifecycle(tx, req.principal, incidentId, change));
    if (change === "lock") await closeWithdrawnGuestSockets();
    return { ok: true };
  };
  app.post("/api/v1/incidents/:incidentId/archive", { preHandler: authenticate }, lifecycle("archive"));
  app.post("/api/v1/incidents/:incidentId/unarchive", { preHandler: authenticate }, lifecycle("unarchive"));
  app.post("/api/v1/incidents/:incidentId/lockdown", { preHandler: authenticate }, lifecycle("lock"));
  app.delete("/api/v1/incidents/:incidentId/lockdown", { preHandler: authenticate }, lifecycle("unlock"));

  app.get("/api/v1/incidents/:incidentId", { preHandler: authenticate }, async (req, reply) => {
    const { incidentId } = req.params as { incidentId: string };
    const detail = await withPerson(sql, req.principal.person.id, (tx) =>
      getIncident(tx, req.principal, incidentId),
    );
    return reply.send(detail);
  });

  app.get("/api/v1/incidents/:incidentId/operational-area", { preHandler: authenticate }, async (req) => {
    const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
    return withPerson(sql, req.principal.person.id, (tx) =>
      getIncidentArea(tx, req.principal, incidentId));
  });

  app.get("/api/v1/incidents/:incidentId/operational-area/history", { preHandler: authenticate }, async (req) => {
    const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
    const { beforeRevision } = z.object({
      beforeRevision: z.coerce.number().int().positive().max(2147483647).optional(),
    }).strict().parse(req.query);
    const revisions = await withPerson(sql, req.principal.person.id, (tx) =>
      listIncidentAreaHistory(tx, req.principal, incidentId, beforeRevision));
    return { revisions };
  });

  app.put("/api/v1/incidents/:incidentId/operational-area", { preHandler: authenticate }, async (req) => {
    const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
    const input = IncidentAreaUpdateSchema.parse(req.body);
    return withPerson(sql, req.principal.person.id, (tx) =>
      reviseIncidentArea(tx, req.principal, incidentId, input));
  });

  app.get("/api/v1/incidents/:incidentId/tasks", { preHandler: authenticate }, async (req) => {
    const incidentId = IncidentId.parse((req.params as { incidentId: string }).incidentId);
    const { page, filters: query } = splitPageQuery(req.query);
    const filters = TaskListQuerySchema.parse(query);
    return withPerson(sql, req.principal.person.id, (tx) =>
      listIncidentTasks(tx, req.principal, incidentId, filters, page));
  });

  app.patch(
    "/api/v1/incidents/:incidentId/tasks/:taskId",
    { preHandler: authenticate },
    async (req) => {
      const params = z.object({ incidentId: IncidentId, taskId: IncidentId }).parse(req.params);
      const input = TaskMetadataPatchSchema.parse(req.body);
      return withPerson(sql, req.principal.person.id, (tx) =>
        updateIncidentTask(tx, req.principal, params.incidentId, params.taskId, input));
    },
  );

  app.post(
    "/api/v1/incidents/:incidentId/tasks/:taskId/complete",
    { preHandler: authenticate },
    async (req) => {
      const params = z.object({ incidentId: IncidentId, taskId: IncidentId }).parse(req.params);
      const input = TaskCompletionRequestSchema.parse(req.body);
      return withPerson(sql, req.principal.person.id, (tx) =>
        completeIncidentTask(
          tx,
          req.principal,
          params.incidentId,
          params.taskId,
          input.operationId,
        ));
    },
  );

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
