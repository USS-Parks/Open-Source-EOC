import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let baseUrl: string;
let hostA: string;
let hostB: string;
let partner: string;
let outsider: string;
let ownerId: string;
let partnerId: string;
let expiredId: string;
let ownerToken: string;
let partnerToken: string;
let expiredToken: string;
let outsiderToken: string;
let incidentA: string;
let incidentB: string;
let dashboardA: string;
let dashboardB: string;
let restrictedDashboard: string;
let shelterBoard: string;
let datasetId: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const incident = (id: string) => `/api/v1/incidents/${id}`;
const dashboard = (id: string, incidentId: string) =>
  `/api/v1/dashboards/${id}/data?incidentId=${incidentId}`;

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}

async function activate(jurisdictionId: string, name: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    headers: auth(ownerToken),
    payload: { templateKey: "wildfire", name },
  });
  expect(response.statusCode).toBe(201);
  return response.json().incidentId as string;
}

async function createDashboard(jurisdictionId: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/dashboards`,
    headers: auth(ownerToken),
    payload: { templateKey: "eoc_status" },
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

async function grant(personEmail: string, role: "viewer" | "coordinator", expiresAt: string) {
  return app.inject({
    method: "POST",
    url: `${incident(incidentA)}/participants`,
    headers: auth(ownerToken),
    payload: {
      organizationSlug: "partner-aid",
      personEmail,
      incidentPositionTitle: "Mutual Aid Viewer",
      role,
      expiresAt,
      reason: "VEOC-80 authorized viewing evidence",
    },
  });
}

async function nextSocketMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dashboard stream message timeout")), 3000);
    socket.once("message", (value) => {
      clearTimeout(timer);
      resolve(JSON.parse(value.toString()) as Record<string, unknown>);
    });
    socket.once("error", reject);
  });
}

async function socketClosed(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dashboard stream stayed open")), 3000);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  hostA = await createJurisdiction(admin, "host-a", "Host A EOC");
  hostB = await createJurisdiction(admin, "host-b", "Host B EOC");
  partner = await createJurisdiction(admin, "partner-aid", "Partner Mutual Aid");
  outsider = await createJurisdiction(admin, "outsider", "Unrelated Organization");
  ownerId = await createPerson(admin, {
    email: "owner@example.org",
    displayName: "Dual Host Owner",
    password: "owner-password-good",
  });
  partnerId = await createPerson(admin, {
    email: "viewer@example.org",
    displayName: "Partner Viewer",
    password: "partner-password-good",
  });
  expiredId = await createPerson(admin, {
    email: "expired@example.org",
    displayName: "Expired Viewer",
    password: "expired-password-good",
  });
  const outsiderId = await createPerson(admin, {
    email: "outsider@example.org",
    displayName: "Outsider",
    password: "outsider-password-good",
  });
  await addMembership(admin, ownerId, hostA, "admin");
  await addMembership(admin, ownerId, hostB, "admin");
  await addMembership(admin, partnerId, partner, "viewer");
  await addMembership(admin, expiredId, partner, "viewer");
  await addMembership(admin, outsiderId, outsider, "viewer");
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  ownerToken = await login("owner@example.org", "owner-password-good");
  partnerToken = await login("viewer@example.org", "partner-password-good");
  expiredToken = await login("expired@example.org", "expired-password-good");
  outsiderToken = await login("outsider@example.org", "outsider-password-good");
  incidentA = await activate(hostA, "Host A Fire");
  incidentB = await activate(hostB, "Host B Flood");
  dashboardA = await createDashboard(hostA);
  dashboardB = await createDashboard(hostB);
  const [shelter] = await admin`
    select b.id from boards b join incident_boards ib on ib.board_id = b.id
    where ib.incident_id = ${incidentA} and b.template_key = 'shelters'`;
  shelterBoard = shelter!.id as string;

  const restrictedBoardDefinition = {
    key: "restricted_ops",
    version: 1,
    title: "Restricted Operations",
    description: "Field masking evidence",
    fields: [
      { key: "public_label", label: "Public label", type: "text", required: true },
      { key: "admin_group", label: "Admin group", type: "text", read: "admin" },
      { key: "admin_value", label: "Admin value", type: "text", read: "admin" },
      { key: "admin_filter", label: "Admin filter", type: "text", read: "admin" },
    ],
    views: [{ key: "all", title: "All", columns: ["public_label"] }],
  };
  await admin`
    insert into board_templates (key, version, title, definition)
    values ('restricted_ops', 1, 'Restricted Operations', ${admin.json(restrictedBoardDefinition)})`;
  const restrictedBoardResponse = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${hostA}/boards`,
    headers: auth(ownerToken),
    payload: { templateKey: "restricted_ops" },
  });
  expect(restrictedBoardResponse.statusCode).toBe(201);
  const restrictedBoard = restrictedBoardResponse.json().id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentA}, ${restrictedBoard})`;
  await admin`
    insert into board_records (board_id, incident_id, data, created_by)
    values (${restrictedBoard}, ${incidentA}, ${admin.json({
      public_label: "Visible status",
      admin_group: "Secret group",
      admin_value: "Secret value",
      admin_filter: "Secret filter",
    })}, ${ownerId})`;
  const restrictedDashboardDefinition = {
    key: "restricted_dashboard",
    version: 1,
    title: "Restricted Dashboard",
    widgets: [
      { kind: "list", key: "restricted_list", title: "Restricted list", board: "restricted_ops",
        columns: ["public_label", "admin_value"], limit: 10 },
      { kind: "chart", key: "restricted_chart", title: "Restricted chart", board: "restricted_ops",
        groupBy: "admin_group", display: "bar" },
      { kind: "status", key: "restricted_status", title: "Restricted status", board: "restricted_ops",
        groupBy: "public_label", valueField: "admin_value" },
      { kind: "tile", key: "restricted_tile", title: "Restricted tile", board: "restricted_ops",
        filter: { field: "admin_filter", equals: "Secret filter" } },
    ],
  };
  await admin`
    insert into dashboard_templates (key, version, title, definition)
    values ('restricted_dashboard', 1, 'Restricted Dashboard',
      ${admin.json(restrictedDashboardDefinition)})`;
  const [restricted] = await admin`
    insert into dashboards (jurisdiction_id, template_key, template_version, title)
    values (${hostA}, 'restricted_dashboard', 1, 'Restricted Dashboard') returning id`;
  restrictedDashboard = restricted!.id as string;

  const pack = await app.inject({
    method: "POST",
    url: `${incident(incidentA)}/data-packs`,
    headers: auth(ownerToken),
    payload: {
      name: "Host A operational geometry",
      organizationSlug: "host-a",
      datasets: [{
        key: "authorized_geometry",
        name: "Authorized Geometry",
        kind: "geojson",
        fieldMapping: { title: "title", sourceId: "id", geometry: "geometry" },
      }],
    },
  });
  expect(pack.statusCode).toBe(201);
  datasetId = (await admin`select id from data_pack_datasets where key = 'authorized_geometry'`)[0]!.id as string;
  const load = await app.inject({
    method: "POST",
    url: `/api/v1/data-packs/datasets/${datasetId}/load`,
    headers: auth(ownerToken),
    payload: {
      records: [{
        id: "feature-a",
        title: "Authorized perimeter point",
        geometry: { type: "Point", coordinates: [-121.5, 38.5] },
      }],
    },
  });
  expect(load.statusCode).toBe(200);
});

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("VEOC-80 FOUO authorized viewing", () => {
  it("keeps incident, dashboard, and dataset reads exact, fresh, and read-only", async () => {
    const granted = await grant(
      "viewer@example.org",
      "viewer",
      new Date(Date.now() + 60_000).toISOString(),
    );
    expect(granted.statusCode).toBe(201);
    const participantId = granted.json().participant.id as string;

    const rawGrant = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${hostA}/guests`,
      headers: auth(ownerToken),
      payload: {
        personId: partnerId,
        scopes: [`board:${shelterBoard}:read`],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(rawGrant.statusCode).toBe(201);
    const me = await app.inject({ method: "GET", url: "/api/v1/me", headers: auth(partnerToken) });
    expect(me.json().guests).toEqual([
      expect.objectContaining({ jurisdictionId: hostA, scopes: [`board:${shelterBoard}:read`] }),
    ]);

    const invalidSocket = new WebSocket(
      `${baseUrl.replace("http", "ws")}/api/v1/dashboards/${dashboardA}/stream?incidentId=not-a-uuid`,
    );
    const invalidMessage = nextSocketMessage(invalidSocket);
    const invalidClosed = socketClosed(invalidSocket);
    expect(await invalidMessage).toEqual({ type: "error", error: "invalid incident scope" });
    await invalidClosed;

    const ownerUnscoped = await app.inject({
      method: "GET", url: `/api/v1/dashboards/${dashboardA}/data`, headers: auth(ownerToken),
    });
    expect(ownerUnscoped.statusCode, ownerUnscoped.body).toBe(200);

    for (const token of [ownerToken, partnerToken]) {
      expect((await app.inject({ method: "GET", url: incident(incidentA), headers: auth(token) })).statusCode).toBe(200);
      const dashboardRead = await app.inject({
        method: "GET", url: dashboard(dashboardA, incidentA), headers: auth(token),
      });
      expect(dashboardRead.statusCode, dashboardRead.body).toBe(200);
      expect((await app.inject({ method: "GET", url: `${incident(incidentA)}/datasets`, headers: auth(token) })).statusCode).toBe(200);
      const items = await app.inject({ method: "GET", url: `/api/v1/datasets/${datasetId}/items`, headers: auth(token) });
      expect(items.statusCode).toBe(200);
      expect(items.json().features[0]).toMatchObject({
        id: "feature-a",
        geometry: { type: "Point", coordinates: [-121.5, 38.5] },
      });
    }

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${hostA}/dashboards?incidentId=${incidentA}`,
      headers: auth(partnerToken),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().dashboards.map((item: { id: string }) => item.id)).toContain(dashboardA);
    expect((await app.inject({ method: "GET", url: `/api/v1/dashboards/${dashboardA}?incidentId=${incidentA}`, headers: auth(partnerToken) })).statusCode).toBe(200);

    const ownerRestrictedRead = await app.inject({
      method: "GET",
      url: dashboard(restrictedDashboard, incidentA),
      headers: auth(ownerToken),
    });
    expect(ownerRestrictedRead.statusCode).toBe(200);
    const ownerRestrictedWidgets = ownerRestrictedRead.json().widgets as Array<{
      key: string;
      columns?: string[];
      records?: Array<Record<string, unknown>>;
      groups?: Array<Record<string, unknown>>;
      value?: number;
    }>;
    expect(ownerRestrictedWidgets.find((widget) => widget.key === "restricted_list")).toMatchObject({
      columns: ["public_label", "admin_value"],
      records: [expect.objectContaining({ admin_value: "Secret value" })],
    });
    expect(ownerRestrictedWidgets.find((widget) => widget.key === "restricted_chart")).toMatchObject({
      groups: [{ value: "Secret group", count: 1 }],
    });
    expect(ownerRestrictedWidgets.find((widget) => widget.key === "restricted_status")).toMatchObject({
      groups: [expect.objectContaining({ group: "Visible status", value: "Secret value" })],
    });
    expect(ownerRestrictedWidgets.find((widget) => widget.key === "restricted_tile")).toMatchObject({
      value: 1,
    });

    const restrictedRead = await app.inject({
      method: "GET",
      url: dashboard(restrictedDashboard, incidentA),
      headers: auth(partnerToken),
    });
    expect(restrictedRead.statusCode).toBe(200);
    const restrictedWidgets = restrictedRead.json().widgets as Array<{
      key: string;
      missing?: boolean;
      columns?: string[];
      records?: Array<Record<string, unknown>>;
    }>;
    const list = restrictedWidgets.find((widget) => widget.key === "restricted_list")!;
    expect(list.columns).toEqual(["public_label"]);
    expect(list.records).toEqual([expect.objectContaining({ public_label: "Visible status" })]);
    expect(list.records![0]).not.toHaveProperty("admin_value");
    for (const key of ["restricted_chart", "restricted_status", "restricted_tile"]) {
      expect(restrictedWidgets.find((widget) => widget.key === key)).toMatchObject({ missing: true });
    }

    expect((await app.inject({ method: "GET", url: dashboard(dashboardA, incidentB), headers: auth(ownerToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: dashboard(dashboardB, incidentA), headers: auth(partnerToken) })).statusCode).toBe(404);
    for (const token of [partnerToken, outsiderToken]) {
      expect((await app.inject({ method: "GET", url: incident(incidentB), headers: auth(token) })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: "GET", url: incident(incidentA) })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: dashboard(dashboardA, incidentA) })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `${incident(incidentA)}/datasets` })).statusCode).toBe(401);

    expect((await app.inject({
      method: "POST",
      url: `/api/v1/boards/${shelterBoard}/records?incidentId=${incidentA}`,
      headers: auth(partnerToken),
      payload: { name: "Viewer write", status: "normal", capacity: 1, occupancy: 0 },
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/data-packs/datasets/${datasetId}/load`,
      headers: auth(partnerToken),
      payload: { records: [] },
    })).statusCode).toBe(403);

    const wsUrl = `${baseUrl.replace("http", "ws")}/api/v1/dashboards/${dashboardA}/stream?incidentId=${incidentA}`;
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({ type: "auth", token: partnerToken }));
    expect(await nextSocketMessage(socket)).toMatchObject({ type: "snapshot" });

    const revoked = await app.inject({
      method: "POST",
      url: `${incident(incidentA)}/participants/${participantId}/revoke`,
      headers: auth(ownerToken),
      payload: { reason: "Mutual-aid assignment ended" },
    });
    expect(revoked.statusCode).toBe(200);
    for (const url of [incident(incidentA), dashboard(dashboardA, incidentA), `${incident(incidentA)}/datasets`]) {
      expect((await app.inject({ method: "GET", url, headers: auth(partnerToken) })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: "GET", url: `/api/v1/boards/${shelterBoard}`, headers: auth(partnerToken) })).statusCode).toBe(200);

    const closing = socketClosed(socket);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/boards/${shelterBoard}/records?incidentId=${incidentA}`,
      headers: auth(ownerToken),
      payload: { name: "Host update", status: "normal", capacity: 20, occupancy: 3 },
    })).statusCode).toBe(201);
    await closing;

    const expiring = await grant(
      "expired@example.org",
      "viewer",
      new Date(Date.now() + 700).toISOString(),
    );
    expect(expiring.statusCode).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 800));
    for (const url of [incident(incidentA), dashboard(dashboardA, incidentA), `${incident(incidentA)}/datasets`]) {
      expect((await app.inject({ method: "GET", url, headers: auth(expiredToken) })).statusCode).toBe(404);
    }
  });
});
