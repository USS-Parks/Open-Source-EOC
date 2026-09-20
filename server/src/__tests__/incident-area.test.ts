import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { withPerson } from "../db/context.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql, runtime: Sql, app: FastifyInstance;
let jurisdictionId: string, adminId: string, memberId: string, outsiderId: string;
let adminToken: string, memberToken: string, outsiderToken: string;
let incidentOne: string, incidentTwo: string;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const area = (id: string) => `/api/v1/incidents/${id}/operational-area`;
const firstGeometry = { type: "Polygon", coordinates: [[
  [-124.1, 40.1], [-119.1, 40.1], [-119.1, 41.1], [-124.1, 41.1], [-124.1, 40.1],
]] };
const secondGeometry = { type: "Polygon", coordinates: [[
  [-118.2, 34.0], [-117.8, 34.0], [-117.8, 34.3], [-118.2, 34.0],
]] };
const period = { label: "Day shift", startsAt: "2026-09-20T08:00:00-07:00", endsAt: "2026-09-20T20:00:00-07:00" };

async function login(email: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken as string;
}
async function activate(name: string) {
  const res = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    headers: auth(adminToken), payload: { templateKey: "daily_ops", name } });
  expect(res.statusCode).toBe(201);
  return res.json().incidentId as string;
}
async function put(id: string, token: string, body: Record<string, unknown>) {
  return app.inject({ method: "PUT", url: area(id), headers: auth(token), payload: body });
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  ({ jurisdictionId, adminId, memberId } = await seedIdentity(admin));
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  const otherJurisdiction = await createJurisdiction(admin, "other", "Other OES");
  outsiderId = await createPerson(admin, { email: "outsider@example.org", displayName: "Outsider",
    password: "outsider-good-password" });
  await addMembership(admin, outsiderId, otherJurisdiction, "admin");
  app = buildApp(runtime, { oidc: null });
  adminToken = await login("admin@example.org", "correct-horse-battery");
  memberToken = await login("member@example.org", "another-good-password");
  outsiderToken = await login("outsider@example.org", "outsider-good-password");
  incidentOne = await activate("Cross-boundary Fire");
  incidentTwo = await activate("Separate Incident");
});
afterAll(async () => { await app.close(); await runtime.end(); await admin.end(); });

