import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { seedCascadia } from "../demo/cascadia.js";
import { seedDeerhorn } from "../demo/deerhorn.js";
import { seedDelNorte } from "../demo/del-norte.js";
import { NORTH_COAST_PASSWORD, placeOnScenarioClock, seedNorthCoast } from "../demo/north-coast.js";
import { auth } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The demo database as the Windows demo profile builds it: North Coast Storm
 * and the three exercises in one database, each on its own clock, all reached
 * by Jordan Lee's one sign-in.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  await placeOnScenarioClock(admin, await seedNorthCoast(app, admin));
  for (const seed of [seedDeerhorn, seedDelNorte, seedCascadia]) await placeOnScenarioClock(admin, await seed(app, admin));
}, 600_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

it("lists all four exercises for the demo's one sign-in", async () => {
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "jordan.lee@humboldt.example", password: NORTH_COAST_PASSWORD } });
  expect(login.statusCode, login.body).toBe(200);
  const token = login.json().accessToken as string;
  const [humboldt] = await admin`select id from jurisdictions where slug = 'humboldt-oes'`;
  const list = await app.inject({ method: "GET", url: `/api/v1/jurisdictions/${humboldt!.id as string}/incidents`, headers: auth(token) });
  expect(list.statusCode, list.body).toBe(200);
  expect((list.json().incidents as { name: string }[]).map((incident) => incident.name).sort()).toEqual([
    "Cascadia Earthquake and Tsunami", "Deerhorn Lightning Complex", "Del Norte Atmospheric Rivers", "North Coast Storm",
  ]);
});

it("fills the director's dashboards from the exercises, not from North Coast Storm", async () => {
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "jordan.lee@humboldt.example", password: NORTH_COAST_PASSWORD } });
  const token = login.json().accessToken as string;
  const get = async <T,>(url: string): Promise<T> => {
    const response = await app.inject({ method: "GET", url, headers: auth(token) });
    expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
    return response.json() as T;
  };
  const incidents = await admin`select id, name, jurisdiction_id from incidents`;
  const incident = (name: string) => incidents.find((row) => row.name === name)!;
  const cascadia = incident("Cascadia Earthquake and Tsunami");
  const id = cascadia.id as string;
  const humboldt = cascadia.jurisdiction_id as string;

  expect((await get<{ tasks: unknown[] }>(`/api/v1/incidents/${id}/tasks`)).tasks).toHaveLength(27);
  expect((await get<{ summary: { total: number } }>(`/api/v1/incidents/${id}/iaps`)).summary.total).toBe(6);
  const { requests } = await get<{ requests: { costCents: number | null }[] }>(`/api/v1/jurisdictions/${humboldt}/resource-requests?incidentId=${id}`);
  expect(requests.filter((request) => (request.costCents ?? 0) > 0)).toHaveLength(9);
  const damage = `/api/v1/jurisdictions/${humboldt}/damage`;
  expect((await get<{ assessments: unknown[] }>(`${damage}/assessments?incidentId=${id}`)).assessments).toHaveLength(20);
  expect((await get<{ items: unknown[] }>(`${damage}/pa-items?incidentId=${id}`)).items).toHaveLength(13);

  // North Coast Storm's Damage Assessment reads as it did before the exercises: nothing of Cascadia's.
  const northCoast = incident("North Coast Storm").id as string;
  expect((await get<{ assessments: unknown[] }>(`${damage}/assessments?incidentId=${northCoast}`)).assessments).toEqual([]);
  const storm = await get<{ items: unknown[]; totals: { items: number } }>(`${damage}/pa-items?incidentId=${northCoast}`);
  expect([storm.items.length, storm.totals.items]).toEqual([0, 0]);
  const aar = await get<{ observations: unknown[]; correctiveActions: unknown[] }>(`/api/v1/incidents/${id}/aar/analytics`);
  expect([aar.observations.length, aar.correctiveActions.length]).toEqual([9, 11]);

  // All incidents: Humboldt's own actions on Cascadia, and those its liaisons recorded on the other owners' exercises.
  const rollup = await get<{ correctiveActions: { incidentId: string }[] }>("/api/v1/aar/rollup");
  const on = (name: string) => rollup.correctiveActions.filter((action) => action.incidentId === incident(name).id).length;
  expect([on("Cascadia Earthquake and Tsunami"), on("Del Norte Atmospheric Rivers"), on("Deerhorn Lightning Complex")]).toEqual([11, 3, 3]);
});
