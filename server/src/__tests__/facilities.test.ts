import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { reportStatus, statusBoard } from "../facilities/service.js";
import { principalForPerson, type Principal } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Facility status networks (VEOC-28, F10): an always-on board with
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
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  memberToken = await tokenFor("member@example.org", "another-good-password");
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

async function tokenFor(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  return res.json().accessToken as string;
}

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
