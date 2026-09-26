import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VolunteerRoster } from "@openeoc/shared";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";

/**
 * Volunteer and CERT roster (Veoci and air gap VA28). Staff enter volunteers
 * with credentials and contacts; viewers read them without the contacts; a
 * partner organization on an incident enters and reads only its own; hours
 * per volunteer per day reconcile with the deployments they come from. The
 * figures are worked by hand in the comments.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let adminToken: string;
let memberToken: string;
let viewerToken: string;
let partnerToken: string;
let partnerViewerToken: string;
let viewerId: string;
let incidentId: string;
let otherIncidentId: string;
let anaId: string;
let benId: string;

const ZONE = "America/Los_Angeles";
const ana = {
  name: "Ana Reyes",
  affiliation: "cert",
  affiliationName: "Klamath CERT",
  phone: "707-555-0101",
  email: "ana.reyes@example.org",
  skills: ["First aid", "Radio"],
  credentials: [
    { name: "CERT Basic Training", issuer: "Klamath OES", issuedOn: "2024-01-10", expiresOn: null },
    { name: "CPR", issuer: "Red Cross", issuedOn: "2018-03-01", expiresOn: "2020-03-01" },
  ],
};

async function call(token: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  return app.inject({ method, url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as object }) });
}

async function roster(token: string, path: string, zone = ZONE): Promise<VolunteerRoster> {
  const res = await call(token, "GET", `${path}/volunteers?timeZone=${encodeURIComponent(zone)}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const incident = (id: string) => `/api/v1/incidents/${id}`;
const jurisdiction = () => `/api/v1/jurisdictions/${seed.jurisdictionId}`;

async function deploy(token: string, volunteerId: string, body: Record<string, unknown>) {
  return call(token, "POST", `/api/v1/volunteers/${volunteerId}/deployments`, { incidentId, ...body });
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  viewerId = await createPerson(admin, { email: "viewer@example.org", displayName: "Vera Viewer", password: "viewer-password-1" });
  await addMembership(admin, viewerId, seed.jurisdictionId, "viewer");
  const cert = await createJurisdiction(admin, "valley-cert", "Valley CERT");
  const partner = await createPerson(admin, { email: "lead@valley-cert.example.org", displayName: "Paula Partner", password: "partner-password-1" });
  const partnerViewer = await createPerson(admin, { email: "watch@valley-cert.example.org", displayName: "Pat Watcher", password: "partner-password-2" });
  await addMembership(admin, partner, cert, "member");
  await addMembership(admin, partnerViewer, cert, "member");
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  viewerToken = await tokenFor(app, "viewer@example.org", "viewer-password-1");
  partnerToken = await tokenFor(app, "lead@valley-cert.example.org", "partner-password-1");
  partnerViewerToken = await tokenFor(app, "watch@valley-cert.example.org", "partner-password-2");
  const opened = await call(adminToken, "POST", `${jurisdiction()}/incidents`, { templateKey: "daily_ops", name: "River Flood" });
  incidentId = opened.json().incidentId as string;
  const other = await call(adminToken, "POST", `${jurisdiction()}/incidents`, { templateKey: "daily_ops", name: "Other" });
  otherIncidentId = other.json().incidentId as string;
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
  for (const [personEmail, role] of [["lead@valley-cert.example.org", "contributor"], ["watch@valley-cert.example.org", "viewer"]]) {
    const granted = await call(adminToken, "POST", `${incident(incidentId)}/participants`, {
      organizationSlug: "valley-cert", personEmail, incidentPositionTitle: "CERT Coordinator", role, expiresAt, reason: "CERT support for the flood",
    });
    expect(granted.statusCode, granted.body).toBe(201);
  }
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("volunteer and CERT roster", () => {
  it("keeps the roster for the jurisdiction's staff, and shows contacts to writers only", async () => {
    expect((await call(viewerToken, "POST", `${jurisdiction()}/volunteers`, ana)).statusCode).toBe(403);
    const created = await call(memberToken, "POST", `${jurisdiction()}/volunteers`, ana);
    expect(created.statusCode, created.body).toBe(201);
    anaId = created.json().id as string;

    const staff = await roster(adminToken, jurisdiction());
    expect(staff).toMatchObject({ entry: "jurisdiction", canSeeContacts: true, incidentId: null, timeZone: ZONE });
    const [entry] = staff.volunteers;
    expect(entry).toMatchObject({
      name: "Ana Reyes", affiliation: "cert", affiliationName: "Klamath CERT", skills: ["First aid", "Radio"],
      contact: { phone: "707-555-0101", email: "ana.reyes@example.org" }, enteredBy: null, active: true,
    });
    expect(entry!.credentials.map((c) => [c.name, c.expired])).toEqual([["CERT Basic Training", false], ["CPR", true]]);

    // A viewer reads the roster and the credentials, not how to reach anyone; the database holds the same line.
    const viewed = await roster(viewerToken, jurisdiction());
    expect(viewed).toMatchObject({ entry: null, canSeeContacts: false });
    expect(viewed.volunteers[0]!.contact).toBeNull();
    expect(viewed.volunteers[0]!.credentials).toHaveLength(2);
    expect(await withPerson(runtime, viewerId, (tx) => tx`select * from volunteer_contacts`)).toHaveLength(0);
    expect(await withPerson(runtime, seed.memberId, (tx) => tx`select * from volunteer_contacts`)).toHaveLength(1);
    // A guest, whatever its grant, reads no part of the roster.
    const guestId = await createPerson(admin, { email: "guest@example.org", displayName: "Gus Guest", password: "guest-password-1" });
    await admin`
      insert into guest_grants (person_id, jurisdiction_id, scopes, expires_at, created_by)
      values (${guestId}, ${seed.jurisdictionId}, ${["dashboards:read"]}, now() + interval '1 day', ${seed.adminId})`;
    const guestToken = await tokenFor(app, "guest@example.org", "guest-password-1");
    expect((await call(guestToken, "GET", `${jurisdiction()}/volunteers`)).statusCode).toBe(403);
    expect((await call(guestToken, "GET", `${incident(incidentId)}/volunteers`)).statusCode).toBe(404);
    expect(await withPerson(runtime, guestId, (tx) => tx`select id from volunteers`)).toHaveLength(0);
    expect(await withPerson(runtime, guestId, (tx) => tx`select * from volunteer_contacts`)).toHaveLength(0);

    // The chronology, which viewers read, keeps the entry but not the contact.
    const audits = await admin`select payload from audit_events where category = 'volunteer.saved' and subject_id = ${anaId}`;
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.payload)).not.toMatch(/707-555|ana\.reyes@/);

    const bad = async (body: unknown) => (await call(memberToken, "POST", `${jurisdiction()}/volunteers`, body)).statusCode;
    expect(await bad({ ...ana, credentials: [{ name: "CPR", expiresOn: "2026-02-30" }] })).toBe(400);
    expect(await bad({ ...ana, credentials: [{ name: "CPR", issuedOn: "2026-05-01", expiresOn: "2026-04-01" }] })).toBe(400);
    expect(await bad({ ...ana, credentials: [{ name: "CPR" }, { name: " cpr " }] })).toBe(400);
    expect(await bad({ ...ana, email: "not an address" })).toBe(400);
    expect((await call(memberToken, "GET", `${jurisdiction()}/volunteers?timeZone=%2B05%3A30`)).statusCode).toBe(400);
  });

  it("lets a partner organization on an incident enter and read only its own volunteers", async () => {
    const ben = { name: "Ben Ortiz", affiliation: "partner", affiliationName: "Valley CERT", phone: "707-555-0199", credentials: [{ name: "CPR", expiresOn: "2099-12-31" }] };
    // The jurisdiction's staff add to its roster, not to one incident; a partner is not staff.
    expect((await call(memberToken, "POST", `${incident(incidentId)}/volunteers`, ben)).statusCode).toBe(403);
    expect((await call(partnerToken, "POST", `${jurisdiction()}/volunteers`, ben)).statusCode).toBe(403);
    expect((await call(partnerToken, "GET", `${jurisdiction()}/volunteers`)).statusCode).toBe(403);
    expect((await call(partnerViewerToken, "POST", `${incident(incidentId)}/volunteers`, ben)).statusCode).toBe(403);
    const created = await call(partnerToken, "POST", `${incident(incidentId)}/volunteers`, ben);
    expect(created.statusCode, created.body).toBe(201);
    benId = created.json().id as string;
    const edited = await call(partnerToken, "PUT", `/api/v1/volunteers/${benId}`, { ...ben, skills: ["Traffic control"] });
    expect(edited.statusCode, edited.body).toBe(200);
    expect((await call(partnerViewerToken, "PUT", `/api/v1/volunteers/${benId}`, ben)).statusCode).toBe(403);

    const own = await roster(partnerToken, incident(incidentId));
    expect(own.volunteers[0]!.skills).toEqual(["Traffic control"]);
    expect(own).toMatchObject({ entry: "organization", canSeeContacts: true, incidentId });
    expect(own.volunteers.map((v) => [v.name, v.contact?.phone, v.enteredBy?.organizationName])).toEqual([["Ben Ortiz", "707-555-0199", "Valley CERT"]]);
    const watched = await roster(partnerViewerToken, incident(incidentId));
    expect(watched).toMatchObject({ entry: null, canSeeContacts: false });
    expect(watched.volunteers.map((v) => [v.name, v.contact])).toEqual([["Ben Ortiz", null]]);

    // The partner cannot reach the jurisdiction's own entries.
    expect((await call(partnerToken, "PUT", `/api/v1/volunteers/${anaId}`, ana)).statusCode).toBe(404);
    expect((await deploy(partnerToken, anaId, { role: "Runner", startsAt: "2026-09-20T16:00:00Z" })).statusCode).toBe(404);
    // Its volunteer serves only on the incident it was entered for.
    const elsewhere = await call(partnerToken, "POST", `/api/v1/volunteers/${benId}/deployments`,
      { incidentId: otherIncidentId, role: "Runner", startsAt: "2026-09-20T16:00:00Z" });
    expect(elsewhere.statusCode).toBe(400);
    expect((await call(memberToken, "POST", `/api/v1/volunteers/${benId}/deployments`,
      { incidentId: otherIncidentId, role: "Runner", startsAt: "2026-09-20T16:00:00Z" })).statusCode).toBe(400);

    // Staff read the partner's entry, contact included, on the whole roster.
    const staff = await roster(memberToken, jurisdiction());
    expect(staff.volunteers.map((v) => [v.name, v.enteredBy?.organizationName ?? null, v.contact?.phone])).toEqual([
      ["Ana Reyes", null, "707-555-0101"], ["Ben Ortiz", "Valley CERT", "707-555-0199"],
    ]);
    const [partnerAudit] = await admin`
      select jurisdiction_id, incident_id, payload from audit_events where category = 'volunteer.saved' and subject_id = ${benId}`;
    expect(partnerAudit).toMatchObject({ jurisdiction_id: seed.jurisdictionId, incident_id: incidentId });
    expect(JSON.stringify(partnerAudit!.payload)).not.toContain("707-555");
  });

  it("reads hours per volunteer per local day from deployments, merged where they overlap, and warns on credentials", async () => {
    // Pacific daylight time is seven hours behind UTC in September.
    const shelter = await deploy(memberToken, anaId, { role: "Shelter support", startsAt: "2026-09-20T15:00:00Z", endsAt: "2026-09-20T19:00:00Z", needs: ["CPR"] });
    expect(shelter.statusCode, shelter.body).toBe(201);
    // 10:00 to 14:00 overlaps the shelter's 08:00 to 12:00: one stretch of six hours, not eight.
    expect((await deploy(memberToken, anaId, { role: "Radio operator", startsAt: "2026-09-20T17:00:00Z", endsAt: "2026-09-20T21:00:00Z", needs: ["cert basic training"] })).statusCode).toBe(201);
    // 22:00 on the 21st to 02:00 on the 22nd: two hours on each day.
    expect((await deploy(memberToken, anaId, { role: "Night watch", startsAt: "2026-09-22T05:00:00Z", endsAt: "2026-09-22T09:00:00Z", needs: ["Ham license"] })).statusCode).toBe(201);
    // On another incident, 13:00 to 15:00 on the 20th: an hour past the radio shift.
    expect((await call(memberToken, "POST", `/api/v1/volunteers/${anaId}/deployments`,
      { incidentId: otherIncidentId, role: "Sandbags", startsAt: "2026-09-20T20:00:00Z", endsAt: "2026-09-20T22:00:00Z" })).statusCode).toBe(201);
    // Under way since two hours ago, and not counted until it ends.
    const since = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 2 * 3600_000).toISOString();
    const open = await deploy(memberToken, anaId, { role: "Check-in desk", startsAt: since });
    expect(open.statusCode, open.body).toBe(201);
    // The partner deploys its own: 09:00 to 11:30 on the 20th.
    expect((await deploy(partnerToken, benId, { role: "Runner", startsAt: "2026-09-20T16:00:00Z", endsAt: "2026-09-20T18:30:00Z", needs: ["CPR"] })).statusCode).toBe(201);

    expect((await deploy(viewerToken, anaId, { role: "Runner", startsAt: "2026-09-20T16:00:00Z" })).statusCode).toBe(403);
    expect((await deploy(memberToken, anaId, { role: "Runner", startsAt: "2026-09-20T16:00:30Z" })).statusCode).toBe(400);
    expect((await deploy(memberToken, anaId, { role: "Runner", startsAt: "2026-09-20T16:00:00Z", endsAt: "2026-09-20T15:00:00Z" })).statusCode).toBe(400);

    const onIncident = await roster(memberToken, incident(incidentId));
    expect(onIncident.volunteers.map((v) => v.name)).toEqual(["Ana Reyes", "Ben Ortiz"]);
    expect(onIncident.hours.map((h) => [h.volunteerName, h.date, h.minutes])).toEqual([
      ["Ana Reyes", "2026-09-20", 360],
      ["Ben Ortiz", "2026-09-20", 150],
      ["Ana Reyes", "2026-09-21", 120],
      ["Ana Reyes", "2026-09-22", 120],
    ]);
    // Reconciled: Ana's days add up to her merged ended deployments, 08:00 to 14:00 and 22:00 to 02:00.
    const anaMinutes = onIncident.hours.filter((h) => h.volunteerId === anaId).reduce((sum, h) => sum + h.minutes, 0);
    expect(anaMinutes).toBe(6 * 60 + 4 * 60);
    expect(onIncident.underWay.map((u) => [u.volunteerName, u.since])).toEqual([["Ana Reyes", since]]);
    const warnings = Object.fromEntries(onIncident.deployments.map((d) => [d.role, d.warnings]));
    expect(warnings).toEqual({
      "Shelter support": ["CPR expired 2020-03-01"],
      "Radio operator": [],
      "Night watch": ["No Ham license on record"],
      "Check-in desk": [],
      Runner: [],
    });
    expect(onIncident.deployments.every((d) => d.incidentId === incidentId)).toBe(true);

    // Across incidents the sandbags hour joins the 20th: 08:00 to 15:00.
    const whole = await roster(memberToken, jurisdiction());
    expect(whole.hours.filter((h) => h.volunteerId === anaId).map((h) => [h.date, h.minutes]))
      .toEqual([["2026-09-20", 420], ["2026-09-21", 120], ["2026-09-22", 120]]);
    // Cut at UTC midnight instead, the night watch is one day.
    const utc = await roster(memberToken, incident(incidentId), "UTC");
    expect(utc.hours.filter((h) => h.volunteerId === anaId).map((h) => [h.date, h.minutes])).toEqual([["2026-09-20", 360], ["2026-09-22", 240]]);

    // Viewers read the hours; a partner reads only its own volunteer's.
    expect((await roster(viewerToken, incident(incidentId))).hours).toEqual(onIncident.hours);
    const partnerView = await roster(partnerToken, incident(incidentId));
    expect(partnerView.hours.map((h) => [h.volunteerName, h.minutes])).toEqual([["Ben Ortiz", 150]]);
    expect(partnerView.deployments.map((d) => d.role)).toEqual(["Runner"]);

    // Ending the open deployment counts it; removing a deployment takes its hours away.
    const ended = new Date(Date.parse(since) + 90 * 60_000).toISOString();
    const openId = open.json().id as string;
    const end = await call(memberToken, "PUT", `/api/v1/volunteer-deployments/${openId}`, { role: "Check-in desk", startsAt: since, endsAt: ended });
    expect(end.statusCode, end.body).toBe(200);
    const afterEnd = await roster(memberToken, incident(incidentId));
    expect(afterEnd.underWay).toEqual([]);
    expect(afterEnd.hours.filter((h) => h.volunteerId === anaId).reduce((sum, h) => sum + h.minutes, 0)).toBe(anaMinutes + 90);
    expect((await call(partnerToken, "DELETE", `/api/v1/volunteer-deployments/${openId}`)).statusCode).toBe(404);
    expect((await call(memberToken, "DELETE", `/api/v1/volunteer-deployments/${openId}`)).statusCode).toBe(204);
    const [removed] = await admin`select payload from audit_events where category = 'volunteer.deployment.removed'`;
    expect(removed!.payload).toMatchObject({ deploymentId: openId, role: "Check-in desk", startsAt: since, endsAt: ended });

    // An inactive volunteer is not deployed.
    expect((await call(memberToken, "PUT", `/api/v1/volunteers/${anaId}`, { ...ana, active: false })).statusCode).toBe(200);
    expect((await deploy(memberToken, anaId, { role: "Runner", startsAt: "2026-09-20T16:00:00Z" })).statusCode).toBe(409);
  });

  it("ends a partner's reach when its grant is revoked", async () => {
    const participants = await call(adminToken, "GET", `${incident(incidentId)}/participants`);
    const grant = (participants.json().participants as Array<{ id: string; personEmail: string }>)
      .find((p) => p.personEmail === "lead@valley-cert.example.org")!;
    const revoked = await call(adminToken, "POST", `${incident(incidentId)}/participants/${grant.id}/revoke`, { reason: "Demobilized" });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect((await call(partnerToken, "GET", `${incident(incidentId)}/volunteers`)).statusCode).toBe(404);
    expect((await call(partnerToken, "PUT", `/api/v1/volunteers/${benId}`, { name: "Ben Ortiz", affiliation: "partner" })).statusCode).toBe(404);
  });
});
