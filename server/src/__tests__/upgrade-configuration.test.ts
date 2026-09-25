import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { migrate } from "../db/migrate.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Configuration moves forward (acceptance scenario 8). An organization
 * configured on an earlier release (a board with a local field, a saved map
 * layout, a dashboard, a notification rule, a position and its holder, admin,
 * member and viewer grants, a partner's incident grant and a request its
 * owner triaged) is upgraded across the migrations since, and everything is
 * still there and every role can still do what it could. The member then
 * opens the console at the frames' size and at a 125%-scaled laptop's and
 * finds the request under its new stage with its owner, and the dashboard
 * where it was.
 */

const DIST = buildDir("upgrade-configuration-app");
const SHOTS = shotDir("upgrade-configuration");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
/** The last migration of the earlier release this test starts from. */
const EARLIER = "0131_exercise_incidents.sql";
const PASSWORD = "configured-before-upgrade";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let applied: readonly string[];
let browser: Browser;
let baseUrl: string;
const ids: Record<string, string> = {};

async function signIn(email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

function call(token: string, method: string, url: string, payload?: Record<string, unknown>) {
  return app.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb({ migrateThrough: EARLIER }));
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await ensureStandardDashboards(admin);

  ids.county = await createJurisdiction(admin, "upgrade-county", "Upgrade County OES");
  ids.partner = await createJurisdiction(admin, "upgrade-partner", "Upgrade Utility");
  for (const [key, role, organization] of [["admin", "admin", "county"], ["member", "member", "county"], ["viewer", "viewer", "county"], ["liaison", "member", "partner"]] as const) {
    ids[key] = await createPerson(admin, { email: `${key}@upgrade.example`, displayName: `Upgrade ${key}`, password: PASSWORD });
    await addMembership(admin, ids[key]!, ids[organization]!, role);
  }
  const [board] = await admin`
    insert into boards (jurisdiction_id, template_key, template_version, title, local_fields)
    values (${ids.county!}, 'activity_log', 1, 'County log',
      ${admin.json([{ key: "x_shift", label: "Shift", type: "text" }] as never)})
    returning id`;
  ids.board = board!.id as string;
  const [incident] = await admin`
    insert into incidents (jurisdiction_id, template_key, name, kind, activated_by)
    values (${ids.county!}, 'daily_ops', 'Upgrade exercise', 'incident', ${ids.admin!}) returning id`;
  ids.incident = incident!.id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${ids.incident!}, ${ids.board!})`;
  const [position] = await admin`
    insert into positions (jurisdiction_id, key, title) values (${ids.county!}, 'logistics_section_chief', 'Logistics Section Chief')
    returning id`;
  ids.position = position!.id as string;
  await admin`insert into position_assignments (position_id, person_id, assigned_by) values (${ids.position!}, ${ids.member!}, ${ids.admin!})`;
  await admin`
    insert into incident_participants (incident_id, organization_id, person_id, incident_position_title, role, expires_at, reason, created_by)
    values (${ids.incident!}, ${ids.partner!}, ${ids.liaison!}, 'Utility liaison', 'contributor', now() + interval '7 days', 'Upgrade drill', ${ids.admin!})`;
  await admin`
    insert into saved_states (person_id, incident_id, kind, state_key, schema_version, revision, payload)
    values (${ids.admin!}, ${ids.incident!}, 'workspace_layout', 'map', 1, 3,
      ${admin.json({ compactNavigation: true, drawerOpen: false, drawerWidth: 400 } as never)})`;
  const [dashboard] = await admin`
    insert into dashboards (jurisdiction_id, template_key, template_version, title)
    select ${ids.county!}, key, version, 'County command dashboard' from dashboard_templates order by key, version limit 1
    returning id`;
  ids.dashboard = dashboard!.id as string;
  await admin`
    insert into notification_rules (jurisdiction_id, board_id, event, condition, channels, created_by)
    values (${ids.county!}, ${ids.board!}, 'record.created', ${admin.json({} as never)}, ${admin.json([] as never)}, ${ids.admin!})`;
  const [request] = await admin`
    insert into resource_requests (jurisdiction_id, receiving_organization_id, incident_id, origin, item, state, requested_by)
    values (${ids.county!}, ${ids.county!}, ${ids.incident!}, 'eoc', 'Generator', 'triaged', ${ids.member!}) returning id`;
  ids.request = request!.id as string;
  await admin`
    insert into rr_events (request_id, from_state, to_state, note, actor_person, at) values
      (${ids.request!}, null, 'submitted', 'request submitted', ${ids.member!}, now() - interval '2 hours'),
      (${ids.request!}, 'submitted', 'triaged', null, ${ids.admin!}, now() - interval '1 hour')`;

  // The upgrade: every migration since the earlier release.
  applied = await migrate(admin, MIGRATIONS);
  await admin.unsafe("alter role app_runtime login password 'app-runtime-test-only'");
  app = buildApp(runtime, { oidc: null });
  await buildWeb(DIST);
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("configuration moves forward across an upgrade", () => {
  it("applies the migrations since the earlier release, and only those", () => {
    expect(applied[0]! > EARLIER).toBe(true);
    expect(applied).toContain("0138_request_acceptance.sql");
  });

  it("keeps the board's local field, the saved layout, the dashboard and the notification rule", async () => {
    const token = await signIn("admin@upgrade.example");
    const board = (await call(token, "GET", `/api/v1/boards/${ids.board}`)).json();
    expect(board.fields.map((field: { key: string }) => field.key)).toContain("x_shift");
    const [layout] = await admin`select revision, payload from saved_states where person_id = ${ids.admin!} and state_key = 'map'`;
    expect(layout).toMatchObject({ revision: 3, payload: { compactNavigation: true, drawerOpen: false, drawerWidth: 400 } });
    const dashboards = (await call(token, "GET", `/api/v1/jurisdictions/${ids.county}/dashboards`)).json();
    expect(JSON.stringify(dashboards)).toContain("County command dashboard");
    const [rule] = await admin`select event, enabled from notification_rules where board_id = ${ids.board!}`;
    expect(rule).toMatchObject({ event: "record.created" });
  });

  it("moves the triaged request to accepted, owned by whoever triaged it, with its history kept", async () => {
    const token = await signIn("member@upgrade.example");
    const detail = (await call(token, "GET", `/api/v1/resource-requests/${ids.request}`)).json();
    expect(detail.state).toBe("accepted");
    expect(detail.acceptance).toMatchObject({ personName: "Upgrade admin" });
    expect(detail.chronology.map((entry: { toState: string }) => entry.toState)).toEqual(["submitted", "triaged"]);
  });

  it("leaves every role able to do what it could", async () => {
    const member = await signIn("member@upgrade.example");
    expect((await call(member, "POST", `/api/v1/boards/${ids.board}/records`, { entry: "After upgrade", x_shift: "Night" })).statusCode).toBe(201);
    expect((await call(member, "POST", `/api/v1/positions/${ids.position}/sign-in`, {})).statusCode).toBe(200);
    const viewer = await signIn("viewer@upgrade.example");
    expect((await call(viewer, "POST", `/api/v1/boards/${ids.board}/records`, { entry: "Not allowed" })).statusCode).toBe(403);
    expect((await call(viewer, "GET", `/api/v1/boards/${ids.board}/views/all`)).statusCode).toBe(200);
    const administrator = await signIn("admin@upgrade.example");
    expect((await call(administrator, "POST", `/api/v1/boards/${ids.board}/local-fields`, { key: "x_radio", label: "Radio", type: "text" })).statusCode).toBeLessThan(300);
    const liaison = await signIn("liaison@upgrade.example");
    expect((await call(liaison, "GET", `/api/v1/incidents/${ids.incident}/resource-requests`)).statusCode).toBe(200);
    const asked = await call(liaison, "POST", `/api/v1/jurisdictions/${ids.county}/resource-requests`, { origin: "eoc", item: "Line crew", incidentId: ids.incident });
    expect(asked.statusCode, asked.body).toBe(201);
  });

  for (const viewport of VIEWPORTS) {
    it(`shows the member the upgraded request and the kept dashboard at ${viewport.width} by ${viewport.height}`, async () => {
      const context = await browser.newContext({ viewport, locale: "en-US" });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${baseUrl}/app/index.html#/resources?incident=${ids.incident}`, { waitUntil: "load" });
      await page.getByLabel("Email").fill("member@upgrade.example");
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      const row = page.getByRole("listitem").filter({ hasText: "Generator" }).first();
      await row.getByText("Accepted", { exact: true }).waitFor();
      await row.getByText(/^Owner: Upgrade admin/).waitFor();
      await page.evaluate("location.hash = '#/dashboard'");
      await page.getByText("County command dashboard").first().waitFor();
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await page.screenshot({ path: join(SHOTS, `upgraded-${viewport.width}.png`) });
      await context.close();
      expect(errors).toEqual([]);
    }, 120_000);
  }
});
