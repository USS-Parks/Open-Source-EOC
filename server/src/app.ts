import { readFileSync } from "node:fs";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import type { Sql } from "./db/client.js";
import {
  addMembership,
  assignPosition,
  AuthError,
  changeOwnPassword,
  createJurisdiction,
  createPerson,
  createPosition,
  logout,
  type Principal,
  reassignPosition,
  resume,
  sessionPrincipal,
  signInPosition,
  signOutPosition,
} from "./auth/service.js";
import { cachedPrincipal, forgetPerson, forgetSession } from "./auth/principal-cache.js";
import { checkAllowed, recordFailure, recordSuccess } from "./auth/rate-limit.js";
import { hashToken } from "./auth/tokens.js";
import { activateEnrollment, beginEnrollment, passwordLogin, verifyMfa } from "./auth/mfa.js";
import { createGuestGrant, listPositions, provisionJurisdiction, revokeGuestGrant } from "./auth/authz.js";
import { adminRoutes } from "./auth/admin-routes.js";
import { recordAudit } from "./audit/service.js";
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
import { planRoutes } from "./plans/routes.js";
import { dataPackRoutes } from "./data-packs/routes.js";
import { iapRoutes } from "./iap/routes.js";
import { ipawsRoutes } from "./ipaws/routes.js";
import { jicRoutes } from "./jic/routes.js";
import { meetingRoutes } from "./meetings/routes.js";
import { feedRoutes } from "./feeds/routes.js";
import { fileRoutes } from "./files/routes.js";
import { formRoutes } from "./forms/routes.js";
import { formMediaRoutes } from "./forms/routes.js";
import { sitrepRoutes } from "./sitreps/routes.js";
import { staffingRoutes } from "./staffing/routes.js";
import { trackingRoutes } from "./tracking/routes.js";
import { BlobStore } from "./files/service.js";
import { geoRoutes } from "./geo/routes.js";
import { geocodeRoutes, loadGazetteer } from "./geocode/routes.js";
import { messagingRoutes } from "./messaging/routes.js";
import { notifyRoutes } from "./notify/routes.js";
import { massNotificationRoutes } from "./notify/mass.js";
import { contactRoutes } from "./contacts/routes.js";
import { reportRoutes } from "./reports/routes.js";
import { resourceRoutes } from "./resource/routes.js";
import { BoardSyncHub } from "./sync/hub.js";
import { notificationStreamRoutes } from "./sync/notifications.js";
import { closeWithdrawnGuestSockets, registerSyncRoutes } from "./sync/routes.js";
import { DEFAULT_SOCKET_LIMITS, disciplineSockets, MAX_PAYLOAD_BYTES, type SocketLimits } from "./sync/sockets.js";
import { withPerson } from "./db/context.js";
import { applySecurityHeaders } from "./security/headers.js";
import { applyCors } from "./security/cors.js";
import { rateLimit } from "./security/rate-limit.js";
import { exportRoutes } from "./export/routes.js";
import { impactRoutes } from "./impact/routes.js";
import { savedStateRoutes } from "./saved-state/routes.js";
import { lifelineRoutes } from "./lifelines/routes.js";
import { esfRoutes } from "./esf/routes.js";
import { operationalRelationshipRoutes } from "./relationships/routes.js";
import {
  logLevelFromEnv,
  loggingOptions,
  slowRequestMsFromEnv,
  type LogLevel,
  type LogStream,
} from "./telemetry/logging.js";
import { Metrics, metricsRoutes, observeRequests } from "./telemetry/metrics.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal;
  }
  interface FastifyInstance {
    metrics: Metrics;
  }
}

