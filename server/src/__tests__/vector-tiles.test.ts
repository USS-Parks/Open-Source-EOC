import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Operational vector tiles cut by PostGIS: a 5,000-point board and dataset
 * render past the GeoJSON page cap, cluster at low zoom, and never carry a
 * record or a field the caller cannot read.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let adminToken: string;
let memberToken: string;
let outsiderToken: string;
let boardId: string;
let datasetId: string;

const COUNT = 5000;
/** 100 x 50 grid of points 0.002 degrees apart, south-west corner here. */
const WEST = -123.7;
const SOUTH = 41.2;
const pointAt = (i: number): [number, number] => [WEST + (i % 100) * 0.002, SOUTH + Math.floor(i / 100) * 0.002];

/** The slippy-map tile holding a WGS84 position. */
function tileOf(lng: number, lat: number, z: number): [number, number, number] {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return [z, x, y];
}

type Props = Record<string, string | number | boolean>;

/** Minimal Mapbox Vector Tile reader: layer name to feature properties. */
function decodeMvt(buf: Uint8Array): Record<string, Props[]> {
  const fields = (b: Uint8Array): [number, number | Uint8Array][] => {
    const out: [number, number | Uint8Array][] = [];
    let i = 0;
    const varint = () => {
      let value = 0;
      let scale = 1;
      let byte: number;
      do {
        byte = b[i++]!;
        value += (byte & 0x7f) * scale;
        scale *= 128;
      } while (byte & 0x80);
      return value;
    };
    while (i < b.length) {
      const key = varint();
      const wire = key & 7;
      const field = Math.floor(key / 8);
      if (wire === 0) out.push([field, varint()]);
      else if (wire === 2) {
        const n = varint();
        out.push([field, b.subarray(i, i + n)]);
        i += n;
      } else if (wire === 1) {
        out.push([field, Buffer.from(b.subarray(i, i + 8)).readDoubleLE(0)]);
        i += 8;
      } else if (wire === 5) {
        out.push([field, Buffer.from(b.subarray(i, i + 4)).readFloatLE(0)]);
        i += 4;
      } else throw new Error(`unexpected wire type ${wire}`);
    }
    return out;
  };
  const text = (v: number | Uint8Array) => Buffer.from(v as Uint8Array).toString("utf8");
  const packed = (v: Uint8Array) => {
    const out: number[] = [];
    let value = 0;
    let scale = 1;
    for (const byte of v) {
      value += (byte & 0x7f) * scale;
      scale *= 128;
      if ((byte & 0x80) === 0) {
        out.push(value);
        value = 0;
        scale = 1;
      }
    }
    return out;
  };
  const layers: Record<string, Props[]> = {};
  for (const [field, layerBytes] of fields(buf)) {
    if (field !== 3) continue;
    let name = "";
    const keys: string[] = [];
    const values: (string | number | boolean)[] = [];
    const features: Uint8Array[] = [];
    for (const [f, v] of fields(layerBytes as Uint8Array)) {
      if (f === 1) name = text(v);
      else if (f === 2) features.push(v as Uint8Array);
      else if (f === 3) keys.push(text(v));
      else if (f === 4) {
        const [[kind, raw]] = fields(v as Uint8Array) as [[number, number | Uint8Array]];
        values.push(kind === 1 ? text(raw) : kind === 7 ? raw === 1 : kind === 6 ? ((raw as number) % 2 ? -((raw as number) + 1) / 2 : (raw as number) / 2) : raw as number);
      }
    }
    layers[name] = features.map((feature) => {
      const props: Props = {};
      for (const [f, v] of fields(feature)) {
        if (f !== 2) continue;
        const tags = packed(v as Uint8Array);
        for (let t = 0; t < tags.length; t += 2) props[keys[tags[t]!]!] = values[tags[t + 1]!]!;
      }
      return props;
    });
  }
  return layers;
}

