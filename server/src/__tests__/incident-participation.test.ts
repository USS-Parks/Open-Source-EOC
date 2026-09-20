import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { withPerson } from "../db/context.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, type Sql } from "./helpers.js";

let admin: Sql, runtime: Sql, app: FastifyInstance;
let ownerId: string, partnerId: string, outsiderId: string;
let ownerAdminId: string, partnerPersonId: string;
let ownerToken: string, partnerToken: string, viewerToken: string, outsiderToken: string;
let firstIncident: string, secondIncident: string;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const incidentUrl = (id: string) => `/api/v1/incidents/${id}`;
const participantUrl = (id: string) => `${incidentUrl(id)}/participants`;
const areaUrl = (id: string) => `${incidentUrl(id)}/operational-area`;
const expiresAt = () => new Date(Date.now() + 60_000).toISOString();

async function login(email: string, password: string): Promise<string> {
  const result = await app.inject({ method: "POST", url: "/api/v1/auth/login",
    payload: { email, password } });
  expect(result.statusCode).toBe(200);
  return result.json().accessToken as string;
}
async function activate(name: string): Promise<string> {
  const result = await app.inject({ method: "POST",
    url: `/api/v1/jurisdictions/${ownerId}/incidents`, headers: auth(ownerToken),
    payload: { templateKey: "daily_ops", name } });
  expect(result.statusCode).toBe(201);
  return result.json().incidentId as string;
}
async function grant(incidentId: string, personEmail: string, expiry = expiresAt(),
  role: "viewer" | "contributor" | "coordinator" = "coordinator") {
  return app.inject({ method: "POST", url: participantUrl(incidentId), headers: auth(ownerToken),
    payload: { organizationSlug: "valley-mutual-aid", personEmail,
      incidentPositionTitle: "Mutual Aid Liaison", role,
      expiresAt: expiry, reason: "Joint response assignment" } });
}
async function read(id: string, token: string) {
  return app.inject({ method: "GET", url: incidentUrl(id), headers: auth(token) });
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  ownerId = await createJurisdiction(admin, "valley-city", "Valley City EOC");
  partnerId = await createJurisdiction(admin, "valley-mutual-aid", "Valley Mutual Aid");
  outsiderId = await createJurisdiction(admin, "ridge-county", "Ridge County EOC");
  ownerAdminId = await createPerson(admin, { email: "city-admin@example.org",
    displayName: "City Admin", password: "owner-good-password" });
  partnerPersonId = await createPerson(admin, { email: "aid@example.org",
    displayName: "Aid Liaison", password: "partner-good-password" });
  const viewerPersonId = await createPerson(admin, { email: "aid-viewer@example.org",
    displayName: "Aid Viewer", password: "viewer-good-password" });
  const outsiderPersonId = await createPerson(admin, { email: "ridge@example.org",
    displayName: "Ridge Operator", password: "outsider-good-password" });
  await addMembership(admin, ownerAdminId, ownerId, "admin");
  await addMembership(admin, partnerPersonId, partnerId, "member");
  await addMembership(admin, viewerPersonId, partnerId, "viewer");
  await addMembership(admin, outsiderPersonId, outsiderId, "admin");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  ownerToken = await login("city-admin@example.org", "owner-good-password");
  partnerToken = await login("aid@example.org", "partner-good-password");
  viewerToken = await login("aid-viewer@example.org", "viewer-good-password");
  outsiderToken = await login("ridge@example.org", "outsider-good-password");
  firstIncident = await activate("Valley Response");
  secondIncident = await activate("Separate Flood");
});
afterAll(async () => { await app.close(); await runtime.end(); await admin.end(); });

