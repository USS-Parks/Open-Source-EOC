import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Tracking and reunification (F11): a scan tag carries one
 * custody chain across agency handoffs; restricted health/identity is
 * masked to anyone below operational staff; and a reunification query
 * answers whereabouts without exposing restricted fields.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let memberToken: string;
let viewerToken: string;
let outsiderToken: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  // A viewer (reunification desk) and an outsider, reusing member's hash.
  const viewerId = await admin`
    insert into persons (email, display_name, password_hash)
    select 'viewer@example.org', 'Reunification Desk', password_hash from persons
    where email = 'member@example.org' returning id`;
  await admin`
    insert into jurisdiction_memberships (person_id, jurisdiction_id, role)
    values (${viewerId[0]!.id as string}, ${seed.jurisdictionId}, 'viewer')`;
  await admin`
    insert into persons (email, display_name, password_hash)
    select 'tracking-outsider@example.org', 'Out', password_hash from persons
    where email = 'member@example.org'`;

  app = buildApp(runtime, { oidc: null, integrations: ["tracking"] });
  await app.listen({ port: 0, host: "127.0.0.1" });
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  viewerToken = await tokenFor(app, "viewer@example.org", "another-good-password");
  outsiderToken = await tokenFor(app, "tracking-outsider@example.org", "another-good-password");
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});


async function scan(tag: string, custodyState: string, station: string, agency: string, location?: string): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/tracked-objects/scan`,
    headers: { authorization: `Bearer ${memberToken}` },
    payload: { tag, custodyState, station, agency, ...(location ? { location } : {}) },
  });
  if (res.statusCode !== 201) throw new Error(`scan failed: ${res.body}`);
}

describe("a continuous custody chain across agency handoffs", () => {
  let objectId: string;
  let tag: string;

  it("registers a patient and appends field, transport, shelter, and discharge scans", async () => {
    const reg = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/tracked-objects`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        kind: "patient",
        label: "Adult male, blue jacket",
        restricted: { fullName: "John Doe", triage: "immediate", condition: "compound fracture" },
        station: "Field IC",
        agency: "Fire",
        location: "Milepost 12",
      },
    });
    expect(reg.statusCode).toBe(201);
    objectId = reg.json().id as string;
    tag = reg.json().tag as string;

    await scan(tag, "in_transit", "Ambulance 3", "EMS", "en route");
    await scan(tag, "at_receiving_facility", "County Hospital", "Health", "ED bay 2");
    await scan(tag, "at_shelter", "Weitchpec Gym", "Red Cross", "cot 14");
    await scan(tag, "discharged", "Weitchpec Gym", "Red Cross", "released to family");

    const obj = await app.inject({
      method: "GET",
      url: `/api/v1/tracked-objects/${objectId}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    const view = obj.json() as {
      chain: Array<{ custodyState: string; agency: string | null }>;
      restricted?: Record<string, unknown>;
      restrictedRedacted: boolean;
    };
    // One continuous chain: registered + four handoffs, in order, across agencies.
    expect(view.chain.map((e) => e.custodyState)).toEqual([
      "registered",
      "in_transit",
      "at_receiving_facility",
      "at_shelter",
      "discharged",
    ]);
    expect(view.chain.map((e) => e.agency)).toEqual([
      "Fire",
      "EMS",
      "Health",
      "Red Cross",
      "Red Cross",
    ]);
    // Operational staff see the restricted details.
    expect(view.restrictedRedacted).toBe(false);
    expect(view.restricted?.condition).toBe("compound fracture");
  });

  it("masks restricted details from a viewer (need-to-know)", async () => {
    const obj = await app.inject({
      method: "GET",
      url: `/api/v1/tracked-objects/${objectId}`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    const view = obj.json() as { restricted?: Record<string, unknown>; restrictedRedacted: boolean; chain: unknown[] };
    expect(view.restrictedRedacted).toBe(true);
    expect(view.restricted).toBeUndefined();
    // The viewer still sees the chain (whereabouts), just not the health data.
    expect(view.chain).toHaveLength(5);
  });

  it("answers a reunification query with location but never restricted fields", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/reunification?tag=${encodeURIComponent(tag)}`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const answers = res.json().answers as Array<{
      tag: string;
      label: string;
      latest: { custodyState: string; location: string | null } | null;
    }>;
    expect(answers).toHaveLength(1);
    expect(answers[0]!.latest?.custodyState).toBe("discharged");
    expect(answers[0]!.latest?.location).toBe("released to family");
    // No restricted data anywhere in the reunification payload.
    expect(JSON.stringify(answers)).not.toContain("John Doe");
    expect(JSON.stringify(answers)).not.toContain("compound fracture");
  });

  it("finds an object by a label search for reunification", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/reunification?label=blue%20jacket`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    const answers = res.json().answers as Array<{ tag: string }>;
    expect(answers.map((a) => a.tag)).toContain(tag);
  });
});

describe("walls and validation", () => {
  it("refuses unknown kinds, states, tags, and outsiders", async () => {
    const badKind = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/tracked-objects`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { kind: "spaceship", label: "x" },
    });
    expect(badKind.statusCode).toBe(400);

    const badScan = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/tracked-objects/scan`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { tag: "TRK-NOPE", custodyState: "in_transit" },
    });
    expect(badScan.statusCode).toBe(404);

    const outsider = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/reunification?label=jacket`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(outsider.statusCode).toBe(403);
  });

  it("does not let a viewer register or scan (read-only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/tracked-objects`,
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { kind: "asset", label: "generator" },
    });
    expect(res.statusCode).toBe(403);
  });
});
