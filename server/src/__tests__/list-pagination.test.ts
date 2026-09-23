import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BoardTemplateSchema } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Keyset pagination: walking every cursor of a board view, the audit
 * chronology and the notification inbox returns each row exactly once, in
 * the list's order, including rows whose timestamps differ only in
 * microseconds. View filters run in SQL, so filtered pages come back full.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let logBoardId: string;
let probeBoardId: string;

const probe = BoardTemplateSchema.parse({
  key: "paging_probe",
  version: 1,
  title: "Paging probe",
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "rank", label: "Rank", type: "number" },
    { key: "double_rank", label: "Double rank", type: "number", calculation: { op: "sum", inputs: ["rank", "rank"] } },
    { key: "secret", label: "Secret", type: "text", read: "admin", write: "admin" },
  ],
  views: [
    { key: "by_name", title: "By name", columns: ["name"], sort: { field: "name", dir: "asc" } },
    { key: "by_rank", title: "By rank", columns: ["rank"], sort: { field: "rank", dir: "desc" } },
    { key: "picked", title: "Picked", columns: ["name"], filter: [{ field: "name", op: "in", value: ["n-003", "n-010"] }] },
    { key: "doubled", title: "Doubled", columns: ["name"], filter: [{ field: "double_rank", op: "eq", value: 20 }] },
    { key: "secret_x", title: "Secret x", columns: ["name"], filter: [{ field: "secret", op: "eq", value: "x" }] },
    { key: "not_secret_x", title: "Not secret x", columns: ["name"], filter: [{ field: "secret", op: "neq", value: "x" }] },
  ],
});

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await admin`
    insert into board_templates (key, version, title, definition)
    values (${probe.key}, ${probe.version}, ${probe.title}, ${admin.json(probe as never)})`;
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const board = async (templateKey: string) => (await app.inject({
    method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken), payload: { templateKey },
  })).json().id as string;
  logBoardId = await board("activity_log");
  probeBoardId = await board("paging_probe");
  // Five timestamps inside one millisecond: a cursor that kept only
  // milliseconds would skip or repeat rows at every page boundary.
  await admin`
    insert into board_records (board_id, data, created_by, created_at)
    select ${logBoardId}, jsonb_build_object('entry', 'line ' || g, 'notable', g % 3 = 0), ${seed.adminId},
           date_trunc('milliseconds', now()) + (g % 5) * interval '1 microsecond'
    from generate_series(1, 250) g`;
  await admin`
    insert into board_records (board_id, data, created_by, created_at)
    select ${probeBoardId},
           jsonb_build_object('name', 'n-' || lpad((g % 50)::text, 3, '0'), 'rank', g % 25,
                              'secret', case when g % 4 = 0 then 'x' else 'y' end),
           ${seed.adminId}, now() - (g % 7) * interval '1 microsecond'
    from generate_series(1, 150) g`;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

