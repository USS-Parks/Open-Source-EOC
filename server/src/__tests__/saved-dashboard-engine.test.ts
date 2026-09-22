import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let host: string;
let otherHost: string;
let partnerOrg: string;
let outsiderOrg: string;
let adminId: string;
let partnerId: string;
let adminToken: string;
let memberToken: string;
let partnerToken: string;
let outsiderToken: string;
let incidentId: string;
let otherIncidentId: string;
let dashboardId: string;
let participantId: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const point = (x: number, y: number) => ({ type: "Point", coordinates: [x, y] });
const polygon = (west: number, south: number, east: number, north: number) => ({
  type: "Polygon",
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

async function activate(jurisdictionId: string, name: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    headers: auth(adminToken),
    payload: { templateKey: "wildfire", name },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().incidentId as string;
}

async function createBoard(templateKey: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${host}/boards`,
    headers: auth(adminToken),
    payload: { templateKey },
  });
  expect(response.statusCode, response.body).toBe(201);
  const boardId = response.json().id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  return boardId;
}

async function saveConfig(
  token: string,
  key: string,
  composition: Record<string, unknown>,
  expectedRevision = 0,
) {
  return app.inject({
    method: "PUT",
    url: `/api/v1/incidents/${incidentId}/dashboard-configs/${key}`,
    headers: auth(token),
    payload: { expectedRevision, composition },
  });
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  host = seed.jurisdictionId;
  adminId = seed.adminId;
  otherHost = await createJurisdiction(admin, "other-host", "Other Host");
  partnerOrg = await createJurisdiction(admin, "dashboard-aid", "Dashboard Mutual Aid");
  outsiderOrg = await createJurisdiction(admin, "dashboard-outside", "Dashboard Outsider");
  partnerId = await createPerson(admin, {
    email: "dashboard-partner@example.org",
    displayName: "Dashboard Partner",
    password: "dashboard-partner-password",
  });
  const outsiderId = await createPerson(admin, {
    email: "dashboard-outsider@example.org",
    displayName: "Dashboard Outsider",
    password: "dashboard-outsider-password",
  });
  await addMembership(admin, adminId, otherHost, "admin");
  await addMembership(admin, partnerId, partnerOrg, "viewer");
  await addMembership(admin, outsiderId, outsiderOrg, "viewer");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);

  const publicBoard = {
    key: "composable_ops",
    version: 1,
    title: "Composable Operations",
    description: "Filter and drilldown fixture",
    fields: [
      { key: "label", label: "Label", type: "text", required: true },
      { key: "category", label: "Category", type: "text", required: true },
      { key: "period", label: "Period", type: "text", required: true },
      { key: "state", label: "State", type: "text", required: true },
      { key: "status", label: "Status", type: "text", required: true },
      { key: "secret", label: "Secret", type: "text", read: "admin" },
      { key: "location", label: "Location", type: "geometry", geometryKind: "point" },
    ],
    views: [{ key: "all", title: "All", columns: ["label", "category", "period", "state"] }],
  };
  const restrictedBoard = {
    key: "restricted_geo",
    version: 1,
    title: "Restricted Geometry",
    description: "Role mask fixture",
    fields: [
      { key: "public_label", label: "Public label", type: "text", required: true },
      { key: "category", label: "Category", type: "text", required: true },
      { key: "period", label: "Period", type: "text", required: true },
      { key: "admin_secret", label: "Admin secret", type: "text", read: "admin" },
      { key: "secret_location", label: "Secret location", type: "geometry", geometryKind: "point", read: "admin" },
    ],
    views: [{ key: "all", title: "All", columns: ["public_label"] }],
  };
  await admin`
    insert into board_templates (key, version, title, definition) values
      ('composable_ops', 1, 'Composable Operations', ${admin.json(publicBoard)}),
      ('restricted_geo', 1, 'Restricted Geometry', ${admin.json(restrictedBoard)})`;

  const dashboard = {
    key: "composable_dashboard",
    version: 1,
    title: "Composable Dashboard",
    widgets: [
      { kind: "tile", key: "public_tile", title: "Public total", board: "composable_ops",
        filter: { field: "state", equals: "active" } },
      { kind: "chart", key: "public_chart", title: "Public chart", board: "composable_ops",
        filter: { field: "state", equals: "active" }, groupBy: "category", display: "bar" },
      { kind: "list", key: "public_list", title: "Public list", board: "composable_ops",
        filter: { field: "state", equals: "active" },
        columns: ["label", "category", "period", "secret", "location"], limit: 10 },
      { kind: "status", key: "public_status", title: "Public status", board: "composable_ops",
        filter: { field: "state", equals: "active" }, groupBy: "category", valueField: "status" },
      { kind: "list", key: "restricted_list", title: "Restricted list", board: "restricted_geo",
        columns: ["public_label", "admin_secret"], limit: 10 },
      { kind: "chart", key: "restricted_chart", title: "Restricted chart", board: "restricted_geo",
        groupBy: "admin_secret", display: "bar" },
    ],
  };
  await admin`
    insert into dashboard_templates (key, version, title, definition)
    values ('composable_dashboard', 1, 'Composable Dashboard', ${admin.json(dashboard)})`;

  app = buildApp(runtime, { oidc: null });
  adminToken = await login("admin@example.org", "correct-horse-battery");
  memberToken = await login("member@example.org", "another-good-password");
  partnerToken = await login("dashboard-partner@example.org", "dashboard-partner-password");
  outsiderToken = await login("dashboard-outsider@example.org", "dashboard-outsider-password");
  incidentId = await activate(host, "Composable Incident");
  otherIncidentId = await activate(otherHost, "Other Incident");

  const publicBoardId = await createBoard("composable_ops");
  const restrictedBoardId = await createBoard("restricted_geo");
  const [dashboardRow] = await admin`
    insert into dashboards (jurisdiction_id, template_key, template_version, title)
    values (${host}, 'composable_dashboard', 1, 'Composable Dashboard') returning id`;
  dashboardId = dashboardRow!.id as string;

  const publicRows = [
    ["one", "A", "OP1", "active", "open", "alpha", -121.5, 38.5, "2026-01-01T00:00:00Z"],
    ["two", "A", "OP1", "active", "closed", "bravo", -121.4, 38.6, "2026-01-02T00:00:00Z"],
    ["outside", "A", "OP1", "active", "open", "charlie", -100, 38.5, "2026-01-02T00:00:00Z"],
    ["other-category", "B", "OP1", "active", "open", "delta", -121.3, 38.5, "2026-01-02T00:00:00Z"],
    ["other-period", "A", "OP2", "active", "open", "echo", -121.2, 38.5, "2026-01-02T00:00:00Z"],
    ["boundary", "A", "OP1", "active", "open", "foxtrot", -121.1, 38.5, "2026-01-03T00:00:00Z"],
    ["inactive", "A", "OP1", "inactive", "open", "golf", -121.0, 38.5, "2026-01-02T00:00:00Z"],
  ] as const;
  for (const [label, category, period, state, status, secret, x, y, at] of publicRows) {
    const location = point(x, y);
    await admin`
      insert into board_records (board_id, incident_id, data, geom, created_by, created_at)
      values (${publicBoardId}, ${incidentId},
        ${admin.json({ label, category, period, state, status, secret, location })},
        ST_SetSRID(ST_MakePoint(${x}, ${y}), 4326), ${adminId}, ${new Date(at)})`;
  }
  for (const [label, at] of [
    ["micro-later", "2026-01-02 00:00:00.000900+00"],
    ["micro-earlier", "2026-01-02 00:00:00.000100+00"],
  ] as const) {
    const location = point(-121.25, 38.5);
    await admin`
      insert into board_records (board_id, incident_id, data, geom, created_by, created_at)
      values (${publicBoardId}, ${incidentId},
        ${admin.json({ label, category: "C", period: "OP3", state: "active",
          status: "open", secret: "micro", location })},
        ST_SetSRID(ST_MakePoint(-121.25, 38.5), 4326), ${adminId}, ${at}::timestamptz)`;
  }
  const nullGroupLocation = point(-121.2, 38.5);
  await admin`
    insert into board_records (board_id, incident_id, data, geom, created_by, created_at)
    values (${publicBoardId}, ${incidentId},
      ${admin.json({ label: "missing-category", period: "NULLGROUP", state: "active",
        status: "open", secret: "null", location: nullGroupLocation })},
      ST_SetSRID(ST_MakePoint(-121.2, 38.5), 4326), ${adminId},
      ${"2026-01-02 12:00:00+00"}::timestamptz)`;
  const restrictedLocation = point(-121.45, 38.55);
  await admin`
    insert into board_records (board_id, incident_id, data, geom, created_by, created_at)
    values (${restrictedBoardId}, ${incidentId},
      ${admin.json({ public_label: "Visible", category: "A", period: "OP1",
        admin_secret: "Command only", secret_location: restrictedLocation })},
      ST_SetSRID(ST_MakePoint(-121.45, 38.55), 4326), ${adminId}, ${new Date("2026-01-02T00:00:00Z")})`;

  await admin`
    insert into incident_area_revisions
      (incident_id, revision, geometry, period_label, period_starts_at, period_ends_at,
       reason, created_by)
    values (${incidentId}, 1,
      ST_GeomFromGeoJSON(${JSON.stringify(polygon(-122, 37, -120, 39))}),
      'OP1', ${new Date("2026-01-01T00:00:00Z")}, ${new Date("2026-01-03T00:00:00Z")},
      'dashboard impact area', ${adminId})`;
  const [pack] = await admin`
    insert into data_packs (incident_id, organization_id, name, created_by)
    values (${incidentId}, ${host}, 'Stale dashboard baseline', ${adminId}) returning id`;
  const [dataset] = await admin`
    insert into data_pack_datasets
      (pack_id, key, name, kind, field_mapping, coverage, stale_after_seconds,
       last_success_at, item_count, created_at)
    values (${pack!.id as string}, 'humboldt_parcels', 'Stale parcels', 'geojson', '{}'::jsonb,
      ST_GeomFromGeoJSON(${JSON.stringify(polygon(-123, 36, -119, 40))}),
      60, ${new Date("2020-01-01T00:00:00Z")}, 1, ${new Date("2020-01-01T00:00:00Z")}) returning id`;
  await admin`
    insert into data_pack_items (dataset_id, incident_id, source_id, data, geom, loaded_by, last_loaded_at)
    values (${dataset!.id as string}, ${incidentId}, 'stale-one', '{}'::jsonb,
      ST_SetSRID(ST_MakePoint(-121.5, 38.5), 4326), ${adminId}, ${new Date("2020-01-01T00:00:00Z")})`;

  const grant = await app.inject({
    method: "POST",
    url: `/api/v1/incidents/${incidentId}/participants`,
    headers: auth(adminToken),
    payload: {
      organizationSlug: "dashboard-aid",
      personEmail: "dashboard-partner@example.org",
      incidentPositionTitle: "Dashboard Viewer",
      role: "viewer",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      reason: "UNIT81-E dashboard verification",
    },
  });
  expect(grant.statusCode, grant.body).toBe(201);
  participantId = grant.json().participant.id as string;
});

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

const filteredComposition = () => ({
  title: "Filtered operations",
  defaultFilters: {
    category: { field: "category", equals: "A" },
    operationalPeriod: { field: "period", areaRevision: 1 },
    date: { from: "2026-01-01T00:00:00Z", to: "2026-01-03T00:00:00Z" },
  },
  bbox: [-122, 37, -120, 39],
  panels: [
    { key: "total", source: "dashboard", dashboardId, widgetKey: "public_tile", presentation: "tile" },
    { key: "chart", source: "dashboard", dashboardId, widgetKey: "public_chart", presentation: "chart" },
    { key: "list", source: "dashboard", dashboardId, widgetKey: "public_list", presentation: "list" },
    { key: "map", source: "dashboard", dashboardId, widgetKey: "public_list", presentation: "map" },
    { key: "restricted", source: "dashboard", dashboardId, widgetKey: "restricted_list", presentation: "list" },
    { key: "restricted_map", source: "dashboard", dashboardId, widgetKey: "restricted_list", presentation: "map" },
    { key: "restricted_chart", source: "dashboard", dashboardId, widgetKey: "restricted_chart", presentation: "chart" },
    { key: "impact", source: "impact", category: "structures_parcels", presentation: "tile" },
  ],
});

describe("UNIT81-E saved composable dashboard engine", () => {
  it("isolates saved configs by person and incident while preserving optimistic revisions", async () => {
    for (const token of [adminToken, memberToken, partnerToken]) {
      const saved = await saveConfig(token, "operations", filteredComposition());
      expect(saved.statusCode, saved.body).toBe(201);
      expect(saved.json().state.revision).toBe(1);
    }
    const duplicate = await saveConfig(adminToken, "operations", filteredComposition());
    expect(duplicate.statusCode).toBe(409);

    const adminList = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs`,
      headers: auth(adminToken),
    });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json().configs).toEqual([
      expect.objectContaining({ key: "operations", title: "Filtered operations", valid: true }),
    ]);
    const otherIncident = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${otherIncidentId}/dashboard-configs/operations`,
      headers: auth(adminToken),
    });
    expect(otherIncident.statusCode).toBe(404);
    const mismatchedDashboard = await app.inject({
      method: "PUT",
      url: `/api/v1/incidents/${otherIncidentId}/dashboard-configs/mismatch`,
      headers: auth(adminToken),
      payload: {
        expectedRevision: 0,
        composition: {
          title: "Mismatched dashboard",
          panels: [{ key: "total", source: "dashboard", dashboardId,
            widgetKey: "public_tile", presentation: "tile" }],
        },
      },
    });
    expect(mismatchedDashboard.statusCode).toBe(404);
    const outsider = await saveConfig(outsiderToken, "operations", filteredComposition());
    expect(outsider.statusCode).toBe(404);
    const anonymous = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it("applies category, period, half-open date, static, and bbox filters identically", async () => {
    for (const token of [adminToken, memberToken, partnerToken]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data`,
        headers: auth(token),
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().resolvedOperationalPeriod).toEqual({
        areaRevision: 1,
        label: "OP1",
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: "2026-01-03T00:00:00.000Z",
      });
      const panels = response.json().panels as Array<Record<string, unknown>>;
      expect((panels.find((panel) => panel.key === "total")!.data as { value: number }).value).toBe(2);
      expect((panels.find((panel) => panel.key === "chart")!.data as { groups: unknown[] }).groups)
        .toEqual([{ value: "A", count: 2 }]);
      expect((panels.find((panel) => panel.key === "list")!.data as { records: unknown[] }).records)
        .toHaveLength(2);
      expect(panels.find((panel) => panel.key === "impact")).toMatchObject({
        state: "unsupported",
        filterCapabilities: ["bbox"],
        notApplied: ["category", "operationalPeriod", "date"],
      });
    }
    const invalidBbox = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data?bbox=2,2,1,1`,
      headers: auth(adminToken),
    });
    expect(invalidBbox.statusCode).toBe(400);
    const wholeIncident = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data?scope=incident`,
      headers: auth(adminToken),
    });
    expect(wholeIncident.statusCode, wholeIncident.body).toBe(200);
    expect(wholeIncident.json().scope).toEqual({ kind: "incident-area", bbox: null });
    expect(wholeIncident.json().panels.find((panel: { key: string }) => panel.key === "total").data.value)
      .toBe(3);
    const conflictingScope = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data?scope=incident&bbox=-122,37,-120,39`,
      headers: auth(adminToken),
    });
    expect(conflictingScope.statusCode).toBe(400);
    const invertedMergedDate = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data?from=2026-01-04T00:00:00Z`,
      headers: auth(adminToken),
    });
    expect(invertedMergedDate.statusCode).toBe(400);
  });

  it("clears or replaces saved filters without mutating the saved composition", async () => {
    const clear = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data?filterMode=clear`,
      headers: auth(adminToken),
    });
    expect(clear.statusCode, clear.body).toBe(200);
    expect(clear.json()).toMatchObject({
      filterMode: "clear",
      filters: null,
      resolvedOperationalPeriod: null,
    });
    const clearPanels = clear.json().panels as Array<Record<string, unknown>>;
    expect((clearPanels.find((panel) => panel.key === "total")!.data as { value: number }).value)
      .toBe(8);
    expect((clearPanels.find((panel) => panel.key === "chart")!.data as { groups: unknown[] }).groups)
      .toEqual([
        { value: "", count: 1 },
        { value: "A", count: 4 },
        { value: "B", count: 1 },
        { value: "C", count: 2 },
      ]);
    expect((clearPanels.find((panel) => panel.key === "list")!.data as { records: unknown[] }).records)
      .toHaveLength(8);
    expect(clearPanels.find((panel) => panel.key === "impact")).toMatchObject({
      state: "stale", notApplied: [],
    });

    const replace = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data` +
        `?filterMode=replace&categoryField=category&category=B`,
      headers: auth(adminToken),
    });
    expect(replace.statusCode, replace.body).toBe(200);
    expect(replace.json()).toMatchObject({
      filterMode: "replace",
      filters: { category: { field: "category", equals: "B" } },
      resolvedOperationalPeriod: null,
    });
    const replacePanels = replace.json().panels as Array<Record<string, unknown>>;
    expect((replacePanels.find((panel) => panel.key === "total")!.data as { value: number }).value)
      .toBe(1);
    expect((replacePanels.find((panel) => panel.key === "chart")!.data as { groups: unknown[] }).groups)
      .toEqual([{ value: "B", count: 1 }]);
    expect((replacePanels.find((panel) => panel.key === "list")!.data as { records: unknown[] }).records)
      .toHaveLength(1);
    expect((replacePanels.find((panel) => panel.key === "restricted")!.data as { records: unknown[] }).records)
      .toHaveLength(0);
    expect((replacePanels.find((panel) => panel.key === "restricted_chart")!.data as { groups: unknown[] }).groups)
      .toHaveLength(0);
    expect(replacePanels.find((panel) => panel.key === "impact")).toMatchObject({
      state: "unsupported", notApplied: ["category"],
    });

    for (const url of [
      `/api/v1/dashboards/${dashboardId}/widgets/public_tile/records?incidentId=${incidentId}&bbox=-122,37,-120,39`,
      `/api/v1/dashboards/${dashboardId}/widgets/public_tile/records?incidentId=${incidentId}` +
        `&bbox=-122,37,-120,39&categoryField=category&category=B`,
    ]) {
      const contributors = await app.inject({ method: "GET", url, headers: auth(adminToken) });
      expect(contributors.statusCode, contributors.body).toBe(200);
      expect(contributors.json().total).toBe(url.includes("category=B") ? 1 : 8);
    }
    const rejectedClear = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data` +
        `?filterMode=clear&field=category&equals=A`,
      headers: auth(adminToken),
    });
    expect(rejectedClear.statusCode).toBe(400);

    const stored = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations`,
      headers: auth(adminToken),
    });
    expect(stored.json().composition.defaultFilters).toEqual(filteredComposition().defaultFilters);
  });

  it("resolves only real, unambiguous operational periods from the selected incident", async () => {
    const geometry = JSON.stringify(polygon(-122, 37, -120, 39));
    const hostPeriods = [
      [2, "Ambiguous", "2026-02-01T00:00:00Z", "2026-02-02T00:00:00Z"],
      [3, "Ambiguous", "2026-02-02T00:00:00Z", "2026-02-03T00:00:00Z"],
      [4, null, null, null],
      [5, "OP1", "2026-01-01T00:00:00Z", "2026-01-03T00:00:00Z"],
    ] as const;
    for (const [revision, label, startsAt, endsAt] of hostPeriods) {
      await admin`
        insert into incident_area_revisions
          (incident_id, revision, geometry, period_label, period_starts_at, period_ends_at,
           reason, created_by)
        values (${incidentId}, ${revision}, ST_GeomFromGeoJSON(${geometry}), ${label},
          ${startsAt === null ? null : new Date(startsAt)},
          ${endsAt === null ? null : new Date(endsAt)}, 'period validation', ${adminId})`;
    }
    for (let revision = 1; revision <= 6; revision += 1) {
      await admin`
        insert into incident_area_revisions
          (incident_id, revision, geometry, period_label, period_starts_at, period_ends_at,
           reason, created_by)
        values (${otherIncidentId}, ${revision}, ST_GeomFromGeoJSON(${geometry}),
          ${`OTHER-${revision}`}, ${new Date(`2026-03-0${revision}T00:00:00Z`)},
          ${new Date(`2026-03-0${revision + 1}T00:00:00Z`)}, 'other incident period', ${adminId})`;
    }

    const repeatedExact = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data?periodField=period&periodRevision=5`,
      headers: auth(adminToken),
    });
    expect(repeatedExact.statusCode, repeatedExact.body).toBe(200);
    expect(repeatedExact.json().resolvedOperationalPeriod).toMatchObject({
      areaRevision: 5, label: "OP1",
    });
    for (const revision of [2, 4, 6, 999]) {
      const rejected = await app.inject({
        method: "GET",
        url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data?periodField=period&periodRevision=${revision}`,
        headers: auth(adminToken),
      });
      expect(rejected.statusCode, `revision ${revision}: ${rejected.body}`).toBe(400);
    }
  });

  it("pages chart, list, and map contributors and reconciles every total", async () => {
    const base = `/api/v1/dashboards/${dashboardId}/widgets/public_chart/records` +
      `?incidentId=${incidentId}&categoryField=category&category=A&periodField=period&periodRevision=1` +
      `&from=2026-01-01T00:00:00Z&to=2026-01-03T00:00:00Z&bbox=-122,37,-120,39&group=A&limit=1`;
    const first = await app.inject({ method: "GET", url: base, headers: auth(partnerToken) });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ total: 2, records: [expect.any(Object)] });
    expect(first.json().records[0].data).not.toHaveProperty("secret");
    const second = await app.inject({
      method: "GET",
      url: `${base}&cursor=${encodeURIComponent(first.json().nextCursor as string)}`,
      headers: auth(partnerToken),
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ total: 2, nextCursor: null });
    expect(new Set([...first.json().records, ...second.json().records].map((row) => row.id)).size).toBe(2);

    const nullAggregate = await app.inject({
      method: "GET",
      url: `/api/v1/dashboards/${dashboardId}/data?incidentId=${incidentId}` +
        `&field=period&equals=NULLGROUP`,
      headers: auth(adminToken),
    });
    expect(nullAggregate.statusCode, nullAggregate.body).toBe(200);
    const nullChart = nullAggregate.json().widgets.find(
      (widget: { key: string }) => widget.key === "public_chart",
    );
    expect(nullChart.groups).toEqual([{ value: "", count: 1 }]);
    const nullGroup = await app.inject({
      method: "GET",
      url: `/api/v1/dashboards/${dashboardId}/widgets/public_chart/records` +
        `?incidentId=${incidentId}&field=period&equals=NULLGROUP&group=`,
      headers: auth(adminToken),
    });
    expect(nullGroup.statusCode, nullGroup.body).toBe(200);
    expect(nullGroup.json().total).toBe(nullChart.groups[0].count);
    expect(nullGroup.json().records[0].data).not.toHaveProperty("category");

    const microBase = `/api/v1/dashboards/${dashboardId}/widgets/public_chart/records` +
      `?incidentId=${incidentId}&field=period&equals=OP3&group=C&limit=1`;
    const microFirst = await app.inject({
      method: "GET", url: microBase, headers: auth(adminToken),
    });
    expect(microFirst.statusCode, microFirst.body).toBe(200);
    expect(microFirst.json().total).toBe(2);
    const microSecond = await app.inject({
      method: "GET",
      url: `${microBase}&cursor=${encodeURIComponent(microFirst.json().nextCursor as string)}`,
      headers: auth(adminToken),
    });
    expect(microSecond.statusCode, microSecond.body).toBe(200);
    expect(microSecond.json()).toMatchObject({ total: 2, nextCursor: null });
    expect(new Set([...microFirst.json().records, ...microSecond.json().records]
      .map((row) => row.id)).size).toBe(2);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/dashboards/${dashboardId}/widgets/public_list/records` +
        `?incidentId=${incidentId}&categoryField=category&category=A&periodField=period&periodRevision=1` +
        `&from=2026-01-01T00:00:00Z&to=2026-01-03T00:00:00Z&bbox=-122,37,-120,39`,
      headers: auth(partnerToken),
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().total).toBe(2);
    expect(list.json().records).toHaveLength(2);
    expect(list.json().records.every((row: Record<string, unknown>) => row.geometry !== null)).toBe(true);
    expect(list.json().records.every((row: { data: Record<string, unknown> }) => !("secret" in row.data))).toBe(true);

    const status = await app.inject({
      method: "GET",
      url: `/api/v1/dashboards/${dashboardId}/widgets/public_status/records?incidentId=${incidentId}`,
      headers: auth(partnerToken),
    });
    expect(status.statusCode).toBe(409);
    const excessiveLimit = await app.inject({
      method: "GET",
      url: `/api/v1/dashboards/${dashboardId}/widgets/public_list/records?incidentId=${incidentId}&limit=101`,
      headers: auth(adminToken),
    });
    expect(excessiveLimit.statusCode).toBe(400);
    const invalidCursor = await app.inject({
      method: "GET",
      url: `/api/v1/dashboards/${dashboardId}/widgets/public_list/records?incidentId=${incidentId}&cursor=bad`,
      headers: auth(adminToken),
    });
    expect(invalidCursor.statusCode).toBe(400);
  });

  it("keeps admin fields and geometry for admins while masking members and guests", async () => {
    const adminView = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data`,
      headers: auth(adminToken),
    });
    const adminPanels = adminView.json().panels as Array<Record<string, unknown>>;
    expect(adminPanels.find((panel) => panel.key === "restricted_map")).toMatchObject({ state: "ready" });
    expect((adminPanels.find((panel) => panel.key === "restricted_chart")!.data as { groups: unknown[] }).groups)
      .toEqual([{ value: "Command only", count: 1 }]);

    const fieldMaskComposition = {
      title: "Restricted field mask",
      panels: [
        { key: "restricted", source: "dashboard", dashboardId,
          widgetKey: "restricted_list", presentation: "list" },
        { key: "restricted_chart", source: "dashboard", dashboardId,
          widgetKey: "restricted_chart", presentation: "chart" },
      ],
    };
    for (const token of [memberToken, partnerToken]) {
      const saved = await saveConfig(token, "restricted-fields", fieldMaskComposition);
      expect(saved.statusCode, saved.body).toBe(201);
    }

    for (const token of [memberToken, partnerToken]) {
      const scoped = await app.inject({
        method: "GET",
        url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data`,
        headers: auth(token),
      });
      expect(scoped.json().panels.find((panel: { key: string }) => panel.key === "restricted_map"))
        .toMatchObject({ state: "missing", data: null });
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/incidents/${incidentId}/dashboard-configs/restricted-fields/data`,
        headers: auth(token),
      });
      const panels = response.json().panels as Array<Record<string, unknown>>;
      expect(panels.find((panel) => panel.key === "restricted_chart")).toMatchObject({
        state: "missing", contributionDrilldown: false,
      });
      const restricted = panels.find((panel) => panel.key === "restricted")!.data as {
        columns: string[]; records: Array<Record<string, unknown>>;
      };
      expect(restricted.columns).toEqual(["public_label"]);
      expect(restricted.records[0]).not.toHaveProperty("admin_secret");
    }
  });

  it("preserves an explicitly configured status widget without deriving exposure status", async () => {
    const saved = await saveConfig(adminToken, "reported-status", {
      title: "Reported conditions",
      panels: [{ key: "conditions", source: "dashboard", dashboardId,
        widgetKey: "public_status", presentation: "status" }],
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const data = await app.inject({ method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/reported-status/data`,
      headers: auth(adminToken) });
    expect(data.statusCode, data.body).toBe(200);
    expect(data.json().panels[0]).toMatchObject({ presentation: "status", data: { kind: "status" } });
    const mismatch = await saveConfig(adminToken, "invalid-status", {
      title: "Wrong source",
      panels: [{ key: "conditions", source: "dashboard", dashboardId,
        widgetKey: "public_tile", presentation: "status" }],
    });
    expect(mismatch.statusCode).toBe(400);
  });

  it("keeps stale and missing impact inputs explicit and revocation fresh", async () => {
    const stale = await saveConfig(adminToken, "stale-impact", {
      title: "Stale impact",
      panels: [{ key: "impact", source: "impact", category: "structures_parcels", presentation: "tile" }],
    });
    expect(stale.statusCode, stale.body).toBe(201);
    const staleData = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/stale-impact/data`,
      headers: auth(adminToken),
    });
    expect(staleData.statusCode, staleData.body).toBe(200);
    expect(staleData.json().panels[0]).toMatchObject({ state: "stale" });

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/participants/${participantId}/revoke`,
      headers: auth(adminToken),
      payload: { reason: "dashboard assignment ended" },
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    for (const url of [
      `/api/v1/incidents/${incidentId}/dashboard-configs`,
      `/api/v1/incidents/${incidentId}/dashboard-configs/operations`,
      `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data`,
      `/api/v1/dashboards/${dashboardId}/widgets/public_list/records?incidentId=${incidentId}`,
    ]) {
      const denied = await app.inject({ method: "GET", url, headers: auth(partnerToken) });
      expect(denied.statusCode, `${url}: ${denied.body}`).toBe(404);
    }

    await admin`update dashboards set archived_at = now() where id = ${dashboardId}`;
    const missingSource = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/dashboard-configs/operations/data`,
      headers: auth(adminToken),
    });
    expect(missingSource.statusCode, missingSource.body).toBe(200);
    expect(missingSource.json().panels.find((panel: { key: string }) => panel.key === "total"))
      .toMatchObject({ state: "missing", data: null, contributionDrilldown: false });
  });
});
