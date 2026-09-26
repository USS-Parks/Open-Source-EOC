import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { esriToGeoJson } from "../geo/esri.js";
import { envelopeBoxes } from "../geo/featureserver.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";
import { multipartUpload } from "./multipart.js";

/**
 * Esri interchange (VC-26) on real PostgreSQL. The FeatureServer view: a
 * service identity's token, sent where Esri clients send it, reads the
 * catalog, the service, its layers and their queries with paging, an
 * envelope in either spatial reference (wider than the world, and across the
 * antimeridian), object ids numbered per board that never change, and
 * f=json or f=geojson; a record rule and a field read level hold for it as
 * for the board, and a map field it may not read is no layer on any map
 * surface; archived records stay out; a person's session is taken from
 * Authorization alone; a revoked token is refused; no token reaches a log
 * line. The Esri JSON import: points, a multipart polygon with a hole, Web
 * Mercator converted, an unsupported spatial reference refused, malformed
 * files refused plainly, invalid and out-of-range shapes reported on their
 * rows, all rows or none, and the import report kept. Requests follow the
 * shapes ArcGIS and QGIS publish; no Esri client runs here.
 */

const R = 6_378_137;
const mercator = ([lon, lat]: [number, number]): [number, number] =>
  [lon * (Math.PI / 180) * R, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
/** Twice the signed area; positive for a clockwise ring with y up. */
const clockwise = (ring: number[][]) =>
  ring.slice(1).reduce((sum, p, i) => sum + (p[0]! - ring[i]![0]!) * (p[1]! + ring[i]![1]!), 0) > 0;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let adminToken: string;
let memberToken: string;
let identityToken: string;
let identityId: string;
let sitesBoard: string;
let privateBoard: string;
let importBoard: string;
let plainBoard: string;
let hiddenBoard: string;
let worldBoard: string;
const lines: string[] = [];

const services = "/api/v1/esri/rest/services";
const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers });
/** A GET as QGIS and ArcGIS send it with a token: in the query string. */
const esri = (url: string, token = identityToken) => get(`${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`);