async function walk(path: string, key: string, token: string, limit: number) {
  const items: Array<Record<string, unknown>> = [];
  const pageSizes: number[] = [];
  let cursor: string | null = null;
  do {
    const separator = path.includes("?") ? "&" : "?";
    const res = await app.inject({
      method: "GET",
      url: `${path}${separator}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const page = body[key] as Array<Record<string, unknown>>;
    items.push(...page);
    pageSizes.push(page.length);
    cursor = body.nextCursor as string | null;
  } while (cursor && pageSizes.length < 500);
  return { items, pageSizes };
}

const ids = (items: ReadonlyArray<Record<string, unknown>>) => items.map((item) => item.id as string);

describe("board view pages", () => {
  it("walks every record once, newest first, across microsecond ties", async () => {
    const { items, pageSizes } = await walk(`/api/v1/boards/${logBoardId}/views/all`, "records", memberToken, 40);
    const expected = await admin`
      select id from board_records where board_id = ${logBoardId} order by created_at desc, id desc`;
    expect(ids(items)).toEqual(expected.map((row) => row.id as string));
    expect(pageSizes).toEqual([40, 40, 40, 40, 40, 40, 10]);
  });

  it("filters in SQL, so every page of a filtered view is full", async () => {
    const { items, pageSizes } = await walk(`/api/v1/boards/${logBoardId}/views/notable`, "records", memberToken, 25);
    const expected = await admin`
      select id from board_records where board_id = ${logBoardId} and (data ->> 'notable')::boolean
      order by created_at desc, id desc`;
    expect(ids(items)).toEqual(expected.map((row) => row.id as string));
    expect(pageSizes.slice(0, -1).every((size) => size === 25)).toBe(true);
  });

  it("pages a sorted view in sort order, both directions, numbers by value", async () => {
    for (const [view, key, dir] of [
      ["by_name", admin`coalesce(data ->> 'name', '')`, "asc"],
      ["by_rank", admin`(data ->> 'rank')::float8`, "desc"],
    ] as const) {
      const { items } = await walk(`/api/v1/boards/${probeBoardId}/views/${view}`, "records", memberToken, 17);
      const expected = await admin`
        select id from board_records where board_id = ${probeBoardId}
        order by ${key} ${dir === "asc" ? admin`asc` : admin`desc`}, created_at desc, id desc`;
      expect(ids(items)).toEqual(expected.map((row) => row.id as string));
    }
  });

  it("matches applyView for membership, calculated and unreadable filters", async () => {
    const picked = await walk(`/api/v1/boards/${probeBoardId}/views/picked`, "records", memberToken, 4);
    expect(picked.items).toHaveLength(6);
    expect(new Set(picked.items.map((item) => item.name))).toEqual(new Set(["n-003", "n-010"]));
    const doubled = await walk(`/api/v1/boards/${probeBoardId}/views/doubled`, "records", memberToken, 20);
    expect(doubled.items).toHaveLength(6);
    expect(doubled.items.every((item) => item.double_rank === 20)).toBe(true);
    // A member cannot read `secret`: it is absent to their view, as applyView sees it.
    expect((await walk(`/api/v1/boards/${probeBoardId}/views/secret_x`, "records", memberToken, 50)).items).toHaveLength(0);
    expect((await walk(`/api/v1/boards/${probeBoardId}/views/not_secret_x`, "records", memberToken, 50)).items).toHaveLength(150);
    expect((await walk(`/api/v1/boards/${probeBoardId}/views/secret_x`, "records", adminToken, 50)).items).toHaveLength(37);
    expect((await walk(`/api/v1/boards/${probeBoardId}/views/not_secret_x`, "records", adminToken, 50)).items).toHaveLength(113);
  });

  it("refuses a malformed cursor and an oversized page", async () => {
    const bad = await app.inject({
      method: "GET", url: `/api/v1/boards/${logBoardId}/views/all?cursor=not-a-cursor`, headers: auth(memberToken),
    });
    expect(bad.statusCode).toBe(400);
    const big = await app.inject({
      method: "GET", url: `/api/v1/boards/${logBoardId}/views/all?limit=501`, headers: auth(memberToken),
    });
    expect(big.statusCode).toBe(400);
  });
});

describe("audit chronology pages", () => {
  it("walks the chronology once, in sequence order", async () => {
    await admin`
      insert into audit_events (jurisdiction_id, person_id, category)
      select ${seed.jurisdictionId}, ${seed.adminId}, 'probe.event.' || g from generate_series(1, 230) g`;
    const { items } = await walk(`/api/v1/jurisdictions/${seed.jurisdictionId}/chronology`, "entries", adminToken, 50);
    const expected = await admin`
      select seq from audit_events where jurisdiction_id = ${seed.jurisdictionId} order by seq`;
    expect(items.map((entry) => entry.seq)).toEqual(expected.map((row) => Number(row.seq)));
  });
});

describe("notification pages", () => {
  it("walks the inbox once and joins the incident through the typed column", async () => {
    const incident = await app.inject({
      method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      headers: auth(adminToken), payload: { templateKey: "daily_ops", name: "Paging exercise" },
    });
    expect(incident.statusCode).toBe(201);
    const incidentId = incident.json().incidentId as string;
    await admin`
      insert into notifications (jurisdiction_id, person_id, channel, title, body, status, detail)
      select ${seed.jurisdictionId}, ${seed.adminId}, 'workflow', 'Probe ' || g, '', 'delivered',
             case when g = 1 then jsonb_build_object('incidentId', ${incidentId}::text) else '{}'::jsonb end
      from generate_series(1, 30) g`;
    const [typed] = await admin`
      select incident_id from notifications where title = 'Probe 1'`;
    expect(typed!.incident_id).toBe(incidentId);

    const { items } = await walk("/api/v1/notifications", "notifications", adminToken, 7);
    const expected = await admin`select id from notifications order by created_at desc, id desc`;
    expect(ids(items)).toEqual(expected.map((row) => row.id as string));
    const linked = items.find((item) => item.title === "Probe 1")!;
    expect(linked).toMatchObject({ incident_id: incidentId, incident_name: "Paging exercise" });
    expect(linked).not.toHaveProperty("page_at");
  });
});
