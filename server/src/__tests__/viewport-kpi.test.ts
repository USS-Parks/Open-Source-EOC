import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, type Sql } from "./helpers.js";

let admin: Sql, runtime: Sql, app: FastifyInstance;
let jurisdictionId: string, adminId: string, incidentId: string;
let dashboardId: string, datasetId: string, adminToken: string, outsiderToken: string;
let baseUrl: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const polygon = (west: number, south: number, east: number, north: number) => ({
  type: "Polygon",
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST", url: "/api/v1/auth/login", payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}

function widget(snapshot: Record<string, unknown>, key: string): Record<string, unknown> {
  const widgets = snapshot.widgets as Array<Record<string, unknown>>;
  return widgets.find((candidate) => candidate.key === key)!;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  jurisdictionId = await createJurisdiction(admin, "viewport-city", "Viewport City EOC");
  adminId = await createPerson(admin, {
    email: "viewport-admin@example.org", displayName: "Viewport Admin",
    password: "viewport-admin-password",
  });
  await createPerson(admin, {
    email: "viewport-outsider@example.org", displayName: "Viewport Outsider",
    password: "viewport-outsider-password",
  });
  await addMembership(admin, adminId, jurisdictionId, "admin");
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `ws://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  adminToken = await login("viewport-admin@example.org", "viewport-admin-password");
  outsiderToken = await login("viewport-outsider@example.org", "viewport-outsider-password");

  const activated = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    headers: auth(adminToken),
    payload: { templateKey: "wildfire", name: "Viewport Fire" },
  });
  expect(activated.statusCode).toBe(201);
  incidentId = activated.json().incidentId as string;
  const dashboard = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/dashboards`,
    headers: auth(adminToken),
    payload: { templateKey: "eoc_status" },
  });
  expect(dashboard.statusCode).toBe(201);
  dashboardId = dashboard.json().id as string;

  await admin`
    insert into incident_area_revisions (incident_id, revision, geometry, reason, created_by)
    values
      (${incidentId}, 1, ST_GeomFromGeoJSON(${JSON.stringify(polygon(0, 0, 5, 5))}),
       'initial', ${adminId}),
      (${incidentId}, 2, ST_GeomFromGeoJSON(${JSON.stringify(polygon(0, 0, 10, 10))}),
       'expanded', ${adminId})`;
  const [pack] = await admin`
    insert into data_packs (incident_id, organization_id, name, created_by)
    values (${incidentId}, ${jurisdictionId}, 'Viewport parcel baseline', ${adminId}) returning id`;
  const [dataset] = await admin`
    insert into data_pack_datasets
      (pack_id, key, name, kind, field_mapping, coverage, stale_after_seconds,
       last_success_at, item_count)
    values (${pack!.id as string}, 'humboldt_parcels', 'Viewport parcels', 'geojson',
      '{}'::jsonb, ST_GeomFromGeoJSON(${JSON.stringify(polygon(-1, -1, 11, 11))}),
      604800, now(), 1002) returning id`;
  datasetId = dataset!.id as string;
  await admin`
    insert into data_pack_items
      (dataset_id, incident_id, source_id, data, geom, loaded_by)
    select ${datasetId}, ${incidentId}, 'inside-' || lpad(g::text, 4, '0'), '{}'::jsonb,
      ST_SetSRID(ST_MakePoint(1 + g::double precision / 100000, 1), 4326), ${adminId}
    from generate_series(1, 1001) g`;
  await admin`
    insert into data_pack_items (dataset_id, incident_id, source_id, data, geom, loaded_by)
    values (${datasetId}, ${incidentId}, 'outside', '{}'::jsonb,
      ST_SetSRID(ST_MakePoint(8, 8), 4326), ${adminId})`;
  const [shelterDataset] = await admin`
    insert into data_pack_datasets
      (pack_id, key, name, kind, field_mapping, coverage, stale_after_seconds,
       last_success_at, item_count)
    values (${pack!.id as string}, 'statewide_shelters', 'Open shelters', 'geojson',
      '{}'::jsonb, ST_GeomFromGeoJSON(${JSON.stringify(polygon(-1, -1, 11, 11))}),
      604800, now(), 2) returning id`;
  await admin`
    insert into data_pack_items (dataset_id, incident_id, source_id, data, geom, loaded_by) values
      (${shelterDataset!.id as string}, ${incidentId}, 'inside-open', '{"status":"open"}'::jsonb,
       ST_SetSRID(ST_MakePoint(2, 2), 4326), ${adminId}),
      (${shelterDataset!.id as string}, ${incidentId}, 'outside-open', '{"status":"open"}'::jsonb,
       ST_SetSRID(ST_MakePoint(8, 8), 4326), ${adminId})`;

  const boardRows = await admin`
    select b.id, b.template_key from boards b join incident_boards ib on ib.board_id = b.id
    where ib.incident_id = ${incidentId} and b.template_key in ('road_closures', 'shelters')`;
  const roadBoard = boardRows.find((row) => row.template_key === "road_closures")!.id as string;
  const shelterBoard = boardRows.find((row) => row.template_key === "shelters")!.id as string;
  await admin`
    insert into board_records (board_id, incident_id, data, created_by, geom)
    select ${roadBoard}, ${incidentId},
      jsonb_build_object('road', 'Road ' || g, 'reason', 'viewport proof', 'status', 'closed'),
      ${adminId}, ST_SetSRID(ST_MakePoint(1 + g::double precision / 100000, 1), 4326)
    from generate_series(1, 1001) g`;
  await admin`
    insert into board_records (board_id, incident_id, data, created_by, geom) values
      (${roadBoard}, ${incidentId}, '{"road":"Outside","reason":"proof","status":"closed"}'::jsonb,
       ${adminId}, ST_SetSRID(ST_MakePoint(8, 8), 4326)),
      (${roadBoard}, ${incidentId}, '{"road":"Reopened","reason":"proof","status":"reopened"}'::jsonb,
       ${adminId}, ST_SetSRID(ST_MakePoint(2, 2), 4326)),
      (${shelterBoard}, ${incidentId}, '{"name":"Inside open","status":"normal","capacity":10,"occupancy":2}'::jsonb,
       ${adminId}, ST_SetSRID(ST_MakePoint(1, 2), 4326)),
      (${shelterBoard}, ${incidentId}, '{"name":"Inside closed","status":"closed","capacity":10,"occupancy":0}'::jsonb,
       ${adminId}, ST_SetSRID(ST_MakePoint(2, 2), 4326)),
      (${shelterBoard}, ${incidentId}, '{"name":"Outside open","status":"normal","capacity":10,"occupancy":3}'::jsonb,
       ${adminId}, ST_SetSRID(ST_MakePoint(8, 8), 4326))`;
}, 120000);

