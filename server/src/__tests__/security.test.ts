import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Seeded adversarial suite (INV-7). It holds the platform to its
 * authorization contract: no unauthenticated path reaches authority, no
 * jurisdiction reaches another's data, viewers are read-only, peer lanes
 * reject unknown tokens, the audit log is append-only, secrets are never
 * echoed, and login backoff throttles guessing. It runs in CI thereafter.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurA: string;
let jurB: string;
let adminAToken: string;
let viewerAToken: string;
let priorKey: string | undefined;

function inject(method: string, url: string, token?: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: method as "GET",
    url,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(payload !== undefined ? { payload } : {}),
  });
}
async function login(email: string, password: string): Promise<string> {
  return (
    await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } })
  ).json().accessToken as string;
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-security-key";
  const db = await freshDb();
  admin = db.admin;
  runtime = db.runtime;
  const seed = await seedIdentity(admin);
  jurA = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  const viewerId = await createPerson(admin, {
    email: "viewer@example.org",
    displayName: "Viewer",
    password: "correct-horse-battery",
  });
  await addMembership(admin, viewerId, jurA, "viewer");
  // A separate jurisdiction with its own admin.
  jurB = await createJurisdiction(admin, "humboldt", "Humboldt OES");
  const adminBId = await createPerson(admin, {
    email: "adminb@example.org",
    displayName: "Admin B",
    password: "correct-horse-battery",
  });
  await addMembership(admin, adminBId, jurB, "admin");

  app = buildApp(runtime, { oidc: null, integrations: ["collab"] });
  await app.ready();
  adminAToken = await login("admin@example.org", "correct-horse-battery");
  viewerAToken = await login("viewer@example.org", "correct-horse-battery");
}, 60000);

