import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "../../__tests__/helpers.js";
import { GAZETTEER_HEADER } from "../normalize.js";

/**
 * Offline address search over HTTP on real PostgreSQL sign-in: signed-in
 * people search, anonymous callers do not, and a server without a readable
 * gazetteer answers "unavailable" instead of failing.
 */

// kind, name, class, context, lon, lat, key, addresses
const FIXTURE = [
  "place\tEureka\tcity\t\t-124.17076\t40.80188\teureka\t",
  "place\tArcata\ttown\t\t-124.08284\t40.86652\tarcata\t",
  "street\t3rd Street\ttertiary\tEureka\t-124.15693\t40.80493\t3rd street\t816,-124.16261,40.80401",
  "street\tEureka Way\tminor\tWeed\t-122.38562\t41.42291\teureka way\t55,-122.38631,41.42235",
  "poi\tHumboldt County Courthouse\tcourthouse\tEureka\t-124.1624\t40.80294\thumboldt county courthouse\t",
];

let admin: Sql;
let runtime: Sql;
let dir: string;
let app: FastifyInstance;
let token: string;
const others: FastifyInstance[] = [];

const search = (target: FastifyInstance, query: string, headers: Record<string, string> = auth(token)) =>
  target.inject({ method: "GET", url: `/api/v1/geocode/search?${query}`, headers });

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  await seedIdentity(admin);
  dir = mkdtempSync(join(tmpdir(), "geocode-"));
  writeFileSync(join(dir, "gazetteer.tsv"), `${GAZETTEER_HEADER}\t2026-09-23T00:00:00Z\n${FIXTURE.join("\n")}\n`);
  writeFileSync(join(dir, "corrupt.tsv"), "this is not a gazetteer\n");
  app = buildApp(runtime, { oidc: null, gazetteerPath: join(dir, "gazetteer.tsv") });
  token = await tokenFor(app, "member@example.org", "another-good-password");
});

afterAll(async () => {
  await Promise.all([app, ...others].map((target) => target.close()));
  await runtime.end();
  await admin.end();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/v1/geocode/search", () => {
  it("refuses anonymous callers and bad tokens", async () => {
    expect((await search(app, "q=eureka", {})).statusCode).toBe(401);
    expect((await search(app, "q=eureka", { authorization: "Bearer not-a-token" })).statusCode).toBe(401);
  });

  it("puts the exact address first for a signed-in member", async () => {
    const res = await search(app, "q=816%203rd%20street%20eureka");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { available: boolean; results: Array<Record<string, unknown>> };
    expect(body.available).toBe(true);
    expect(body.results[0]).toEqual({
      kind: "address", label: "816 3rd Street", detail: "Eureka", lon: -124.16261, lat: 40.80401, zoom: 18,
    });
    expect(body.results[1]).toMatchObject({ kind: "street", label: "3rd Street" });
    const unknown = (await search(app, "q=999%203rd%20street")).json() as { results: Array<Record<string, unknown>> };
    expect(unknown.results).toEqual([expect.objectContaining({ kind: "street", label: "3rd Street", zoom: 16 })]);
  });

  it("ranks the city above the street named after it and honours the limit", async () => {
    const all = (await search(app, "q=eureka")).json() as { results: Array<{ kind: string; label: string }> };
    expect(all.results.map((r) => `${r.kind}:${r.label}`)).toEqual(["place:Eureka", "street:Eureka Way"]);
    const one = (await search(app, "q=eureka&limit=1&near=-122.39,41.42")).json() as { results: unknown[] };
    expect(one.results).toHaveLength(1);
  });

  it("rejects out-of-range input", async () => {
    expect((await search(app, "q=eureka&limit=50")).statusCode).toBe(400);
    expect((await search(app, "limit=5")).statusCode).toBe(400);
    expect((await search(app, `q=${"a".repeat(201)}`)).statusCode).toBe(400);
    expect((await search(app, "q=eureka&near=north")).statusCode).toBe(400);
  });

  it("reports search unavailable when no gazetteer is configured or readable", async () => {
    for (const gazetteerPath of [null, join(dir, "missing.tsv"), join(dir, "corrupt.tsv")]) {
      const target = buildApp(runtime, { oidc: null, gazetteerPath });
      others.push(target);
      const res = await search(target, "q=eureka");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ available: false, results: [] });
    }
  });
});

describe("GET /api/v1/geocode/reverse", () => {
  const reverse = (target: FastifyInstance, at: string, headers: Record<string, string> = auth(token)) =>
    target.inject({ method: "GET", url: `/api/v1/geocode/reverse?at=${at}`, headers });

  it("answers a point with the nearest house number, place and point of interest", async () => {
    expect((await reverse(app, "-124.1626,40.804", {})).statusCode).toBe(401);
    const res = await reverse(app, "-124.1626,40.804");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { available: boolean; results: Array<{ kind: string; label: string; distanceMeters: number }> };
    expect(body.available).toBe(true);
    expect(body.results.map((r) => `${r.kind}:${r.label}`)).toEqual([
      "address:816 3rd Street", "place:Eureka", "poi:Humboldt County Courthouse",
    ]);
    expect(body.results[0]!.distanceMeters).toBeLessThan(10);
  });

  it("rejects a malformed or impossible point, and reports lookup unavailable without a gazetteer", async () => {
    expect((await reverse(app, "north")).statusCode).toBe(400);
    expect((await reverse(app, "-200,40")).statusCode).toBe(400);
    const target = buildApp(runtime, { oidc: null, gazetteerPath: null });
    others.push(target);
    expect((await reverse(target, "-124.16,40.8")).json()).toEqual({ available: false, results: [] });
  });
});
