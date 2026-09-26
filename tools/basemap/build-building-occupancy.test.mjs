import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import {
  archiveHeader, binStructures, enrichArchive, footprintsHolding, occupancyOf, structures, withOccupancy,
} from "./build-building-occupancy.mjs";
import { archiveTiles, lonLat } from "./build-gazetteer.mjs";
import { COMPRESSION, TILE_TYPE, writePmtiles } from "./pmtiles-writer.mjs";

// Runs under the workspace vitest, on small fixtures; nothing here uses the network.

const fromMapLibre = createRequire(createRequire(new URL("../../web/package.json", import.meta.url)).resolve("maplibre-gl/package.json"));
const load = (name) => import(pathToFileURL(fromMapLibre.resolve(name)).href);
const { fromGeojsonVt } = await load("@maplibre/vt-pbf");
const { VectorTile } = await load("@mapbox/vector-tile");
const { PbfReader } = await load("pbf");

const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
/** Two footprints, one with a courtyard, and a third no structure lies in. */
const FOOTPRINTS = [
  { id: 12, type: 3, geometry: [square(100, 100, 200, 200), square(140, 160, 160, 140)], tags: { class: "yes", osm_id: 1, name: "Courtyard" } },
  { id: 22, type: 3, geometry: [square(300, 300, 400, 400)], tags: { class: "house", osm_id: 2, levels: 2 } },
  { id: 32, type: 3, geometry: [square(500, 500, 600, 600)], tags: { class: "yes", osm_id: 3, overture_subtype: "civic" } },
];
const tileOf = (features) => Buffer.from(fromGeojsonVt({ buildings: { features } }, { version: 2, extent: 4096 }));
const decode = (data) => {
  const layer = new VectorTile(new PbfReader(data)).layers.buildings;
  return Array.from({ length: layer.length }, (_, i) => {
    const f = layer.feature(i);
    return { id: f.id, type: f.type, properties: f.properties, geometry: f.loadGeometry().map((ring) => ring.map(({ x, y }) => [x, y])) };
  });
};
const at = (id, px, py, occ, sqft, prim) => ({ id, px, py, occ, sqft, ...(prim ? { prim } : {}) });

describe("USA Structures points", () => {
  it("keeps the classified structures with their occupancy and size", () => {
    const point = (OBJECTID, OCC_CLS, PRIM_OCC, SQFEET) => ({ geometry: { type: "Point", coordinates: [-124.1, 40.8] }, properties: { OBJECTID, OCC_CLS, PRIM_OCC, SQFEET } });
    expect(structures([
      point(1, "Commercial", "Hospital", 90_000), point(2, "Unclassified", null, 800), point(3, " ", null, 800), point(4, "Utility and Misc", "", null),
    ])).toEqual([
      { id: 1, lon: -124.1, lat: 40.8, occ: "Commercial", prim: "Hospital", sqft: 90_000 },
      { id: 4, lon: -124.1, lat: 40.8, occ: "Utility and Misc", prim: undefined, sqft: 0 },
    ]);
  });

  it("gives a footprint the class of the largest structure inside it, then the lowest id", () => {
    expect(occupancyOf([at(5, 0, 0, "Commercial", 900, "Retail Trade"), at(3, 0, 0, "Residential", 2_000, "Single Family Dwelling")]))
      .toEqual({ occ: "Residential", occ_prim: "Single Family Dwelling" });
    expect(occupancyOf([at(5, 0, 0, "Commercial", 900), at(3, 0, 0, "Government", 900)])).toEqual({ occ: "Government" });
  });

  it("bins points into the tile they fall in, in that tile's coordinates", () => {
    const [lon, lat] = lonLat(14, 2541, 6154, 4096, 1024, 3072);
    const [[key, [point]]] = [...binStructures([{ id: 1, lon, lat }], 14)];
    expect(key).toBe("2541/6154");
    expect(point.px).toBeCloseTo(1024, -1);
    expect(point.py).toBeCloseTo(3072, -1);
  });
});