/** The server package's version, reported by the liveness probe. */
const SERVER_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const ResumeBody = z.object({ resumeToken: z.string().min(1) });
const PasswordChangeBody = z.object({ currentPassword: z.string().min(1).max(1024), newPassword: z.string().max(1024) });
const MfaTokenBody = z.object({ mfaToken: z.string().min(1) });
const MfaCodeBody = z.object({ mfaToken: z.string().min(1), code: z.string().min(1).max(64) });
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
  readonly integrations?: readonly OptionalIntegration[];
  /** Defaults to OPENEOC_LOG_LEVEL (see telemetry/logging.ts). */
  readonly logLevel?: LogLevel;
  /** Log destination; stdout when absent. */
  readonly logStream?: LogStream;
  /** Defaults to OPENEOC_SLOW_REQUEST_MS, else 1000. */
  readonly slowRequestMs?: number;
  /** Bearer token for GET /api/v1/metrics; defaults to OPENEOC_METRICS_TOKEN. Unset serves 404. */
  readonly metricsToken?: string | null;
  /** Admins must enroll in MFA to sign in with a password. Default: on unless OPENEOC_REQUIRE_ADMIN_MFA=0. */
  readonly requireAdminMfa?: boolean;
  /** Which peers may set X-Forwarded-For; defaults to OPENEOC_TRUST_PROXY (see trustProxyFromEnv). */
  readonly trustProxy?: boolean | string;
  /** WebSocket auth deadline, heartbeat and backpressure ceiling; see sync/sockets.ts. */
  readonly socketLimits?: Partial<SocketLimits>;
  /** Offline address search file; defaults to OPENEOC_GAZETTEER_PATH. Unset reports search unavailable. */
  readonly gazetteerPath?: string | null;
}

export type OptionalIntegration = "collab" | "facilities" | "meetings" | "tracking";

function integrationsFromEnv(value = process.env.OPENEOC_INTEGRATIONS ?? ""): OptionalIntegration[] {
  const integrations: OptionalIntegration[] = [];
  for (const entry of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    if (entry !== "collab" && entry !== "facilities" && entry !== "meetings" && entry !== "tracking") {
      throw new Error(`unsupported OPENEOC_INTEGRATIONS entry: ${entry}`);
    }
    if (!integrations.includes(entry)) integrations.push(entry);
  }
  return integrations;
}

/**
 * OPENEOC_TRUST_PROXY: unset or "false" trusts no proxy, so request.ip is the
 * socket peer; "true" trusts any sender; anything else is a comma-separated
 * list of proxy addresses or CIDRs whose X-Forwarded-For is believed. The
 * limiters key on request.ip, so behind a reverse proxy name the proxy, and
 * never trust the header where clients connect directly.
 */
export function trustProxyFromEnv(value = process.env.OPENEOC_TRUST_PROXY ?? ""): boolean | string {
  const v = value.trim();
  if (v === "" || v === "false") return false;
  return v === "true" ? true : v;
}

/**
 * Public keys of the template publishers this instance trusts, read from the
 * PEM bundle file OPENEOC_TRUSTED_TEMPLATE_KEYS names. Unset trusts none, so a
 * signed package is refused; a set path with no key in it is a mistake and
 * stops startup rather than silently trusting none.
 */
export function trustedTemplateKeysFromEnv(path = process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS): string[] {
  if (!path) return [];
  const keys = readFileSync(path, "utf8").match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g);
  if (!keys) throw new Error(`OPENEOC_TRUSTED_TEMPLATE_KEYS names ${path}, which holds no PEM public key`);
  return keys;
}