async function post(url: string, payload: unknown, token = adminToken) {
  const response = await app.inject({ method: "POST", url, headers: auth(token), payload: payload as object });
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

async function importFile(boardId: string, body: unknown, query = "", token = adminToken) {
  return importText(boardId, JSON.stringify(body), query, token);
}
async function importText(boardId: string, text: string, query = "", token = adminToken) {
  const upload = await multipartUpload({ name: "layer.json" }, Buffer.from(text), "application/json");
  return app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/import${query}`,
    headers: { ...auth(token), ...upload.headers }, payload: upload.payload });
}

const sitesTemplate = {
  key: "esri_sites", version: 1, title: "Esri Sites",
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "status", label: "Status", type: "enum", values: ["open", "closed"] },
    { key: "count", label: "Count", type: "number" },
    { key: "opened", label: "Opened", type: "datetime" },
    { key: "staffed", label: "Staffed", type: "boolean" },
    { key: "notes", label: "Internal notes", type: "text", read: "admin" },
    { key: "site", label: "Site", type: "geometry", geometryKind: "any" },
  ],
  views: [{ key: "all", title: "All", columns: ["name", "status"] }],
};
const privateTemplate = {
  key: "esri_private", version: 1, title: "Esri Private Reports",
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "location", label: "Location", type: "geometry", geometryKind: "point" },
  ],
  views: [{ key: "all", title: "All", columns: ["name"] }],
  recordAccess: { read: [{ kind: "creator" }], edit: [{ kind: "creator" }] },
};
/** A board whose location only administrators read. */
const hiddenTemplate = {
  key: "esri_hidden", version: 1, title: "Esri Safe Houses",
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "location", label: "Location", type: "geometry", geometryKind: "point", read: "admin" },
  ],
  views: [{ key: "all", title: "All", columns: ["name"] }],
};
const worldTemplate = {
  key: "esri_world", version: 1, title: "Esri World",
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "place", label: "Place", type: "geometry", geometryKind: "point" },
  ],
  views: [{ key: "all", title: "All", columns: ["name"] }],
};
const world: Array<[string, [number, number]]> = [
  ["Hoopa", [-123.6, 41.1]], ["Alps", [10, 46.5]], ["Chukotka", [179.5, 65]], ["Aleutians", [-179.5, 52]],
];

const points: Array<[string, [number, number]]> = [
  ["Weitchpec", [-123.61, 41.29]], ["Klamath Glen", [-123.8, 41.5]], ["Orick", [-124.0, 41.0]],
  ["Far away", [-120.0, 38.0]], ["Bay", [-122.0, 37.8]],
];
const square = (x: number, y: number, size: number) =>
  [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  // Registering the two templates is an instance administrator's act.
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  app = buildApp(runtime, { oidc: null, logLevel: "info", logStream: { write: (line) => void lines.push(line) }, slowRequestMs: 0 });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  await post("/api/v1/templates", sitesTemplate);
  await post("/api/v1/templates", privateTemplate);
  await post("/api/v1/templates", hiddenTemplate);
  await post("/api/v1/templates", worldTemplate);
  const board = async (templateKey: string) => (await post(`/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey })).id as string;
  sitesBoard = await board("esri_sites");
  privateBoard = await board("esri_private");
  importBoard = await board("esri_sites");
  plainBoard = await board("activity_log");
  hiddenBoard = await board("esri_hidden");
  worldBoard = await board("esri_world");
  await post(`/api/v1/boards/${hiddenBoard}/records`, { name: "House A", location: { type: "Point", coordinates: [-123.61, 41.29] } });
  for (const [name, coordinates] of world) await post(`/api/v1/boards/${worldBoard}/records`, { name, place: { type: "Point", coordinates } });
  for (const [name, coordinates] of points) {
    await post(`/api/v1/boards/${sitesBoard}/records`, {
      name, status: "open", count: name.length, opened: "2026-09-25T08:00:00Z", staffed: true,
      notes: `admin only ${name}`, site: { type: "Point", coordinates },
    });
  }
  await post(`/api/v1/boards/${sitesBoard}/records`, {
    name: "River road", site: { type: "LineString", coordinates: [[-123.6, 41.3], [-123.5, 41.35]] },
  });
  // Two parts, the first with a hole; stored counter-clockwise as RFC 7946 draws outer rings.
  await post(`/api/v1/boards/${sitesBoard}/records`, {
    name: "Tribal lands", site: { type: "MultiPolygon", coordinates: [
      [square(-124.2, 41.6, 0.1), square(-124.17, 41.63, 0.02).reverse()],
      [square(-124.0, 41.8, 0.05)],
    ] },
  });
  const created = await post(`/api/v1/jurisdictions/${seed.jurisdictionId}/service-identities`,
    { name: "County GIS", role: "member", expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  identityToken = created.token as string;
  identityId = (created.identity as { id: string }).id;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("the FeatureServer view", () => {
  it("lists every board with a geometry field as a service, and nothing to an anonymous caller", async () => {
    expect((await get(services)).statusCode).toBe(401);
    const catalog = await esri(`${services}?f=json`);
    expect(catalog.statusCode, catalog.body).toBe(200);
    const names = (catalog.json().services as Array<{ name: string; type: string }>);
    expect(names).toEqual(expect.arrayContaining([
      { name: sitesBoard, type: "FeatureServer" }, { name: privateBoard, type: "FeatureServer" },
    ]));
    expect(names.some((s) => s.name === plainBoard)).toBe(false);
    expect((await esri(`${services}/${plainBoard}/FeatureServer`)).statusCode).toBe(404);
  });

  it("describes a service's layers by geometry kind and each layer's fields, extent and limits", async () => {
    const service = (await esri(`${services}/${sitesBoard}/FeatureServer?f=json`)).json();
    expect(service).toMatchObject({ capabilities: "Query", spatialReference: { wkid: 4326 }, maxRecordCount: 1000, tables: [] });
    expect(service.layers.map((l: { id: number; name: string; geometryType: string }) => [l.id, l.name, l.geometryType])).toEqual([
      [0, "Esri Sites (points)", "esriGeometryPoint"], [1, "Esri Sites (lines)", "esriGeometryPolyline"],
      [2, "Esri Sites (areas)", "esriGeometryPolygon"], [3, "Esri Sites (multipoints)", "esriGeometryMultipoint"],
    ]);
    const single = (await esri(`${services}/${privateBoard}/FeatureServer`)).json();
    expect(single.layers.map((l: { id: number; name: string }) => [l.id, l.name])).toEqual([[0, "Esri Private Reports"]]);
    expect((await esri(`${services}/${privateBoard}/FeatureServer/2`)).statusCode).toBe(404);

    const layer = (await esri(`${services}/${sitesBoard}/FeatureServer/0?f=pjson`)).json();
    expect(layer).toMatchObject({
      id: 0, type: "Feature Layer", geometryType: "esriGeometryPoint", objectIdField: "OBJECTID", capabilities: "Query",
      maxRecordCount: 1000, supportedQueryFormats: "JSON, geoJSON", advancedQueryCapabilities: { supportsPagination: true },
      extent: { xmin: -124, ymin: 37.8, xmax: -120, ymax: 41.5, spatialReference: { wkid: 4326 } },
    });
    const types = Object.fromEntries(layer.fields.map((f: { name: string; type: string }) => [f.name, f.type]));
    expect(types).toEqual({
      OBJECTID: "esriFieldTypeOID", RecordID: "esriFieldTypeString", EditDate: "esriFieldTypeDate", Editor: "esriFieldTypeString",
      name: "esriFieldTypeString", status: "esriFieldTypeString", count: "esriFieldTypeDouble",
      opened: "esriFieldTypeDate", staffed: "esriFieldTypeSmallInteger",
    });
    // The administrator's session reads the admin-only field; the member identity does not.
    const asAdmin = (await get(`${services}/${sitesBoard}/FeatureServer/0`, auth(adminToken))).json();
    expect(asAdmin.fields.map((f: { name: string }) => f.name)).toContain("notes");
    const all = (await esri(`${services}/${sitesBoard}/FeatureServer/layers`)).json();
    expect(all.layers.map((l: { id: number }) => l.id)).toEqual([0, 1, 2, 3]);
  });

  it("answers queries with paging, counts, ids, object id lists and f=geojson", async () => {
    const query = `${services}/${sitesBoard}/FeatureServer/0/query`;
    const full = (await esri(`${query}?where=1%3D1&outFields=*&f=json`)).json();
    expect(full).toMatchObject({ objectIdFieldName: "OBJECTID", geometryType: "esriGeometryPoint",
      spatialReference: { wkid: 4326 }, exceededTransferLimit: false });
    expect(full.features).toHaveLength(5);
    const weitchpec = full.features.find((f: { attributes: { name: string } }) => f.attributes.name === "Weitchpec");
    expect(weitchpec.geometry).toEqual({ x: -123.61, y: 41.29 });
    expect(weitchpec.attributes).toMatchObject({ status: "open", count: 9, staffed: 1, opened: Date.parse("2026-09-25T08:00:00Z"), Editor: "Admin" });
    expect(weitchpec.attributes.notes).toBeUndefined();
    // Each board numbers its own records: other boards' writes leave no gaps here.
    const ids = full.features.map((f: { attributes: { OBJECTID: number } }) => f.attributes.OBJECTID);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
    const stored = await admin`select object_id, data ->> 'name' as name from board_records where board_id = ${sitesBoard}`;
    expect(Number(stored.find((r) => r.name === "Weitchpec")!.object_id)).toBe(weitchpec.attributes.OBJECTID);

    // Pages in object id order, with exceededTransferLimit until the last.
    const page = async (offset: number) => (await esri(`${query}?where=1=1&outFields=OBJECTID&resultOffset=${offset}&resultRecordCount=2`)).json();
    const pages = [await page(0), await page(2), await page(4)];
    expect(pages.map((p) => p.exceededTransferLimit)).toEqual([true, true, false]);
    expect(pages.flatMap((p) => p.features.map((f: { attributes: { OBJECTID: number } }) => f.attributes.OBJECTID))).toEqual(ids);
    expect(pages[0].fields.map((f: { name: string }) => f.name)).toEqual(["OBJECTID"]);

    expect((await esri(`${query}?where=1=1&returnCountOnly=true`)).json()).toEqual({ count: 5 });
    expect((await esri(`${query}?where=1=1&returnIdsOnly=true`)).json()).toEqual({ objectIdFieldName: "OBJECTID", objectIds: ids });
    const two = (await esri(`${query}?objectIds=${ids[0]},${ids[2]}&outFields=name&returnGeometry=false`)).json();
    expect(two.features).toEqual([{ attributes: { OBJECTID: ids[0], name: "Weitchpec" } }, { attributes: { OBJECTID: ids[2], name: "Orick" } }]);

    const geojson = await esri(`${query}?where=1=1&outFields=name&f=geojson&resultRecordCount=4`);
    expect(geojson.headers["content-type"]).toContain("application/geo+json");
    expect(geojson.json()).toMatchObject({ type: "FeatureCollection", properties: { exceededTransferLimit: true } });
    expect(geojson.json().features[0]).toEqual({ type: "Feature", id: ids[0], geometry: { type: "Point", coordinates: [-123.61, 41.29] },
      properties: { OBJECTID: ids[0], name: "Weitchpec" } });
  });

  it("filters by an envelope in WGS 84 or Web Mercator and returns Web Mercator when asked", async () => {
    const query = `${services}/${sitesBoard}/FeatureServer/0/query`;
    const names = (body: { features: Array<{ attributes: { name: string } }> }) => body.features.map((f) => f.attributes.name).sort();
    const simple = (await esri(`${query}?geometry=-124.5,40.5,-123,42&geometryType=esriGeometryEnvelope`
      + `&spatialRel=esriSpatialRelEnvelopeIntersects&inSR=4326&outFields=name`)).json();
    expect(names(simple)).toEqual(["Klamath Glen", "Orick", "Weitchpec"]);
    const [xmin, ymin] = mercator([-124.5, 40.5]);
    const [xmax, ymax] = mercator([-123, 42]);
    const envelope = JSON.stringify({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 102100, latestWkid: 3857 } });
    const projected = (await esri(`${query}?geometry=${encodeURIComponent(envelope)}&geometryType=esriGeometryEnvelope`
      + `&spatialRel=esriSpatialRelIntersects&outFields=name&outSR=102100`)).json();
    expect(names(projected)).toEqual(["Klamath Glen", "Orick", "Weitchpec"]);
    expect(projected.spatialReference).toEqual({ wkid: 102100, latestWkid: 3857 });
    const weitchpec = projected.features.find((f: { attributes: { name: string } }) => f.attributes.name === "Weitchpec");
    const [x, y] = mercator([-123.61, 41.29]);
    expect(weitchpec.geometry.x).toBeCloseTo(x, 2);
    expect(weitchpec.geometry.y).toBeCloseTo(y, 2);
  });

  it("serves lines as paths and a multipart area as clockwise outer rings with its hole", async () => {
    const paths = (await esri(`${services}/${sitesBoard}/FeatureServer/1/query?where=1=1&outFields=name`)).json();
    expect(paths.features).toEqual([expect.objectContaining({ geometry: { paths: [[[-123.6, 41.3], [-123.5, 41.35]]] } })]);
    const areas = (await esri(`${services}/${sitesBoard}/FeatureServer/2/query?where=1=1&outFields=name`)).json();
    expect(areas.geometryType).toBe("esriGeometryPolygon");
    const rings = areas.features[0].geometry.rings as number[][][];
    expect(rings).toHaveLength(3);
    expect(rings.map(clockwise)).toEqual([true, false, true]);
    expect(esriToGeoJson({ rings, spatialReference: { wkid: 4326 } })).toMatchObject({ type: "MultiPolygon" });
    expect((await esri(`${services}/${sitesBoard}/FeatureServer/3/query?where=1=1`)).json().features).toEqual([]);
  });

  it("gives no layer on any map surface for a board whose map field the caller may not read", async () => {
    expect((await esri(services)).json().services.map((s: { name: string }) => s.name)).not.toContain(hiddenBoard);
    for (const url of [`${services}/${hiddenBoard}/FeatureServer`, `${services}/${hiddenBoard}/FeatureServer/layers`,
      `${services}/${hiddenBoard}/FeatureServer/0`, `${services}/${hiddenBoard}/FeatureServer/0/query?where=1=1&outFields=*`])
      expect((await esri(url)).statusCode, url).toBe(404);
    const collections = async (token: string) =>
      (await get("/api/v1/ogc/collections", auth(token))).json().collections.map((c: { id: string }) => c.id) as string[];
    expect(await collections(memberToken)).not.toContain(hiddenBoard);
    expect(await collections(memberToken)).toContain(sitesBoard);
    expect((await get(`/api/v1/ogc/collections/${hiddenBoard}/items`, auth(memberToken))).statusCode).toBe(404);
    expect((await get(`/api/v1/tiles/boards/${hiddenBoard}/0/0/0.mvt`, auth(memberToken))).statusCode).toBe(404);
    // The administrator reads the field, so the board is a layer on all three.
    expect(await collections(adminToken)).toContain(hiddenBoard);
    expect((await get(`${services}/${hiddenBoard}/FeatureServer/0/query?where=1=1&returnCountOnly=true`, auth(adminToken))).json())
      .toEqual({ count: 1 });
    expect((await get(`/api/v1/ogc/collections/${hiddenBoard}/items`, auth(adminToken))).json().numberReturned).toBe(1);
    const tile = await get(`/api/v1/tiles/boards/${hiddenBoard}/0/0/0.mvt`, auth(adminToken));
    expect(tile.statusCode).toBe(200);
    expect(tile.rawPayload.length).toBeGreaterThan(0);
  });

  it("takes an envelope wider than the world as the whole world and one across the antimeridian as both sides", async () => {
    const [wide] = envelopeBoxes([-40_000_000, -20_000_000, 40_000_000, 20_000_000], 3857);
    expect(wide![0]).toBe(-180);
    expect(wide![2]).toBe(180);
    expect(wide![1]).toBeCloseTo(-85.02, 2);
    expect(wide![3]).toBeCloseTo(85.02, 2);
    expect(envelopeBoxes([-1e300, -1e300, 1e300, 1e300], 3857)).toEqual([[-180, -85.06, 180, 85.06]]);
    expect(envelopeBoxes([170, 50, 190, 70], 4326)).toEqual([[170, 50, 180, 70], [-180, 50, -170, 70]]);
    expect(envelopeBoxes([-170, 50, -190, 70], 4326)).toEqual([[170, 50, 180, 70], [-180, 50, -170, 70]]);
    expect(envelopeBoxes([370, 95, 380, -95], 4326)).toEqual([[10, -90, 20, 90]]);

    const query = `${services}/${worldBoard}/FeatureServer/0/query?where=1=1&outFields=name`;
    const names = async (params: string) =>
      ((await esri(`${query}&${params}`)).json().features as Array<{ attributes: { name: string } }>).map((f) => f.attributes.name).sort();
    const all = ["Aleutians", "Alps", "Chukotka", "Hoopa"];
    // A zoomed-out Web Mercator map asks for more than the world.
    expect(await names("geometry=-40000000,-20000000,40000000,20000000&inSR=102100")).toEqual(all);
    expect(await names("geometry=-1e300,-1e300,1e300,1e300&inSR=3857&spatialRel=esriSpatialRelEnvelopeIntersects")).toEqual(all);
    expect(await names("geometry=-30000000,-15000000,10000000,15000000&inSR=102100")).toEqual(["Aleutians", "Alps", "Chukotka", "Hoopa"]);
    // Across the antimeridian, in degrees and in Web Mercator, either way round.
    expect(await names("geometry=170,50,190,70&inSR=4326")).toEqual(["Aleutians", "Chukotka"]);
    expect(await names("geometry=-190,50,-170,70&inSR=4326&spatialRel=esriSpatialRelEnvelopeIntersects")).toEqual(["Aleutians", "Chukotka"]);
    const [xmin, ymin] = mercator([170, 50]);
    const [xmax, ymax] = mercator([190, 70]);
    const across = encodeURIComponent(JSON.stringify({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 102100 } }));
    expect(await names(`geometry=${across}`)).toEqual(["Aleutians", "Chukotka"]);
    expect(await names("geometry=0,40,20,50&inSR=4326")).toEqual(["Alps"]);
  });

  it("leaves archived records out, as the board's views do", async () => {
    const retired = await post(`/api/v1/boards/${worldBoard}/records`, { name: "Retired", place: { type: "Point", coordinates: [100, 10] } });
    const archived = await app.inject({ method: "POST", url: `/api/v1/boards/${worldBoard}/records/${retired.id as string}/archive`, headers: auth(adminToken) });
    expect(archived.statusCode, archived.body).toBe(200);
    const [row] = await admin`select object_id from board_records where id = ${retired.id as string}`;
    const query = `${services}/${worldBoard}/FeatureServer/0/query?where=1=1`;
    expect((await esri(`${query}&returnCountOnly=true`)).json()).toEqual({ count: 4 });
    expect((await esri(`${query}&returnIdsOnly=true`)).json().objectIds).toEqual([1, 2, 3, 4]);
    expect((await esri(`${query}&objectIds=${row!.object_id as string}`)).json().features).toEqual([]);
    expect((await esri(`${services}/${worldBoard}/FeatureServer/0`)).json().extent).toMatchObject({ xmin: -179.5, xmax: 179.5 });
  });

  it("refuses what it does not do, in plain words, and nothing writes through it", async () => {
    const query = `${services}/${sitesBoard}/FeatureServer/0/query`;
    const refused = async (params: string, message: string) => {
      const response = await esri(`${query}?${params}`);
      expect(response.statusCode, params).toBe(400);
      expect(response.json().error).toContain(message);
    };
    await refused("where=status%3D'open'", "only where=1=1 is supported");
    await refused("f=pbf", "f=pbf is not supported");
    await refused("outSR=2227", "spatial reference 2227 is not supported");
    await refused("geometry=1,2&geometryType=esriGeometryEnvelope", "must be an envelope");
    await refused("geometry=-124,40,-123,42&geometryType=esriGeometryPoint", "only an envelope");
    await refused("geometry=-124,40,-123,42&spatialRel=esriSpatialRelWithin", "esriSpatialRelWithin is not supported");
    await refused("outStatistics=[]", "statistics");
    await refused("objectIds=1,x", "objectIds");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const response = await app.inject({ method, url: `${services}/${sitesBoard}/FeatureServer/0/applyEdits`, headers: auth(identityToken) });
      expect(response.statusCode).toBe(404);
    }
  });

  it("keeps each record's object id through an edit and a restart", async () => {
    const [record] = await admin`select id, object_id from board_records where board_id = ${sitesBoard} and data ->> 'name' = 'Orick'`;
    const patched = await app.inject({ method: "PATCH", url: `/api/v1/boards/${sitesBoard}/records/${record!.id as string}`,
      headers: auth(adminToken), payload: { status: "closed" } });
    expect(patched.statusCode, patched.body).toBe(200);
    const restarted = buildApp(runtime, { oidc: null });
    try {
      const response = await restarted.inject({ method: "GET",
        url: `${services}/${sitesBoard}/FeatureServer/0/query?objectIds=${record!.object_id as string}&outFields=name,status&token=${identityToken}` });
      expect(response.json().features[0].attributes).toEqual({ OBJECTID: Number(record!.object_id), name: "Orick", status: "closed" });
    } finally {
      await restarted.close();
    }
  });

  it("holds a record rule and a field read level for a service identity as the board does", async () => {
    await post(`/api/v1/boards/${privateBoard}/records`, { name: "Admin report", location: { type: "Point", coordinates: [-123.9, 41.1] } });
    await post(`/api/v1/boards/${privateBoard}/records`, { name: "Integration report", location: { type: "Point", coordinates: [-123.7, 41.2] } }, identityToken);
    const query = `${services}/${privateBoard}/FeatureServer/0/query?where=1=1&outFields=*`;
    expect((await admin`select object_id from board_records where board_id = ${privateBoard} order by object_id`)
      .map((r) => Number(r.object_id))).toEqual([1, 2]);
    const seen = (await esri(query)).json();
    expect(seen.features.map((f: { attributes: { name: string } }) => f.attributes.name)).toEqual(["Integration report"]);
    expect((await esri(`${query}&returnCountOnly=true`)).json()).toEqual({ count: 1 });
    const [hidden] = await admin`select object_id from board_records where board_id = ${privateBoard} and data ->> 'name' = 'Admin report'`;
    expect((await esri(`${query}&objectIds=${hidden!.object_id as string}`)).json().features).toEqual([]);
    const layer = (await esri(`${services}/${privateBoard}/FeatureServer/0`)).json();
    expect(layer.extent).toMatchObject({ xmin: -123.7, xmax: -123.7 });
    const asAdmin = (await get(query, auth(adminToken))).json();
    expect(asAdmin.features.map((f: { attributes: { name: string } }) => f.attributes.name).sort()).toEqual(["Admin report", "Integration report"]);
    // The admin-only field: absent for the identity even when named, present for the administrator.
    const named = (await esri(`${services}/${sitesBoard}/FeatureServer/0/query?where=1=1&outFields=name,notes`)).json();
    expect(named.fields.map((f: { name: string }) => f.name)).toEqual(["OBJECTID", "name"]);
    expect(named.features.every((f: { attributes: Record<string, unknown> }) => !("notes" in f.attributes))).toBe(true);
    const adminNamed = (await get(`${services}/${sitesBoard}/FeatureServer/0/query?where=1=1&outFields=notes`, auth(adminToken))).json();
    expect(adminNamed.features[0].attributes.notes).toMatch(/^admin only /);
    // A member's session reads the same view.
    expect((await get(`${services}/${sitesBoard}/FeatureServer/0/query?where=1=1&returnCountOnly=true`, auth(memberToken))).json()).toEqual({ count: 5 });
  });

  it("takes the token from each place Esri clients send it, refuses a revoked one, and logs none", async () => {
    const url = `${services}/${sitesBoard}/FeatureServer/0/query?where=1=1&returnCountOnly=true`;
    expect((await get(url, { authorization: `Bearer ${identityToken}` })).json()).toEqual({ count: 5 });
    // QGIS's Esri token method sends a trailing space.
    expect((await get(url, { "x-esri-authorization": `Bearer ${identityToken} ` })).json()).toEqual({ count: 5 });
    expect((await esri(url)).json()).toEqual({ count: 5 });
    expect((await esri(`/api/v1/esri/rest/nowhere?f=json`)).statusCode).toBe(404);
    expect((await esri(`${services}/${sitesBoard}/FeatureServer/0/query?where=x`)).statusCode).toBe(400);
    // A person's session is taken from Authorization alone, never from the address or the Esri header.
    const session = await esri(url, memberToken);
    expect(session.statusCode).toBe(401);
    expect(session.json().error).toContain("only a service identity's token");
    expect((await get(url, { "x-esri-authorization": `Bearer ${memberToken}` })).statusCode).toBe(401);
    expect((await get(url, auth(memberToken))).json()).toEqual({ count: 5 });
    // The token works only on this view: every other route wants the bearer header.
    expect((await get(`/api/v1/ogc/collections?token=${identityToken}`)).statusCode).toBe(401);

    const revoked = await app.inject({ method: "DELETE", url: `/api/v1/service-identities/${identityId}`, headers: auth(adminToken) });
    expect(revoked.statusCode, revoked.body).toBe(200);
    const refused = await esri(url);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error).toContain("revoked");
    expect((await get(url, { "x-esri-authorization": `Bearer ${identityToken}` })).statusCode).toBe(401);

    const logs = lines.join("\n");
    expect(logs).toContain("/api/v1/esri/rest/services/:boardId/FeatureServer/:layerId/query");
    expect(logs).not.toContain(identityToken.split(".").at(-1)!);
    expect(logs).not.toContain("oeoc-svc.");
    expect(logs).not.toContain(memberToken);
    expect(logs).not.toContain("token=");
  });
});

