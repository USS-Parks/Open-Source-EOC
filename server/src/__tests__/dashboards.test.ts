import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { STANDARD_DASHBOARDS, type DashboardSnapshot } from "@openeoc/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Dashboards: server-side aggregation over several boards with
 * no client-side joins, live refresh pushed over the stream, and
 * definitions that round-trip between jurisdictions.
 */

const LIVE_REFRESH_BUDGET_MS = 2000;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let baseUrl: string;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let outsiderToken: string;
let bAdminToken: string;
let jurisdictionB: string;
let dashboardId: string;
let roadsBoardId: string;

const boards: Record<string, string> = {};

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  await admin`update persons set is_instance_admin = true
    where email = 'admin@example.org'`;

  // A second jurisdiction with its own admin, for the cross-jurisdiction
  // round trip; an outsider with no membership anywhere that matters.
  jurisdictionB = await createJurisdiction(admin, "downriver", "Downriver County OES");
  const bAdminId = await createPerson(admin, {
    email: "b-admin@example.org",
    displayName: "B Admin",
    password: "b-admin-password-ok",
  });
  await addMembership(admin, bAdminId, jurisdictionB, "admin");
  const outsiderId = await createPerson(admin, {
    email: "outsider@example.org",
    displayName: "Outsider",
    password: "outsider-password-ok",
  });
  void outsiderId;

  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  outsiderToken = await tokenFor(app, "outsider@example.org", "outsider-password-ok");
  bAdminToken = await tokenFor(app, "b-admin@example.org", "b-admin-password-ok");

  for (const key of ["lifelines", "shelters", "road_closures"]) {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { templateKey: key },
    });
    boards[key] = res.json().id as string;
  }
  roadsBoardId = boards.road_closures!;

  const dash = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/dashboards`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey: "eoc_status" },
  });
  expect(dash.statusCode).toBe(201);
  dashboardId = dash.json().id as string;

  // The picture: two closed roads and a reopened one; three shelters;
  // lifeline entries where a later entry supersedes an earlier one.
  await post("road_closures", { road: "SR-169", reason: "slide", status: "closed" });
  await post("road_closures", { road: "SR-96", reason: "flooding", status: "closed" });
  await post("road_closures", { road: "US-101", reason: "wind", status: "reopened" });
  await post("shelters", { name: "Weitchpec Gym", status: "normal", capacity: 120, occupancy: 40 });
  await post("shelters", { name: "Klamath Hall", status: "normal", capacity: 80, occupancy: 75 });
  await post("shelters", { name: "Orick School", status: "closed", capacity: 60, occupancy: 0 });
  await post("lifelines", { lifeline: "energy", status: "stable" });
  await post("lifelines", { lifeline: "water_systems", status: "stabilizing" });
  await post("lifelines", { lifeline: "energy", status: "unstable", note: "substation down" });
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});


async function post(board: string, data: Record<string, unknown>): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/boards/${boards[board]}/records`,
    headers: { authorization: `Bearer ${memberToken}` },
    payload: data,
  });
  if (res.statusCode !== 201) throw new Error(`post to ${board} failed: ${res.body}`);
}

