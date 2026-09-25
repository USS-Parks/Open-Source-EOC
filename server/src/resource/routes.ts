import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  DEMOBILIZATION_CHECKS,
  RESOURCE_RETURN_CONDITIONS,
  RESOURCE_STATUSES,
  ResourceRequestAssignmentSchema,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import { ics213rr, ics213rrPdf } from "./rr213.js";
import {
  addCost,
  addResource,
  assign,
  escalate,
  exportCosts,
  getRequest,
  listIncidentRequests,
  listRequests,
  listResources,
  receiveEscalation,
  reportBack,
  resourceHistory,
  submitRequest,
  transition,
  transitionResource,
  updateResource,
  type EscalationPayload,
} from "./service.js";
import { addLocalKind, deleteLocalKind, importKinds, listKinds, updateLocalKind } from "./typing.js";

/**
 * 213RR resource-request routes (F5). Submission, the guarded
 * lifecycle transitions, assignment, cost capture, and export run under the
 * caller's person context. Escalation delivers to a peer tier over that
 * peer's token; the receive and report lanes are peer-token authenticated.
 */

const SubmitBody = z.object({
  origin: z.enum(["field", "eoc"]),
  item: z.string().min(1),
  quantity: z.number().int().positive().optional(),
  priority: z.string().min(1).optional(),
  neededBy: z.coerce.date().optional(),
  notes: z.string().optional(),
  incidentId: z.string().uuid().optional(),
  resourceKind: z.string().min(1).max(200).optional(),
  resourceType: z.number().int().min(1).max(10).optional(),
});
const TransitionBody = z.object({ toState: z.string().min(1), note: z.string().max(2000).optional() });
/** A request list's filters: a number or words, open or ended, and only the caller's own. */
const RequestFilterQuery = {
  q: z.string().max(200).optional(),
  status: z.enum(["open", "ended", "all"]).optional(),
  mine: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
};
const AssignBody = z.union([
  ResourceRequestAssignmentSchema,
  z.object({ positionId: z.uuid() }).strict(),
]).transform((body) => "kind" in body ? body : { kind: "position" as const, positionId: body.positionId });
const EscalateBody = z.object({
  peerName: z.string().min(1),
  peerBaseUrl: z.string().url(),
  peerToken: z.string().min(1),
});
const ReceiveBody = z.object({
  originRequestId: z.string().uuid(),
  item: z.string().min(1),
  quantity: z.number().int().positive(),
  priority: z.string().min(1),
  notes: z.string().nullable(),
});
const ReportBody = z.object({
  sourceRequestId: z.string().uuid(),
  toState: z.string().min(1),
  note: z.string().optional(),
});
const CostBody = z.object({
  category: z.string().min(1),
  description: z.string().optional(),
  amountCents: z.number().int().nonnegative(),
  incurredAt: z.string().optional(),
});
const JurisdictionParams = z.object({ jurisdictionId: z.uuid() });
const TypeLevel = z.object({ type: z.number().int().min(1).max(10), capability: z.string().max(2000) });
const KindBody = z.object({
  name: z.string().trim().min(1).max(200),
  discipline: z.string().trim().max(200).default(""),
  levels: z.array(TypeLevel).max(10).default([]),
  notes: z.string().max(4000).default(""),
});
const ImportBody = z.object({ csv: z.string().min(1).max(5_000_000), sourceNote: z.string().trim().min(1).max(500) });
const ResourceBody = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.string().min(1).max(200),
  type: z.number().int().min(1).max(10).nullable().default(null),
});
const ResourceMoveBody = z.object({
  to: RESOURCE_STATUSES.schema,
  requestId: z.uuid().optional(),
  returnCondition: RESOURCE_RETURN_CONDITIONS.schema.optional(),
  checks: z.array(DEMOBILIZATION_CHECKS.schema).max(DEMOBILIZATION_CHECKS.values.length).optional(),
});

