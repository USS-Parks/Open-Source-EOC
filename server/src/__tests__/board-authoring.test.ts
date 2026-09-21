import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createRecord as createRecordService, ensureStandardTemplates, upgradeBoard } from "../boards/service.js";
import { principalForPerson } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let token: string;
let jurisdictionId: string;
let adminId: string;

const headers = () => ({ authorization: `Bearer ${token}` });
const template = (version: number, codeRequired: boolean) => ({
  key: "cost_estimate",
  version,
  title: "Cost estimate",
  fields: [
    { key: "kind", label: "Kind", type: "enum", values: ["routine", "urgent"], required: true },
    { key: "units", label: "Units", type: "number", required: true },
    { key: "unit_cost", label: "Unit cost", type: "number", required: true },
    { key: "total", label: "Total", type: "number", calculation: { op: "multiply", inputs: ["units", "unit_cost"] } },
    { key: "urgent_note", label: "Urgent note", type: "text", required: true,
      condition: { field: "kind", op: "eq", value: "urgent" } },
    ...(version > 1 ? [{ key: "code", label: "Code", type: "text", required: codeRequired }] : []),
    ...(version === 3 ? [{ key: "local_note", label: "Standard note", type: "text" }] : []),
  ],
  views: [{ key: "all", title: "All", columns: ["kind", "total"] }],
  inputLayout: { sections: [{ key: "inputs", title: "Inputs",
    fields: ["kind", "units", "unit_cost", "urgent_note", ...(version > 1 ? ["code"] : [])] }] },
  detailLayout: { sections: [{ key: "summary", title: "Summary", fields: ["kind", "total"] }] },
});

