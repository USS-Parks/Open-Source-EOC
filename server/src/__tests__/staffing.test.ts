import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Staffing (VEOC-24): check-in bound to positions feeds the activity log,
 * scan check-in reconciles when replayed offline, shift scheduling
 * refuses overlaps, and the staffing summary shows on-duty, vacancies,
 * and upcoming coverage live.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let opsPositionId: string;
let planPositionId: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor("member@example.org", "another-good-password");
  opsPositionId = await makePosition("operations_section_chief", "Operations Section Chief");
  planPositionId = await makePosition("planning_section_chief", "Planning Section Chief");
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

async function makePosition(key: string, title: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { key, title },
  });
  return res.json().id as string;
}

async function staffing(): Promise<{
  onDuty: Array<{ personId: string; positionTitle: string; method: string }>;
  vacantPositions: Array<{ title: string }>;
  upcomingShifts: Array<{ positionTitle: string; personName: string | null }>;
}> {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/staffing`,
    headers: { authorization: `Bearer ${memberToken}` },
  });
  return res.json();
}

describe("check-in and the staffing picture", () => {
  it("checks a member in, shows them on duty, and leaves other positions vacant", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/checkins`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { personId: seed.memberId, positionId: opsPositionId },
    });
    expect(res.statusCode).toBe(201);

    const s = await staffing();
    expect(s.onDuty).toHaveLength(1);
    expect(s.onDuty[0]!.positionTitle).toBe("Operations Section Chief");
    expect(s.vacantPositions.map((p) => p.title)).toContain("Planning Section Chief");
    expect(s.vacantPositions.map((p) => p.title)).not.toContain("Operations Section Chief");

    // The check-in fed the activity log.
    const [audit] = await admin`
      select category from audit_events where category = 'staff.checkin'`;
    expect(audit).toBeTruthy();
  });

  it("checks out, returning the position to vacant", async () => {
    const before = await staffing();
    const checkinId = (await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/staffing`,
      headers: { authorization: `Bearer ${memberToken}` },
    }).then((r) => r.json())).onDuty[0].checkinId as string;
    void before;

    const out = await app.inject({
      method: "POST",
      url: `/api/v1/checkins/${checkinId}/checkout`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(out.statusCode).toBe(200);
    const s = await staffing();
    expect(s.onDuty).toHaveLength(0);
    expect(s.vacantPositions.map((p) => p.title)).toContain("Operations Section Chief");
  });
});

describe("badge scan check-in reconciles offline", () => {
  it("scans a badge to check in, and a replayed scan lands exactly once", async () => {
    const badge = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/badges`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { personId: seed.memberId, label: "M-1" },
    });
    expect(badge.statusCode).toBe(201);
    const badgeToken = badge.json().token as string;

    // A field station queues a scan offline with a stable client id, then
    // replays it on reconnect. Both calls must resolve to one check-in.
    const clientCheckinId = randomUUID();
    const scan = () =>
      app.inject({
        method: "POST",
        url: `/api/v1/jurisdictions/${seed.jurisdictionId}/checkins/scan`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { badgeToken, positionId: planPositionId, clientCheckinId },
      });
    const first = await scan();
    const second = await scan();
    expect(first.statusCode).toBe(201);
    expect(first.json().personId).toBe(seed.memberId);
    expect(second.json().deduplicated).toBe(true);
    expect(second.json().id).toBe(first.json().id);

    const [row] = await admin`
      select count(*)::int as n from staff_checkins where client_checkin_id = ${clientCheckinId}`;
    expect(row!.n).toBe(1);

    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/checkins/scan`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { badgeToken: "not-a-badge", positionId: planPositionId },
    });
    expect(bad.statusCode).toBe(401);
  });
});

describe("shift scheduling", () => {
  it("schedules coverage and refuses an overlapping shift for the same position", async () => {
    const shift = (startsAt: string, endsAt: string, personId?: string) =>
      app.inject({
        method: "POST",
        url: `/api/v1/jurisdictions/${seed.jurisdictionId}/shifts`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { positionId: opsPositionId, startsAt, endsAt, ...(personId ? { personId } : {}) },
      });
    const a = await shift("2026-09-18T00:00:00Z", "2026-09-18T12:00:00Z", seed.memberId);
    expect(a.statusCode).toBe(201);

    const overlap = await shift("2026-09-18T06:00:00Z", "2026-09-18T18:00:00Z");
    expect(overlap.statusCode).toBe(409);

    // A back-to-back shift (no overlap) is fine.
    const next = await shift("2026-09-18T12:00:00Z", "2026-09-19T00:00:00Z");
    expect(next.statusCode).toBe(201);

    // Same person double-booked on a different position is refused too.
    const clashPerson = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/shifts`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        positionId: planPositionId,
        personId: seed.memberId,
        startsAt: "2026-09-18T06:00:00Z",
        endsAt: "2026-09-18T10:00:00Z",
      },
    });
    expect(clashPerson.statusCode).toBe(409);
  });

  it("rejects a shift that ends before it starts", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/shifts`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        positionId: planPositionId,
        startsAt: "2026-09-18T12:00:00Z",
        endsAt: "2026-09-18T08:00:00Z",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