export function resourceRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/resource-requests",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = SubmitBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        submitRequest(tx, req.principal, jurisdictionId, {
          origin: body.origin,
          item: body.item,
          ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.neededBy !== undefined ? { neededBy: body.neededBy } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.incidentId !== undefined ? { incidentId: body.incidentId } : {}),
          ...(body.resourceKind !== undefined ? { resourceKind: body.resourceKind } : {}),
          ...(body.resourceType !== undefined ? { resourceType: body.resourceType } : {}),
        }),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/resource-requests",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      // Optional incident scope: narrow the 213RR list to the selected
      // incident's requests so the surface reconciles with its context (79B2).
      const { incidentId, q, status, mine, ...page } = z.object({
        incidentId: z.string().uuid().optional(), ...RequestFilterQuery, ...pageQuery,
      }).parse(req.query);
      const { items, nextCursor } = await withPerson(sql, req.principal.person.id, (tx) =>
        listRequests(tx, req.principal, jurisdictionId, incidentId, page, { q, status, mine }),
      );
      return reply.send({ requests: items, nextCursor });
    },
  );

  // Every organization's requests on an incident, for anyone who can read the incident.
  app.get(
    "/api/v1/incidents/:incidentId/resource-requests",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = z.object({ incidentId: z.uuid() }).parse(req.params);
      const { q, status, mine, ...page } = z.object({ ...RequestFilterQuery, ...pageQuery }).parse(req.query);
      const { items, nextCursor } = await withPerson(sql, req.principal.person.id, (tx) =>
        listIncidentRequests(tx, req.principal, incidentId, page, { q, status, mine }),
      );
      return reply.send({ requests: items, nextCursor });
    },
  );

  app.post("/api/v1/resource-requests/:id/transition", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = TransitionBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      transition(tx, req.principal, id, body.toState, body.note),
    );
    return reply.send(result);
  });

  app.post("/api/v1/resource-requests/:id/assign", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = AssignBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      assign(tx, req.principal, id, body),
    );
    return reply.send(result);
  });

  app.post("/api/v1/resource-requests/:id/escalate", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = EscalateBody.parse(req.body);
    const deliver = async (payload: EscalationPayload): Promise<void> => {
      const res = await fetch(`${body.peerBaseUrl}/api/v1/resource-requests/receive`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-peer-token": body.peerToken },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => {
        // Unreachable, or silent past the timeout; nothing is recorded.
        throw new AuthError(502, "escalation delivery failed");
      });
      if (!res.ok) throw new AuthError(502, "escalation delivery failed");
    };
    // Delivers between its own transactions, never inside one.
    await escalate(sql, req.principal, id, body.peerName, deliver);
    return reply.send({ ok: true });
  });

  app.post("/api/v1/resource-requests/receive", async (req, reply) => {
    const token = String(req.headers["x-peer-token"] ?? "");
    if (!token) return reply.status(401).send({ error: "missing peer token" });
    const body = ReceiveBody.parse(req.body);
    const result = await receiveEscalation(sql, token, body);
    return reply.status(result.duplicate ? 200 : 201).send(result);
  });

  app.post("/api/v1/resource-requests/report", async (req, reply) => {
    const token = String(req.headers["x-peer-token"] ?? "");
    if (!token) return reply.status(401).send({ error: "missing peer token" });
    const body = ReportBody.parse(req.body);
    const result = await reportBack(sql, token, body.sourceRequestId, body.toState, body.note);
    return reply.send(result);
  });

  app.get("/api/v1/resource-requests/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      getRequest(tx, req.principal, id),
    );
    return reply.send(result);
  });

  app.post("/api/v1/resource-requests/:id/costs", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = CostBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      addCost(tx, req.principal, id, {
        category: body.category,
        amountCents: body.amountCents,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.incurredAt !== undefined ? { incurredAt: body.incurredAt } : {}),
      }),
    );
    return reply.status(201).send(result);
  });

  app.get(
    "/api/v1/resource-requests/:id/costs/export",
    { preHandler: authenticate },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const csv = await withPerson(sql, req.principal.person.id, (tx) =>
        exportCosts(tx, req.principal, id),
      );
      return reply.header("content-type", "text/csv").send(csv);
    },
  );

  // The request's ICS 213RR as it stands now, to read or print (VA38).
  app.get("/api/v1/resource-requests/:id/ics-213rr", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { request, incidentName, values, form } = await withPerson(sql, req.principal.person.id, (tx) =>
      ics213rr(tx, req.principal, id));
    return reply.send({ requestId: request.id, number: request.number, incidentId: request.incidentId, incidentName, values, form });
  });

  app.get("/api/v1/resource-requests/:id/ics-213rr/pdf", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { filename, bytes } = await withPerson(sql, req.principal.person.id, (tx) => ics213rrPdf(tx, req.principal, id));
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(Buffer.from(bytes));
  });

  // The typing catalog: members read it, administrators add local kinds and import RTLT definitions.
  app.get("/api/v1/jurisdictions/:jurisdictionId/resources/kinds", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    return reply.send(await withPerson(sql, req.principal.person.id, (tx) => listKinds(tx, req.principal, jurisdictionId)));
  });

  app.post("/api/v1/jurisdictions/:jurisdictionId/resources/kinds", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    const body = KindBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) => addLocalKind(tx, req.principal, jurisdictionId, body));
    return reply.status(201).send(result);
  });

  const KindParams = z.object({ jurisdictionId: z.uuid(), key: z.string().min(1).max(200) });
  app.patch("/api/v1/jurisdictions/:jurisdictionId/resources/kinds/:key", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId, key } = KindParams.parse(req.params);
    const body = KindBody.parse(req.body);
    await withPerson(sql, req.principal.person.id, (tx) => updateLocalKind(tx, req.principal, jurisdictionId, key, body));
    return reply.send({ ok: true });
  });

  app.delete("/api/v1/jurisdictions/:jurisdictionId/resources/kinds/:key", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId, key } = KindParams.parse(req.params);
    await withPerson(sql, req.principal.person.id, (tx) => deleteLocalKind(tx, req.principal, jurisdictionId, key));
    return reply.send({ ok: true });
  });

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/resources/kinds/import",
    { preHandler: authenticate, bodyLimit: 5 * 1024 * 1024 },
    async (req, reply) => {
      const { jurisdictionId } = JurisdictionParams.parse(req.params);
      const body = ImportBody.parse(req.body);
      return reply.send(await withPerson(sql, req.principal.person.id, (tx) =>
        importKinds(tx, req.principal, jurisdictionId, body.csv, body.sourceNote)));
    },
  );

  // The resource pool: members read it, writers add resources and move their status.
  app.get("/api/v1/jurisdictions/:jurisdictionId/resources", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    const page = z.object(pageQuery).parse(req.query);
    const { items, nextCursor } = await withPerson(sql, req.principal.person.id, (tx) =>
      listResources(tx, req.principal, jurisdictionId, page));
    return reply.send({ resources: items, nextCursor });
  });

  app.post("/api/v1/jurisdictions/:jurisdictionId/resources", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    const body = ResourceBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) => addResource(tx, req.principal, jurisdictionId, body));
    return reply.status(201).send(result);
  });

  app.patch("/api/v1/resources/:resourceId", { preHandler: authenticate }, async (req, reply) => {
    const { resourceId } = z.object({ resourceId: z.uuid() }).parse(req.params);
    const body = ResourceBody.parse(req.body);
    await withPerson(sql, req.principal.person.id, (tx) => updateResource(tx, req.principal, resourceId, body));
    return reply.send({ ok: true });
  });

  app.get("/api/v1/resources/:resourceId/history", { preHandler: authenticate }, async (req, reply) => {
    const { resourceId } = z.object({ resourceId: z.uuid() }).parse(req.params);
    const history = await withPerson(sql, req.principal.person.id, (tx) => resourceHistory(tx, req.principal, resourceId));
    return reply.send({ history });
  });

  app.post("/api/v1/resources/:resourceId/transition", { preHandler: authenticate }, async (req, reply) => {
    const { resourceId } = z.object({ resourceId: z.uuid() }).parse(req.params);
    const body = ResourceMoveBody.parse(req.body);
    return reply.send(await withPerson(sql, req.principal.person.id, (tx) =>
      transitionResource(tx, req.principal, resourceId, body)));
  });
}