describe("Esri JSON import", () => {
  const fields = [
    { name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "name", type: "esriFieldTypeString" },
    { name: "status", type: "esriFieldTypeString" }, { name: "count", type: "esriFieldTypeInteger" },
    { name: "opened", type: "esriFieldTypeDate" },
  ];
  const opened = Date.parse("2026-09-24T18:30:00Z");

  it("imports points with a dry run first, maps the geometry to the board's field and keeps the report", async () => {
    const file = {
      geometryType: "esriGeometryPoint", spatialReference: { wkid: 4326, latestWkid: 4326 }, fields,
      features: [
        { attributes: { OBJECTID: 1, name: "Hoopa staging", status: "open", count: 4, opened }, geometry: { x: -123.68, y: 41.05 } },
        { attributes: { OBJECTID: 2, name: "Orleans staging", status: null, count: null, opened: null }, geometry: { x: -123.54, y: 41.3, z: 120 } },
      ],
    };
    const dry = await importFile(importBoard, file, "?dryRun=true");
    expect(dry.statusCode, dry.body).toBe(200);
    expect(dry.json()).toMatchObject({
      dryRun: true, rows: 2, created: 0, errorCount: 0, ignored: ["OBJECTID"],
      mapping: { name: "name", status: "status", count: "count", opened: "opened", geometry: "site" },
    });
    const done = await importFile(importBoard, file);
    expect(done.statusCode, done.body).toBe(201);
    expect(done.json()).toMatchObject({ created: 2, errorCount: 0 });
    const rows = await admin`
      select data, ST_AsText(geom) as wkt from board_records where board_id = ${importBoard} order by data ->> 'name'`;
    expect(rows.map((r) => [r.data, r.wkt])).toEqual([
      [{ name: "Hoopa staging", status: "open", count: 4, opened: "2026-09-24T18:30:00.000Z", site: { type: "Point", coordinates: [-123.68, 41.05] } },
        "POINT(-123.68 41.05)"],
      [{ name: "Orleans staging", site: { type: "Point", coordinates: [-123.54, 41.3] } }, "POINT(-123.54 41.3)"],
    ]);
    const report = await app.inject({ method: "GET", url: `/api/v1/import-reports/${done.json().reportId as string}`, headers: auth(adminToken) });
    expect(report.json()).toMatchObject({ kind: "board_records", subject: "Esri Sites", sourceName: "layer.json", read: 2, created: 2,
      mapping: expect.arrayContaining([{ field: "Site", column: "geometry" }]) });
    expect(report.json().rows.map((r: { row: number }) => r.row)).toEqual([1, 2]);
  });

  it("converts a multipart polygon with a hole and polylines from Web Mercator", async () => {
    const ring = (coordinates: number[][]) => coordinates.map((p) => mercator(p as [number, number]));
    // Esri's order: outer rings clockwise, the hole counter-clockwise.
    const outerA = ring([[-124.2, 41.6], [-124.2, 41.7], [-124.1, 41.7], [-124.1, 41.6], [-124.2, 41.6]]);
    const hole = ring([[-124.17, 41.63], [-124.15, 41.63], [-124.15, 41.65], [-124.17, 41.65], [-124.17, 41.63]]);
    const outerB = ring([[-124.0, 41.8], [-124.0, 41.85], [-123.95, 41.85], [-123.95, 41.8], [-124.0, 41.8]]);
    const file = {
      geometryType: "esriGeometryPolygon", spatialReference: { wkid: 102100, latestWkid: 3857 },
      fields: [{ name: "name", type: "esriFieldTypeString" }],
      features: [
        { attributes: { name: "Reservation" }, geometry: { rings: [outerA, outerB, hole] } },
        { attributes: { name: "Two roads" }, geometry: { paths: [ring([[-123.6, 41.3], [-123.5, 41.35]]), ring([[-123.4, 41.2], [-123.3, 41.25]])] } },
      ],
    };
    const done = await importFile(importBoard, file);
    expect(done.statusCode, done.body).toBe(201);
    const [reservation] = await admin`
      select data -> 'site' as site, GeometryType(geom) as kind, ST_NumGeometries(geom) as parts, ST_NumInteriorRings(ST_GeometryN(geom, 1)) as holes
      from board_records where board_id = ${importBoard} and data ->> 'name' = 'Reservation'`;
    expect(reservation).toMatchObject({ kind: "MULTIPOLYGON", parts: 2, holes: 1 });
    const polygons = reservation!.site.coordinates as number[][][][];
    expect(polygons[0]![0]![0]![0]).toBeCloseTo(-124.2, 7);
    expect(polygons[0]![1]![0]![1]).toBeCloseTo(41.63, 7);
    // RFC 7946: outer rings counter-clockwise, holes clockwise.
    expect(polygons.map((polygon) => polygon.map(clockwise))).toEqual([[false, true], [false]]);
    const [roads] = await admin`
      select GeometryType(geom) as kind from board_records where board_id = ${importBoard} and data ->> 'name' = 'Two roads'`;
    expect(roads!.kind).toBe("MULTILINESTRING");
  });

  it("imports a feature collection's layer and its own FeatureServer output", async () => {
    const collection = { layers: [{
      layerDefinition: { geometryType: "esriGeometryPoint", fields: [{ name: "name", type: "esriFieldTypeString" }],
        extent: { spatialReference: { wkid: 4326 } } },
      featureSet: { geometryType: "esriGeometryPoint", features: [{ attributes: { name: "Collection point" }, geometry: { x: -123.1, y: 40.9 } }] },
    }] };
    expect((await importFile(importBoard, collection)).statusCode).toBe(201);
    // What this server's query?f=json answers imports back, the server's own columns left out.
    const output = (await get(`${services}/${sitesBoard}/FeatureServer/0/query?where=1=1&outFields=*`, auth(adminToken))).json();
    const again = await importFile(importBoard, output, "?dryRun=true");
    expect(again.json()).toMatchObject({ rows: 5, errorCount: 0, mapping: { name: "name", geometry: "site", notes: "notes" } });
    expect(again.json().ignored).toEqual(expect.arrayContaining(["OBJECTID", "RecordID", "EditDate", "Editor"]));
  });

  it("refuses a malformed file in plain words, without failing", async () => {
    const refused = async (response: Awaited<ReturnType<typeof importText>>, error: string) => {
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error).toBe(error);
    };
    await refused(await importFile(importBoard, { spatialReference: { wkid: 4326 }, fields: {}, features: [] }),
      "the file's fields are not a list of fields");
    await refused(await importFile(importBoard, { spatialReference: { wkid: 4326 }, features: [{ attributes: "name", geometry: { x: 1, y: 1 } }] }),
      "feature 1 has attributes that are not named values");
    // Nested far past any Esri shape: parsed, never walked or written out whole.
    const deep = `{"spatialReference":{"wkid":4326},"features":[{"attributes":{"name":"Deep"},"geometry":{"rings":${"[".repeat(50_000)}${"]".repeat(50_000)}}}]}`;
    await refused(await importText(importBoard, deep), "feature 1 nests deeper than Esri JSON does");
    // A date past what a date can hold is its row's error.
    const late = await importFile(importBoard, { spatialReference: { wkid: 4326 }, fields: [{ name: "opened", type: "esriFieldTypeDate" }],
      features: [{ attributes: { name: "Late", opened: 1e20 }, geometry: { x: -123, y: 41 } }] }, "?dryRun=true");
    expect(late.statusCode, late.body).toBe(200);
    expect(late.json().errors).toEqual([expect.objectContaining({ row: 1, field: "opened" })]);
  });

  it("reports a shape that is not valid or lies past the edge of the world on its row, and repairs nothing", async () => {
    const before = (await admin`select count(*)::int as n from board_records where board_id = ${importBoard}`)[0]!.n as number;
    const cw = (x: number, y: number, size: number) => square(x, y, size).reverse();
    const failed = await importFile(importBoard, { spatialReference: { wkid: 4326 }, features: [
      { attributes: { name: "Bow tie" }, geometry: { rings: [[[10, 10], [11, 11], [11, 10], [10, 11], [10, 10]]] } },
      // The hole's first corner is inside the area; the rest of it is not.
      { attributes: { name: "Loose hole" }, geometry: { rings: [cw(0, 0, 1), square(0.5, 0.5, 1)] } },
      { attributes: { name: "Past the dateline" }, geometry: { x: 190, y: 10 } },
      { attributes: { name: "Fine" }, geometry: { x: -123, y: 41 } },
    ] });
    expect(failed.statusCode).toBe(422);
    const errors = failed.json().errors as Array<{ row: number; field: string; message: string }>;
    expect(errors.map((e) => [e.row, e.field])).toEqual([[1, "site"], [2, "site"], [3, "site"]]);
    expect(errors[0]!.message).toMatch(/^Site is not a valid shape: Self-intersection/);
    expect(errors[1]!.message).toMatch(/^Site is not a valid shape: /);
    expect(errors[2]!.message).toBe("Site: a coordinate lies outside longitude -180 to 180 or latitude -90 to 90");
    const edge = await importFile(importBoard, { spatialReference: { wkid: 102100 },
      features: [{ attributes: { name: "Off the map" }, geometry: { x: 20_100_000, y: 0 } }] }, "?dryRun=true");
    expect(edge.json().errors).toEqual([{ row: 1, field: "site", message: "Site: a Web Mercator x lies beyond the edge of the world (20,037,508 m)" }]);
    expect((await admin`select count(*)::int as n from board_records where board_id = ${importBoard}`)[0]!.n).toBe(before);

    // A hole that touches its area at one corner is still a hole, not a filled part.
    const pond = await importFile(importBoard, { spatialReference: { wkid: 4326 }, features: [{ attributes: { name: "Pond at the fence" },
      geometry: { rings: [cw(20, 20, 2), [[20, 21], [21, 20.5], [21.5, 21], [21, 21.5], [20, 21]]] } }] });
    expect(pond.statusCode, pond.body).toBe(201);
    const [stored] = await admin`
      select GeometryType(geom) as kind, ST_NumInteriorRings(geom) as holes, ST_IsValid(geom) as valid
      from board_records where board_id = ${importBoard} and data ->> 'name' = 'Pond at the fence'`;
    expect(stored).toEqual({ kind: "POLYGON", holes: 1, valid: true });
  });

  it("refuses an unsupported spatial reference and writes nothing when one feature fails", async () => {
    const before = (await admin`select count(*)::int as n from board_records where board_id = ${importBoard}`)[0]!.n as number;
    const stateplane = await importFile(importBoard, {
      spatialReference: { wkid: 2227, latestWkid: 2227 }, features: [{ attributes: { name: "Survey" }, geometry: { x: 6_000_000, y: 2_100_000 } }],
    });
    expect(stateplane.statusCode).toBe(400);
    expect(stateplane.json().error).toBe("the file's spatial reference 2227 is not supported: use 4326 (WGS 84) or 3857 (Web Mercator)");
    const unnamed = await importFile(importBoard, { features: [{ attributes: { name: "Nowhere" }, geometry: { x: 1, y: 2 } }] });
    expect(unnamed.json().error).toContain("names no spatial reference");
    expect((await importFile(importBoard, { type: "FeatureCollection", features: {} })).json().error).toContain("not an Esri JSON feature set");

    const mixed = {
      spatialReference: { wkid: 4326 },
      features: [
        { attributes: { name: "Good" }, geometry: { x: -123, y: 41 } },
        { attributes: { name: "Curved" }, geometry: { curveRings: [[[0, 0], { a: [[1, 1], [0, 0], 0, 1] }]] } },
        { attributes: { name: "Elsewhere" }, geometry: { x: 1, y: 1, spatialReference: { wkid: 27700 } } },
      ],
    };
    const failed = await importFile(importBoard, mixed);
    expect(failed.statusCode).toBe(422);
    expect(failed.json()).toMatchObject({ created: 0, errorCount: 2 });
    expect(failed.json().errors).toEqual([
      { row: 2, field: "site", message: "Site: curved geometry is not supported: densify it before export" },
      { row: 3, field: "site", message: "Site: spatial reference 27700 is not supported: use 4326 (WGS 84) or 3857 (Web Mercator)" },
    ]);
    // A polygon does not fit a point field.
    const polygon = await importFile(privateBoard, { spatialReference: { wkid: 4326 },
      features: [{ attributes: { name: "Area" }, geometry: { rings: [square(-124, 41, 0.1).reverse()] } }] });
    expect(polygon.json().errors).toEqual([{ row: 1, field: "location", message: "must be a point" }]);
    expect((await admin`select count(*)::int as n from board_records where board_id = ${importBoard}`)[0]!.n).toBe(before);
  });
});
