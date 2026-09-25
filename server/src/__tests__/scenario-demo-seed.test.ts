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
