import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { reportStatus, statusBoard } from "../facilities/service.js";
import { principalForPerson, type Principal } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Facility status networks (F10): an always-on board with
 * staleness, a "report now" query that fans out and tracks response
 * completeness, and EDXL-HAVE export.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let memberToken: string;
let memberP: Principal;
let hospitalA: string;
let hospitalB: string;
let shelter: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  app = buildApp(runtime, { oidc: null, integrations: ["facilities"] });
  await app.listen({ port: 0, host: "127.0.0.1" });
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  memberP = await principalForPerson(runtime, seed.memberId);
  hospitalA = await facility("Klamath General", "hospital");
  hospitalB = await facility("Requa Regional", "hospital");
  shelter = await facility("Weitchpec Gym", "shelter");
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});


async function facility(name: string, kind: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/facilities`,
    headers: { authorization: `Bearer ${memberToken}` },
    payload: { name, kind, staleAfterSeconds: 3600 },
  });
  return res.json().id as string;
}

async function report(id: string, body: Record<string, unknown>): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/facilities/${id}/status`,
    headers: { authorization: `Bearer ${memberToken}` },
    payload: body,
  });
  if (res.statusCode !== 201) throw new Error(`report failed: ${res.body}`);
}

describe("the always-on status board", () => {
  it("shows current status and flags staleness per facility", async () => {
    await report(hospitalA, {
      operatingStatus: "normal",
      emsTraffic: "accepting",
      beds: [{ bedType: "adult_icu", available: 4, baseline: 12 }],
    });
    // hospitalB reported long ago (stale); write directly with an old time.
    await withPerson(runtime, seed.memberId, (tx) =>
      reportStatus(tx, memberP, hospitalB, { operatingStatus: "compromised", emsTraffic: "divert" }),
    );
    await admin`
      update facility_status_reports set reported_at = now() - interval '2 hours'
      where facility_id = ${hospitalB}`;

    const board = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/facilities/board?kind=hospital`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    const facilities = board.json().facilities as Array<{
      organizationName: string;
      operatingStatus: string;
      stale: boolean;
      beds: unknown[];
    }>;
    expect(facilities).toHaveLength(2);
    const a = facilities.find((f) => f.organizationName === "Klamath General")!;
    const b = facilities.find((f) => f.organizationName === "Requa Regional")!;
    expect(a.operatingStatus).toBe("normal");
    expect(a.stale).toBe(false);
    expect(a.beds).toHaveLength(1);
    expect(b.operatingStatus).toBe("compromised");
    expect(b.stale).toBe(true); // reported 2h ago, window is 1h
    // A never-reported facility (the shelter) reads stale on the full board.
    const full = await withPerson(runtime, seed.memberId, (tx) =>
      statusBoard(tx, memberP, seed.jurisdictionId),
    );
    expect(full.find((f) => f.organizationName === "Weitchpec Gym")!.stale).toBe(true);
    void shelter;
  });
});

describe("event-driven status query", () => {
  it("fans out to a kind, tracks completeness, and closes on report", async () => {
    // Fresh reports so both hospitals are current before the query.
    await report(hospitalB, { operatingStatus: "normal", emsTraffic: "accepting" });

    const launched = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/status-queries`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { prompt: "All hospitals report bed status now", kind: "hospital" },
    });
    expect(launched.statusCode).toBe(201);
    const { id, targets } = launched.json() as { id: string; targets: number };
    expect(targets).toBe(2); // both hospitals, not the shelter

    const before = await queryState(id);
    expect(before.responded).toBe(0);
    expect(before.complete).toBe(false);
    expect(before.outstanding).toHaveLength(2);

    // One hospital reports: completeness advances, that facility drops off.
    await report(hospitalA, { operatingStatus: "normal", emsTraffic: "accepting" });
    const mid = await queryState(id);
    expect(mid.responded).toBe(1);
    expect(mid.outstanding.map((o) => o.name)).toEqual(["Requa Regional"]);

    // The second reports: the query is complete.
    await report(hospitalB, { operatingStatus: "normal", emsTraffic: "conditional" });
    const done = await queryState(id);
    expect(done.responded).toBe(2);
    expect(done.complete).toBe(true);
    expect(done.outstanding).toHaveLength(0);
  });

  async function queryState(id: string): Promise<{
    responded: number;
    complete: boolean;
    outstanding: Array<{ name: string }>;
  }> {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/status-queries/${id}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    return res.json();
  }
});

