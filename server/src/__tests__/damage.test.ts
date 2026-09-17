import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DamageSummary } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { resetIntakeLimits, intakeAllowed } from "../damage/intake-limit.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Damage assessment (VEOC-23, F8/F9): official assessments aggregate to
 * declaration-threshold summaries and export FEMA-shaped documents, and
 * public self-reports cannot move those numbers until a moderator
 * approves them.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let outsiderToken: string;

const THRESHOLDS = { population: 5000, paPerCapitaIndicator: 4.6, iaResidenceThreshold: 3 };

beforeAll(async () => {
  resetIntakeLimits();
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor("member@example.org", "another-good-password");
  const outsiderId = await admin`
    insert into persons (email, display_name, password_hash)
    select 'damage-outsider@example.org', 'Out', password_hash from persons
    where email = 'member@example.org' returning id`;
  void outsiderId;
  outsiderToken = await tokenFor("damage-outsider@example.org", "another-good-password");
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

async function assess(payload: Record<string, unknown>, token = memberToken): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/assessments`,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
  if (res.statusCode !== 201) throw new Error(`assess failed: ${res.body}`);
}

async function summary(): Promise<DamageSummary> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/summary`,
    headers: { authorization: `Bearer ${memberToken}` },
    payload: THRESHOLDS,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as DamageSummary;
}

describe("baseline and official assessment", () => {
  it("imports a baseline and assesses against it, aggregating to a summary", async () => {
    const base = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/baseline`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        rows: [
          {
            parcelId: "APN-001",
            address: "1 River Rd",
            structureType: "single_family",
            replacementValue: 250000,
            location: { lon: -123.61, lat: 41.29 },
          },
          {
            parcelId: "APN-002",
            address: "2 River Rd",
            structureType: "single_family",
            replacementValue: 220000,
          },
        ],
      },
    });
    expect(base.statusCode).toBe(201);
    expect(base.json().imported).toBe(2);

    await assess({
      address: "1 River Rd",
      structureType: "single_family",
      degree: "destroyed",
      insured: false,
      estimatedLoss: 200000,
      location: { lon: -123.61, lat: 41.29 },
    });
    await assess({
      address: "2 River Rd",
      structureType: "single_family",
      degree: "major",
      insured: true,
      estimatedLoss: 90000,
    });
    await assess({
      address: "3 River Rd",
      structureType: "mobile_home",
      degree: "destroyed",
      insured: false,
      estimatedLoss: 60000,
    });

    const s = await summary();
    expect(s.byDegree.destroyed).toBe(2);
    expect(s.byDegree.major).toBe(1);
    expect(s.majorOrWorse).toBe(3);
    expect(s.totalEstimatedLoss).toBe(350000);
    expect(s.uninsuredLoss).toBe(260000);
    expect(s.declaration.iaThresholdMet).toBe(true);
  });

  it("rejects an unknown degree and a non-admin baseline import", async () => {
    const badDegree = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/assessments`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { address: "x", structureType: "single_family", degree: "obliterated", estimatedLoss: 1 },
    });
    expect(badDegree.statusCode).toBe(400);
    const nonAdmin = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/baseline`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { rows: [{ parcelId: "x", address: "x", structureType: "single_family", replacementValue: 1 }] },
    });
    expect(nonAdmin.statusCode).toBe(403);
  });
});

describe("moderated public self-report intake", () => {
  let intakeToken: string;

  it("enables intake and accepts a token-gated public report", async () => {
    const enable = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/intake/enable`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(enable.statusCode).toBe(201);
    intakeToken = enable.json().token as string;

    const report = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/report`,
      headers: { "x-intake-token": intakeToken },
      payload: {
        address: "9 Public St",
        structureType: "single_family",
        degree: "destroyed",
        estimatedLoss: 999999,
        reporterContact: "resident@example.org",
      },
    });
    expect(report.statusCode).toBe(202);

    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/report`,
      headers: { "x-intake-token": "wrong" },
      payload: { address: "x", structureType: "single_family", degree: "minor" },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("does NOT count an unmoderated public report in the summary", async () => {
    const s = await summary();
    // Still the three official assessments; the public destroyed report
    // (loss 999999) has not moved the numbers.
    expect(s.byDegree.destroyed).toBe(2);
    expect(s.totalEstimatedLoss).toBe(350000);
  });

  it("counts the report only after a moderator approves it, and never if rejected", async () => {
    const pending = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/assessments?status=submitted`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    const submitted = pending.json().assessments as Array<{ id: string; source: string }>;
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.source).toBe("public");
    const reportId = submitted[0]!.id;

    const approve = await app.inject({
      method: "POST",
      url: `/api/v1/damage/assessments/${reportId}/moderate`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { decision: "approved" },
    });
    expect(approve.statusCode).toBe(200);

    const s = await summary();
    expect(s.byDegree.destroyed).toBe(3); // now counted
    expect(s.totalEstimatedLoss).toBe(350000 + 999999);

    // Re-moderating a settled report is refused.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/damage/assessments/${reportId}/moderate`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { decision: "rejected" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("throttles a flood of public reports", () => {
    resetIntakeLimits();
    const key = "flood-jurisdiction";
    let accepted = 0;
    for (let i = 0; i < 40; i++) if (intakeAllowed(key)) accepted += 1;
    expect(accepted).toBe(30); // MAX_PER_WINDOW
    expect(intakeAllowed(key)).toBe(false);
  });
});

describe("declaration export and walls", () => {
  it("exports a FEMA-shaped declaration document from the approved numbers", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/declaration`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { ...THRESHOLDS, incident: "Winter Storms 2026" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { summary: DamageSummary; document: string };
    expect(body.summary.byDegree.destroyed).toBe(3);
    expect(body.summary.majorOrWorse).toBe(4); // 3 destroyed + 1 major
    expect(body.document).toContain("Disaster Declaration Support Summary");
    expect(body.document).toContain("Destroyed or major (IA basis): 4");
    expect(body.document).toContain("Yurok Tribe OES");
  });

  it("keeps assessments behind the jurisdiction wall", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/assessments`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