afterAll(async () => { await app.close(); await runtime.end(); await admin.end(); });

describe("H12-E viewport KPI queries", () => {
  it("reconciles viewport impact totals, comparisons, and paged drilldown records", async () => {
    const whole = await app.inject({
      method: "GET", url: `/api/v1/incidents/${incidentId}/impact`, headers: auth(adminToken),
    });
    expect(whole.statusCode).toBe(200);
    expect(whole.json().impact).toMatchObject({
      scope: { kind: "incident-area", bbox: null },
      categories: { structures_parcels: { value: 1002 }, shelters: { value: 2 } },
    });

    const bbox = "0,0,5,5";
    const viewport = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/impact?bbox=${bbox}`,
      headers: auth(adminToken),
    });
    expect(viewport.statusCode).toBe(200);
    expect(viewport.json().impact).toMatchObject({
      scope: { kind: "viewport", bbox: [0, 0, 5, 5] },
      categories: { structures_parcels: { value: 1001 }, shelters: { value: 1 } },
    });
    const comparison = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/impact/compare?fromRevision=1&toRevision=2&bbox=${bbox}`,
      headers: auth(adminToken),
    });
    expect(comparison.json()).toMatchObject({
      scope: { kind: "viewport", bbox: [0, 0, 5, 5] },
      categories: {
        structures_parcels: { fromValue: 1001, toValue: 1001, delta: 0 },
        shelters: { fromValue: 1, toValue: 1, delta: 0 },
      },
    });

    let cursor: string | null = null;
    let contributions = 0;
    do {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const page = await app.inject({
        method: "GET",
        url: `/api/v1/incidents/${incidentId}/impact/sources/${datasetId}/records?bbox=${bbox}&limit=100${suffix}`,
        headers: auth(adminToken),
      });
      expect(page.statusCode).toBe(200);
      expect(page.json().scope).toEqual({ kind: "viewport", bbox: [0, 0, 5, 5] });
      contributions += page.json().records.length as number;
      cursor = page.json().nextCursor as string | null;
    } while (cursor);
    expect(contributions).toBe(1001);

    const empty = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/impact?bbox=20,20,21,21`,
      headers: auth(adminToken),
    });
    expect(empty.json().impact.categories.structures_parcels).toMatchObject({
      value: 0, coverage: "complete", reason: null,
    });
  });

  it("counts spatial dashboard rows beyond the client cap while preserving filters", async () => {
    const base = `/api/v1/dashboards/${dashboardId}/data?incidentId=${incidentId}`;
    const whole = await app.inject({ method: "GET", url: base, headers: auth(adminToken) });
    expect(whole.statusCode).toBe(200);
    expect(whole.json().scope).toEqual({ kind: "incident-area", bbox: null });
    expect(widget(whole.json(), "closed_roads").value).toBe(1002);

    const viewport = await app.inject({
      method: "GET", url: `${base}&bbox=0,0,5,5`, headers: auth(adminToken),
    });
    expect(viewport.statusCode).toBe(200);
    expect(viewport.json().scope).toEqual({ kind: "viewport", bbox: [0, 0, 5, 5] });
    expect(widget(viewport.json(), "closed_roads").value).toBe(1001);
    expect((widget(viewport.json(), "active_closures").records as unknown[])).toHaveLength(10);
    expect(widget(viewport.json(), "shelters_by_status")).toMatchObject({
      missing: true, groups: [],
    });

    const filtered = await app.inject({
      method: "GET",
      url: `${base}&bbox=0,0,5,5&field=status&equals=reopened`,
      headers: auth(adminToken),
    });
    expect(widget(filtered.json(), "closed_roads").value).toBe(0);
    expect(widget(filtered.json(), "active_closures").records).toEqual([]);
  });

  it("rejects invalid and unauthorized viewport queries, including streams", async () => {
    for (const url of [
      `/api/v1/incidents/${incidentId}/impact?bbox=0,0,0,1`,
      `/api/v1/dashboards/${dashboardId}/data?incidentId=${incidentId}&bbox=0,0,181,1`,
    ]) {
      expect((await app.inject({ method: "GET", url, headers: auth(adminToken) })).statusCode).toBe(400);
    }
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/impact?bbox=0,0,5,5`,
      headers: auth(outsiderToken),
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/dashboards/${dashboardId}/data?incidentId=${incidentId}&bbox=0,0,5,5`,
      headers: auth(outsiderToken),
    })).statusCode).toBe(404);

    const socket = new WebSocket(
      `${baseUrl}/api/v1/dashboards/${dashboardId}/stream?incidentId=${incidentId}&bbox=0,0,0,1`,
    );
    const message = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.once("message", (raw) => resolve(JSON.parse(raw.toString()) as Record<string, unknown>));
      socket.once("error", reject);
    });
    expect(message).toEqual({ type: "error", error: "invalid incident scope" });
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  });
});
