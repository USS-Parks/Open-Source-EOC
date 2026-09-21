import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
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
  reassignPosition,
  resume,
  signInPosition,
  signOutPosition,
} from "./auth/service.js";
import { checkAllowed, recordFailure, recordSuccess } from "./auth/rate-limit.js";
import { createGuestGrant, listPositions, provisionJurisdiction, revokeGuestGrant } from "./auth/authz.js";
import { OidcClient, oidcSettingsFromEnv, type OidcSettings } from "./auth/oidc.js";
import { aarRoutes } from "./aar/routes.js";
import { auditRoutes } from "./audit/routes.js";
import { boardRoutes } from "./boards/routes.js";
import { capRoutes } from "./cap/routes.js";
import { cotRoutes } from "./cot/routes.js";
import { dashboardRoutes } from "./dashboards/routes.js";
import { damageRoutes } from "./damage/routes.js";
import { edxlRoutes } from "./edxl/routes.js";
import { facilityRoutes } from "./facilities/routes.js";
import { federationRoutes } from "./federation/routes.js";
import { collabRoutes } from "./collab/routes.js";
import { syncPositionIncidents } from "./collab/service.js";
import { incidentRoutes } from "./incidents/routes.js";
import { dataPackRoutes } from "./data-packs/routes.js";
import { iapRoutes } from "./iap/routes.js";
import { ipawsRoutes } from "./ipaws/routes.js";
import { jicRoutes } from "./jic/routes.js";
import { meetingRoutes } from "./meetings/routes.js";
import { feedRoutes } from "./feeds/routes.js";
import { fileRoutes } from "./files/routes.js";
import { formRoutes } from "./forms/routes.js";
import { sitrepRoutes } from "./sitreps/routes.js";
import { staffingRoutes } from "./staffing/routes.js";
import { trackingRoutes } from "./tracking/routes.js";
import { BlobStore } from "./files/service.js";
import { geoRoutes } from "./geo/routes.js";
import { messagingRoutes } from "./messaging/routes.js";
import { notifyRoutes } from "./notify/routes.js";
import { resourceRoutes } from "./resource/routes.js";
import { BoardSyncHub } from "./sync/hub.js";
import { registerSyncRoutes } from "./sync/routes.js";
import { withPerson } from "./db/context.js";
import { applySecurityHeaders } from "./security/headers.js";
import { applyCors } from "./security/cors.js";
import { rateLimit } from "./security/rate-limit.js";
import { exportRoutes } from "./export/routes.js";
import { impactRoutes } from "./impact/routes.js";
import { savedStateRoutes } from "./saved-state/routes.js";

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
  readonly trustedTemplateKeys?: readonly string[];
}

export function buildApp(sql: Sql, options: BuildAppOptions = {}): FastifyInstance {
  // requestTimeout caps how long an unfinished request may occupy a
  // connection (slowloris defense and continuity under load); it applies to
  // request receipt, not to established WebSocket sessions.
  const app = Fastify({ logger: false, requestTimeout: 30_000 });
  void app.register(websocket);
  const oidcSettings = options.oidc === undefined ? oidcSettingsFromEnv() : options.oidc;
  const oidc = oidcSettings ? new OidcClient(oidcSettings) : null;

  /**
   * Security headers on every response, and a shared flood limiter in front
   * of the API. Health probes and the WebSocket upgrade are exempt from the
   * limiter so monitoring and live sync are never throttled.
   */
  app.addHook("onRequest", async (req, reply) => {
    if (req.headers.upgrade?.toLowerCase() === "websocket") return;
    const path = req.url.split("?")[0] ?? "";
    applySecurityHeaders(reply, { api: path.startsWith("/api/") });
    if (applyCors(req, reply)) return; // CORS preflight fully answered
    if (path === "/api/v1/health" || path === "/api/v1/ready") return;
    const decision = rateLimit(req.ip);
    if (!decision.allowed) {
      return reply
        .header("retry-after", String(Math.ceil(decision.retryAfterMs / 1000)))
        .code(429)
        .send({ error: "rate limit exceeded" });
    }
  });

  // Liveness (no dependencies) and readiness (database reachable), for load
  // balancers and orchestration. No auth, and exempt from the flood limiter.
  app.get("/api/v1/health", async () => ({ status: "ok" }));
  app.get("/api/v1/ready", async (_req, reply) => {
    try {
      await sql`select 1`;
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

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

  /**
   * Best-effort collaboration membership sync after an assignment change.
   * Runs in its own transaction so a backend hiccup never fails the
   * assignment, and no-ops when no collaboration backend is configured.
   */
  async function syncCollabForPosition(principal: Principal, positionId: string): Promise<void> {
    try {
      await withPerson(sql, principal.person.id, (tx) =>
        syncPositionIncidents(tx, principal, positionId),
      );
    } catch {
      // Membership sync is advisory; the assignment itself already committed.
    }
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
      await syncCollabForPosition(req.principal, positionId);
      return reply.status(201).send({ ok: true });
    },
  );

  // Reassign a position (shift change): the incoming holder replaces the
  // current one, and any active incident's collaboration membership follows.
  app.post(
    "/api/v1/positions/:positionId/reassignments",
    { preHandler: authenticate },
    async (req, reply) => {
      const { positionId } = req.params as { positionId: string };
      const body = AssignBody.parse(req.body);
      await withPerson(sql, req.principal.person.id, (tx) =>
        reassignPosition(tx, req.principal, positionId, body.personId),
      );
      await syncCollabForPosition(req.principal, positionId);
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

  boardRoutes(app, sql, authenticate, {
    trustedTemplateKeys: options.trustedTemplateKeys ?? [],
  });
  auditRoutes(app, sql, authenticate);
  capRoutes(app, sql, authenticate);
  cotRoutes(app, sql, authenticate);
  ipawsRoutes(app, sql, authenticate);
  collabRoutes(app, sql, authenticate);
  meetingRoutes(app, sql, authenticate);
  jicRoutes(app, sql, authenticate);
  iapRoutes(app, sql, authenticate);
  resourceRoutes(app, sql, authenticate);
  aarRoutes(app, sql, authenticate);
  dashboardRoutes(app, sql, authenticate);
  damageRoutes(app, sql, authenticate);
  edxlRoutes(app, sql, authenticate);
  facilityRoutes(app, sql, authenticate);
  feedRoutes(app, sql, authenticate);
  formRoutes(app, sql, authenticate);
  sitrepRoutes(app, sql, authenticate);
  staffingRoutes(app, sql, authenticate);
  trackingRoutes(app, sql, authenticate);
  incidentRoutes(app, sql, authenticate);
  dataPackRoutes(app, sql, authenticate);
  impactRoutes(app, sql, authenticate);
  savedStateRoutes(app, sql, authenticate);
  notifyRoutes(app, sql, authenticate);
  messagingRoutes(app, sql, authenticate);
  geoRoutes(app, sql, authenticate);
  exportRoutes(app, sql, authenticate);
  fileRoutes(
    app,
    sql,
    new BlobStore(process.env.OPENEOC_DATA_DIR ?? "./data/blobs"),
    authenticate,
  );
  const hub = new BoardSyncHub(sql);
  registerSyncRoutes(app, sql, hub);
  federationRoutes(app, sql, hub, authenticate);

  return app;
}

export { createJurisdiction, createPerson, addMembership };