describe("incident operational area", () => {
  it("starts undefined and keeps two incident areas and periods separate", async () => {
    const initial = await app.inject({ method: "GET", url: area(incidentOne), headers: auth(memberToken) });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({ revision: 0, geometry: null, operationalPeriod: null,
      createdBy: null, createdByName: null, positionTitle: null });
    const first = await put(incidentOne, adminToken, { expectedRevision: 0, geometry: firstGeometry,
      operationalPeriod: period, reason: "Fire crossed the county line" });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ revision: 1, geometry: firstGeometry, createdBy: adminId,
      createdByName: "Admin", operationalPeriod: { label: "Day shift" } });
    const second = await put(incidentTwo, adminToken, { expectedRevision: 0, geometry: secondGeometry,
      operationalPeriod: null, reason: "Separate response footprint" });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ revision: 1, geometry: secondGeometry, operationalPeriod: null });
    const one = await app.inject({ method: "GET", url: area(incidentOne), headers: auth(memberToken) });
    expect(one.json().geometry).toEqual(firstGeometry);
    expect(one.json().operationalPeriod.label).toBe("Day shift");
    const audit = await admin`select person_id, position_id, payload from audit_events
      where incident_id = ${incidentOne} and category = 'incident.area.revised'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ person_id: adminId, position_id: null,
      payload: { revision: 1, reason: "Fire crossed the county line" } });
  });

  it("rejects invalid geometry, bad periods, stale writes, and unauthorized actors", async () => {
    const bowtie = { type: "Polygon", coordinates: [[
      [-120, 40], [-119, 41], [-120, 41], [-119, 40], [-120, 40],
    ]] };
    for (const geometry of [bowtie, { type: "Polygon", coordinates: [[
      [-120, 40], [-119, 40], [-119, 41], [-120, 41],
    ]] }]) {
      const result = await put(incidentOne, adminToken, { expectedRevision: 1, geometry,
        operationalPeriod: period, reason: "Invalid shape" });
      expect(result.statusCode).toBe(400);
    }
    const badPeriod = await put(incidentOne, adminToken, { expectedRevision: 1,
      geometry: firstGeometry, operationalPeriod: { ...period, endsAt: period.startsAt }, reason: "Bad time" });
    expect(badPeriod.statusCode).toBe(400);
    const stale = await put(incidentOne, adminToken, { expectedRevision: 0,
      geometry: null, operationalPeriod: null, reason: "Stale" });
    expect(stale.statusCode).toBe(409);
    const member = await put(incidentOne, memberToken, { expectedRevision: 1,
      geometry: null, operationalPeriod: null, reason: "Unauthorized" });
    expect(member.statusCode).toBe(403);
    const outsideRead = await app.inject({ method: "GET", url: area(incidentOne), headers: auth(outsiderToken) });
    expect(outsideRead.statusCode).toBe(404);
    const outsideHistory = await app.inject({ method: "GET", url: `${area(incidentOne)}/history`,
      headers: auth(outsiderToken) });
    expect(outsideHistory.statusCode).toBe(404);
    const outsideWrite = await put(incidentOne, outsiderToken, { expectedRevision: 1,
      geometry: null, operationalPeriod: null, reason: "Unauthorized" });
    expect(outsideWrite.statusCode).toBe(404);
    const badCursor = await app.inject({ method: "GET",
      url: `${area(incidentOne)}/history?beforeRevision=2147483648`, headers: auth(adminToken) });
    expect(badCursor.statusCode).toBe(400);
    const badId = await app.inject({ method: "GET",
      url: "/api/v1/incidents/not-a-uuid/operational-area", headers: auth(adminToken) });
    expect(badId.statusCode).toBe(400);
    expect((await admin`select count(*)::integer as n from incident_area_revisions
      where incident_id = ${incidentOne}`)[0]!.n).toBe(1);
  });

  it("serializes competing changes and retains attributed, immutable history", async () => {
    const [a, b] = await Promise.all([
      put(incidentOne, adminToken, { expectedRevision: 1, geometry: null,
        operationalPeriod: period, reason: "Survey pending" }),
      put(incidentOne, adminToken, { expectedRevision: 1, geometry: firstGeometry,
        operationalPeriod: null, reason: "New period pending" }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const current = await app.inject({ method: "GET", url: area(incidentOne), headers: auth(adminToken) });
    expect(current.json().revision).toBe(2);
    const history = await app.inject({ method: "GET", url: `${area(incidentOne)}/history`,
      headers: auth(memberToken) });
    expect(history.statusCode).toBe(200);
    expect(history.json().revisions.map((r: { revision: number }) => r.revision)).toEqual([2, 1]);
    const page = await app.inject({ method: "GET", url: `${area(incidentOne)}/history?beforeRevision=2`,
      headers: auth(memberToken) });
    expect(page.json().revisions.map((r: { revision: number }) => r.revision)).toEqual([1]);
    expect((await app.inject({ method: "GET", url: `${area(incidentTwo)}/history`,
      headers: auth(memberToken) })).json().revisions).toHaveLength(1);
    await expect(withPerson(runtime, adminId, (tx) => tx`
      update incident_area_revisions set reason = 'forged' where incident_id = ${incidentOne}`)).rejects.toThrow();
    await expect(admin`delete from incident_area_revisions where incident_id = ${incidentOne}`).rejects.toThrow();
    await expect(withPerson(runtime, adminId, (tx) => tx`
      insert into incident_area_revisions
        (incident_id, revision, reason, created_by)
      values (${incidentOne}, 3, 'forged author', ${memberId})`)).rejects.toThrow();
    await expect(withPerson(runtime, outsiderId, (tx) => tx`
      select * from incident_area_revisions where incident_id = ${incidentOne}`))
      .resolves.toHaveLength(0);
    await expect(withPerson(runtime, outsiderId, (tx) => tx`
      insert into incident_area_revisions
        (incident_id, revision, reason, created_by)
      values (${incidentOne}, 3, 'cross-incident write', ${outsiderId})`)).rejects.toThrow();
  });

  it("attributes a revision to the signed-in position", async () => {
    const [position] = await admin`
      select id from positions where jurisdiction_id = ${jurisdictionId}
        and key = 'operations_section_chief'`;
    const positionId = position!.id as string;
    const assigned = await app.inject({ method: "POST",
      url: `/api/v1/positions/${positionId}/assignments`, headers: auth(adminToken),
      payload: { personId: adminId } });
    expect(assigned.statusCode).toBe(201);
    const signedIn = await app.inject({ method: "POST",
      url: `/api/v1/positions/${positionId}/sign-in`, headers: auth(adminToken) });
    expect(signedIn.statusCode).toBe(200);
    const revised = await put(incidentTwo, adminToken, { expectedRevision: 1,
      geometry: null, operationalPeriod: period, reason: "Day shift assigned" });
    expect(revised.statusCode).toBe(200);
    expect(revised.json()).toMatchObject({ revision: 2, positionId,
      positionTitle: "Operations Section Chief", createdByName: "Admin" });
    const [audit] = await admin`
      select position_id from audit_events where incident_id = ${incidentTwo}
        and category = 'incident.area.revised' order by seq desc limit 1`;
    expect(audit!.position_id).toBe(positionId);
  });

  it("rejects malformed direct database periods and out-of-range geometry", async () => {
    await expect(admin`
      insert into incident_area_revisions
        (incident_id, revision, reason, created_by, period_label, period_starts_at)
      values (${incidentTwo}, 3, 'missing end', ${adminId}, 'Shift', now())`
    ).rejects.toThrow();
    await expect(admin`
      insert into incident_area_revisions
        (incident_id, revision, reason, created_by, geometry)
      values (${incidentTwo}, 3, 'invalid range', ${adminId},
        ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[200,40],[201,40],[201,41],[200,40]]]}'))`
    ).rejects.toThrow();
    expect((await admin`select count(*)::integer as n from incident_area_revisions
      where incident_id = ${incidentTwo}`)[0]!.n).toBe(2);
  });

  it("bounds history pages to 50 revisions", async () => {
    for (let revision = 3; revision <= 51; revision += 1) {
      const result = await put(incidentTwo, adminToken, { expectedRevision: revision - 1,
        geometry: null, operationalPeriod: null, reason: `Shift ${revision}` });
      expect(result.statusCode).toBe(200);
    }
    const first = await app.inject({ method: "GET", url: `${area(incidentTwo)}/history`,
      headers: auth(memberToken) });
    expect(first.json().revisions).toHaveLength(50);
    expect(first.json().revisions[0].revision).toBe(51);
    expect(first.json().revisions[49].revision).toBe(2);
    const next = await app.inject({ method: "GET", url: `${area(incidentTwo)}/history?beforeRevision=2`,
      headers: auth(memberToken) });
    expect(next.json().revisions.map((r: { revision: number }) => r.revision)).toEqual([1]);
  });

  it("refuses revisions after closure without erasing history", async () => {
    const closed = await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentOne}/close`,
      headers: auth(adminToken) });
    expect(closed.statusCode).toBe(200);
    const write = await put(incidentOne, adminToken, { expectedRevision: 2,
      geometry: null, operationalPeriod: null, reason: "Too late" });
    expect(write.statusCode).toBe(409);
    const history = await app.inject({ method: "GET", url: `${area(incidentOne)}/history`,
      headers: auth(memberToken) });
    expect(history.json().revisions).toHaveLength(2);
    await expect(withPerson(runtime, adminId, (tx) => tx`
      insert into incident_area_revisions
        (incident_id, revision, reason, created_by)
      values (${incidentOne}, 3, 'late direct insert', ${adminId})`)).rejects.toThrow();
  });
});
