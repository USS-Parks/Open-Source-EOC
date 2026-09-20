import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { AuthError } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import {
  addCost,
  assign,
  escalate,
  exportCosts,
  getRequest,
  listRequests,
  receiveEscalation,
  reportBack,
  submitRequest,
  transition,
  type EscalationPayload,
} from "./service.js";

/**
 * 213RR resource-request routes (VEOC-35, F5). Submission, the guarded
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
});
const TransitionBody = z.object({ toState: z.string().min(1), note: z.string().optional() });
const AssignBody = z.object({ positionId: z.string().uuid() });
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
      const requests = await withPerson(sql, req.principal.person.id, (tx) =>
        listRequests(tx, req.principal, jurisdictionId),
      );
      return reply.send({ requests });
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
      assign(tx, req.principal, id, body.positionId),
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
      });
      if (!res.ok) throw new AuthError(502, "escalation delivery failed");
    };
    await withPerson(sql, req.principal.person.id, (tx) =>
      escalate(tx, req.principal, id, body.peerName, deliver),
    );
    return reply.send({ ok: true });
  });

  app.post("/api/v1/resource-requests/receive", async (req, reply) => {
    const token = String(req.headers["x-peer-token"] ?? "");
    if (!token) return reply.status(401).send({ error: "missing peer token" });
    const body = ReceiveBody.parse(req.body);
    const result = await receiveEscalation(sql, token, body);
    return reply.status(201).send(result);
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
}