afterAll(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (admin) await admin.end();
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

describe("no unauthenticated path reaches authority", () => {
  const endpoints: Array<[string, string, Record<string, unknown>?]> = [
    ["GET", "/api/v1/me"],
    ["POST", "/api/v1/persons", { email: "x@example.org", displayName: "X", password: "correct-horse-battery", jurisdictionId: "00000000-0000-0000-0000-000000000000", role: "admin" }],
  ];
  it("rejects every authority endpoint without a bearer token", async () => {
    const dynamic: Array<[string, string, Record<string, unknown>?]> = [
      ["POST", `/api/v1/jurisdictions/${jurA}/boards`, { templateKey: "activity_log" }],
      ["POST", `/api/v1/jurisdictions/${jurA}/ipaws/enable`, { enabled: true }],
      ["POST", `/api/v1/jurisdictions/${jurA}/resource-requests`, { origin: "eoc", item: "x" }],
      ["POST", `/api/v1/jurisdictions/${jurA}/jic/releases`, { title: "x", body: "y" }],
    ];
    for (const [method, url, body] of [...endpoints, ...dynamic]) {
      const res = await inject(method, url, undefined, body);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe("no jurisdiction reaches another's authority", () => {
  it("refuses an admin of A acting on B", async () => {
    const attempts: Array<[string, string, Record<string, unknown>?]> = [
      ["POST", `/api/v1/jurisdictions/${jurB}/boards`, { templateKey: "activity_log" }],
      ["GET", `/api/v1/jurisdictions/${jurB}/ipaws`],
      ["POST", `/api/v1/jurisdictions/${jurB}/resource-requests`, { origin: "eoc", item: "x" }],
      ["POST", `/api/v1/jurisdictions/${jurB}/corrective-actions`, { capability: "planning", recommendation: "y" }],
      ["POST", `/api/v1/jurisdictions/${jurB}/jic/releases`, { title: "x", body: "y" }],
    ];
    for (const [method, url, body] of attempts) {
      const res = await inject(method, url, adminAToken, body);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});

describe("viewers are read-only (INV-1)", () => {
  it("lets a viewer read but not write", async () => {
    expect((await inject("GET", `/api/v1/jurisdictions/${jurA}/ipaws`, viewerAToken)).statusCode).toBe(200);
    expect((await inject("GET", `/api/v1/jurisdictions/${jurA}/jic/public`, viewerAToken)).statusCode).toBe(200);

    const writes: Array<[string, string, Record<string, unknown>]> = [
      ["POST", `/api/v1/jurisdictions/${jurA}/resource-requests`, { origin: "eoc", item: "x" }],
      ["POST", `/api/v1/jurisdictions/${jurA}/jic/releases`, { title: "x", body: "y" }],
      ["POST", `/api/v1/jurisdictions/${jurA}/corrective-actions`, { capability: "planning", recommendation: "y" }],
      ["POST", `/api/v1/jurisdictions/${jurA}/boards`, { templateKey: "activity_log" }],
    ];
    for (const [method, url, body] of writes) {
      const res = await inject(method, url, viewerAToken, body);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});

describe("peer and intake lanes reject unknown tokens", () => {
  it("refuses forged tokens on every token-authenticated lane", async () => {
    const lanes: Array<[string, Record<string, unknown>]> = [
      ["/api/v1/federation/receive", { boardId: "00000000-0000-0000-0000-000000000000", updates: [] }],
      ["/api/v1/jic/approvals/receive", { releaseId: "00000000-0000-0000-0000-000000000000", decision: "approve" }],
      ["/api/v1/resource-requests/receive", { originRequestId: "00000000-0000-0000-0000-000000000000", item: "x", quantity: 1, priority: "routine", notes: null }],
    ];
    for (const [url, body] of lanes) {
      const res = await app.inject({ method: "POST", url, headers: { "x-peer-token": "forged" }, payload: body });
      expect(res.statusCode, url).toBe(401);
    }
    // Public damage intake requires an intake token.
    const noToken = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${jurA}/damage/report`,
      payload: { assessments: [] },
    });
    expect(noToken.statusCode).toBe(401);
  });
});

describe("the audit log is append-only", () => {
  it("refuses update and delete from the runtime role", async () => {
    // Generate at least one audit row.
    await inject("POST", `/api/v1/jurisdictions/${jurA}/boards`, adminAToken, { templateKey: "activity_log" });
    await expect(runtime`update audit_events set category = 'tamper'`).rejects.toThrow();
    await expect(runtime`delete from audit_events`).rejects.toThrow();
  });
});

describe("secrets are never echoed", () => {
  it("returns fingerprints, never the raw credential", async () => {
    const ipaws = await inject("PUT", `/api/v1/jurisdictions/${jurA}/ipaws/config`, adminAToken, {
      environment: "test",
      cogId: "123456",
      endpointUrl: "https://tdl.example.org/IPAWS",
      credential: "super-secret-pin",
    });
    expect(ipaws.statusCode).toBe(200);
    const status = await inject("GET", `/api/v1/jurisdictions/${jurA}/ipaws`, adminAToken);
    expect(status.body).not.toContain("super-secret-pin");

    const collab = await inject("PUT", `/api/v1/jurisdictions/${jurA}/collab/backend`, adminAToken, {
      kind: "mattermost",
      baseUrl: "https://mm.example.org",
      token: "bot-secret-token",
      enabled: true,
    });
    expect(collab.statusCode).toBe(200);
    const collabStatus = await inject("GET", `/api/v1/jurisdictions/${jurA}/collab`, adminAToken);
    expect(collabStatus.body).not.toContain("bot-secret-token");
  });
});

describe("login backoff throttles guessing", () => {
  it("locks an email after repeated failures", async () => {
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "guesser@example.org", password: "wrong-password" },
      });
    for (let i = 0; i < 5; i += 1) {
      const res = await attempt();
      expect(res.statusCode).toBe(401);
    }
    const locked = await attempt();
    expect(locked.statusCode).toBe(429);
  });
});
