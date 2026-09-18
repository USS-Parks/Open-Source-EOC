import type { FastifyInstance } from "fastify";
import { cotFromXml, cotToXml, type CotEvent } from "@openeoc/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * CoT/TAK gateway (VEOC-29, ADR-0008): a simulated ATAK track renders on
 * the COP (inbound CoT → feed feature), and a VEOC geo record appears in a
 * TAK fixture server (outbound CoT XML a TAK consumer parses back).
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let memberToken: string;
let adminToken: string;
let boardId: string;

const atakTrack: CotEvent = {
  uid: "ANDROID-EAGLE-1",
  type: "a-f-G-U-C",
  time: "2026-09-18T00:00:00.000Z",
  start: "2026-09-18T00:00:00.000Z",
  stale: "2026-09-18T00:05:00.000Z",
  how: "m-g",
  point: { lat: 41.29, lon: -123.61 },
  callsign: "EAGLE-1",
};

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor("member@example.org", "another-good-password");
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey: "road_closures" },
  });
  boardId = board.json().id as string;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

async function tokenFor(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  return res.json().accessToken as string;
}

describe("inbound: an ATAK track renders on the COP", () => {
  it("ingests a CoT event and lands it as a COP feed feature", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cot/ingest`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { xml: cotToXml(atakTrack) },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { feedId: string; feature: { properties: Record<string, unknown> } };
    expect(body.feature.properties.callsign).toBe("EAGLE-1");

    // It renders on the COP: the feed's items feed carries it as GeoJSON.
    const items = await app.inject({
      method: "GET",
      url: `/api/v1/feeds/${body.feedId}/items`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    const fc = items.json() as {
      features: Array<{ geometry: { coordinates: number[] }; properties: Record<string, unknown> }>;
    };
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry.coordinates).toEqual([-123.61, 41.29]);
    expect(fc.features[0]!.properties._source).toBe("CoT/TAK");
  });
});

describe("outbound: a VEOC geo record appears in TAK", () => {
  it("emits a board record as CoT XML a TAK fixture server parses back", async () => {
    const rec = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        road: "SR-169 at Pecwan",
        reason: "slide",
        status: "closed",
        location: { type: "Point", coordinates: [-123.61, 41.29] },
      },
    });
    const recordId = rec.json().id as string;

    const emitted = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records/${recordId}/cot`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { staleMinutes: 30 },
    });
    expect(emitted.statusCode).toBe(200);
    expect(emitted.headers["content-type"]).toContain("application/xml");

    // The TAK fixture server: parse the emitted CoT and confirm the record
    // is on the wire with its position and identity.
    const onTak = cotFromXml(emitted.body);
    expect(onTak.uid).toBe(recordId);
    expect(onTak.point.lat).toBe(41.29);
    expect(onTak.point.lon).toBe(-123.61);
    expect(onTak.callsign).toBe("SR-169 at Pecwan");
  });

  it("refuses to emit a record with no geometry", async () => {
    const rec = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { road: "SR-96", reason: "flooding", status: "one_lane" },
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records/${rec.json().id as string}/cot`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