describe("EDXL-HAVE export", () => {
  it("exports the current picture as HAVE-shaped XML", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/facilities/have?kind=hospital`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/emergency+xml");
    const xml = res.body;
    expect(xml).toContain('xmlns="urn:oasis:names:tc:emergency:EDXL:HAVE:2.0"');
    expect(xml).toContain("<OrganizationName>Klamath General</OrganizationName>");
    expect(xml).toContain("<FacilityStatus>normal</FacilityStatus>");
    expect(xml).toContain("<EMSTrafficStatus>");
  });
});

describe("the registry on the board", () => {
  it("carries each facility's contact, position and freshness window, and keeps them out of HAVE", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/facilities`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        name: "Orleans Shelter", kind: "shelter", contact: "Site lead 555-0100",
        staleAfterSeconds: 7200, location: { lon: -123.53, lat: 41.3 },
      },
    });
    expect(res.statusCode).toBe(201);
    const board = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/facilities/board?kind=shelter`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    const rows = board.json().facilities as Array<Record<string, unknown>>;
    expect(rows.find((f) => f.organizationName === "Orleans Shelter")).toMatchObject({
      contact: "Site lead 555-0100", location: { lon: -123.53, lat: 41.3 }, staleAfterSeconds: 7200,
    });
    expect(rows.find((f) => f.organizationName === "Weitchpec Gym"))
      .toMatchObject({ contact: null, location: null, staleAfterSeconds: 3600 });
    const have = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/facilities/have?kind=shelter`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(have.body).toContain("<OrganizationName>Orleans Shelter</OrganizationName>");
    expect(have.body).not.toContain("555-0100");
  });
});

