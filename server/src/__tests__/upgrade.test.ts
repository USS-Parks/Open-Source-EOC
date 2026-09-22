import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { migrate } from "../db/migrate.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Deployment upgrade preserves customization (INV-5). A customized
 * instance (a board with a local x_ field and records) survives re-running
 * the migration runner (idempotent) and a board template version upgrade:
 * the local field and the records are kept, and the new template's fields
 * appear. This is the upgrade drill the packaging promises.
 */

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminToken: string;
let boardId: string;

function api(method: string, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: method as "GET",
    url,
    headers: { authorization: `Bearer ${adminToken}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

beforeAll(async () => {
  const db = await freshDb();
  admin = db.admin;
  runtime = db.runtime;
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = (
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@example.org", password: "correct-horse-battery" },
    })
  ).json().accessToken as string;

  boardId = (await api("POST", `/api/v1/jurisdictions/${jurisdictionId}/boards`, { templateKey: "activity_log" })).json()
    .id as string;
  await api("POST", `/api/v1/boards/${boardId}/local-fields`, {
    key: "x_note",
    label: "Local Note",
    type: "text",
  });
  await api("POST", `/api/v1/boards/${boardId}/records`, { entry: "before upgrade", x_note: "keep me" });
}, 60000);

afterAll(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (admin) await admin.end();
});

describe("re-running migrations is a clean no-op", () => {
  it("applies nothing new and leaves customization intact", async () => {
    const ran = await migrate(admin, MIGRATIONS);
    expect(ran).toHaveLength(0);
    const board = (await api("GET", `/api/v1/boards/${boardId}`)).json();
    expect(board.fields.some((f: { key: string }) => f.key === "x_note")).toBe(true);
    const view = (await api("GET", `/api/v1/boards/${boardId}/views/all`)).json();
    expect(view.records).toHaveLength(1);
    expect(view.records[0].x_note).toBe("keep me");
  });
});

describe("template version upgrade preserves customization", () => {
  it("keeps the local field and records and adds the new template field", async () => {
    // A new template version arrives (as a signed package would deliver it).
    const v2 = {
      key: "activity_log",
      version: 2,
      title: "Activity Log",
      description: "Chronological log of actions taken.",
      fields: [
        { key: "entry", label: "Entry", type: "text", required: true },
        { key: "notable", label: "Notable", type: "boolean" },
        { key: "priority", label: "Priority", type: "enum", values: ["routine", "priority"] },
      ],
      views: [{ key: "all", title: "All entries", columns: ["entry", "priority", "notable"] }],
    };
    await admin`
      insert into board_templates (key, version, title, definition)
      values ('activity_log', 2, 'Activity Log', ${admin.json(v2 as never)})`;

    const up = await api("POST", `/api/v1/boards/${boardId}/upgrade`, { toVersion: 2 });
    expect(up.statusCode).toBe(200);

    const board = (await api("GET", `/api/v1/boards/${boardId}`)).json();
    const keys = board.fields.map((f: { key: string }) => f.key);
    expect(keys).toContain("priority"); // new template field present
    expect(keys).toContain("x_note"); // local customization preserved

    const view = (await api("GET", `/api/v1/boards/${boardId}/views/all`)).json();
    expect(view.records).toHaveLength(1);
    expect(view.records[0].x_note).toBe("keep me"); // records untouched
  });
});
