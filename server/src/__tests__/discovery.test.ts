import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { createJurisdiction } from "../auth/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Discovery endpoints for the app shell: a jurisdiction's boards and
 * dashboards. Any member may list (viewers included); a non-member is
 * refused, and Row-Level Security is the second wall.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let otherJurisdictionId: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  otherJurisdictionId = await createJurisdiction(admin, "hoopa", "Hoopa Valley OES");
  app = buildApp(runtime, { oidc: null });

  adminToken = await login("admin@example.org", "correct-horse-battery");
  memberToken = await login("member@example.org", "another-good-password");

  await createBoard("road_closures");
  await createDashboard("eoc_status");
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  return res.json().accessToken as string;
}

async function createBoard(templateKey: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey },
  });
  if (res.statusCode !== 201) throw new Error(`board create failed: ${res.body}`);
  return res.json().id as string;
}

async function createDashboard(templateKey: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/dashboards`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey },
  });
  if (res.statusCode !== 201) throw new Error(`dashboard create failed: ${res.body}`);
  return res.json().id as string;
}

describe("board discovery", () => {
  it("lists a jurisdiction's boards for a member, flagging geometry", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(200);
    const boards = res.json().boards as Array<{
      id: string;
      title: string;
      templateKey: string;
      templateVersion: number;
      hasGeometry: boolean;
    }>;
    const closures = boards.find((b) => b.templateKey === "road_closures");
    expect(closures).toBeDefined();
    expect(closures!.hasGeometry).toBe(true);
    expect(typeof closures!.title).toBe("string");
  });

  it("refuses a jurisdiction the caller does not belong to", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${otherJurisdictionId}/boards`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("dashboard discovery", () => {
  it("lists a jurisdiction's dashboards for a member", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/dashboards`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(200);
    const dashboards = res.json().dashboards as Array<{
      id: string;
      title: string;
      templateKey: string;
    }>;
    expect(dashboards.some((d) => d.templateKey === "eoc_status")).toBe(true);
  });

  it("refuses a jurisdiction the caller does not belong to", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${otherJurisdictionId}/dashboards`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
