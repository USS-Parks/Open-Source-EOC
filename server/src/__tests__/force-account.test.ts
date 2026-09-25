import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { equipmentSummaryCsv, laborSummaryCsv, type ForceAccountSummary } from "@openeoc/shared";
import { addMembership, createPerson } from "../auth/service.js";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";

/**
 * FEMA Public Assistance force account (Veoci and air gap VA14). A shift's
 * hours and a pool truck's hours roll into a force account summary that
 * reconciles with its rows, and into a Public Assistance line item. The
 * figures are worked by hand in the comments.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let adminToken: string;
let memberToken: string;
let viewerToken: string;
let incidentId: string;
let otherIncidentId: string;
let truckId: string;
let outsiderId: string;

const ZONE = "America/Los_Angeles";

async function call(token: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  return app.inject({ method, url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as object }) });
}

async function summary(token = memberToken): Promise<ForceAccountSummary> {
  const res = await call(token, "GET", `/api/v1/incidents/${incidentId}/force-account?timeZone=${encodeURIComponent(ZONE)}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  const viewer = await createPerson(admin, { email: "viewer@example.org", displayName: "Vera Viewer", password: "viewer-password-1" });
  await addMembership(admin, viewer, seed.jurisdictionId, "viewer");
  outsiderId = await createPerson(admin, { email: "outside@example.org", displayName: "Otto Outside", password: "outside-password-1" });
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  viewerToken = await tokenFor(app, "viewer@example.org", "viewer-password-1");
  const opened = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, { templateKey: "daily_ops", name: "River Flood" });
  incidentId = opened.json().incidentId as string;
  const other = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, { templateKey: "daily_ops", name: "Other" });
  otherIncidentId = other.json().incidentId as string;
  const [position] = await admin`select id from positions where jurisdiction_id = ${seed.jurisdictionId} limit 1`;
  const positionId = position!.id as string;
  // Pacific daylight time is seven hours behind UTC in September.
  const checkIn = (personId: string, start: string, end: string | null) => admin`
    insert into staff_checkins (jurisdiction_id, incident_id, person_id, position_id, method, checked_in_at, checked_out_at, checked_in_by)
    values (${seed.jurisdictionId}, ${incidentId}, ${personId}, ${positionId}, 'manual', ${start}, ${end}, ${seed.adminId})`;
  const shift = (personId: string, start: string, end: string, incident = incidentId) => admin`
    insert into shifts (jurisdiction_id, incident_id, position_id, person_id, starts_at, ends_at, created_by)
    values (${seed.jurisdictionId}, ${incident}, ${positionId}, ${personId}, ${start}, ${end}, ${seed.adminId})`;
  // The member: 08:00 to 19:30 on the 20th (11.5 hours), and 22:00 on the 21st to 02:00 on the 22nd.
  await checkIn(seed.memberId, "2026-09-20T15:00:00Z", "2026-09-21T02:30:00Z");
  await checkIn(seed.memberId, "2026-09-22T05:00:00Z", "2026-09-22T09:00:00Z");
  // A check-in still open is left out until it closes.
  await checkIn(seed.memberId, "2026-09-24T15:00:00Z", null);
  // The member's shift on the 20th is covered by the check-in; the admin's on the 19th, 09:00 to 13:00, is not.
  await shift(seed.memberId, "2026-09-20T15:00:00Z", "2026-09-21T01:00:00Z");
  await shift(seed.adminId, "2026-09-19T16:00:00Z", "2026-09-19T20:00:00Z");
  // Another incident's shift is not this incident's labor.
  await shift(seed.adminId, "2026-09-18T16:00:00Z", "2026-09-18T20:00:00Z", otherIncidentId);
  const [truck] = await admin`
    insert into resources (jurisdiction_id, name, resource_kind, created_by, updated_by)
    values (${seed.jurisdictionId}, 'Dump truck 12', 'local:dump_truck', ${seed.adminId}, ${seed.adminId}) returning id`;
  truckId = truck!.id as string;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("force account", () => {
  it("reads labor per person per local day from check-ins and uncovered shifts, unrated until rates are set", async () => {
    const s = await summary();
    expect(s.labor.map((row) => [row.personName, row.date, row.regularHours, row.overtimeHours, row.sources])).toEqual([
      ["Admin", "2026-09-19", 4, 0, ["shift"]],
      ["Member", "2026-09-20", 8, 3.5, ["check_in"]],
      ["Member", "2026-09-21", 2, 0, ["check_in"]],
      ["Member", "2026-09-22", 2, 0, ["check_in"]],
    ]);
    expect(s.labor.every((row) => row.costCents === 0)).toBe(true);
    expect(s.unratedPeople.map((person) => person.personName).sort()).toEqual(["Admin", "Member"]);
    expect((await call(viewerToken, "GET", `/api/v1/incidents/${incidentId}/force-account`)).statusCode).toBe(403);
    const badZone = await call(memberToken, "GET", `/api/v1/incidents/${incidentId}/force-account?timeZone=Mars%2FOlympus`);
    expect(badZone.statusCode).toBe(400);
  });

  it("keeps labor rates for administrators to set and writers to read", async () => {
    const rate = { jobTitle: "Road crew lead", hourlyRate: 30, overtimeRate: 45, fringePercent: 25, overtimeFringePercent: 10 };
    expect((await call(memberToken, "PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/pa-labor-rates/${seed.memberId}`, rate)).statusCode).toBe(403);
    const outside = await call(adminToken, "PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/pa-labor-rates/${outsiderId}`, rate);
    expect(outside.statusCode).toBe(400);
    const set = await call(adminToken, "PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/pa-labor-rates/${seed.memberId}`, rate);
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toMatchObject({ personName: "Member", overtimeAfterHours: 8 });
    const own = await call(adminToken, "PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/pa-labor-rates/${seed.adminId}`,
      { jobTitle: "Emergency manager", hourlyRate: 40 });
    expect(own.statusCode, own.body).toBe(200);
    const read = await call(memberToken, "GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/pa-rates`);
    expect(read.json().labor.map((r: { personName: string }) => r.personName)).toEqual(["Admin", "Member"]);
    const hidden = await call(viewerToken, "GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/pa-rates`);
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().labor).toEqual([]);
  });

  it("imports an equipment schedule by cost code and logs pool equipment hours", async () => {
    const rows = [
      { code: "8010", equipment: "Air Compressor", specification: "Air Delivery", capacity: "41 CFM", hp: "to 10", notes: "Hoses included.", unit: "hour", rate: 1.62 },
      { code: "8072", equipment: "Truck, Dump", capacity: "12 CY", unit: "hour", rate: 50 },
    ];
    expect((await call(memberToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/pa-equipment-rates`,
      { edition: "FEMA 2025", source: "fema", rows })).statusCode).toBe(403);
    const first = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/pa-equipment-rates`,
      { edition: "FEMA 2025", source: "fema", rows });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toEqual({ inserted: 2, updated: 0 });
    const again = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/pa-equipment-rates`,
      { edition: "FEMA 2025", source: "fema", rows: [{ ...rows[1], rate: 58.19 }] });
    expect(again.json()).toEqual({ inserted: 0, updated: 1 });
    const twice = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/pa-equipment-rates`,
      { edition: "Local", source: "local", rows: [rows[0], rows[0]] });
    expect(twice.statusCode).toBe(400);

    const log = (body: object) => call(memberToken, "POST", `/api/v1/incidents/${incidentId}/equipment-hours`, body);
    expect((await log({ resourceId: truckId, rateCode: "8072", operatorPersonId: seed.memberId, usedOn: "2026-09-20", quantity: 6 })).statusCode).toBe(201);
    expect((await log({ rateCode: "8010", usedOn: "2026-09-21", quantity: 3, note: "Culvert clearing" })).statusCode).toBe(201);
    const unrated = await log({ rateCode: "9999", usedOn: "2026-09-21", quantity: 1 });
    expect(unrated.statusCode).toBe(201);
    expect((await log({ resourceId: truckId, rateCode: "8072", operatorPersonId: outsiderId, usedOn: "2026-09-20", quantity: 1 })).statusCode).toBe(400);
    expect((await call(viewerToken, "POST", `/api/v1/incidents/${incidentId}/equipment-hours`, { rateCode: "8010", usedOn: "2026-09-21", quantity: 1 })).statusCode).toBe(403);

    const s = await summary();
    expect(s.unratedCodes).toEqual(["9999"]);
    expect(s.equipment.map((row) => [row.resourceName, row.code, row.equipment, row.operatorName, row.quantity, row.rate, row.costCents])).toEqual([
      ["Dump truck 12", "8072", "Truck, Dump", "Member", 6, 58.19, 34914],
      [null, "8010", "Air Compressor", null, 3, 1.62, 486],
      [null, "9999", null, null, 1, null, 0],
    ]);
    const paItem = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/pa-items`, {
      incidentId, applicant: "Yurok Tribe", category: "b_emergency_protective_measures", description: "Flood fight force account",
      estimatedCostCents: 0, percentComplete: 0, status: "submitted",
    });
    expect(paItem.statusCode, paItem.body).toBe(201);
    const refused = await call(memberToken, "POST", `/api/v1/incidents/${incidentId}/force-account/roll-up`, { paItemId: paItem.json().id, timeZone: ZONE });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toContain("a rate for equipment code 9999");
    const removed = s.equipment.find((row) => row.code === "9999")!;
    expect((await call(memberToken, "DELETE", `/api/v1/equipment-hours/${removed.id}`)).statusCode).toBe(204);
  });

  it("rolls a shift's hours and a pool truck's hours into a summary that reconciles, and into a line item", async () => {
    const s = await summary();
    // Member, 20th: 8 h x $30 x 1.25 = $300.00 and 3.5 h x $45 x 1.10 = $173.25. 21st and 22nd: 2 h x $30 x 1.25 = $75.00 each.
    // Admin, 19th, from the shift alone: 4 h x $40 = $160.00. Truck: 6 h x $58.19 = $349.14. Compressor: 3 h x $1.62 = $4.86.
    expect(s.labor.map((row) => [row.date, row.regularCostCents, row.overtimeCostCents, row.costCents])).toEqual([
      ["2026-09-19", 16000, 0, 16000],
      ["2026-09-20", 30000, 17325, 47325],
      ["2026-09-21", 7500, 0, 7500],
      ["2026-09-22", 7500, 0, 7500],
    ]);
    expect(s.totals).toEqual({ regularHours: 16, overtimeHours: 3.5, laborCents: 78325, equipmentCents: 35400, totalCents: 113725 });
    expect(s.totals.laborCents).toBe(s.labor.reduce((sum, row) => sum + row.costCents, 0));
    expect(s.totals.equipmentCents).toBe(s.equipment.reduce((sum, row) => sum + row.costCents, 0));
    expect(s.unratedPeople).toEqual([]);
    expect(s.unratedCodes).toEqual([]);
    // The FEMA-format summaries end on the same totals.
    expect(laborSummaryCsv(s).trimEnd().split("\r\n").at(-1)).toBe("Total,,,,19.50,,,,783.25");
    expect(equipmentSummaryCsv(s).trimEnd().split("\r\n").at(-1)).toBe("Total,,,,,,,,354.00");
    expect(laborSummaryCsv(s)).toContain("Member,Road crew lead,2026-09-20,Overtime,3.50,45.00,4.50,49.50,173.25");

    const [item] = await admin`select id from damage_pa_items where incident_id = ${incidentId}`;
    const elsewhere = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/pa-items`, {
      incidentId: otherIncidentId, applicant: "Yurok Tribe", category: "b_emergency_protective_measures", description: "Other",
      estimatedCostCents: 100, percentComplete: 0, status: "submitted",
    });
    const wrong = await call(memberToken, "POST", `/api/v1/incidents/${incidentId}/force-account/roll-up`, { paItemId: elsewhere.json().id, timeZone: ZONE });
    expect(wrong.statusCode).toBe(409);
    const rolled = await call(memberToken, "POST", `/api/v1/incidents/${incidentId}/force-account/roll-up`, { paItemId: item!.id, timeZone: ZONE });
    expect(rolled.statusCode, rolled.body).toBe(200);
    expect(rolled.json().summary.totals.totalCents).toBe(113725);
    const [stored] = await admin`select estimated_cost_cents, force_account from damage_pa_items where id = ${item!.id as string}`;
    expect(Number(stored!.estimated_cost_cents)).toBe(113725);
    expect(stored!.force_account).toMatchObject({ incidentId, timeZone: ZONE, laborRows: 4, equipmentRows: 2, totals: { totalCents: 113725 } });
    const pa = await call(memberToken, "GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/pa-items`);
    expect(pa.json().totals.byCategory.b_emergency_protective_measures).toBe(1137.25 + 1);
    const audits = await admin`select category from audit_events where incident_id = ${incidentId} and category like 'damage.%' order by seq`;
    expect(audits.map((a) => a.category)).toEqual([
      "damage.equipment_hours.recorded", "damage.equipment_hours.recorded", "damage.equipment_hours.recorded",
      "damage.pa_item.created", "damage.equipment_hours.removed", "damage.pa_item.force_account",
    ]);
  });
});