describe("footprints", () => {
  const tile = tileOf(FOOTPRINTS);
  const layer = () => new VectorTile(new PbfReader(tile)).layers.buildings;

  it("finds the structures inside each footprint, leaving out a courtyard", () => {
    const held = footprintsHolding(layer(), [
      at(1, 120, 120, "Commercial", 900), at(2, 180, 180, "Residential", 2_000), at(3, 150, 150, "Assembly", 5_000),
      at(4, 350, 350, "Government", 3_000), at(5, 700, 700, "Industrial", 3_000),
    ]);
    expect([...held.keys()]).toEqual([12, 22]);
    expect(held.get(12).map((p) => p.id)).toEqual([1, 2]);
    expect(held.get(22).map((p) => p.id)).toEqual([4]);
  });

  it("adds occ and occ_prim to the matched footprints and writes everything else back as it was", () => {
    const byId = new Map([[12, { occ: "Residential", occ_prim: "Single Family Dwelling" }], [22, { occ: "Government" }]]);
    const before = decode(tile);
    const after = decode(withOccupancy(tile, byId));
    const shape = ({ id, type, geometry }) => ({ id, type, geometry });
    expect(after.map(shape)).toEqual(before.map(shape));
    expect(after.map((f) => f.properties)).toEqual([
      { ...before[0].properties, occ: "Residential", occ_prim: "Single Family Dwelling" },
      { ...before[1].properties, occ: "Government" },
      before[2].properties,
    ]);
    expect(withOccupancy(tile, new Map([[99, { occ: "Commercial" }]]))).toBeNull();
  });
});

describe("the enriched archive", () => {
  const dir = mkdtempSync(join(tmpdir(), "occupancy-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("rewrites only the tiles holding a matched footprint, at both zooms, and names the source", () => {
    const eureka = { z: 14, x: 2541, y: 6154 };
    const inputTiles = [
      { z: 13, x: 1270, y: 3077, features: FOOTPRINTS },
      { ...eureka, features: FOOTPRINTS },
      { z: 14, x: 2542, y: 6154, features: [{ ...FOOTPRINTS[2], id: 42 }] },
      { z: 14, x: 2600, y: 6000, features: FOOTPRINTS },
    ].map(({ features, ...tile }) => ({ ...tile, data: gzipSync(tileOf(features)) }));
    const metadata = {
      name: "buildings", attribution: "© OpenStreetMap contributors", overture_release: "2026-08-19.0",
      vector_layers: [{ id: "buildings", fields: { class: "String", osm_id: "Number" }, minzoom: 13, maxzoom: 14 }],
    };
    const archive = join(dir, "buildings.pmtiles");
    writeFileSync(archive, writePmtiles(inputTiles, { tileType: TILE_TYPE.mvt, tileCompression: COMPRESSION.gzip, bounds: [-125, 32, -114, 42], metadata }));

    const point = (id, px, py, occ, sqft) => {
      const [lon, lat] = lonLat(eureka.z, eureka.x, eureka.y, 4096, px, py);
      return { id, lon, lat, occ, prim: undefined, sqft };
    };
    const points = [point(1, 120, 120, "Commercial", 900), point(2, 180, 180, "Residential", 2_000), point(4, 350, 350, "Government", 3_000)];
    const box = [-124.18, 40.78, -124.14, 40.81];
    const source = { url: "https://example.test/layer", edition: "2026-01-23", coverage: "Humboldt County, California" };
    const { bytes, metadata: written, counts } = enrichArchive({ archive, points, box, source });
    const output = join(dir, "enriched.pmtiles");
    writeFileSync(output, bytes);

    const read = (path, z) => new Map([...archiveTiles(path, z, { raw: true })].map((t) => [`${t.z}/${t.x}/${t.y}`, t.data]));
    const [before, after] = [archive, output].map((path) => new Map([...read(path, 13), ...read(path, 14)]));
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const key of ["14/2542/6154", "14/2600/6000"]) expect(after.get(key).equals(before.get(key)), key).toBe(true);
    for (const key of ["13/1270/3077", "14/2541/6154"]) {
      expect(decode(gunzipSync(after.get(key))).map((f) => f.properties.occ ?? null), key).toEqual(["Residential", "Government", null]);
    }
    expect(counts).toMatchObject({
      structures: 3, structuresInAFootprint: 3, footprintsEnriched: 2, footprintsWithMixedClasses: 1,
      footprintsByClass: { Government: 1, Residential: 1 }, tilesRewritten: { 13: 1, 14: 1 }, tiles: 4,
    });

    const header = archiveHeader(output);
    expect(header.metadata).toEqual(written);
    expect(written.vector_layers[0].fields).toEqual({ class: "String", osm_id: "Number", occ: "String", occ_prim: "String" });
    expect(written.attribution).toMatch(/^© OpenStreetMap contributors; occupancy: .*FEMA USA Structures/);
    expect(written).toMatchObject({ overture_release: "2026-08-19.0", usa_structures_edition: "2026-01-23", usa_structures_coverage: "Humboldt County, California" });
    expect(header.bounds).toEqual([-125, 32, -114, 42]);
  });
});
