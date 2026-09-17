import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { STANDARD_DASHBOARDS, type DashboardSnapshot } from "@openeoc/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Dashboards (VEOC-18): server-side aggregation over several boards with
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

  adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor("member@example.org", "another-good-password");
  outsiderToken = await tokenFor("outsider@example.org", "outsider-password-ok");
  bAdminToken = await tokenFor("b-admin@example.org", "b-admin-password-ok");

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

async function tokenFor(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  return res.json().accessToken as string;
}

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
    expect(snap.widgets).toHaveLength(4);

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
