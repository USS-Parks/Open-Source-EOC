import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import {
  exportHave,
  launchQuery,
  listStatusQueries,
  queryStatus,
  registerFacility,
  reportStatus,
  retireFacility,
  statusBoard,
  updateFacility,
} from "./service.js";

const FacilityBody = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  contact: z.string().optional(),
  staleAfterSeconds: z.number().int().positive().optional(),
  location: z.object({ lon: z.number(), lat: z.number() }).optional(),
});
const FacilityEditBody = z.object({
  name: z.string().trim().min(1),
  kind: z.string().min(1),
  contact: z.string().trim().min(1).nullable(),
  staleAfterSeconds: z.number().int().positive(),
  location: z.object({ lon: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).nullable(),
}).strict();
const StatusBody = z.object({
  operatingStatus: z.string().min(1),
  emsTraffic: z.string().optional(),
  beds: z.array(z.object({ bedType: z.string(), available: z.number().int(), baseline: z.number().int() })).optional(),
  capabilities: z.array(z.string()).optional(),
  note: z.string().optional(),
});
const QueryBody = z.object({
  prompt: z.string().min(1),
  kind: z.string().optional(),
  dueInSeconds: z.number().int().positive().optional(),
  incidentId: z.string().uuid().optional(),
});

export function facilityRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/facilities",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = FacilityBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        registerFacility(tx, req.principal, jurisdictionId, body),
      );
      return reply.status(201).send(result);
    },
  );

  app.patch("/api/v1/facilities/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = FacilityEditBody.parse(req.body);
    await withPerson(sql, req.principal.person.id, (tx) => updateFacility(tx, req.principal, id, body));
    return reply.send({ ok: true });
  });

  app.post("/api/v1/facilities/:id/retire", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await withPerson(sql, req.principal.person.id, (tx) => retireFacility(tx, req.principal, id));
    return reply.send({ ok: true });
  });

  app.post("/api/v1/facilities/:id/status", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = StatusBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      reportStatus(tx, req.principal, id, body),
    );
    return reply.status(201).send(result);
  });

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/facilities/board",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const q = req.query as { kind?: string };
      const board = await withPerson(sql, req.principal.person.id, (tx) =>
        statusBoard(tx, req.principal, jurisdictionId, q.kind),
      );
      return reply.send({ facilities: board });
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/facilities/have",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const q = req.query as { kind?: string };
      const xml = await withPerson(sql, req.principal.person.id, (tx) =>
        exportHave(tx, req.principal, jurisdictionId, q.kind),
      );
      return reply.header("content-type", "application/emergency+xml").send(xml);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/status-queries",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = QueryBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        launchQuery(tx, req.principal, jurisdictionId, body),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/status-queries",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const query = z.object({ ...pageQuery, incidentId: z.string().uuid().optional() }).parse(req.query);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        listStatusQueries(tx, req.principal, jurisdictionId, query.incidentId ?? null, query),
      );
      return reply.send(result);
    },
  );

  app.get("/api/v1/status-queries/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      queryStatus(tx, req.principal, id),
    );
    return reply.send(result);
  });
}
