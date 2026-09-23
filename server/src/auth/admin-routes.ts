import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import {
  findPerson,
  listGuestGrants,
  listMembers,
  listPositionHolders,
  removeMember,
  resetPersonMfa,
  revokePosition,
  setMemberRole,
  setPersonDisabled,
} from "./admin.js";
import { forgetPerson } from "./principal-cache.js";

const PageQuery = z.object(pageQuery);
const RoleBody = z.object({ role: z.enum(["admin", "member", "viewer"]) });
const DisabledBody = z.object({ disabled: z.boolean() });
const ResetBody = z.object({ reason: z.string().trim().min(1).max(1000) });
const EmailQuery = z.object({ email: z.string().email() });

const MemberParams = z.object({ jurisdictionId: z.string().uuid(), personId: z.string().uuid() });
const AssignmentParams = z.object({ positionId: z.string().uuid(), personId: z.string().uuid() });

/**
 * Administration routes for the operator screen. Each change to a role, a
 * membership or the disabled flag forgets the person's cached principals
 * once withPerson has committed.
 */
export function adminRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get("/api/v1/persons", { preHandler: authenticate }, async (req, reply) => {
    const { email } = EmailQuery.parse(req.query);
    const person = await withPerson(sql, req.principal.person.id, (tx) =>
      findPerson(tx, req.principal, email),
    );
    return reply.send({ person });
  });

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/members",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const page = PageQuery.parse(req.query);
      return reply.send(await withPerson(sql, req.principal.person.id, (tx) =>
        listMembers(tx, req.principal, jurisdictionId, page),
      ));
    },
  );

  app.put(
    "/api/v1/jurisdictions/:jurisdictionId/members/:personId",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId, personId } = MemberParams.parse(req.params);
      const { role } = RoleBody.parse(req.body);
      await withPerson(sql, req.principal.person.id, (tx) =>
        setMemberRole(tx, req.principal, jurisdictionId, personId, role),
      );
      forgetPerson(personId);
      return reply.send({ ok: true });
    },
  );

  app.delete(
    "/api/v1/jurisdictions/:jurisdictionId/members/:personId",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId, personId } = MemberParams.parse(req.params);
      await withPerson(sql, req.principal.person.id, (tx) =>
        removeMember(tx, req.principal, jurisdictionId, personId),
      );
      forgetPerson(personId);
      return reply.send({ ok: true });
    },
  );

  app.put(
    "/api/v1/jurisdictions/:jurisdictionId/members/:personId/disabled",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId, personId } = MemberParams.parse(req.params);
      const { disabled } = DisabledBody.parse(req.body);
      await withPerson(sql, req.principal.person.id, (tx) =>
        setPersonDisabled(tx, req.principal, jurisdictionId, personId, disabled),
      );
      forgetPerson(personId);
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/members/:personId/mfa-reset",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId, personId } = MemberParams.parse(req.params);
      const { reason } = ResetBody.parse(req.body);
      await withPerson(sql, req.principal.person.id, (tx) =>
        resetPersonMfa(tx, req.principal, jurisdictionId, personId, reason),
      );
      return reply.send({ ok: true });
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/guests",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const page = PageQuery.parse(req.query);
      return reply.send(await withPerson(sql, req.principal.person.id, (tx) =>
        listGuestGrants(tx, req.principal, jurisdictionId, page),
      ));
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/position-assignments",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const assignments = await withPerson(sql, req.principal.person.id, (tx) =>
        listPositionHolders(tx, req.principal, jurisdictionId),
      );
      return reply.send({ assignments });
    },
  );

  app.delete(
    "/api/v1/positions/:positionId/assignments/:personId",
    { preHandler: authenticate },
    async (req, reply) => {
      const { positionId, personId } = AssignmentParams.parse(req.params);
      await withPerson(sql, req.principal.person.id, (tx) =>
        revokePosition(tx, req.principal, positionId, personId),
      );
      forgetPerson(personId);
      return reply.send({ ok: true });
    },
  );
}