async function publish(body: Record<string, unknown>) {
  return await app.inject({ method: "POST", url: "/api/v1/templates", headers: headers(), payload: body });
}
async function createBoard(templateKey: string, version?: number): Promise<string> {
  const response = await app.inject({ method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/boards`, headers: headers(),
    payload: { templateKey, ...(version ? { version } : {}) } });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}
async function createRecord(boardId: string, payload: Record<string, unknown>, incidentId?: string) {
  return app.inject({ method: "POST",
    url: `/api/v1/boards/${boardId}/records${incidentId ? `?incidentId=${incidentId}` : ""}`,
    headers: headers(), payload });
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  adminId = seed.adminId;
  await admin`update persons set is_instance_admin = true where id = ${adminId}`;
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login",
    payload: { email: "admin@example.org", password: "correct-horse-battery" } });
  token = login.json().accessToken as string;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("board authoring and immutable upgrades", () => {
  it("publishes sequential versions, derives records, and preflights retained data", async () => {
    expect((await publish(template(1, false))).statusCode).toBe(201);
    expect((await publish({ ...template(1, false), version: 3 })).statusCode).toBe(409);
    const boardId = await createBoard("cost_estimate");
    expect((await publish(template(2, true))).statusCode).toBe(201);
    expect((await publish(template(3, false))).statusCode).toBe(201);

    const versions = await app.inject({ method: "GET", url: "/api/v1/templates/cost_estimate/versions", headers: headers() });
    expect(versions.statusCode).toBe(200);
    expect(versions.json().versions.map((item: { version: number }) => item.version)).toEqual([1, 2, 3]);
    const immutable = await app.inject({ method: "GET", url: "/api/v1/templates/cost_estimate/versions/1", headers: headers() });
    expect(immutable.json().version).toBe(1);

    await app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/local-fields`, headers: headers(),
      payload: { key: "x_local_note", label: "Local note", type: "text" } });
    expect((await createRecord(boardId, { kind: "urgent", units: 2, unit_cost: 5 })).statusCode).toBe(400);
    expect((await createRecord(boardId, { kind: "routine", units: 2, unit_cost: 5, total: 10 })).statusCode).toBe(400);
    const created = await createRecord(boardId,
      { kind: "routine", units: 2, unit_cost: 5, x_local_note: "preserve" });
    expect(created.statusCode).toBe(201);
    const recordId = created.json().id as string;

    const view = await app.inject({ method: "GET", url: `/api/v1/boards/${boardId}/views/all`, headers: headers() });
    expect(view.json().records[0].total).toBe(10);
    const [storedBefore] = await admin`select data from board_records where id = ${recordId}`;
    expect(storedBefore!.data).not.toHaveProperty("total");

    const rejected = await app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/upgrade`,
      headers: headers(), payload: { toVersion: 2 } });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toContain(recordId);
    const [unchanged] = await admin`select template_version, local_fields from boards where id = ${boardId}`;
    expect(unchanged!.template_version).toBe(1);
    expect(unchanged!.local_fields).toHaveLength(1);

    const upgraded = await app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/upgrade`,
      headers: headers(), payload: { toVersion: 3 } });
    expect(upgraded.statusCode).toBe(200);
    expect(upgraded.json().dropped).toEqual(["x_local_note"]);
    const [boardAfter] = await admin`select template_version, local_fields from boards where id = ${boardId}`;
    expect(boardAfter!.template_version).toBe(3);
    expect(boardAfter!.local_fields).toHaveLength(0);
    const [storedAfter] = await admin`select data from board_records where id = ${recordId}`;
    expect(storedAfter!.data).toEqual(storedBefore!.data);
    const updated = await app.inject({ method: "PATCH", url: `/api/v1/boards/${boardId}/records/${recordId}`,
      headers: headers(), payload: { units: 4 } });
    expect(updated.statusCode).toBe(200);
    const [storedUpdated] = await admin`select data from board_records where id = ${recordId}`;
    expect(storedUpdated!.data.x_local_note).toBe("preserve");
    expect(storedUpdated!.data.units).toBe(4);
  });

  it("preserves but never exposes a stale stored value for a newly calculated field", async () => {
    const v1 = { key: "legacy_calculation", version: 1, title: "Legacy calculation",
      fields: [
        { key: "units", label: "Units", type: "number" },
        { key: "total", label: "Total", type: "number", read: "admin" },
      ], views: [{ key: "all", title: "All", columns: ["units", "total"] }] };
    const v2 = { ...v1, version: 2, fields: [
      { key: "units", label: "Units", type: "number" },
      { key: "unit_cost", label: "Unit cost", type: "number" },
      { key: "total", label: "Total", type: "number", read: "any",
        calculation: { op: "multiply", inputs: ["units", "unit_cost"] } },
    ] };
    expect((await publish(v1)).statusCode).toBe(201);
    const boardId = await createBoard("legacy_calculation");
    expect((await publish(v2)).statusCode).toBe(201);
    const created = await createRecord(boardId, { units: 2, total: 999 });
    expect(created.statusCode).toBe(201);
    const recordId = created.json().id as string;
    expect((await app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/upgrade`,
      headers: headers(), payload: { toVersion: 2 } })).statusCode).toBe(200);

    const [stored] = await admin`select data from board_records where id = ${recordId}`;
    expect(stored!.data.total).toBe(999);
    const view = await app.inject({ method: "GET", url: `/api/v1/boards/${boardId}/views/all`, headers: headers() });
    expect(view.json().records[0]).not.toHaveProperty("total");
    expect((await app.inject({ method: "PATCH", url: `/api/v1/boards/${boardId}/records/${recordId}`,
      headers: headers(), payload: { units: 3 } })).statusCode).toBe(200);
    const [storedAfter] = await admin`select data from board_records where id = ${recordId}`;
    expect(storedAfter!.data.total).toBe(999);
    const after = await app.inject({ method: "GET", url: `/api/v1/boards/${boardId}/views/all`, headers: headers() });
    expect(after.json().records[0]).not.toHaveProperty("total");
  });

  it("serializes an old-shape writer with upgrade preflight", async () => {
    const v1 = { key: "locked_upgrade", version: 1, title: "Locked upgrade",
      fields: [{ key: "old_value", label: "Old value", type: "text", required: true }],
      views: [{ key: "all", title: "All", columns: ["old_value"] }] };
    const v2 = { key: "locked_upgrade", version: 2, title: "Locked upgrade",
      fields: [{ key: "new_value", label: "New value", type: "text", required: true }],
      views: [{ key: "all", title: "All", columns: ["new_value"] }] };
    expect((await publish(v1)).statusCode).toBe(201);
    const boardId = await createBoard("locked_upgrade");
    expect((await publish(v2)).statusCode).toBe(201);
    const actor = await principalForPerson(runtime, adminId);
    let writerReady!: () => void;
    let releaseWriter!: () => void;
    const ready = new Promise<void>((resolve) => { writerReady = resolve; });
    const release = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const writer = withPerson(runtime, adminId, async (tx) => {
      const result = await createRecordService(tx, actor, boardId, { old_value: "committed first" });
      writerReady();
      await release;
      return result;
    });
    await ready;

    let upgradeSettled = false;
    let upgradeStarted!: () => void;
    const started = new Promise<void>((resolve) => { upgradeStarted = resolve; });
    const upgrading = withPerson(runtime, adminId, async (tx) => {
      await tx`select set_config('application_name', 'veoc-81a-upgrade-wait', true)`;
      upgradeStarted();
      return upgradeBoard(tx, actor, boardId, 2);
    });
    void upgrading.then(() => { upgradeSettled = true; }, () => { upgradeSettled = true; });
    await started;
    let observedLockWait = false;
    for (let attempt = 0; attempt < 50 && !upgradeSettled; attempt += 1) {
      const [state] = await admin`
        select wait_event_type from pg_stat_activity
        where application_name = 'veoc-81a-upgrade-wait'`;
      if (state?.wait_event_type === "Lock") { observedLockWait = true; break; }
    }
    releaseWriter();
    const written = await writer;
    let upgradeError: unknown;
    try { await upgrading; } catch (error) { upgradeError = error; }
    expect(observedLockWait).toBe(true);
    expect(upgradeError).toMatchObject({ status: 409 });
    const [board] = await admin`select template_version from boards where id = ${boardId}`;
    expect(board!.template_version).toBe(1);
    expect(await admin`select id from board_records where id = ${written.id}`).toHaveLength(1);
  });
});

describe("incident-scoped record references", () => {
  it("lists readable targets and rejects a target from another incident", async () => {
    const targetTemplate = { key: "incident_assets", version: 1, title: "Incident assets",
      fields: [{ key: "name", label: "Name", type: "text", required: true }],
      views: [{ key: "all", title: "All", columns: ["name"] }] };
    const sourceTemplate = { key: "incident_assignments", version: 1, title: "Incident assignments",
      fields: [{ key: "asset", label: "Asset", type: "record_ref", required: true,
        targetBoardKey: "incident_assets", labelField: "name" }],
      views: [{ key: "all", title: "All", columns: ["asset"] }] };
    expect((await publish(targetTemplate)).statusCode).toBe(201);
    expect((await publish(sourceTemplate)).statusCode).toBe(201);
    const targetBoard = await createBoard("incident_assets");
    const sourceBoard = await createBoard("incident_assignments");
    expect((await publish({ ...targetTemplate, version: 2,
      fields: [{ key: "name", label: "Name", type: "text", required: true, read: "admin" }] })).statusCode).toBe(201);
    const hiddenTargetBoard = await createBoard("incident_assets", 2);
    const otherTemplate = { ...targetTemplate, key: "other_assets" };
    expect((await publish(otherTemplate)).statusCode).toBe(201);
    const otherBoard = await createBoard("other_assets");
    const incidents = await admin`
      insert into incidents (jurisdiction_id, name, kind, activated_by)
      values (${jurisdictionId}, 'One', 'incident', ${adminId}),
             (${jurisdictionId}, 'Two', 'incident', ${adminId}),
             (${jurisdictionId}, 'Pagination', 'incident', ${adminId}) returning id`;
    const first = incidents[0]!.id as string;
    const second = incidents[1]!.id as string;
    const pagination = incidents[2]!.id as string;
    await admin`insert into incident_boards (incident_id, board_id) values
      (${first}, ${targetBoard}), (${first}, ${sourceBoard}),
      (${first}, ${otherBoard}),
      (${second}, ${targetBoard}), (${second}, ${sourceBoard}),
      (${pagination}, ${hiddenTargetBoard}), (${pagination}, ${targetBoard}),
      (${pagination}, ${sourceBoard})`;

    const firstTarget = await createRecord(targetBoard, { name: "Pump 12" }, first);
    const secondTarget = await createRecord(targetBoard, { name: "Pump 99" }, second);
    expect(firstTarget.statusCode).toBe(201);
    expect(secondTarget.statusCode).toBe(201);
    const firstId = firstTarget.json().id as string;
    const secondId = secondTarget.json().id as string;

    const options = await app.inject({ method: "GET",
      url: `/api/v1/boards/${sourceBoard}/record-references/asset?incidentId=${first}&limit=10`, headers: headers() });
    expect(options.statusCode).toBe(200);
    expect(options.json().options).toEqual([{ id: firstId, label: "Pump 12", boardId: targetBoard }]);
    const assignment = await createRecord(sourceBoard, { asset: firstId }, first);
    expect(assignment.statusCode).toBe(201);
    expect((await createRecord(sourceBoard, { asset: secondId }, first)).statusCode).toBe(400);

    const hiddenId = "00000000-0000-4000-8000-000000000001";
    const visibleId = "00000000-0000-4000-8000-000000000002";
    await admin`insert into board_records (id, board_id, data, created_by, incident_id) values
      (${hiddenId}, ${hiddenTargetBoard}, ${admin.json({ name: "Secret pump" })}, ${adminId}, ${pagination}),
      (${visibleId}, ${targetBoard}, ${admin.json({ name: "Public pump" })}, ${adminId}, ${pagination})`;
    const adminPage = await app.inject({ method: "GET",
      url: `/api/v1/boards/${sourceBoard}/record-references/asset?incidentId=${pagination}&limit=1`, headers: headers() });
    expect(adminPage.statusCode).toBe(200);
    expect(adminPage.json().options).toEqual([{ id: hiddenId, label: "Secret pump", boardId: hiddenTargetBoard }]);
    const memberLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login",
      payload: { email: "member@example.org", password: "another-good-password" } });
    expect(memberLogin.statusCode).toBe(200);
    const paged = await app.inject({ method: "GET",
      url: `/api/v1/boards/${sourceBoard}/record-references/asset?incidentId=${pagination}&limit=1`,
      headers: { authorization: `Bearer ${memberLogin.json().accessToken as string}` } });
    expect(paged.statusCode).toBe(200);
    expect(paged.json().options).toEqual([{ id: visibleId, label: "Public pump", boardId: targetBoard }]);
    expect(JSON.stringify(paged.json())).not.toContain("Secret pump");

    const retargeted = { ...sourceTemplate, version: 2,
      fields: [{ ...sourceTemplate.fields[0]!, targetBoardKey: "other_assets" }] };
    expect((await publish(retargeted)).statusCode).toBe(201);
    const before = (await admin`select data from board_records where id = ${assignment.json().id as string}`)[0]!.data;
    const upgrade = await app.inject({ method: "POST", url: `/api/v1/boards/${sourceBoard}/upgrade`,
      headers: headers(), payload: { toVersion: 2 } });
    expect(upgrade.statusCode).toBe(409);
    expect(upgrade.json().error).toContain(assignment.json().id as string);
    const [sourceAfter] = await admin`select template_version from boards where id = ${sourceBoard}`;
    expect(sourceAfter!.template_version).toBe(1);
    expect((await admin`select data from board_records where id = ${assignment.json().id as string}`)[0]!.data).toEqual(before);
  });
});
