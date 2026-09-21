import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DashboardSnapshot } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Incident-scoped dashboard counts (VEOC-79B2): a scoped dashboard counts only
 * the selected incident's records, so a tile and a chart reconcile with that
 * incident's board view. Two concurrent incidents keep distinct totals, and an
 * authorized partner's contribution counts in the incident it was shared to.
 */

let admin: Sql, runtime: Sql, app: FastifyInstance;
let ownerId: string, partnerId: string;
let ownerToken: string, partnerToken: string;
let incidentA: string, incidentB: string;
let dashboardId: string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function login(email: string, password: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(r.statusCode).toBe(200);
  return r.json().accessToken as string;
}
async function activateWildfire(name: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${ownerId}/incidents`,
    headers: auth(ownerToken), payload: { templateKey: "wildfire", name } });
  expect(r.statusCode).toBe(201);
  return r.json().incidentId as string;
}
async function incidentBoard(incidentId: string, templateKey: string): Promise<string> {
  const [row] = await admin`
    select b.id from boards b join incident_boards ib on ib.board_id = b.id
    where ib.incident_id = ${incidentId} and b.template_key = ${templateKey}`;
  return row!.id as string;
}
const postRecord = (boardId: string, token: string, data: Record<string, unknown>, incidentId: string) =>
  app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`,
    headers: auth(token), payload: data });
async function dashboard(incidentId?: string): Promise<DashboardSnapshot> {
  const q = incidentId ? `?incidentId=${incidentId}` : "";
  const r = await app.inject({ method: "GET", url: `/api/v1/dashboards/${dashboardId}/data${q}`, headers: auth(ownerToken) });
  expect(r.statusCode).toBe(200);
  return r.json() as DashboardSnapshot;
}
async function scopedRecordCount(boardId: string, incidentId: string): Promise<number> {
  const r = await app.inject({ method: "GET",
    url: `/api/v1/boards/${boardId}/views/all?incidentId=${incidentId}`, headers: auth(ownerToken) });
  expect(r.statusCode).toBe(200);
  return (r.json().records as unknown[]).length;
}
function widget<T>(snap: DashboardSnapshot, key: string): T {
  const found = snap.widgets.find((w) => w.key === key);
  expect(found, key).toBeDefined();
  return found as T;
}
interface Tile { value: number }
interface Chart { groups: { value: string; count: number }[] }
const chartTotal = (c: Chart) => c.groups.reduce((s, g) => s + g.count, 0);
const shelter = (name: string, status: string) => ({ name, status, capacity: 100, occupancy: 20 });

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  ownerId = await createJurisdiction(admin, "valley-city", "Valley City EOC");
  partnerId = await createJurisdiction(admin, "valley-mutual-aid", "Valley Mutual Aid");
  const ownerAdmin = await createPerson(admin, { email: "city@example.org", displayName: "City Admin", password: "owner-good-password" });
  const partnerPerson = await createPerson(admin, { email: "coord@example.org", displayName: "Coordinator", password: "coord-good-password" });
  await addMembership(admin, ownerAdmin, ownerId, "admin");
  await addMembership(admin, partnerPerson, partnerId, "member");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await ensureStandardDashboards(admin);
  app = buildApp(runtime, { oidc: null });
  ownerToken = await login("city@example.org", "owner-good-password");
  partnerToken = await login("coord@example.org", "coord-good-password");
  incidentA = await activateWildfire("Ridge Fire");
  incidentB = await activateWildfire("Canyon Fire");
  const dash = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${ownerId}/dashboards`,
    headers: auth(ownerToken), payload: { templateKey: "eoc_status" } });
  expect(dash.statusCode).toBe(201);
  dashboardId = dash.json().id as string;
});
afterAll(async () => { await app.close(); await runtime.end(); await admin.end(); });

describe("incident-scoped dashboard counts (VEOC-79B2)", () => {
  it("scopes tiles and charts to the incident, reconciles totals, and isolates", async () => {
    const sheltersA = await incidentBoard(incidentA, "shelters");
    const roadsA = await incidentBoard(incidentA, "road_closures");
    const sheltersB = await incidentBoard(incidentB, "shelters");

    // Incident A: two operating shelters and one closed; two roads closed and
    // one reopened. Every record is tagged to incident A.
    for (const s of [shelter("Valley Gym", "normal"), shelter("Ridge Hall", "normal"), shelter("Old School", "closed")]) {
      expect((await postRecord(sheltersA, ownerToken, s, incidentA)).statusCode).toBe(201);
    }
    for (const [road, status] of [["SR-1", "closed"], ["SR-2", "closed"], ["US-101", "reopened"]] as const) {
      expect((await postRecord(roadsA, ownerToken, { road, reason: "fire", status }, incidentA)).statusCode).toBe(201);
    }

    // A partner joins incident A and contributes one more operating shelter; it
    // must count in incident A's totals like any authorized contribution.
    expect((await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentA}/participants`,
      headers: auth(ownerToken), payload: { organizationSlug: "valley-mutual-aid", personEmail: "coord@example.org",
        incidentPositionTitle: "Mutual Aid Liaison", role: "coordinator",
        expiresAt: new Date(Date.now() + 60_000).toISOString(), reason: "Joint response" } })).statusCode).toBe(201);
    expect((await postRecord(sheltersA, partnerToken, shelter("Mutual Aid Post", "normal"), incidentA)).statusCode).toBe(201);

    // Incident B: a single operating shelter, no road closures.
    expect((await postRecord(sheltersB, ownerToken, shelter("Canyon Center", "normal"), incidentB)).statusCode).toBe(201);

    // Scoped to A: four shelters (three owner + one partner), two closed roads.
    // The displayed totals reconcile with incident A's shelter board view.
    const a = await dashboard(incidentA);
    expect(chartTotal(widget<Chart>(a, "shelters_by_status"))).toBe(4);
    expect(widget<Tile>(a, "closed_roads").value).toBe(2);
    expect(await scopedRecordCount(sheltersA, incidentA)).toBe(4);

    // Scoped to B: one shelter, no closed roads. Incident A never leaks in.
    const b = await dashboard(incidentB);
    expect(chartTotal(widget<Chart>(b, "shelters_by_status"))).toBe(1);
    expect(widget<Tile>(b, "closed_roads").value).toBe(0);
    expect(await scopedRecordCount(sheltersB, incidentB)).toBe(1);
  });

  it("rejects a malformed or foreign incidentId instead of widening the counts", async () => {
    const malformed = await app.inject({
      method: "GET",
      url: `/api/v1/dashboards/${dashboardId}/data?incidentId=not-a-uuid`,
      headers: auth(ownerToken),
    });
    expect(malformed.statusCode).toBe(400);

    const foreign = await app.inject({
      method: "GET",
      url: `/api/v1/dashboards/${dashboardId}/data?incidentId=00000000-0000-4000-8000-000000000001`,
      headers: auth(ownerToken),
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error).toBe("incident not found in this jurisdiction");
  });
});
