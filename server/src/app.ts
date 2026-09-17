import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "./db/client.js";
import {
  addMembership,
  assignPosition,
  AuthError,
  createJurisdiction,
  createPerson,
  createPosition,
  login,
  logout,
  type Principal,
  principalFromToken,
  resume,
  signInPosition,
  signOutPosition,
} from "./auth/service.js";
import { checkAllowed, recordFailure, recordSuccess } from "./auth/rate-limit.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal;
  }
}

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const ResumeBody = z.object({ resumeToken: z.string().min(1) });
const CreatePositionBody = z.object({ key: z.string().min(1), title: z.string().min(1) });
const AssignBody = z.object({ personId: z.string().uuid() });
const CreatePersonBody = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  password: z.string().min(12),
  jurisdictionId: z.string().uuid(),
  role: z.enum(["admin", "member", "viewer"]),
});

export function buildApp(sql: Sql): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AuthError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.status(400).send({ error: "invalid request" });
    app.log.error?.(err);
    return reply.status(500).send({ error: "internal error" });
  });

  /**
   * Server-side principal derivation (INV-7): the bearer token is the only
   * caller input consulted. Position, roles, and identity come from the
   * database; any caller-supplied identity headers are ignored.
   */
  async function authenticate(req: FastifyRequest): Promise<void> {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new AuthError(401, "not authenticated");
    req.principal = await principalFromToken(sql, token);
  }

  app.post("/api/v1/auth/login", async (req, reply) => {
    const body = LoginBody.parse(req.body);
    if (!checkAllowed(body.email)) throw new AuthError(429, "too many attempts, retry later");
    try {
      const result = await login(sql, body.email, body.password);
      recordSuccess(body.email);
      return reply.send(result);
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) recordFailure(body.email);
      throw err;
    }
  });

  app.post("/api/v1/auth/resume", async (req, reply) => {
    const body = ResumeBody.parse(req.body);
    return reply.send(await resume(sql, body.resumeToken));
  });

  app.post("/api/v1/auth/logout", { preHandler: authenticate }, async (req, reply) => {
    await logout(sql, req.principal.sessionId);
    return reply.send({ ok: true });
  });

  app.get("/api/v1/me", { preHandler: authenticate }, async (req, reply) => {
    const { person, position, memberships, sessionId } = req.principal;
    return reply.send({ person, position, memberships, sessionId });
  });

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/positions",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = CreatePositionBody.parse(req.body);
      const id = await createPosition(sql, req.principal, jurisdictionId, body.key, body.title);
      return reply.status(201).send({ id });
    },
  );

  app.post(
    "/api/v1/positions/:positionId/assignments",
    { preHandler: authenticate },
    async (req, reply) => {
      const { positionId } = req.params as { positionId: string };
      const body = AssignBody.parse(req.body);
      await assignPosition(sql, req.principal, positionId, body.personId);
      return reply.status(201).send({ ok: true });
    },
  );

  app.post(
    "/api/v1/positions/:positionId/sign-in",
    { preHandler: authenticate },
    async (req, reply) => {
      const { positionId } = req.params as { positionId: string };
      await signInPosition(sql, req.principal, positionId);
      return reply.send({ ok: true });
    },
  );

  app.post("/api/v1/positions/sign-out", { preHandler: authenticate }, async (req, reply) => {
    await signOutPosition(sql, req.principal);
    return reply.send({ ok: true });
  });

  /** Person creation is an admin act (no open registration; threat B2/B11). */
  app.post("/api/v1/persons", { preHandler: authenticate }, async (req, reply) => {
    const body = CreatePersonBody.parse(req.body);
    const m = req.principal.memberships.find((x) => x.jurisdictionId === body.jurisdictionId);
    if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
    const personId = await createPerson(sql, body);
    await addMembership(sql, personId, body.jurisdictionId, body.role);
    return reply.status(201).send({ id: personId });
  });

  return app;
}

export { createJurisdiction, createPerson, addMembership };