async function snapshot(token: string): Promise<DashboardSnapshot> {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/dashboards/${dashboardId}/data`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as DashboardSnapshot;
}

async function snapshotFiltered(token: string, field: string, equals: string): Promise<DashboardSnapshot> {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/dashboards/${dashboardId}/data?field=${field}&equals=${equals}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as DashboardSnapshot;
}

function widget<T>(snap: DashboardSnapshot, key: string): T {
  const found = snap.widgets.find((w) => w.key === key);
  expect(found, `widget ${key}`).toBeDefined();
  return found as T;
}

interface Tile { value: number; level: string }
interface Chart { groups: { value: string; count: number }[] }
interface StatusW { groups: { group: string; value: string | null; at: string | null }[] }
interface List { columns: string[]; records: Record<string, unknown>[] }

describe("server-side aggregation (AR6: no join trap)", () => {
  it("computes tiles, charts, status, and lists across three boards in one snapshot", async () => {
    const snap = await snapshot(memberToken);
    expect(snap.widgets).toHaveLength(5);

    const tile = widget<Tile>(snap, "closed_roads");
    expect(tile.value).toBe(2);
    expect(tile.level).toBe("warn"); // 2 >= warn(1), below critical(5)

    const chart = widget<Chart>(snap, "shelters_by_status");
    expect(chart.groups).toEqual([
      { value: "closed", count: 1 },
      { value: "normal", count: 2 },
    ]);

    const list = widget<List>(snap, "active_closures");
    expect(list.columns).toEqual(["road", "reason", "status"]);
    expect(list.records.map((r) => r.road).sort()).toEqual(["SR-169", "SR-96"].sort());
  });

  it("status widgets report the LATEST entry per group; older entries stay history", async () => {
    const snap = await snapshot(memberToken);
    const lifelines = widget<StatusW>(snap, "lifelines");
    const byGroup = new Map(lifelines.groups.map((g) => [g.group, g.value]));
    expect(byGroup.get("energy")).toBe("unstable"); // superseded "stable"
    expect(byGroup.get("water_systems")).toBe("stabilizing");
    // History is intact underneath: three lifeline records exist.
    const [row] = await admin`
      select count(*)::int as n from board_records
      where board_id = ${boards.lifelines!}`;
    expect(row!.n).toBe(3);
  });

  it("hides the dashboard from a person outside the jurisdiction", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/dashboards/${dashboardId}/data`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("live refresh over the stream", () => {
  it("rejects a malformed incidentId instead of leaving the stream unscoped", async () => {
    const socket = new WebSocket(
      `ws://${baseUrl}/api/v1/dashboards/${dashboardId}/stream?incidentId=not-a-uuid`,
    );
    const msg = await new Promise<{ type: string; error?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no stream error")), 5000);
      socket.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.on("message", (raw: Buffer) => {
        clearTimeout(timer);
        resolve(JSON.parse(raw.toString()) as { type: string; error?: string });
      });
    });
    expect(msg.type).toBe("error");
    expect(msg.error).toBe("invalid incident scope");
    socket.close();
  });

  it("pushes a recomputed snapshot after a field edit, inside the budget", async () => {
    const socket = new WebSocket(`ws://${baseUrl}/api/v1/dashboards/${dashboardId}/stream`);
    const snapshots: DashboardSnapshot[] = [];
    let announce: (() => void) | null = null;

    await new Promise<void>((resolve, reject) => {
      socket.on("open", () =>
        socket.send(JSON.stringify({ type: "auth", token: memberToken })),
      );
      socket.on("error", reject);
      socket.on("message", (raw: Buffer) => {
        const msg = JSON.parse(raw.toString()) as { type: string; data?: DashboardSnapshot; error?: string };
        if (msg.type === "error") return reject(new Error(msg.error));
        if (msg.type === "snapshot") {
          snapshots.push(msg.data!);
          if (snapshots.length === 1) resolve();
          announce?.();
        }
      });
    });
    expect(snapshots).toHaveLength(1);

    const t0 = Date.now();
    const next = new Promise<void>((resolve) => {
      announce = resolve;
    });
    await post("road_closures", { road: "Bald Hills Rd", reason: "fire", status: "closed" });
    await next;
    const latency = Date.now() - t0;
    expect(latency).toBeLessThanOrEqual(LIVE_REFRESH_BUDGET_MS);

    const tile = widget<Tile>(snapshots.at(-1)!, "closed_roads");
    expect(tile.value).toBe(3);
    socket.close();

    // Restore the picture for any later assertions.
    const [row] = await admin`
      select id from board_records
      where board_id = ${roadsBoardId} and data ->> 'road' = 'Bald Hills Rd'`;
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/boards/${roadsBoardId}/records/${row!.id as string}`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { status: "reopened" },
    });
    expect(patch.statusCode).toBe(200);
  });
});

describe("definitions travel between jurisdictions", () => {
  it("exports byte-equal, re-imports under a new key, and computes in the other jurisdiction", async () => {
    const exported = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard-templates/eoc_status/1/export",
      headers: { authorization: `Bearer ${bAdminToken}` },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.json()).toEqual(STANDARD_DASHBOARDS[0]);

    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/dashboard-templates",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { ...(exported.json() as Record<string, unknown>), key: "eoc_status_import" },
    });
    expect(registered.statusCode).toBe(201);

    // Jurisdiction B runs only a shelters board; the imported dashboard
    // still stands up, with the unmatched widgets marked missing.
    const bBoard = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${jurisdictionB}/boards`,
      headers: { authorization: `Bearer ${bAdminToken}` },
      payload: { templateKey: "shelters" },
    });
    expect(bBoard.statusCode).toBe(201);
    const rec = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${bBoard.json().id as string}/records`,
      headers: { authorization: `Bearer ${bAdminToken}` },
      payload: { name: "County Fairgrounds", status: "normal", capacity: 300, occupancy: 12 },
    });
    expect(rec.statusCode).toBe(201);

    const bDash = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${jurisdictionB}/dashboards`,
      headers: { authorization: `Bearer ${bAdminToken}` },
      payload: { templateKey: "eoc_status_import" },
    });
    expect(bDash.statusCode).toBe(201);
    const data = await app.inject({
      method: "GET",
      url: `/api/v1/dashboards/${bDash.json().id as string}/data`,
      headers: { authorization: `Bearer ${bAdminToken}` },
    });
    expect(data.statusCode).toBe(200);
    const snap = data.json() as DashboardSnapshot;
    const chart = widget<Chart>(snap, "shelters_by_status");
    expect(chart.groups).toEqual([{ value: "normal", count: 1 }]);
    const lifelines = widget<StatusW & { missing?: boolean }>(snap, "lifelines");
    expect(lifelines.missing).toBe(true);
    expect(lifelines.groups).toEqual([]);
  });

  it("rejects registration by a non-instance-admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/dashboard-templates",
      headers: { authorization: `Bearer ${bAdminToken}` },
      payload: { ...STANDARD_DASHBOARDS[0], key: "sneaky" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("runtime dashboard filter", () => {
  it("scopes the counting widgets, reconciles the totals, and echoes the filter", async () => {
    // Shelters: two normal, one closed. Unfiltered, all three are counted.
    const all = await snapshot(memberToken);
    const chartAll = widget<Chart>(all, "shelters_by_status");
    expect(chartAll.groups.reduce((s, g) => s + g.count, 0)).toBe(3);

    // Filtered to status=normal, only the two normal shelters remain, and the
    // applied filter is echoed so the view (and a deep link) can reproduce it.
    const filtered = await snapshotFiltered(memberToken, "status", "normal");
    expect(filtered.filter).toEqual({ field: "status", equals: "normal" });
    const chartFiltered = widget<Chart>(filtered, "shelters_by_status");
    expect(chartFiltered.groups.every((g) => g.value === "normal")).toBe(true);
    expect(chartFiltered.groups.reduce((s, g) => s + g.count, 0)).toBe(2);
  });
});

describe("kanban and calendar widgets", () => {
  interface Kanban { columns: { value: string | null; count: number }[] }
  interface Upcoming { items: { id: string; at: string; label: string | null }[] }

  it("counts kanban columns in the enum's order and lists what is upcoming, leaving archived records out", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/dashboard-templates",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        key: "road_views", version: 1, title: "Road views",
        widgets: [
          { kind: "kanban", key: "by_status", title: "Closures by status", board: "road_closures", field: "status" },
          { kind: "calendar", key: "reopenings", title: "Reopenings", board: "road_closures",
            field: "reopen_estimate", labelField: "road", limit: 2 },
          { kind: "tile", key: "closures", title: "Closures", board: "road_closures" },
          { kind: "chart", key: "closure_chart", title: "Closures by status", board: "road_closures", groupBy: "status" },
        ],
      },
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/dashboards`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { templateKey: "road_views" },
    });
    const viewsId = created.json().id as string;
    const read = async () => {
      const res = await app.inject({
        method: "GET", url: `/api/v1/dashboards/${viewsId}/data`, headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(res.statusCode, res.body).toBe(200);
      const snap = res.json() as DashboardSnapshot;
      return {
        kanban: widget<Kanban>(snap, "by_status"),
        upcoming: widget<Upcoming>(snap, "reopenings"),
        tile: widget<{ value: number }>(snap, "closures"),
        chart: widget<{ groups: { value: string; count: number }[] }>(snap, "closure_chart"),
      };
    };

    const hour = 3_600_000;
    const at = (offset: number) => new Date(Date.now() + offset).toISOString();
    await post("road_closures", { road: "Past reopening", reason: "slide", status: "closed", reopen_estimate: at(-hour) });
    await post("road_closures", { road: "Later reopening", reason: "slide", status: "closed", reopen_estimate: at(48 * hour) });
    await post("road_closures", { road: "Next reopening", reason: "slide", status: "closed", reopen_estimate: at(hour) });
    await post("road_closures", { road: "Last reopening", reason: "slide", status: "closed", reopen_estimate: at(72 * hour) });
    const before = await read();
    expect(before.kanban.columns.map((column) => column.value)).toEqual(["closed", "one_lane", "reopened"]);
    expect(before.kanban.columns[1]!.count).toBe(0);
    const [counted] = await admin`
      select count(*)::int as n from board_records
      where board_id = ${roadsBoardId} and data ->> 'status' = 'closed' and archived_at is null`;
    expect(before.kanban.columns[0]!.count).toBe(counted!.n);
    // Soonest first, nothing in the past, and no more than the widget's limit.
    expect(before.upcoming.items.map((item) => item.label)).toEqual(["Next reopening", "Later reopening"]);

    const [next] = await admin`
      select id from board_records where board_id = ${roadsBoardId} and data ->> 'road' = 'Next reopening'`;
    const archived = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${roadsBoardId}/records/${next!.id as string}/archive`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const after = await read();
    expect(after.kanban.columns[0]!.count).toBe(counted!.n - 1);
    // Every widget counts what the board's default view shows: archived records are out.
    expect(after.tile.value).toBe(before.tile.value - 1);
    const closedIn = (c: typeof before.chart) => c.groups.find((g) => g.value === "closed")!.count;
    expect(closedIn(after.chart)).toBe(closedIn(before.chart) - 1);
    expect(after.upcoming.items.map((item) => item.label)).toEqual(["Later reopening", "Last reopening"]);
  });
});
