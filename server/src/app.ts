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
import { createGuestGrant, listPositions, provisionJurisdiction, revokeGuestGrant } from "./auth/authz.js";
import { OidcClient, oidcSettingsFromEnv, type OidcSettings } from "./auth/oidc.js";
import { withPerson } from "./db/context.js";

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
const ProvisionBody = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  adminPersonId: z.string().uuid(),
});
const GuestGrantBody = z.object({
  personId: z.string().uuid(),
  scopes: z.array(z.string().min(1)).min(1),
  expiresAt: z.coerce.date(),
});

export interface BuildAppOptions {
  readonly oidc?: OidcSettings | null;
}

export function buildApp(sql: Sql, options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const oidcSettings = options.oidc === undefined ? oidcSettingsFromEnv() : options.oidc;
  const oidc = oidcSettings ? new OidcClient(oidcSettings) : null;

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
    await withPerson(sql, req.principal.person.id, (tx) => logout(tx, req.principal.sessionId));
    return reply.send({ ok: true });
  });

  if (oidc) {
    app.get("/api/v1/auth/oidc/start", async (_req, reply) => reply.send(await oidc.start()));
    app.get("/api/v1/auth/oidc/callback", async (req, reply) => {
      const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      return reply.send(await oidc.callback(sql, oidcSettings!.redirectUri + search));
    });
  }

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
      const id = await withPerson(sql, req.principal.person.id, (tx) =>
        createPosition(tx, req.principal, jurisdictionId, body.key, body.title),
      );
      return reply.status(201).send({ id });
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/positions",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const rows = await withPerson(sql, req.principal.person.id, (tx) =>
        listPositions(tx, req.principal, jurisdictionId),
      );
      return reply.send({ positions: rows });
    },
  );

  app.post("/api/v1/provision/jurisdictions", { preHandler: authenticate }, async (req, reply) => {
    const body = ProvisionBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      provisionJurisdiction(tx, req.principal, body),
    );
    return reply.status(201).send(result);
  });

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/guests",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = GuestGrantBody.parse(req.body);
      const id = await withPerson(sql, req.principal.person.id, (tx) =>
        createGuestGrant(tx, req.principal, { jurisdictionId, ...body }),
      );
      return reply.status(201).send({ id });
    },
  );

  app.delete(
    "/api/v1/guests/:grantId",
    { preHandler: authenticate },
    async (req, reply) => {
      const { grantId } = req.params as { grantId: string };
      await withPerson(sql, req.principal.person.id, (tx) =>
        revokeGuestGrant(tx, req.principal, grantId),
      );
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/api/v1/positions/:positionId/assignments",
    { preHandler: authenticate },
    async (req, reply) => {
      const { positionId } = req.params as { positionId: string };
      const body = AssignBody.parse(req.body);
      await withPerson(sql, req.principal.person.id, (tx) =>
        assignPosition(tx, req.principal, positionId, body.personId),
      );
      return reply.status(201).send({ ok: true });
    },
  );

  app.post(
    "/api/v1/positions/:positionId/sign-in",
    { preHandler: authenticate },
    async (req, reply) => {
      const { positionId } = req.params as { positionId: string };
      await withPerson(sql, req.principal.person.id, (tx) =>
        signInPosition(tx, req.principal, positionId),
      );
      return reply.send({ ok: true });
    },
  );

  app.post("/api/v1/positions/sign-out", { preHandler: authenticate }, async (req, reply) => {
    await withPerson(sql, req.principal.person.id, (tx) => signOutPosition(tx, req.principal));
    return reply.send({ ok: true });
  });

  /** Person creation is an admin act (no open registration; threat B2/B11). */
  app.post("/api/v1/persons", { preHandler: authenticate }, async (req, reply) => {
    const body = CreatePersonBody.parse(req.body);
    const m = req.principal.memberships.find((x) => x.jurisdictionId === body.jurisdictionId);
    if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
    const personId = await withPerson(sql, req.principal.person.id, async (tx) => {
      const id = await createPerson(tx, body);
      await addMembership(tx, id, body.jurisdictionId, body.role);
      return id;
    });
    return reply.status(201).send({ id: personId });
  });

  return app;
}

export { createJurisdiction, createPerson, addMembership };
