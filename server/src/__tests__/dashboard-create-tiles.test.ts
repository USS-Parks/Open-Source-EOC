import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BoardTemplateSchema } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { addMembership, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Create-record tiles on a saved incident dashboard (VC-24), against a real
 * database: a tile names a board of the incident and preset values its
 * fields accept; the snapshot tells each viewer whether they may add a
 * record; a writer's record from the tile lands on the incident with the
 * presets, and a viewer without write access is shown the tile disabled and
 * refused by the server.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminToken: string;
let memberToken: string;
let viewerToken: string;
let incidentId: string;
let boardId: string;
let outsideBoardId: string;

const requests = BoardTemplateSchema.parse({
  key: "tile_requests",
  version: 1,
  title: "Supply requests",
  fields: [
    { key: "item", label: "Item", type: "text", required: true },
    { key: "status", label: "Status", type: "enum", values: ["open", "filled"] },
    { key: "quantity", label: "Quantity", type: "number" },
    { key: "urgent", label: "Urgent", type: "boolean" },
    { key: "location", label: "Location", type: "geometry", geometryKind: "point" },
    { key: "cost_code", label: "Cost code", type: "text", read: "admin", write: "admin" },
  ],
  views: [{ key: "all", title: "All", columns: ["item", "status"] }],
});

const request = (method: string, url: string, token: string, payload?: unknown) =>
  app.inject({ method: method as "GET", url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as object }) });

const tile = (presets?: Record<string, unknown>, board = boardId) => ({
  title: "Requests desk",
  panels: [{ key: "new_request", source: "create", presentation: "tile", boardId: board, ...(presets ? { presets } : {}) }],
});

async function save(token: string, key: string, composition: unknown) {
  return request("PUT", `/api/v1/incidents/${incidentId}/dashboard-configs/${key}`, token, { expectedRevision: 0, composition });
}

async function panel(token: string, key: string) {
  const res = await request("GET", `/api/v1/incidents/${incidentId}/dashboard-configs/${key}/data`, token);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().panels[0];
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await admin`
    insert into board_templates (key, version, title, definition)
    values (${requests.key}, ${requests.version}, ${requests.title}, ${admin.json(requests as never)})`;
  const viewerId = await createPerson(admin, { email: "viewer@example.org", displayName: "Viewer", password: "viewer-test-password" });
  await addMembership(admin, viewerId, jurisdictionId, "viewer");
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  viewerToken = await tokenFor(app, "viewer@example.org", "viewer-test-password");
  const activation = await request("POST", `/api/v1/jurisdictions/${jurisdictionId}/incidents`, adminToken,
    { templateKey: "wildfire", name: "Tile Fire" });
  expect(activation.statusCode, activation.body).toBe(201);
  incidentId = activation.json().incidentId as string;
  const board = async () => (await request("POST", `/api/v1/jurisdictions/${jurisdictionId}/boards`, adminToken, { templateKey: requests.key })).json().id as string;
  boardId = await board();
  outsideBoardId = await board();
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("create-record tiles", () => {
  it("shows a writer the tile with its presets, and the record saved from it lands on the incident", async () => {
    const saved = await save(memberToken, "desk", tile({ status: "open", quantity: 2, urgent: true }));
    expect(saved.statusCode, saved.body).toBe(201);
    const shown = await panel(memberToken, "desk");
    expect(shown).toMatchObject({
      key: "new_request", title: "New Supply requests record", source: "create", presentation: "tile", state: "ready", reason: null,
      data: {
        kind: "create", boardId, boardTitle: "Supply requests", canCreate: true,
        presets: [
          { field: "status", label: "Status", value: "open", text: "Open" },
          { field: "quantity", label: "Quantity", value: 2, text: "2" },
          { field: "urgent", label: "Urgent", value: true, text: "Yes" },
        ],
      },
    });
    // The tile's form submits the presets with what the person entered, to the tile's board and incident.
    const values = Object.fromEntries((shown.data.presets as Array<{ field: string; value: unknown }>).map((p) => [p.field, p.value]));
    const created = await request("POST", `/api/v1/boards/${shown.data.boardId as string}/records?incidentId=${incidentId}`, memberToken,
      { ...values, item: "Cots" });
    expect(created.statusCode, created.body).toBe(201);
    const [row] = await admin`select incident_id, data from board_records where id = ${created.json().id as string}`;
    expect(row).toMatchObject({ incident_id: incidentId, data: { item: "Cots", status: "open", quantity: 2, urgent: true } });
  });

  it("shows a viewer without write access the tile disabled, and the server refuses their record", async () => {
    const saved = await save(viewerToken, "desk", tile({ status: "open" }));
    expect(saved.statusCode, saved.body).toBe(201);
    const shown = await panel(viewerToken, "desk");
    expect(shown).toMatchObject({
      state: "ready", reason: "You can read this board but not add records to it.",
      data: { kind: "create", canCreate: false, presets: [{ field: "status", value: "open", text: "Open" }] },
    });
    const before = await admin`select count(*)::int as n from board_records where board_id = ${boardId}`;
    const refused = await request("POST", `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, viewerToken, { item: "Tarps", status: "open" });
    expect(refused.statusCode).toBe(403);
    const after = await admin`select count(*)::int as n from board_records where board_id = ${boardId}`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it("refuses a tile whose board or presets do not fit, and shows an unavailable board as missing", async () => {
    const status = async (composition: unknown) => (await save(memberToken, `bad-${Math.random().toString(36).slice(2, 8)}`, composition)).statusCode;
    expect(await status(tile({ nope: "x" }))).toBe(400);
    expect(await status(tile({ quantity: "many" }))).toBe(400);
    expect(await status(tile({ status: "closed" }))).toBe(400);
    expect(await status(tile({ location: "here" }))).toBe(400);
    // A field the member cannot read cannot be preset by them.
    expect(await status(tile({ cost_code: "A-1" }))).toBe(400);
    expect(await status(tile(undefined, outsideBoardId))).toBe(400);
    expect(await status({ title: "Map tile", panels: [{ key: "t", source: "create", presentation: "map", boardId }] })).toBe(400);
    expect((await save(adminToken, "admin-desk", tile({ cost_code: "A-1" }))).statusCode).toBe(201);

    // A board later taken off the incident leaves the tile missing, not broken.
    await save(memberToken, "later", tile());
    await admin`delete from incident_boards where incident_id = ${incidentId} and board_id = ${boardId}`;
    try {
      expect(await panel(memberToken, "later")).toMatchObject({ state: "missing", reason: "the board is unavailable", data: null });
    } finally {
      await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
    }
  });
});
