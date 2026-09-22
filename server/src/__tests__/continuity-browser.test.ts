import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { launchBrowser, listen, login, serveStatic } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const OUT_ROOT = process.env.OPENEOC_TEST_BUILD_ROOT ?? "/tmp/openeoc-test-build";
const DIST = join(OUT_ROOT, "continuity-browser-dist");
const FIXTURE_DIR = join(process.cwd(), "web", "src", "offline", "__fixtures__");
const DB_NAME = "continuity-browser-proof";
const RECORD_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_INCIDENT_RECORD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK_OPERATION_ID = "22222222-2222-4222-8222-222222222222";

interface FixtureApi {
  configure(config: Record<string, string>): Promise<void>;
  editReport(recordId: string, fields: Record<string, unknown>): Promise<unknown>;
  queueTask(operationId: string): Promise<unknown>;
  markOffline(): Promise<unknown>;
  snapshot(): Promise<Record<string, unknown>>;
  snapshotScope(scope: Record<string, string>): Promise<Record<string, unknown>>;
  records(): Record<string, Record<string, unknown>>;
  reconnect(): Promise<{ snapshot: Record<string, unknown> }>;
}

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
let boardId: string;
let taskId: string;
let memberToken: string;
let memberId: string;
let positionId: string;

async function post(token: string, url: string, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

beforeAll(async () => {
  const { build } = await import("../../../web/node_modules/vite/dist/node/index.js");
  await build({
    root: FIXTURE_DIR,
    base: "./",
    publicDir: false,
    logLevel: "silent",
    build: { outDir: DIST, emptyOutDir: true, rollupOptions: { input: join(FIXTURE_DIR, "continuity.html") } },
  });
  expect(existsSync(join(DIST, "continuity.html"))).toBe(true);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  memberId = seed.memberId;
  await ensureStandardTemplates(admin);
  const definition = {
    key: "continuity_fixture",
    title: "Continuity fixture",
    positions: ["incident_commander"],
    boards: [],
    checklists: [{ position: "incident_commander", items: ["Submit offline field report"] }],
  };
  await admin`insert into incident_templates (key, title, definition)
    values ('continuity_fixture', 'Continuity fixture', ${admin.json(definition as never)})`;
  app = buildApp(runtime, { oidc: null });
  // The fixture bundle is self-contained; no web/public fallback is wanted.
  serveStatic(app, "/continuity", DIST, DIST);
  baseUrl = await listen(app);
  const adminToken = await login(app);
  memberToken = await login(app, "member@example.org", "another-good-password");
  incidentId = (await post(
    adminToken,
    `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    { templateKey: "continuity_fixture", name: "Browser continuity incident" },
  )).incidentId as string;
  boardId = (await post(
    adminToken,
    `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    { templateKey: "significant_events" },
  )).id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  const otherIncidentId = (await post(
    adminToken,
    `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    { templateKey: "continuity_fixture", name: "Browser continuity other incident" },
  )).incidentId as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${otherIncidentId}, ${boardId})`;
  await admin`insert into board_records (id, board_id, incident_id, data, created_by)
    values (${OTHER_INCIDENT_RECORD_ID}, ${boardId}, ${otherIncidentId}, ${admin.json({
      summary: "Other browser incident only",
      occurred_at: "2026-09-21T20:00:00Z",
      severity: "info",
    })}, ${memberId})`;
  const [position] = await admin`
    select p.id from incident_positions ip join positions p on p.id = ip.position_id
    where ip.incident_id = ${incidentId} and p.key = 'incident_commander'`;
  positionId = position!.id as string;
  await post(adminToken, `/api/v1/positions/${positionId}/assignments`, { personId: memberId });
  await post(memberToken, `/api/v1/positions/${positionId}/sign-in`, {});
  const listed = await app.inject({
    method: "GET",
    url: `/api/v1/incidents/${incidentId}/tasks`,
    headers: { authorization: `Bearer ${memberToken}` },
  });
  taskId = listed.json().tasks[0].id as string;
  browser = await launchBrowser();
  page = await browser.newPage();
}, 120000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("actual browser continuity", () => {
  it("survives reload offline and reconciles board and task exactly once", async () => {
    const config = {
      personId: memberId,
      incidentId,
      boardId,
      taskId,
      token: memberToken,
      databaseName: DB_NAME,
    };
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(`${baseUrl}/continuity/continuity.html`, { waitUntil: "load" });
    await page.evaluate((value) =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.configure(value), config);
    await page.evaluate((recordId) =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.editReport(recordId, {
      summary: "Field report retained through reload",
      occurred_at: "2026-09-21T21:00:00Z",
      severity: "warning",
    }), RECORD_ID);
    await page.evaluate((operationId) =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.queueTask(operationId),
    TASK_OPERATION_ID);
    await page.evaluate(() =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.markOffline());
    expect(await admin`select id from board_records where id = ${RECORD_ID}`).toHaveLength(0);

    await page.reload({ waitUntil: "load" });
    await page.evaluate((value) =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.configure(value), config);
    expect(await page.evaluate(() =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.records())).toMatchObject({
      [RECORD_ID]: { summary: "Field report retained through reload", severity: "warning" },
    });
    expect(await page.evaluate(() =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.snapshot())).toMatchObject({
      phase: "offline",
      pendingBoardIds: [boardId],
      pendingTaskOperationIds: [TASK_OPERATION_ID],
    });
    expect(await page.evaluate((value) =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.snapshotScope(value), {
      personId: "99999999-9999-4999-8999-999999999999",
      incidentId,
    })).toMatchObject({ pendingBoardIds: [], pendingTaskOperationIds: [] });
    expect(await page.evaluate((value) =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.snapshotScope(value), {
      personId: memberId,
      incidentId: "88888888-8888-4888-8888-888888888888",
    })).toMatchObject({ pendingBoardIds: [], pendingTaskOperationIds: [] });

    await page.unroute("**/api/**");
    const reconciled = await page.evaluate(() =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.reconnect());
    expect(reconciled.snapshot).toMatchObject({
      phase: "synced",
      pendingBoardIds: [],
      pendingTaskOperationIds: [],
    });
    expect(await page.evaluate(() =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.reconnect())).toMatchObject({
      snapshot: { phase: "synced", pendingBoardIds: [], pendingTaskOperationIds: [] },
    });
    const [counts] = await admin`
      select
        (select count(*)::int from sync_updates where operation_id is not null
          and board_id = ${boardId}) as board_receipts,
        (select count(*)::int from audit_events where subject_id = ${RECORD_ID}) as board_audits,
        (select count(*)::int from checklist_completion_operations
          where operation_id = ${TASK_OPERATION_ID}) as task_receipts`;
    expect(counts).toMatchObject({ board_receipts: 1, board_audits: 1, task_receipts: 1 });
    const [record] = await admin`
      select created_by, incident_id, data from board_records where id = ${RECORD_ID}`;
    expect(record).toMatchObject({ created_by: memberId });
    expect(record!.incident_id).toBe(incidentId);
    expect(record!.data).toMatchObject({ summary: "Field report retained through reload" });
    expect(await page.evaluate(() =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.records()))
      .not.toHaveProperty(OTHER_INCIDENT_RECORD_ID);
    const [task] = await admin`
      select status, completed_by, completed_by_position from checklist_items where id = ${taskId}`;
    expect(task).toMatchObject({ status: "completed", completed_by: memberId, completed_by_position: positionId });

    const conflictRecord = "77777777-7777-4777-8777-777777777777";
    await page.evaluate((recordId) =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.editReport(recordId, {
      summary: "Invalid field report remains visible as conflict",
      occurred_at: "2026-09-21T22:00:00Z",
      severity: "catastrophic",
    }), conflictRecord);
    expect(await page.evaluate(() =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.reconnect())).toMatchObject({
      snapshot: { phase: "conflict", conflicts: 1, pendingBoardIds: [] },
    });
    expect(await page.evaluate(() =>
      (globalThis as unknown as { continuityFixture: FixtureApi }).continuityFixture.reconnect())).toMatchObject({
      snapshot: { phase: "conflict", conflicts: 1, pendingBoardIds: [] },
    });
    const [conflict] = await admin`
      select origin_person from sync_conflicts where record_id = ${conflictRecord}`;
    expect(conflict).toMatchObject({ origin_person: memberId });
  });
});
