import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  checkIn,
  checkOut,
  createShift,
  issueBadge,
  scanCheckIn,
  staffingSummary,
} from "./service.js";

const BadgeBody = z.object({ personId: z.string().uuid(), label: z.string().optional() });
const CheckInBody = z.object({
  personId: z.string().uuid(),
  positionId: z.string().uuid(),
  clientCheckinId: z.string().min(1).optional(),
  incidentId: z.string().uuid().optional(),
});
const ScanBody = z.object({
  badgeToken: z.string().min(1),
  positionId: z.string().uuid(),
  clientCheckinId: z.string().min(1).optional(),
  incidentId: z.string().uuid().optional(),
});
const ShiftBody = z.object({
  positionId: z.string().uuid(),
  personId: z.string().uuid().optional(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  note: z.string().optional(),
  incidentId: z.string().uuid().optional(),
});

export function staffingRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/badges",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = BadgeBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        issueBadge(tx, req.principal, jurisdictionId, body),
      );
      return reply.status(201).send(result);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/checkins",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = CheckInBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        checkIn(tx, req.principal, jurisdictionId, body),
      );
      return reply.status(201).send(result);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/checkins/scan",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = ScanBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        scanCheckIn(tx, req.principal, jurisdictionId, body),
      );
      return reply.status(201).send(result);
    },
  );

  app.post("/api/v1/checkins/:id/checkout", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await withPerson(sql, req.principal.person.id, (tx) => checkOut(tx, req.principal, id));
    return reply.send({ ok: true });
  });

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/shifts",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = ShiftBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        createShift(tx, req.principal, jurisdictionId, body),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/staffing",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const summary = await withPerson(sql, req.principal.person.id, (tx) =>
        staffingSummary(tx, req.principal, jurisdictionId),
      );
      return reply.send(summary);
    },
  );
}
