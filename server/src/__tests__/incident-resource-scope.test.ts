import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Incident-scoped resource-request reads (VEOC-79B2): the 213RR list narrows to
 * the selected incident's requests, so the resources surface reconciles with
 * the incident context. Two incidents keep distinct lists, and a request with
 * no incident stays a jurisdiction-wide request rather than being hidden.
 */

let admin: Sql, runtime: Sql, app: FastifyInstance;
let ownerId: string, ownerToken: string;
let incidentA: string, incidentB: string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function activate(name: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${ownerId}/incidents`,
    headers: auth(ownerToken), payload: { templateKey: "daily_ops", name } });
  expect(r.statusCode).toBe(201);
  return r.json().incidentId as string;
}
const submit = (item: string, incidentId?: string) =>
  app.inject({ method: "POST", url: `/api/v1/jurisdictions/${ownerId}/resource-requests`,
    headers: auth(ownerToken),
    payload: { origin: "eoc", item, quantity: 1, ...(incidentId ? { incidentId } : {}) } });
async function listItems(incidentId?: string): Promise<string[]> {
  const q = incidentId ? `?incidentId=${incidentId}` : "";
  const r = await app.inject({ method: "GET",
    url: `/api/v1/jurisdictions/${ownerId}/resource-requests${q}`, headers: auth(ownerToken) });
  expect(r.statusCode).toBe(200);
  return (r.json().requests as { item: string }[]).map((x) => x.item).sort();
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  ownerId = await createJurisdiction(admin, "valley-city", "Valley City EOC");
  const ownerAdmin = await createPerson(admin, { email: "city@example.org", displayName: "City Admin", password: "owner-good-password" });
  await addMembership(admin, ownerAdmin, ownerId, "admin");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login",
    payload: { email: "city@example.org", password: "owner-good-password" } });
  ownerToken = login.json().accessToken as string;
  incidentA = await activate("Valley Response");
  incidentB = await activate("Separate Flood");
});
afterAll(async () => { await app.close(); await runtime.end(); await admin.end(); });

describe("incident-scoped resource requests (VEOC-79B2)", () => {
  it("narrows the 213RR list to the selected incident and keeps unscoped requests visible", async () => {
    expect((await submit("Generators", incidentA)).statusCode).toBe(201);
    expect((await submit("Type 1 crew", incidentA)).statusCode).toBe(201);
    expect((await submit("Cots", incidentB)).statusCode).toBe(201);
    expect((await submit("Standing cache")).statusCode).toBe(201);

    // Scoped to each incident: only that incident's requests, never the other's.
    expect(await listItems(incidentA)).toEqual(["Generators", "Type 1 crew"]);
    expect(await listItems(incidentB)).toEqual(["Cots"]);
    // Unscoped: every request in the jurisdiction, including the standing cache
    // that belongs to no incident.
    expect(await listItems()).toEqual(["Cots", "Generators", "Standing cache", "Type 1 crew"]);
  });
});