describe("named incident participation", () => {
  it("keeps single and multi-organization incidents isolated, attributed, and revocable", async () => {
    // A single owner organization is valid. No tribal entity is configured or required.
    expect((await read(firstIncident, ownerToken)).json()).toMatchObject({
      canManageParticipation: true, canEditArea: true });
    expect((await app.inject({ method: "GET", url: participantUrl(firstIncident),
      headers: auth(ownerToken) })).json().participants).toEqual([]);
    expect((await read(firstIncident, partnerToken)).statusCode).toBe(404);
    expect((await read(firstIncident, outsiderToken)).statusCode).toBe(404);
    const viewerGrant = await grant(firstIncident, "aid-viewer@example.org", expiresAt(), "viewer");
    expect(viewerGrant.statusCode).toBe(201);
    expect((await read(firstIncident, viewerToken)).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: areaUrl(firstIncident),
      headers: auth(viewerToken), payload: { expectedRevision: 0, geometry: null,
        operationalPeriod: null, reason: "Viewer cannot revise" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: areaUrl(firstIncident),
      headers: auth(partnerToken) })).statusCode).toBe(404);
    expect(await withPerson(runtime, partnerPersonId, (tx) => tx`
      select id from incidents where id = ${firstIncident}`)).toHaveLength(0);

    const wrongHome = await grant(firstIncident, "ridge@example.org");
    expect(wrongHome.statusCode).toBe(403);
    const created = await grant(firstIncident, "aid@example.org");
    expect(created.statusCode).toBe(201);
    const participant = created.json().participant;
    expect(participant).toMatchObject({ incidentId: firstIncident,
      organizationSlug: "valley-mutual-aid", organizationName: "Valley Mutual Aid",
      personId: partnerPersonId, incidentPositionTitle: "Mutual Aid Liaison",
      role: "coordinator", revokedAt: null });
    expect((await read(firstIncident, partnerToken)).json()).toMatchObject({
      canManageParticipation: false, canEditArea: true });
    expect((await read(secondIncident, partnerToken)).statusCode).toBe(404);
    expect((await read(firstIncident, outsiderToken)).statusCode).toBe(404);
    const listed = await app.inject({ method: "GET",
      url: `/api/v1/jurisdictions/${partnerId}/incidents`, headers: auth(partnerToken) });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().incidents.map((i: { id: string }) => i.id)).toEqual([firstIncident]);
    expect((await app.inject({ method: "GET", url: participantUrl(firstIncident),
      headers: auth(partnerToken) })).json().canManageParticipation).toBe(false);
    expect((await app.inject({ method: "POST", url: participantUrl(firstIncident),
      headers: auth(partnerToken), payload: { organizationSlug: "ridge-county",
        personEmail: "ridge@example.org", incidentPositionTitle: "Operator",
        role: "viewer", expiresAt: expiresAt(), reason: "Forged" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `${incidentUrl(firstIncident)}/close`,
      headers: auth(partnerToken) })).statusCode).toBe(403);

    const revised = await app.inject({ method: "PUT", url: areaUrl(firstIncident),
      headers: auth(partnerToken), payload: { expectedRevision: 0, geometry: null,
        operationalPeriod: null, reason: "Partner field assessment" } });
    expect(revised.statusCode).toBe(200);
    expect(revised.json()).toMatchObject({ createdBy: partnerPersonId,
      homeOrganizationName: "Valley Mutual Aid",
      incidentPositionTitle: "Mutual Aid Liaison" });
    await expect(withPerson(runtime, partnerPersonId, (tx) => tx`
      insert into incident_area_revisions
        (incident_id, revision, reason, created_by, home_organization_id,
         incident_position_title, participation_id)
      values (${firstIncident}, 2, 'forged home', ${partnerPersonId},
        ${outsiderId}, 'Mutual Aid Liaison', ${participant.id as string})`)).rejects.toThrow();
    await expect(withPerson(runtime, partnerPersonId, (tx) => tx`
      insert into incident_area_revisions
        (incident_id, revision, reason, created_by, home_organization_id,
         incident_position_title, participation_id)
      values (${secondIncident}, 1, 'wrong incident', ${partnerPersonId},
        ${partnerId}, 'Mutual Aid Liaison', ${participant.id as string})`)).rejects.toThrow();
    await expect(withPerson(runtime, ownerAdminId, (tx) => tx`
      update incident_participants set role = 'viewer' where id = ${participant.id as string}`)).rejects.toThrow();
    await expect(withPerson(runtime, ownerAdminId, (tx) => tx`
      update incident_participants set revoked_at = now(), revoked_by = ${ownerAdminId},
        revoke_reason = null where id = ${participant.id as string}`)).rejects.toThrow();

    const revoked = await app.inject({ method: "POST",
      url: `${participantUrl(firstIncident)}/${participant.id as string}/revoke`,
      headers: auth(ownerToken), payload: { reason: "Assignment ended" } });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().participant.revokedAt).not.toBeNull();
    expect((await read(firstIncident, partnerToken)).statusCode).toBe(404);
    expect(await withPerson(runtime, partnerPersonId, (tx) => tx`
      select id from incidents where id = ${firstIncident}`)).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: `${areaUrl(firstIncident)}/history`,
      headers: auth(ownerToken) })).json().revisions[0]).toMatchObject({
        homeOrganizationName: "Valley Mutual Aid", incidentPositionTitle: "Mutual Aid Liaison" });

    const short = await grant(firstIncident, "aid@example.org",
      new Date(Date.now() + 1_200).toISOString());
    expect(short.statusCode).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect((await read(firstIncident, partnerToken)).statusCode).toBe(404);
    expect(await withPerson(runtime, partnerPersonId, (tx) => tx`
      select id from incidents where id = ${firstIncident}`)).toHaveLength(0);
    expect((await app.inject({ method: "POST",
      url: `${participantUrl(firstIncident)}/${short.json().participant.id as string}/revoke`,
      headers: auth(ownerToken), payload: { reason: "Expired assignment retired" } })).statusCode).toBe(200);
    expect((await grant(firstIncident, "aid@example.org")).statusCode).toBe(201);
  });
});