describe("editing and removing registry entries, and the list of status requests", () => {
  const inject = (method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${memberToken}` }, ...(payload ? { payload } : {}) });
  const boardNames = async () => ((await inject("GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/facilities/board`))
    .json().facilities as Array<{ organizationName: string }>).map((row) => row.organizationName);

  it("edits a facility's registry fields and clears what the edit leaves empty", async () => {
    const id = await facility("Pecwan Clinic", "clinic");
    const edited = await inject("PATCH", `/api/v1/facilities/${id}`, {
      name: "Pecwan Health Center", kind: "hospital", contact: "Charge nurse 555-0142",
      staleAfterSeconds: 1800, location: { lon: -123.9, lat: 41.4 },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    const board = (await inject("GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/facilities/board`))
      .json().facilities as Array<Record<string, unknown>>;
    expect(board.find((row) => row.organizationId === id)).toMatchObject({
      organizationName: "Pecwan Health Center", facilityKind: "hospital", contact: "Charge nurse 555-0142",
      staleAfterSeconds: 1800, location: { lon: -123.9, lat: 41.4 },
    });
    await inject("PATCH", `/api/v1/facilities/${id}`, {
      name: "Pecwan Health Center", kind: "hospital", contact: null, staleAfterSeconds: 1800, location: null,
    });
    const [row] = await admin`select contact, geom from facilities where id = ${id}`;
    expect(row).toMatchObject({ contact: null, geom: null });
    const [audit] = await admin`select count(*)::int as n from audit_events where category = 'facility.updated' and subject_id = ${id}`;
    expect(audit!.n).toBe(2);
    // A viewer of the jurisdiction reads the registry but cannot change it.
    const viewer = await admin`
      insert into persons (email, display_name, password_hash) values ('facility-viewer@example.org', 'Viewer', 'x') returning id`;
    await admin`insert into jurisdiction_memberships (person_id, jurisdiction_id, role) values (${viewer[0]!.id as string}, ${seed.jurisdictionId}, 'viewer')`;
    const viewerP = await principalForPerson(runtime, viewer[0]!.id as string);
    const { updateFacility } = await import("../facilities/service.js");
    await expect(withPerson(runtime, viewerP.person.id, (tx) => updateFacility(tx, viewerP, id, {
      name: "Renamed", kind: "hospital", contact: null, staleAfterSeconds: 60, location: null,
    }))).rejects.toMatchObject({ status: 403 });
  });

  it("removes a facility from the board and from open requests, and keeps its reports", async () => {
    const id = await facility("Martins Ferry Station", "fire_station");
    await report(id, { operatingStatus: "normal" });
    const launched = (await inject("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/status-queries`,
      { prompt: "Road access check", kind: "fire_station" })).json() as { id: string; targets: number };
    expect(launched.targets).toBeGreaterThan(0);
    const before = (await inject("GET", `/api/v1/status-queries/${launched.id}`)).json() as { outstanding: Array<{ facilityId: string }> };
    expect(before.outstanding.map((f) => f.facilityId)).toContain(id);

    expect((await inject("POST", `/api/v1/facilities/${id}/retire`)).statusCode).toBe(200);
    expect(await boardNames()).not.toContain("Martins Ferry Station");
    const after = (await inject("GET", `/api/v1/status-queries/${launched.id}`)).json() as { outstanding: Array<{ facilityId: string }>; total: number };
    expect(after.outstanding.map((f) => f.facilityId)).not.toContain(id);
    expect((await inject("POST", `/api/v1/facilities/${id}/status`, { operatingStatus: "normal" })).statusCode).toBe(409);
    expect((await inject("POST", `/api/v1/facilities/${id}/retire`)).statusCode).toBe(409);
    const [kept] = await admin`select count(*)::int as n from facility_status_reports where facility_id = ${id}`;
    expect(kept!.n).toBe(1);
    const again = (await inject("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/status-queries`,
      { prompt: "Second check", kind: "fire_station" })).json() as { id: string };
    const targets = await admin`select facility_id from status_query_targets where query_id = ${again.id}`;
    expect(targets.map((t) => t.facility_id)).not.toContain(id);
  });

  it("lists the jurisdiction's status requests newest first with their answers, a page at a time", async () => {
    const first = (await inject("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/status-queries`,
      { prompt: "Generator fuel", kind: "shelter" })).json() as { id: string };
    await report(shelter, { operatingStatus: "normal" });
    const second = (await inject("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/status-queries`,
      { prompt: "Water pressure", kind: "hospital" })).json() as { id: string };
    const listed = (await inject("GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/status-queries`)).json() as {
      queries: Array<{ id: string; prompt: string; total: number; responded: number; complete: boolean; outstanding: Array<{ name: string }> }>;
    };
    const ids = listed.queries.map((q) => q.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    const water = listed.queries.find((q) => q.id === second.id)!;
    const one = (await inject("GET", `/api/v1/status-queries/${second.id}`)).json() as Record<string, unknown>;
    expect(water).toMatchObject({ prompt: "Water pressure", total: one.total, responded: one.responded, complete: one.complete });
    expect(water.outstanding.map((f) => f.name)).toEqual((one.outstanding as Array<{ name: string }>).map((f) => f.name));
    // The gym answered the fuel request with its report.
    expect(listed.queries.find((q) => q.id === first.id)!.outstanding.map((f) => f.name)).not.toContain("Weitchpec Gym");
    const page = (await inject("GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/status-queries?limit=1`)).json() as { queries: Array<{ id: string }>; nextCursor: string };
    expect(page.queries[0]!.id).toBe(second.id);
    const next = (await inject("GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/status-queries?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`))
      .json() as { queries: Array<{ id: string }> };
    expect(next.queries[0]!.id).toBe(first.id);
  });
});