export function buildApp(sql: Sql, options: BuildAppOptions = {}): FastifyInstance {
  // requestTimeout caps how long an unfinished request may occupy a
  // connection (continuity under load); it applies to request receipt, not to
  // established WebSocket sessions. Five minutes lets a maximum-size upload
  // finish over a slow field link; headers alone are still cut off by Node's
  // 60-second headersTimeout, which is the slowloris defense.
  const app = Fastify({
    requestTimeout: 300_000,
    trustProxy: options.trustProxy ?? trustProxyFromEnv(),
    ...loggingOptions(options.logLevel ?? logLevelFromEnv(), options.logStream),
  });
  void app.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });
  disciplineSockets(app, { ...DEFAULT_SOCKET_LIMITS, ...options.socketLimits });
  const metrics = new Metrics();
  app.decorate("metrics", metrics);
  observeRequests(app, metrics, options.slowRequestMs ?? slowRequestMsFromEnv());
  const oidcSettings = options.oidc === undefined ? oidcSettingsFromEnv() : options.oidc;
  const oidc = oidcSettings ? new OidcClient(oidcSettings) : null;
  const integrations = new Set(options.integrations ?? integrationsFromEnv());

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
  // Liveness names the running version so an upgrade can confirm it took.
  app.get("/api/v1/health", async () => ({ status: "ok", version: SERVER_VERSION }));
  app.get("/api/v1/ready", async (_req, reply) => {
    try {
      await sql`select 1`;
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AuthError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.status(400).send({ error: "invalid request" });
    // Fastify's own request errors, such as a body over the route's limit, keep their 4xx status.
    const status = (err as { statusCode?: unknown }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error({ err }, "request failed");
    return reply.status(500).send({ error: "internal error" });
  });

  /**
   * Server-side principal derivation (INV-7): the bearer token is the only
   * caller input consulted. Position, roles, and identity come from the
   * database; any caller-supplied identity headers are ignored. A short-lived
   * cache (auth/principal-cache.ts) spares repeat requests the derivation.
   */
  async function authenticate(req: FastifyRequest): Promise<void> {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new AuthError(401, "not authenticated");
    const accessHash = hashToken(token);
    req.principal = await cachedPrincipal(accessHash, () => sessionPrincipal(sql, accessHash));
  }

  /**
   * Best-effort collaboration membership sync after an assignment change.
   * Runs after the assignment commits, with the backend called outside any
   * transaction, so a backend hiccup never fails the assignment; no-ops when
   * no collaboration backend is configured.
   */
  async function syncCollabForPosition(principal: Principal, positionId: string): Promise<void> {
    if (!integrations.has("collab")) return;
    try {
      await syncPositionIncidents(sql, principal, positionId);
    } catch {
      // Membership sync is advisory; the assignment itself already committed.
    }
  }

  const requireAdminMfa = options.requireAdminMfa ?? process.env.OPENEOC_REQUIRE_ADMIN_MFA !== "0";
  app.post("/api/v1/auth/login", async (req, reply) => {
    const body = LoginBody.parse(req.body);
    if (!checkAllowed(body.email)) throw new AuthError(429, "too many attempts, retry later");
    try {
      const result = await passwordLogin(sql, body.email, body.password, requireAdminMfa);
      recordSuccess(body.email);
      return reply.send(result);
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) recordFailure(body.email);
      throw err;
    }
  });

  // Second factor. The mfaToken from a password login is the only credential
  // these accept; each completes sign-in with the usual session payload.
  app.post("/api/v1/auth/mfa/verify", async (req, reply) => {
    const body = MfaCodeBody.parse(req.body);
    return reply.send(await verifyMfa(sql, body.mfaToken, body.code));
  });
  app.post("/api/v1/auth/mfa/enroll", async (req, reply) => {
    const body = MfaTokenBody.parse(req.body);
    return reply.send(await beginEnrollment(sql, body.mfaToken));
  });
  app.post("/api/v1/auth/mfa/activate", async (req, reply) => {
    const body = MfaCodeBody.parse(req.body);
    return reply.send(await activateEnrollment(sql, body.mfaToken, body.code));
  });

  app.post("/api/v1/auth/resume", async (req, reply) => {
    const body = ResumeBody.parse(req.body);
    const result = await resume(sql, body.resumeToken);
    forgetSession(result.sessionId); // the previous access token no longer resolves
    return reply.send(result);
  });

  // Identity changes below forget the affected cached principals only after
  // withPerson has committed, so a concurrent request cannot re-cache the
  // state from before the change.
  app.post("/api/v1/auth/logout", { preHandler: authenticate }, async (req, reply) => {
    await withPerson(sql, req.principal.person.id, (tx) => logout(tx, req.principal.sessionId));
    forgetSession(req.principal.sessionId);
    return reply.send({ ok: true });
  });

  // Changing one's own password. Wrong current passwords count toward the
  // same backoff as sign-in, keyed on the person, so a left-open session
  // cannot be used to guess the password.
  app.post("/api/v1/auth/password", { preHandler: authenticate }, async (req, reply) => {
    const body = PasswordChangeBody.parse(req.body);
    const key = `password:${req.principal.person.id}`;
    if (!checkAllowed(key)) return reply.code(429).send({ error: "too many attempts; wait a moment and try again" });
    try {
      const ended = await withPerson(sql, req.principal.person.id,
        (tx) => changeOwnPassword(tx, req.principal, body.currentPassword, body.newPassword));
      recordSuccess(key);
      forgetPerson(req.principal.person.id);
      return reply.send({ ok: true, otherSessionsEnded: ended });
    } catch (error) {
      if (error instanceof AuthError && error.status === 403) recordFailure(key);
      throw error;
    }
  });

  // Keep the session contract truthful for scope-limited raw guest grants.
  // Incident participation remains a separate, incident-specific authority.
  // A refused request has no principal; its error body passes through as is.
  app.addHook("preSerialization", async (req, _reply, payload) => {
    if (req.routeOptions.url !== "/api/v1/me" || !req.principal) return payload;
    return { ...(payload as object), guests: req.principal.guests };
  });

  if (oidc) {
    app.get("/api/v1/auth/oidc/start", async (_req, reply) => reply.send(await oidc.start()));
    app.get("/api/v1/auth/oidc/callback", async (req, reply) => {
      const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      return reply.send(await oidc.callback(sql, oidcSettings!.redirectUri + search));
    });
  }

  app.get("/api/v1/me", { preHandler: authenticate }, async (req, reply) => {
    const { person, position, memberships, sessionId, isInstanceAdmin } = req.principal;
    return reply.send({ person, position, memberships, sessionId, isInstanceAdmin });
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
        listPositions(tx, req.principal, jurisdictionId,
          z.object({ assignedToMe: z.enum(["true", "false"]).optional() })
            .parse(req.query).assignedToMe === "true"),
      );
      return reply.send({ positions: rows });
    },
  );

  app.post("/api/v1/provision/jurisdictions", { preHandler: authenticate }, async (req, reply) => {
    const body = ProvisionBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      provisionJurisdiction(tx, req.principal, body),
    );
    forgetPerson(body.adminPersonId);
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
      forgetPerson(body.personId);
      return reply.status(201).send({ id });
    },
  );

  app.delete(
    "/api/v1/guests/:grantId",
    { preHandler: authenticate },
    async (req, reply) => {
      const { grantId } = req.params as { grantId: string };
      const guestId = await withPerson(sql, req.principal.person.id, (tx) =>
        revokeGuestGrant(tx, req.principal, grantId),
      );
      forgetPerson(guestId);
      await closeWithdrawnGuestSockets();
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
      const former = await withPerson(sql, req.principal.person.id, (tx) =>
        reassignPosition(tx, req.principal, positionId, body.personId),
      );
      for (const personId of former) forgetPerson(personId);
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
      forgetSession(req.principal.sessionId);
      return reply.send({ ok: true });
    },
  );

  app.post("/api/v1/positions/sign-out", { preHandler: authenticate }, async (req, reply) => {
    await withPerson(sql, req.principal.person.id, (tx) => signOutPosition(tx, req.principal));
    forgetSession(req.principal.sessionId);
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
      await recordAudit(tx, req.principal, {
        jurisdictionId: body.jurisdictionId, category: "membership.added",
        subjectTable: "persons", subjectId: id, payload: { role: body.role, previousRole: null },
      });
      return id;
    });
    return reply.status(201).send({ id: personId });
  });

  // Which optional integrations this deployment registers. Read-only: the
  // set comes from OPENEOC_INTEGRATIONS at start, not from the database.
  // Any signed-in person may read which optional integrations run: the
  // console hides the entries of those that do not.
  app.get("/api/v1/integrations", { preHandler: authenticate }, async (_req, reply) => {
    return reply.send({
      variable: "OPENEOC_INTEGRATIONS",
      integrations: (["collab", "facilities", "meetings", "tracking"] as const)
        .map((key) => ({ key, enabled: integrations.has(key) })),
    });
  });
  adminRoutes(app, sql, authenticate);

  // One trusted key bundle for both signed package formats: board templates (v1) and solution packages (v2).
  const trustedTemplateKeys = options.trustedTemplateKeys ?? trustedTemplateKeysFromEnv();
  boardRoutes(app, sql, authenticate, { trustedTemplateKeys });
  auditRoutes(app, sql, authenticate);
  capRoutes(app, sql, authenticate);
  cotRoutes(app, sql, authenticate);
  ipawsRoutes(app, sql, authenticate);
  if (integrations.has("collab")) collabRoutes(app, sql, authenticate);
  if (integrations.has("meetings")) meetingRoutes(app, sql, authenticate);
  jicRoutes(app, sql, authenticate);
  iapRoutes(app, sql, authenticate);
  resourceRoutes(app, sql, authenticate);
  aarRoutes(app, sql, authenticate);
  dashboardRoutes(app, sql, authenticate);
  damageRoutes(app, sql, authenticate, { shelterCensus: integrations.has("facilities") });
  edxlRoutes(app, sql, authenticate);
  if (integrations.has("facilities")) facilityRoutes(app, sql, authenticate);
  feedRoutes(app, sql, authenticate);
  formRoutes(app, sql, authenticate);
  sitrepRoutes(app, sql, authenticate);
  staffingRoutes(app, sql, authenticate);
  if (integrations.has("tracking")) trackingRoutes(app, sql, authenticate);
  incidentRoutes(app, sql, authenticate);
  planRoutes(app, sql, authenticate);
  dataPackRoutes(app, sql, authenticate, { trustedTemplateKeys });
  impactRoutes(app, sql, authenticate);
  savedStateRoutes(app, sql, authenticate);
  lifelineRoutes(app, sql, authenticate);
  esfRoutes(app, sql, authenticate);
  operationalRelationshipRoutes(app, sql, authenticate);
  notifyRoutes(app, sql, authenticate);
  massNotificationRoutes(app, sql, authenticate);
  contactRoutes(app, sql, authenticate);
  reportRoutes(app, sql, authenticate);
  messagingRoutes(app, sql, authenticate);
  geoRoutes(app, sql, authenticate);
  geocodeRoutes(app, authenticate, loadGazetteer(
    options.gazetteerPath === undefined ? process.env.OPENEOC_GAZETTEER_PATH : options.gazetteerPath ?? undefined,
    app.log,
  ));
  const blobs = new BlobStore(process.env.OPENEOC_DATA_DIR ?? "./data/blobs");
  exportRoutes(app, sql, blobs, authenticate);
  fileRoutes(app, sql, blobs, authenticate);
  formMediaRoutes(app, sql, blobs, authenticate);
  const hub = new BoardSyncHub(sql);
  app.addHook("onClose", () => { hub.close(); });
  registerSyncRoutes(app, sql, hub);
  notificationStreamRoutes(app, sql);
  federationRoutes(app, sql, hub, authenticate);
  metricsRoutes(
    app,
    sql,
    hub,
    metrics,
    options.metricsToken === undefined ? process.env.OPENEOC_METRICS_TOKEN || null : options.metricsToken,
  );

  return app;
}

export { createJurisdiction, createPerson, addMembership };
