#!/usr/bin/env node
// Adds FEMA USA Structures occupancy to the buildings archive with Node only.
// An OpenStreetMap footprint that holds the point of a USA Structures
// structure takes that structure's occupancy class as `occ` and its primary
// occupancy as `occ_prim`. Every other attribute, footprint and tile stays as
// it was: tiles with no match are copied byte for byte. Writes to the output
// folder buildings.pmtiles, buildings-overture.json (the sidecar the Windows
// launcher verifies before it credits either enrichment) and
// buildings-occupancy.json (the build receipt).
//
//   node tools/basemap/build-building-occupancy.mjs [outDir]
//     [--archive web/public/basemap/buildings.pmtiles] [--cache <dir>] [--refresh]
//
// See README section 8.
import { createHash } from "node:crypto";
import { closeSync, createReadStream, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { arcgisQuery, cached } from "./build-facilities.mjs";
import { archiveTiles, boundaryContains, lonLat, readBoundaries } from "./build-gazetteer.mjs";
import { COMPRESSION, TILE_TYPE, writePmtiles } from "./pmtiles-writer.mjs";

// The vector tile decoder and encoder MapLibre already depends on.
const fromMapLibre = createRequire(createRequire(new URL("../../web/package.json", import.meta.url)).resolve("maplibre-gl/package.json"));
const load = (name) => import(pathToFileURL(fromMapLibre.resolve(name)).href);
const { fromVectorTileJs } = await load("@maplibre/vt-pbf");
const { VectorTile } = await load("@mapbox/vector-tile");
const { PbfReader } = await load("pbf");

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

/**
 * FEMA Region 9's point layer of USA Structures: one point inside each
 * structure's footprint, with the structure's occupancy. Published by FEMA's
 * own ArcGIS organization; no account or key.
 */
export const USA_STRUCTURES_LAYER = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/USAStructures_Region9_Point/FeatureServer/0";
const FIELDS = "OBJECTID,OCC_CLS,PRIM_OCC,SQFEET,FIPS";
export const USA_STRUCTURES_LICENSE = "A work of the U.S. Government (FEMA with Oak Ridge National Laboratory). FEMA's metadata sets no access or use constraints, and ORNL's deposit of the state files on Figshare is CC0 1.0. Public domain.";

/**
 * The counties fetched, by county FIPS: every county a demo exercise draws in.
 * The statewide file (2.19 GB) is over the plan's 1 GB limit, so the rest of
 * California keeps its footprints as they were.
 */
export const COUNTIES = Object.freeze({ "06015": "Del Norte", "06023": "Humboldt", "06093": "Siskiyou", "06105": "Trinity" });

const LAYER = "buildings";
const MATCH_ZOOM = 14;

export const JOIN_RULE = "A footprint takes the occupancy of the USA Structures point inside it (even-odd rule over its rings, in the z14 tile's coordinates); where it holds several, the largest structure by SQFEET, then the lowest OBJECTID. The result is written to every tile of that footprint at z13 and z14 by its feature id. Structures classed Unclassified are left out.";

/** USA Structures points with a class, as {id, lon, lat, occ, prim, sqft}. */
export function structures(features) {
  const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  return features.flatMap(({ geometry, properties: p }) => {
    const occ = text(p?.OCC_CLS);
    if (!occ || occ === "Unclassified" || geometry?.type !== "Point") return [];
    const [lon, lat] = geometry.coordinates;
    return [{ id: p.OBJECTID, lon, lat, occ, prim: text(p.PRIM_OCC), sqft: Number(p.SQFEET) || 0 }];
  });
}

/** Web Mercator position in [0, 1). */
function world(lon, lat) {
  const sin = Math.sin((lat * Math.PI) / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

/** The tile x or y range a box covers at a zoom, one tile wider on each side. */
export function tileRange([west, south, east, north], zoom) {
  const n = 2 ** zoom;
  const [x0, y0] = world(west, north).map((v) => Math.floor(v * n) - 1);
  const [x1, y1] = world(east, south).map((v) => Math.floor(v * n) + 1);
  return { x0, y0, x1, y1, has: ({ x, y }) => x >= x0 && x <= x1 && y >= y0 && y <= y1 };
}

/** Points by the tile of one zoom they fall in, each with its position in that tile: "x/y" -> [{...point, px, py}]. */
export function binStructures(points, zoom, extent = 4096) {
  const n = 2 ** zoom;
  const tiles = new Map();
  for (const point of points) {
    const [wx, wy] = world(point.lon, point.lat);
    const [x, y] = [Math.floor(wx * n), Math.floor(wy * n)];
    const key = `${x}/${y}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push({ ...point, px: (wx * n - x) * extent, py: (wy * n - y) * extent });
  }
  return tiles;
}

/** Whether a point lies inside a feature's rings, by the even-odd rule, so holes stay out. */
function inside(rings, px, py) {
  let odd = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) odd = !odd;
    }
  }
  return odd;
}

/**
 * The points inside each polygon footprint of one decoded tile, by feature
 * id. Points are in the tile's coordinates at the layer's extent.
 */
export function footprintsHolding(layer, points) {
  const held = new Map();
  for (let i = 0; i < layer.length; i += 1) {
    const feature = layer.feature(i);
    if (feature.type !== 3 || feature.id === undefined) continue;
    const rings = feature.loadGeometry();
    const [x0, y0, x1, y1] = feature.bbox();
    for (const point of points) {
      if (point.px < x0 || point.px > x1 || point.py < y0 || point.py > y1 || !inside(rings, point.px, point.py)) continue;
      if (!held.has(feature.id)) held.set(feature.id, []);
      held.get(feature.id).push(point);
    }
  }
  return held;
}

/** The occupancy a footprint takes from the structures inside it: the largest, then the lowest id. */
export function occupancyOf(points) {
  const best = points.reduce((a, b) => (b.sqft > a.sqft || (b.sqft === a.sqft && b.id < a.id) ? b : a));
  return { occ: best.occ, ...(best.prim ? { occ_prim: best.prim } : {}) };
}

/**
 * A decompressed vector tile with `occ` and `occ_prim` added to the footprints
 * named in byId, or null when it holds none of them. Geometry, ids and every
 * other attribute are written back as they were read.
 */
export function withOccupancy(data, byId) {
  const tile = new VectorTile(new PbfReader(data));
  const layer = tile.layers[LAYER];
  if (!layer) return null;
  let found = false;
  for (let i = 0; i < layer.length && !found; i += 1) found = byId.has(layer.feature(i).id);
  if (!found) return null;
  const enriched = {
    version: layer.version, name: layer.name, extent: layer.extent, length: layer.length,
    feature(i) {
      const feature = layer.feature(i);
      const add = byId.get(feature.id);
      if (add) feature.properties = { ...feature.properties, ...add };
      return feature;
    },
  };
  return Buffer.from(fromVectorTileJs({ layers: { ...tile.layers, [LAYER]: enriched } }));
}

/** A PMTiles v3 archive's header fields this build needs, and its metadata. */
export function archiveHeader(path) {
  const fd = openSync(path, "r");
  try {
    const read = (offset, length) => {
      const buf = Buffer.alloc(length);
      readSync(fd, buf, 0, length, offset);
      return buf;
    };
    const h = read(0, 127);
    if (h.toString("latin1", 0, 7) !== "PMTiles" || h[7] !== 3) throw new Error(`${path} is not a PMTiles v3 archive`);
    if (h[99] !== TILE_TYPE.mvt || h[98] !== COMPRESSION.gzip) throw new Error(`${path} does not hold gzip-compressed vector tiles`);
    const u64 = (offset) => Number(h.readBigUInt64LE(offset));
    const meta = read(u64(24), u64(32));
    const metadata = JSON.parse((h[97] === COMPRESSION.gzip ? gunzipSync(meta) : meta).toString("utf8"));
    const e7 = (offset) => h.readInt32LE(offset) / 1e7;
    return { minZoom: h[100], maxZoom: h[101], bounds: [e7(102), e7(106), e7(110), e7(114)], metadata };
  } finally {
    closeSync(fd);
  }
}

/**
 * The enriched archive: the footprints of `archive` that hold one of `points`
 * take its occupancy. `box` bounds the points; `counted` says whether a
 * footprint (by its first vertex) lies in the covered area, for the match
 * rate. Returns the archive bytes, its metadata and the counts.
 */
export function enrichArchive({ archive, points, box, counted = () => true, source }) {
  const header = archiveHeader(archive);
  const byTile = binStructures(points, MATCH_ZOOM);
  const range = tileRange(box, MATCH_ZOOM);

  // Match on the z14 tiles, where footprints are least simplified.
  const candidates = new Map();
  const matched = new Set();
  const seen = new Set();
  let footprints = 0;
  const countedIds = new Set();
  for (const tile of archiveTiles(archive, MATCH_ZOOM)) {
    if (!range.has(tile)) continue;
    const layer = new VectorTile(new PbfReader(tile.data)).layers[LAYER];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i += 1) {
      const feature = layer.feature(i);
      if (feature.id === undefined || seen.has(feature.id)) continue;
      seen.add(feature.id);
      const [first] = feature.loadGeometry()[0] ?? [];
      if (first && counted(...lonLat(tile.z, tile.x, tile.y, layer.extent, first.x, first.y))) {
        footprints += 1;
        countedIds.add(feature.id);
      }
    }
    const inTile = byTile.get(`${tile.x}/${tile.y}`);
    if (!inTile) continue;
    for (const [id, held] of footprintsHolding(layer, inTile)) {
      for (const point of held) matched.add(point.id);
      candidates.set(id, [...(candidates.get(id) ?? []), ...held]);
    }
  }
  const byId = new Map([...candidates].map(([id, held]) => [id, occupancyOf(held)]));
  const mixed = [...candidates.values()].filter((held) => new Set(held.map((p) => p.occ)).size > 1).length;
  const byClass = {};
  for (const { occ } of byId.values()) byClass[occ] = (byClass[occ] ?? 0) + 1;

  // Rewrite only the tiles that hold a matched footprint; copy every other tile as stored.
  const tiles = [];
  const rewritten = {};
  for (let z = header.minZoom; z <= header.maxZoom; z += 1) {
    const near = tileRange(box, z);
    for (const tile of archiveTiles(archive, z, { raw: true })) {
      const enriched = near.has(tile) ? withOccupancy(gunzipSync(tile.data), byId) : null;
      if (enriched) rewritten[z] = (rewritten[z] ?? 0) + 1;
      tiles.push({ z: tile.z, x: tile.x, y: tile.y, data: enriched ? gzipSync(enriched) : tile.data });
    }
  }

  const { metadata } = header;
  const credit = "occupancy: <a href=\"https://gis-fema.hub.arcgis.com/pages/usa-structures\" target=\"_blank\">FEMA USA Structures</a>";
  const enrichedMetadata = {
    ...metadata,
    attribution: metadata.attribution?.includes("USA Structures") ? metadata.attribution : [metadata.attribution, credit].filter(Boolean).join("; "),
    vector_layers: (metadata.vector_layers ?? []).map((layer) =>
      (layer.id === LAYER ? { ...layer, fields: { ...layer.fields, occ: "String", occ_prim: "String" } } : layer)),
    usa_structures_edition: source.edition,
    usa_structures_source: source.url,
    usa_structures_coverage: source.coverage,
    usa_structures_join: JOIN_RULE,
    usa_structures_license: USA_STRUCTURES_LICENSE,
  };
  const bytes = writePmtiles(tiles, { tileType: TILE_TYPE.mvt, tileCompression: COMPRESSION.gzip, bounds: header.bounds, metadata: enrichedMetadata });
  const counts = {
    structures: points.length,
    structuresInAFootprint: matched.size,
    footprintsInCoverage: footprints,
    footprintsEnriched: byId.size,
    footprintsEnrichedInCoverage: [...byId.keys()].filter((id) => countedIds.has(id)).length,
    footprintsWithMixedClasses: mixed,
    footprintsByClass: Object.fromEntries(Object.entries(byClass).sort()),
    tilesRewritten: rewritten,
    tiles: tiles.length,
  };
  return { bytes, metadata: enrichedMetadata, counts };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    archive: { type: "string" }, cache: { type: "string" }, refresh: { type: "boolean" },
  } });
  const out = resolve(positionals[0] ?? join(here, "out"));
  const cache = resolve(values.cache ?? join(out, "occupancy-cache"));
  const archive = resolve(values.archive ?? join(repo, "web/public/basemap/buildings.pmtiles"));
  mkdirSync(cache, { recursive: true });
  mkdirSync(out, { recursive: true });
  if (resolve(out, "buildings.pmtiles") === archive) throw new Error("Write the enriched archive to another folder than its input");

  // About 120,000 points of five fields each: about 25 MB of GeoJSON in 61 pages of 2,000.
  const fips = Object.keys(COUNTIES);
  const where = encodeURIComponent(`FIPS IN (${fips.map((code) => `'${code}'`).join(",")})`);
  const layerInfo = await cached(cache, "usa-structures-layer.json", `${USA_STRUCTURES_LAYER}?f=json`, { refresh: values.refresh });
  const query = await cached(cache, "usa-structures-points.geojson", `${USA_STRUCTURES_LAYER}/query?where=${where}`,
    { refresh: values.refresh, produce: arcgisQuery("OBJECTID", 2000, FIELDS) });
  const edited = JSON.parse(readFileSync(layerInfo.path, "utf8")).editingInfo?.dataLastEditDate;
  if (!Number.isFinite(edited)) throw new Error("The USA Structures layer names no data edit date");
  const edition = new Date(edited).toISOString().slice(0, 10);
  const features = JSON.parse(readFileSync(query.path, "utf8")).features;
  const points = structures(features);

  const counties = readBoundaries(join(repo, "web/public/basemap/ca_counties.geojson"))
    .filter((county) => Object.values(COUNTIES).includes(county.name));
  if (counties.length !== fips.length) throw new Error(`Found ${counties.length} of the ${fips.length} counties in ca_counties.geojson`);
  const box = counties.reduce(([w, s, e, n], { bbox }) => [Math.min(w, bbox[0]), Math.min(s, bbox[1]), Math.max(e, bbox[2]), Math.max(n, bbox[3])],
    [Infinity, Infinity, -Infinity, -Infinity]);
  const coverage = `${Object.values(COUNTIES).join(", ")} counties, California`;
  const source = { url: USA_STRUCTURES_LAYER, edition, coverage };

  const started = Date.now();
  const { bytes, metadata, counts } = enrichArchive({
    archive, points, box, source,
    counted: (lon, lat) => counties.some((county) => boundaryContains(county, lon, lat)),
  });
  const output = join(out, "buildings.pmtiles");
  writeFileSync(`${output}.partial`, bytes);
  renameSync(`${output}.partial`, output);
  const archiveSha256 = await sha256File(output);

  const release = metadata.overture_release;
  if (typeof release !== "string") throw new Error("The input archive carries no Overture release; start from the shipped buildings archive");
  const sidecar = { release, archive_bytes: bytes.length, archive_sha256: archiveSha256, usa_structures: { edition, coverage } };
  writeFileSync(join(out, "buildings-overture.json"), `${JSON.stringify(sidecar, null, 2)}\n`);
  const { path: _query, ...queryReceipt } = query;
  const { path: _layer, ...layerReceipt } = layerInfo;
  const receipt = {
    format: "openeoc-building-occupancy-v1",
    input: { path: archive, bytes: statSync(archive).size, sha256: await sha256File(archive) },
    output: { path: output, bytes: bytes.length, sha256: archiveSha256 },
    source: {
      title: "USA Structures, FEMA Region 9 structure points (a point inside each footprint)",
      publisher: "Federal Emergency Management Agency, Region 9 GIS, from the FEMA and Oak Ridge National Laboratory USA Structures inventory",
      layer: USA_STRUCTURES_LAYER, edition, fields: FIELDS, counties: COUNTIES, license: USA_STRUCTURES_LICENSE,
      statewideFile: "https://fema-femadata.s3.amazonaws.com/Partners/ORNL/USA_Structures/California/Deliverable20250913CA.zip (2,190,645,592 bytes; not downloaded, over 1 GB)",
      files: [queryReceipt, layerReceipt],
    },
    join: JOIN_RULE,
    fetched: features.length,
    unclassifiedLeftOut: features.length - points.length,
    counts,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  writeFileSync(join(out, "buildings-occupancy.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ output, bytes: bytes.length, sha256: archiveSha256, edition, fetched: features.length, ...counts }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
