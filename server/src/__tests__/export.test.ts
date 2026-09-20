import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dictionaryValues } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Portable jurisdiction export (M4, INV-9/INV-10, continuity): an admin can
 * pull the operational record as JSON; a member cannot. Proves boards,
 * records with geometry, sitreps, and lifelines all round-trip out.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  return res.json().accessToken as string;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  adminToken = await login("admin@example.org", "correct-horse-battery");
  memberToken = await login("member@example.org", "another-good-password");

  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey: "road_closures" },
  });
  const boardId = board.json().id as string;
  await app.inject({
    method: "POST",
    url: `/api/v1/boards/${boardId}/records`,
    headers: { authorization: `Bearer ${memberToken}` },
    payload: {
      road: "SR-169 at Pecwan",
      reason: "Active fire",
      status: "closed",
      location: { type: "Point", coordinates: [-123.61, 41.29] },
    },
  });
  await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/sitreps`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { period: "OP-1" },
  });
  const lifeline = (dictionaryValues("lifelines.lifelines") ?? [])[0];
  const status = (dictionaryValues("lifelines.status") ?? [])[0];
  await app.inject({
    method: "PUT",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/lifelines`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { lifeline, status },
  });
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("jurisdiction export", () => {
  it("gives an admin the full operational record as a downloadable archive", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/export`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-disposition"])).toContain("openeoc-yurok-export.json");
    const body = res.json() as {
      schemaVersion: number;
      jurisdiction: { slug: string };
      boards: Array<{ templateKey: string; records: Array<{ geometry: { type: string } | null }> }>;
      sitreps: unknown[];
      lifelines: unknown[];
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.jurisdiction.slug).toBe("yurok");
    const roads = body.boards.find((b) => b.templateKey === "road_closures");
    expect(roads).toBeDefined();
    expect(roads!.records).toHaveLength(1);
    expect(roads!.records[0]!.geometry?.type).toBe("Point");
    expect(body.sitreps.length).toBeGreaterThanOrEqual(1);
    expect(body.lifelines.length).toBeGreaterThanOrEqual(1);
  });

  it("refuses a non-admin member", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/export`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