async function tile(url: string, token: string) {
  const res = await app.inject({ method: "GET", url, headers: auth(token) });
  return { status: res.statusCode, headers: res.headers, body: res.rawPayload, layers: res.statusCode === 200 ? decodeMvt(res.rawPayload) : {} };
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await createPerson(admin, { email: "tiles-out@example.org", displayName: "Tile Outsider", password: "tile-outsider-pass1" });
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  outsiderToken = await tokenFor(app, "tiles-out@example.org", "tile-outsider-pass1");

  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken),
    payload: { templateKey: "road_closures" },
  });
  boardId = board.json().id as string;
  const local = await app.inject({
    method: "POST",
    url: `/api/v1/boards/${boardId}/local-fields`,
    headers: auth(adminToken),
    payload: { key: "x_secret", label: "Admin note", type: "text", read: "admin" },
  });
  expect(local.statusCode).toBeLessThan(300);
  await admin`
    insert into board_records (board_id, data, created_by, geom)
    select ${boardId}, jsonb_build_object(
        'road', 'Road ' || i, 'reason', 'Load', 'status', 'closed', 'x_secret', 'classified-' || i,
        'location', jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(lng, lat))),
      ${seed.adminId}, ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    from (select i, (${WEST} + (i % 100) * 0.002)::float8 as lng, (${SOUTH} + (i / 100) * 0.002)::float8 as lat
          from generate_series(0, ${COUNT - 1}) i) g`;

  const incident = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    headers: auth(adminToken),
    payload: { templateKey: "daily_ops", name: "Synthetic tile fixture" },
  });
  const incidentId = incident.json().incidentId as string;
  const registered = await app.inject({
    method: "POST",
    url: `/api/v1/incidents/${incidentId}/data-packs`,
    headers: auth(adminToken),
    payload: {
      name: "Synthetic point pack",
      organizationSlug: "yurok",
      description: "Synthetic points for tile verification.",
      datasets: [{
        key: "synthetic_points",
        name: "Synthetic points",
        kind: "geojson",
        fieldMapping: { title: "name", sourceId: "id", geometry: "geometry" },
      }],
    },
  });
  expect(registered.statusCode).toBe(201);
  datasetId = (await admin`
    select id from data_pack_datasets where pack_id = ${registered.json().pack.id as string}`)[0]!.id as string;
  const loaded = await app.inject({
    method: "POST",
    url: `/api/v1/data-packs/datasets/${datasetId}/load`,
    headers: auth(adminToken),
    payload: { records: Array.from({ length: COUNT }, (_, i) => ({
      id: `pt-${i}`,
      name: `Point ${i}`,
      geometry: { type: "Point", coordinates: pointAt(i) },
    })) },
  });
  expect(loaded.statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

const boardTile = (z: number, x: number, y: number) => `/api/v1/tiles/boards/${boardId}/${z}/${x}/${y}.mvt`;
const datasetTile = (z: number, x: number, y: number) => `/api/v1/tiles/datasets/${datasetId}/${z}/${x}/${y}.mvt`;

describe("board vector tiles", () => {
  it("serves every record past the GeoJSON cap as clusters at low zoom", async () => {
    const page = await app.inject({
      method: "GET",
      url: `/api/v1/ogc/collections/${boardId}/items?limit=1000`,
      headers: auth(memberToken),
    });
    expect(page.json().numberReturned).toBe(1000);
    expect(page.json().links.some((l: { rel: string }) => l.rel === "next")).toBe(true);

    const res = await tile(boardTile(...tileOf(WEST, SOUTH, 8)), memberToken);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/vnd.mapbox-vector-tile");
    expect(res.headers["cache-control"]).toBe("private, max-age=5");
    const clusters = res.layers.clusters ?? [];
    expect(clusters.length).toBeGreaterThan(1);
    expect(clusters.reduce((sum, c) => sum + (c.point_count as number), 0)).toBe(COUNT);
    expect(res.layers.features ?? []).toHaveLength(0);
  });

  it("serves individual records with readable fields at street zoom", async () => {
    const [z, x, y] = tileOf(-123.6, 41.25, 13);
    const member = await tile(boardTile(z, x, y), memberToken);
    expect(member.status).toBe(200);
    expect(member.layers.clusters).toBeUndefined();
    const features = member.layers.features ?? [];
    expect(features.length).toBeGreaterThan(10);
    expect(new Set(features.map((f) => f._id)).size).toBe(features.length);
    for (const f of features) {
      expect(f._id).toMatch(/^[0-9a-f-]{36}$/);
      expect(f.road).toMatch(/^Road \d+$/);
      expect(f.status).toBe("closed");
      expect(f.location).toBeUndefined();
      expect(f.x_secret).toBeUndefined();
    }
    // The restricted field is absent from the bytes, not merely undecoded.
    expect(member.body.includes("x_secret")).toBe(false);
    expect(member.body.includes("classified-")).toBe(false);

    const adminView = await tile(boardTile(z, x, y), adminToken);
    expect(adminView.layers.features).toHaveLength(features.length);
    expect(adminView.layers.features!.every((f) => String(f.x_secret).startsWith("classified-"))).toBe(true);
  });

  it("returns an empty tile where there are no records", async () => {
    const res = await tile(boardTile(...tileOf(10, 10, 12)), memberToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  it("denies a caller without access and rejects a tile outside its zoom", async () => {
    const denied = await tile(boardTile(...tileOf(WEST, SOUTH, 8)), outsiderToken);
    expect([403, 404]).toContain(denied.status);
    expect(denied.body.includes("Road ")).toBe(false);
    const bad = await tile(boardTile(3, 8, 0), memberToken);
    expect(bad.status).toBe(400);
    const unauthenticated = await app.inject({ method: "GET", url: boardTile(8, 40, 95) });
    expect(unauthenticated.statusCode).toBe(401);
  });
});

describe("dataset vector tiles", () => {
  it("clusters at low zoom and carries item fields at street zoom", async () => {
    const low = await tile(datasetTile(...tileOf(WEST, SOUTH, 8)), memberToken);
    expect(low.status).toBe(200);
    expect((low.layers.clusters ?? []).reduce((sum, c) => sum + (c.point_count as number), 0)).toBe(COUNT);

    const high = await tile(datasetTile(...tileOf(-123.6, 41.25, 13)), memberToken);
    const features = high.layers.features ?? [];
    expect(features.length).toBeGreaterThan(10);
    for (const f of features) {
      expect(f._id).toMatch(/^pt-\d+$/);
      expect(f.title).toBe(`Point ${String(f._id).slice(3)}`);
    }
  });

  it("leaves out areas too small to see at low zoom and draws them close up", async () => {
    const square = (lng: number, lat: number, size: number) =>
      `POLYGON((${lng} ${lat},${lng + size} ${lat},${lng + size} ${lat + size},${lng} ${lat + size},${lng} ${lat}))`;
    const [item] = await admin`select incident_id, loaded_by from data_pack_items where dataset_id = ${datasetId} limit 1`;
    await admin`
      insert into data_pack_items (dataset_id, incident_id, source_id, data, geom, loaded_by)
      values (${datasetId}, ${item!.incident_id as string}, 'parcel-small', '{"title":"Small parcel"}',
              ST_GeomFromText(${square(-123.6, 41.25, 0.0002)}, 4326), ${item!.loaded_by as string}),
             (${datasetId}, ${item!.incident_id as string}, 'zone-large', '{"title":"Large zone"}',
              ST_GeomFromText(${square(-123.62, 41.24, 0.05)}, 4326), ${item!.loaded_by as string})`;
    try {
      const ids = async (z: number) => ((await tile(datasetTile(...tileOf(-123.5999, 41.2501, z)), memberToken)).layers.features ?? [])
        .map((f) => f._id).filter((id) => !String(id).startsWith("pt-"));
      expect(await ids(8)).toEqual(["zone-large"]);
      expect((await ids(16)).sort()).toEqual(["parcel-small", "zone-large"]);
    } finally {
      await admin`delete from data_pack_items where dataset_id = ${datasetId} and source_id in ('parcel-small', 'zone-large')`;
    }
  });

  it("denies a caller outside the incident", async () => {
    const denied = await tile(datasetTile(...tileOf(WEST, SOUTH, 8)), outsiderToken);
    expect([403, 404]).toContain(denied.status);
    expect(denied.body.includes("Point ")).toBe(false);
  });
});
