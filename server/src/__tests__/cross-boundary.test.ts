import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The integrated cross-boundary exercise (VEOC-79D): one owner and one partner
 * organization drive a single incident end to end through the pieces built in
 * 79-79C, while a second incident stays isolated and every partner
 * contribution keeps its attribution. Resource coordination and COP/KPI
 * reconciliation across organizations are not exercised here: those records
 * are not incident-scoped yet (a deferred data-model change), so this proves
 * the integrated incident foundation, not whole-system hybrid parity.
 */

let admin: Sql, runtime: Sql, app: FastifyInstance;
let ownerId: string, partnerId: string, partnerPersonId: string;
let ownerToken: string, partnerToken: string;
let incidentA: string, incidentB: string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const areaUrl = (id: string) => `/api/v1/incidents/${id}/operational-area`;

async function login(email: string, password: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(r.statusCode).toBe(200);
  return r.json().accessToken as string;
}
async function activate(name: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${ownerId}/incidents`,
    headers: auth(ownerToken), payload: { templateKey: "daily_ops", name } });
  expect(r.statusCode).toBe(201);
  return r.json().incidentId as string;
}
const reviseArea = (incidentId: string, token: string, revision: number, reason: string) =>
  app.inject({ method: "PUT", url: areaUrl(incidentId), headers: auth(token),
    payload: { expectedRevision: revision, geometry: null, operationalPeriod: null, reason } });

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  ownerId = await createJurisdiction(admin, "valley-city", "Valley City EOC");
  partnerId = await createJurisdiction(admin, "valley-mutual-aid", "Valley Mutual Aid");
  const ownerAdmin = await createPerson(admin, { email: "city@example.org", displayName: "City Admin", password: "owner-good-password" });
  partnerPersonId = await createPerson(admin, { email: "coord@example.org", displayName: "Aid Coordinator", password: "coord-good-password" });
  await addMembership(admin, ownerAdmin, ownerId, "admin");
  await addMembership(admin, partnerPersonId, partnerId, "member");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  ownerToken = await login("city@example.org", "owner-good-password");
  partnerToken = await login("coord@example.org", "coord-good-password");
  incidentA = await activate("Valley Response");
  incidentB = await activate("Separate Flood");
});
afterAll(async () => { await app.close(); await runtime.end(); await admin.end(); });

describe("cross-boundary incident exercise", () => {
  it("runs a shared incident end to end while a second stays isolated and attribution holds", async () => {
    // Owner expands the operational area of incident A.
    expect((await reviseArea(incidentA, ownerToken, 0, "Initial area")).statusCode).toBe(200);

    // Partner has no access to A yet.
    expect((await app.inject({ method: "GET", url: `/api/v1/incidents/${incidentA}`, headers: auth(partnerToken) })).statusCode).toBe(404);

    // Owner grants the partner a coordinator seat on A.
    const grant = await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentA}/participants`,
      headers: auth(ownerToken), payload: { organizationSlug: "valley-mutual-aid", personEmail: "coord@example.org",
        incidentPositionTitle: "Mutual Aid Liaison", role: "coordinator",
        expiresAt: new Date(Date.now() + 60_000).toISOString(), reason: "Joint response" } });
    expect(grant.statusCode).toBe(201);
    const participantId = grant.json().participant.id as string;

    // The partner now reads A but never B (isolation).
    expect((await app.inject({ method: "GET", url: `/api/v1/incidents/${incidentA}`, headers: auth(partnerToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/incidents/${incidentB}`, headers: auth(partnerToken) })).statusCode).toBe(404);

    // The partner revises A's area; the revision is attributed to their org and position.
    const revised = await reviseArea(incidentA, partnerToken, 1, "Partner field assessment");
    expect(revised.statusCode).toBe(200);
    expect(revised.json()).toMatchObject({ homeOrganizationName: "Valley Mutual Aid", incidentPositionTitle: "Mutual Aid Liaison" });

    // The partner onboards a data pack; a fresh dataset is awaiting, not zero.
    const pack = await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentA}/data-packs`,
      headers: auth(partnerToken), payload: { name: "Aid datasets", organizationSlug: "valley-mutual-aid",
        datasets: [{ key: "shelters", name: "Shelters", kind: "geojson", url: "https://example.org/s.json",
          fieldMapping: { title: "properties.name" } }] } });
    expect(pack.statusCode).toBe(201);
    const listed = await app.inject({ method: "GET", url: `/api/v1/incidents/${incidentA}/datasets`, headers: auth(ownerToken) });
    expect(listed.json().datasets[0]).toMatchObject({ organizationName: "Valley Mutual Aid", availability: "awaiting", itemCount: null });

    // The owner publishes the joint operational-period IAP for A.
    const iap = await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentA}/iap`,
      headers: auth(ownerToken), payload: { operationalPeriod: "OP 1" } });
    expect(iap.statusCode).toBe(201);

    // Revoking the partner removes their incident access at once; history stays.
    expect((await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentA}/participants/${participantId}/revoke`,
      headers: auth(ownerToken), payload: { reason: "Assignment ended" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: areaUrl(incidentA), headers: auth(partnerToken) })).statusCode).toBe(404);
    const history = await app.inject({ method: "GET", url: `${areaUrl(incidentA)}/history`, headers: auth(ownerToken) });
    expect(history.json().revisions.some((r: { homeOrganizationName: string | null }) => r.homeOrganizationName === "Valley Mutual Aid")).toBe(true);

    // The owner closes A. B remains open and free of A's partner and datasets.
    expect((await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentA}/close`, headers: auth(ownerToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/incidents/${incidentB}/datasets`, headers: auth(ownerToken) })).json().datasets).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/api/v1/incidents/${incidentB}`, headers: auth(partnerToken) })).statusCode).toBe(404);
  });
});
