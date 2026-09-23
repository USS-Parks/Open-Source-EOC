import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRecordSchema, STANDARD_TEMPLATES } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { createPerson } from "../auth/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let boardId: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken),
    payload: { templateKey: "road_closures" },
  });
  boardId = board.json().id as string;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});



describe("geometry fields validate as GeoJSON", () => {
  const closures = STANDARD_TEMPLATES.find((t) => t.key === "road_closures")!;
  const schema = buildRecordSchema(closures.fields);
  const base = { road: "SR-96", reason: "Slide", status: "closed" };

  it("accepts Point, LineString, and Polygon; rejects malformed geometry", () => {
    expect(() =>
      schema.parse({ ...base, location: { type: "Point", coordinates: [-123.6, 41.3] } }),
    ).not.toThrow();
    expect(() =>
      schema.parse({
        ...base,
        location: {
          type: "LineString",
          coordinates: [
            [-123.6, 41.3],
            [-123.5, 41.4],
          ],
        },
      }),
    ).not.toThrow();
    expect(() =>
      schema.parse({ ...base, location: { type: "Point", coordinates: [Infinity, 0] } }),
    ).toThrow();
    expect(() =>
      schema.parse({ ...base, location: { type: "Circle", coordinates: [0, 0] } }),
    ).toThrow();
  });
});

describe("boards with geometry are live OGC Feature collections (F6)", () => {
  it("a posted closure appears in the items feed immediately, geom column populated", async () => {
    const rec = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(memberToken),
      payload: {
        road: "SR-169",
        reason: "Bridge failure",
        status: "closed",
        location: { type: "Point", coordinates: [-123.61, 41.29] },
      },
    });
    expect(rec.statusCode).toBe(201);

    const items = await app.inject({
      method: "GET",
      url: `/api/v1/ogc/collections/${boardId}/items`,
      headers: auth(memberToken),
    });
    expect(items.statusCode).toBe(200);
    expect(items.headers["content-type"]).toContain("geo+json");
    const fc = items.json();
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.numberReturned).toBe(1);
    const feature = fc.features[0];
    expect(feature.type).toBe("Feature");
    expect(feature.geometry).toEqual({ type: "Point", coordinates: [-123.61, 41.29] });
    expect(feature.properties.road).toBe("SR-169");
    expect(feature.properties.location).toBeUndefined();

    const [geo] = await admin`
      select ST_AsText(geom) as wkt from board_records where id = ${feature.id as string}`;
    expect(geo!.wkt).toBe("POINT(-123.61 41.29)");
  });

  it("bbox filtering returns only features inside the envelope", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(memberToken),
      payload: {
        road: "I-5",
        reason: "Distant closure",
        status: "closed",
        location: { type: "Point", coordinates: [-120.0, 38.0] },
      },
    });
    const all = await app.inject({
      method: "GET",
      url: `/api/v1/ogc/collections/${boardId}/items`,
      headers: auth(memberToken),
    });
    expect(all.json().numberReturned).toBe(2);
    const boxed = await app.inject({
      method: "GET",
      url: `/api/v1/ogc/collections/${boardId}/items?bbox=-124,40,-123,42`,
      headers: auth(memberToken),
    });
    expect(boxed.json().numberReturned).toBe(1);
    expect(boxed.json().features[0].properties.road).toBe("SR-169");
  });

  it("landing, conformance, and collections describe the service", async () => {
    const landing = await app.inject({
      method: "GET",
      url: "/api/v1/ogc",
      headers: auth(memberToken),
    });
    expect(landing.json().links.some((l: { rel: string }) => l.rel === "data")).toBe(true);
    const conf = await app.inject({
      method: "GET",
      url: "/api/v1/ogc/conformance",
      headers: auth(memberToken),
    });
    expect(conf.json().conformsTo.join(" ")).toContain("ogcapi-features-1/1.0/conf/core");
    const collections = await app.inject({
      method: "GET",
      url: "/api/v1/ogc/collections",
      headers: auth(memberToken),
    });
    const ids = collections.json().collections.map((c: { id: string }) => c.id);
    expect(ids).toContain(boardId);
  });

  it("the permission wall holds on the standards surface", async () => {
    await createPerson(admin, {
      email: "geo-out@example.org",
      displayName: "Geo Outsider",
      password: "geo-outsider-pass1",
    });
    const outsiderToken = await tokenFor(app, "geo-out@example.org", "geo-outsider-pass1");
    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/ogc/collections/${boardId}/items`,
      headers: auth(outsiderToken),
    });
    expect(denied.statusCode).toBe(404);
    const empty = await app.inject({
      method: "GET",
      url: "/api/v1/ogc/collections",
      headers: auth(outsiderToken),
    });
    expect(empty.json().collections).toHaveLength(0);
  });
});
