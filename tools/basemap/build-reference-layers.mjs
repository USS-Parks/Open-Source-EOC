#!/usr/bin/env node
// Builds two California reference archives with Node only (no GDAL):
// boundaries.pmtiles, tribal areas (Census TIGER/Line AIANNH and BIA Land
// Area Representations), counties and places, and risk.pmtiles, the FEMA
// National Risk Index and the CDC/ATSDR Social Vulnerability Index by census
// tract and county, each with a manifest naming every source. Downloads are
// cached and reused while they still match their receipts.
//
//   node tools/basemap/build-reference-layers.mjs [outDir] [--cache <dir>] [--refresh]
//
// See README section 12.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { arcgisQuery, cached, csvRows, fileLines, readShapefile, zipBuffer, zipLines } from "./build-facilities.mjs";
import { boundaryContains } from "./build-gazetteer.mjs";
import { COMPRESSION, TILE_TYPE, writePmtiles } from "./pmtiles-writer.mjs";

// The tiler and vector tile encoder MapLibre already depends on. The tiler's
// package names a UMD bundle for require; its ES module sits beside it.
const fromMapLibre = createRequire(createRequire(new URL("../../web/package.json", import.meta.url)).resolve("maplibre-gl/package.json"));
const { fromGeojsonVt } = await import(pathToFileURL(fromMapLibre.resolve("@maplibre/vt-pbf")).href);
const { GeoJSONVT } = await import(pathToFileURL(fromMapLibre.resolve("@maplibre/geojson-vt").replace(/\.js$/, ".mjs")).href);

const here = dirname(fileURLToPath(import.meta.url));
const text = (value) => (value == null ? "" : String(value).replace(/\s+/g, " ").trim());
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

// ---------------------------------------------------------------------------
// Polygons: shapefile rings, boxes, label points, area and California.

/** A ring's signed area in square degrees, positive when counterclockwise. */
export function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return area / 2;
}

/** Polygons (GeoJSON coordinates) with their box, as build-gazetteer's boundaryContains takes them. */
export function asBoundary(polygons) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [outer] of polygons) for (const [lon, lat] of outer) {
    if (lon < bbox[0]) bbox[0] = lon;
    if (lat < bbox[1]) bbox[1] = lat;
    if (lon > bbox[2]) bbox[2] = lon;
    if (lat > bbox[3]) bbox[3] = lat;
  }
  return { bbox, polygons };
}

/**
 * A shapefile record's rings as GeoJSON polygons: clockwise rings are outer
 * rings, and a counterclockwise ring is a hole in the smallest outer ring
 * holding one of its vertices.
 */
export function shapePolygons(parts) {
  const rings = parts.filter((ring) => ring.length >= 4);
  const outers = rings.filter((ring) => ringArea(ring) < 0)
    .map((ring) => ({ area: -ringArea(ring), shape: asBoundary([[ring]]), rings: [ring] }))
    .sort((a, b) => a.area - b.area);
  for (const hole of rings.filter((ring) => ringArea(ring) > 0)) {
    outers.find((outer) => hole.some(([lon, lat]) => boundaryContains(outer.shape, lon, lat)))?.rings.push(hole);
  }
  return outers.map((outer) => outer.rings);
}

/**
 * A point inside the largest polygon, for its label: the middle of the widest
 * span inside it along one of nine parallels across it (holes left out).
 */
export function labelPoint(polygons) {
  const largest = polygons.reduce((best, polygon) => (Math.abs(ringArea(polygon[0])) > Math.abs(ringArea(best[0])) ? polygon : best));
  const [, south, , north] = asBoundary([largest]).bbox;
  let best = { width: -1, lon: largest[0][0][0], lat: largest[0][0][1] };
  for (let k = 1; k <= 9; k += 1) {
    const lat = south + ((north - south) * k) / 10;
    const crossings = [];
    for (const ring of largest) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [[xi, yi], [xj, yj]] = [ring[i], ring[j]];
      if ((yi > lat) !== (yj > lat)) crossings.push(xi + ((lat - yi) * (xj - xi)) / (yj - yi));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      if (crossings[i + 1] - crossings[i] > best.width) best = { width: crossings[i + 1] - crossings[i], lon: (crossings[i] + crossings[i + 1]) / 2, lat };
    }
  }
  return [round(best.lon, 6), round(best.lat, 6)];
}

/** Approximate area in square kilometers (degrees scaled at each polygon's latitude). */
export const areaKm2 = (polygons) => polygons.reduce((sum, [outer, ...holes]) => sum
  + (Math.abs(ringArea(outer)) - holes.reduce((area, hole) => area + Math.abs(ringArea(hole)), 0))
  * 111.32 ** 2 * Math.cos((outer[0][1] * Math.PI) / 180), 0);

/**
 * Where a polygon lies: of the points of a 24 by 24 grid over its box that
 * fall inside it (its label point when none do), how many there are and how
 * many fall in each county.
 */
export function countiesUnder(polygon, counties, steps = 24) {
  const shape = asBoundary([polygon]);
  const [west, south, east, north] = shape.bbox;
  const byCounty = new Map();
  let inside = 0;
  const add = (lon, lat) => {
    inside += 1;
    const county = counties.find((c) => boundaryContains(c, lon, lat));
    if (county) byCounty.set(county.name, (byCounty.get(county.name) ?? 0) + 1);
  };
  for (let i = 0; i < steps; i += 1) for (let j = 0; j < steps; j += 1) {
    const lon = west + ((east - west) * (i + 0.5)) / steps;
    const lat = south + ((north - south) * (j + 0.5)) / steps;
    if (boundaryContains(shape, lon, lat)) add(lon, lat);
  }
  if (inside === 0) add(...labelPoint([polygon]));
  return { inside, byCounty };
}

/** A polygon with at least this share of its area in a California county is kept whole. */
export const IN_CALIFORNIA = 0.05;

/**
 * A tribal area's polygons in California and the counties they touch, or
 * null. A polygon mostly across the state line is kept whole, so a
 * reservation such as Colorado River keeps its Arizona side; a polygon with
 * under IN_CALIFORNIA of its area in the state is left out.
 */
export function inCalifornia(polygons, counties) {
  const kept = [];
  const names = new Set();
  for (const polygon of polygons) {
    const { inside, byCounty } = countiesUnder(polygon, counties);
    if ([...byCounty.values()].reduce((sum, n) => sum + n, 0) / inside < IN_CALIFORNIA) continue;
    kept.push(polygon);
    for (const name of byCounty.keys()) names.add(name);
  }
  return kept.length ? { polygons: kept, counties: [...names].sort() } : null;
}

const feature = (id, polygons, properties) => ({ type: "Feature", id,
  geometry: polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons }, properties });

// ---------------------------------------------------------------------------
// Boundaries.

/** Esri's classes for the Census AIANNH layer, with their labels. */
export const AIANNH_CLASSES = Object.freeze({
  federal: "Federal American Indian reservation or off-reservation trust land",
  joint_use: "Joint-use area",
  state: "State American Indian reservation",
  anvsa: "Alaska Native village statistical area",
  hhl: "Hawaiian home land",
  otsa: "Oklahoma tribal statistical area",
  tdsa: "Tribal designated statistical area",
  sdtsa: "State designated tribal statistical area",
});

/** The class of a Census AIANNH area by its class code (and, for D6, its legal/statistical area description). */
export function aiannhClass({ CLASSFP, LSAD }) {
  if (["D1", "D2", "D3", "D5", "D8"].includes(CLASSFP)) return "federal";
  if (CLASSFP === "D6") return LSAD === "88" ? "otsa" : "tdsa";
  return { D0: "joint_use", D4: "state", D9: "sdtsa", E1: "anvsa", F1: "hhl" }[CLASSFP];
}

export const PLACE_KINDS = Object.freeze({ 25: "city", 43: "town", 57: "cdp" });

export const BOUNDARY_FIELDS = Object.freeze({
  aiannh: { geoid: "String", name: "String", namelsad: "String", classfp: "String", class: "String", class_label: "String" },
  bia_lar: { larid: "String", larname: "String", classification: "String", gisacres: "Number", region: "String" },
  counties: { geoid: "String", name: "String", namelsad: "String" },
  places: { geoid: "String", name: "String", namelsad: "String", kind: "String" },
  labels: { layer: "String", id: "String", name: "String", class: "String", kind: "String", area_km2: "Number" },
});

/** Census AIANNH records in California, as {properties, polygons, counties}. */
export function fromAiannh(records, counties) {
  const areas = [];
  for (const { properties: p, parts } of records) {
    const placed = inCalifornia(shapePolygons(parts), counties);
    if (!placed) continue;
    const kind = aiannhClass(p);
    areas.push({ ...placed, properties: { geoid: p.GEOID, name: p.NAME, namelsad: p.NAMELSAD, classfp: p.CLASSFP, class: kind, class_label: AIANNH_CLASSES[kind] } });
  }
  return areas;
}

/** BIA Land Area Representations (GeoJSON features) in California. */
export function fromBiaLar(features, counties) {
  const areas = [];
  for (const { geometry, properties: p } of features) {
    const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
    const placed = polygons.length ? inCalifornia(polygons, counties) : null;
    if (!placed) continue;
    areas.push({ ...placed, properties: { larid: text(p.LARID), larname: text(p.LARNAME), classification: text(p.CLASSIFICATION),
      gisacres: round(Number(p.GISACRES), 1), region: text(p.REGION) } });
  }
  return areas;
}

/** The field each layer's label takes its name from. */
const LABEL_NAMES = { aiannh: "namelsad", bia_lar: "larname", counties: "name", places: "name" };

/** A label point for each area of each layer: {layer: [{properties, polygons}]}. */
export function labelFeatures(layers) {
  const labels = [];
  for (const [layer, areas] of Object.entries(layers)) for (const { properties: p, polygons } of areas) {
    const tags = { layer, id: p.geoid ?? p.larid, name: p[LABEL_NAMES[layer]], ...(p.class ? { class: p.class } : {}), ...(p.kind ? { kind: p.kind } : {}),
      area_km2: round(areaKm2(polygons), 3) };
    labels.push({ type: "Feature", id: labels.length + 1, geometry: { type: "Point", coordinates: labelPoint(polygons) }, properties: tags });
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Risk: FEMA National Risk Index and CDC/ATSDR SVI joined to Census geometry.

/** The Risk Index fields kept, with FEMA's names: composite score and ratings, and the hazards that matter in California. */
export const NRI_FIELDS = Object.freeze(["RISK_SCORE", "RISK_RATNG", "EAL_RATNG", "SOVI_RATNG", "RESL_RATNG",
  "ERQK_RISKR", "TSUN_RISKR", "WFIR_RISKR", "IFLD_RISKR", "CFLD_RISKR", "LNDS_RISKR", "WNTW_RISKR", "HWAV_RISKR"]);
export const NRI_HAZARDS = Object.freeze({ ERQK: "Earthquake", TSUN: "Tsunami", WFIR: "Wildfire", IFLD: "Inland Flooding (Riverine Flooding before v1.20)",
  CFLD: "Coastal Flooding", LNDS: "Landslide", WNTW: "Winter Weather", HWAV: "Heat Wave" });
/** The SVI percentile rankings kept: overall and the four themes. */
export const SVI_FIELDS = Object.freeze(["RPL_THEMES", "RPL_THEME1", "RPL_THEME2", "RPL_THEME3", "RPL_THEME4"]);

export function nriProperties(row) {
  const properties = {};
  for (const field of NRI_FIELDS) {
    const value = text(row[field]);
    if (field === "RISK_SCORE") {
      if (value !== "" && Number.isFinite(Number(value))) properties[field] = round(Number(value), 2);
    } else if (value) properties[field] = value;
  }
  return properties;
}

/** SVI rankings; CDC writes -999 where a ranking could not be computed, which is left out. */
export function sviProperties(row) {
  const properties = {};
  for (const field of SVI_FIELDS) {
    const value = Number(text(row[field]));
    if (text(row[field]) !== "" && Number.isFinite(value) && value >= 0) properties[field] = value;
  }
  return properties;
}

/** Areas ({properties: {geoid, ...}, polygons}) with the rows of a table whose `key` matches their geoid; unmatched areas are left out. */
export function joinRows(areas, rows, key, pick) {
  const byKey = new Map(rows.map((row) => [text(row[key]).padStart(areas[0]?.properties.geoid.length ?? 0, "0"), row]));
  const joined = [];
  for (const area of areas) {
    const row = byKey.get(area.properties.geoid);
    if (row) joined.push({ ...area, properties: { ...area.properties, ...pick(row) } });
  }
  return { joined, missing: areas.length - joined.length, unused: rows.length - joined.length };
}

export const RISK_FIELDS = Object.freeze({
  nri: { geoid: "String", name: "String", county: "String", RISK_SCORE: "Number", ...Object.fromEntries(NRI_FIELDS.slice(1).map((f) => [f, "String"])) },
  svi: { geoid: "String", name: "String", county: "String", ...Object.fromEntries(SVI_FIELDS.map((f) => [f, "Number"])) },
});

// ---------------------------------------------------------------------------
// Tiles and archives.

export const EXTENT = 4096;
/** geojson-vt's simplification in tile units: 3 of 4096 is under half a pixel on a 512 pixel tile. */
export const TOLERANCE = 3;
export const BOUNDARY_ZOOMS = Object.freeze({ aiannh: [4, 12], bia_lar: [4, 12], counties: [4, 12], places: [6, 12], labels: [4, 12] });
/** Esri switches tracts and counties near 1:700,000 to 1:990,000 (MapLibre z8.4 to z8.8), so both are in the z8 tiles. */
export const RISK_ZOOMS = Object.freeze({ nri_counties: [4, 8], svi_counties: [4, 8], nri_tracts: [8, 12], svi_tracts: [8, 12] });

function tileRange(z, [west, south, east, north]) {
  const n = 2 ** z;
  const clamp = (v) => Math.min(n - 1, Math.max(0, Math.floor(v * n)));
  const y = (lat) => {
    const sin = Math.sin((lat * Math.PI) / 180);
    return clamp(0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI));
  };
  return [clamp((west + 180) / 360), y(north), clamp((east + 180) / 360), y(south)];
}

/** The box of GeoJSON features: [west, south, east, north]. */
export function featureBounds(features) {
  const polygons = features.flatMap(({ geometry: g }) => (g.type === "Point" ? [[[g.coordinates]]] : g.type === "Polygon" ? [g.coordinates] : g.coordinates));
  return asBoundary(polygons).bbox;
}

/**
 * Layers ({name, features, minzoom, maxzoom}) cut into gzip-compressed MVT
 * tiles by geojson-vt: each zoom simplified to TOLERANCE, full detail at a
 * layer's top zoom, shapes smaller than the tolerance left out.
 */
export function vectorTiles(layers) {
  const bounds = featureBounds(layers.flatMap((layer) => layer.features));
  const indexed = layers.filter((layer) => layer.features.length).map((layer) => ({ ...layer, index: new GeoJSONVT(
    { type: "FeatureCollection", features: layer.features },
    { maxZoom: layer.maxzoom, indexMaxZoom: Math.min(5, layer.maxzoom), tolerance: TOLERANCE, extent: EXTENT, buffer: 64 }) }));
  const tiles = [];
  for (let z = Math.min(...layers.map((l) => l.minzoom)); z <= Math.max(...layers.map((l) => l.maxzoom)); z += 1) {
    const [x0, y0, x1, y1] = tileRange(z, bounds);
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) {
      const content = {};
      for (const layer of indexed) {
        if (z < layer.minzoom || z > layer.maxzoom) continue;
        const tile = layer.index.getTile(z, x, y);
        if (tile?.features.length) content[layer.name] = tile;
      }
      if (Object.keys(content).length) tiles.push({ z, x, y, data: gzipSync(fromGeojsonVt(content, { version: 2, extent: EXTENT })) });
    }
  }
  return { tiles, bounds };
}

/** A PMTiles archive of named layers: {name: {features, zooms: [min, max], fields}}. */
export function referenceArchive(layers, { name, description, attribution }) {
  const specs = Object.entries(layers).map(([id, layer]) => ({ name: id, features: layer.features, minzoom: layer.zooms[0], maxzoom: layer.zooms[1] }));
  const { tiles, bounds } = vectorTiles(specs);
  const metadata = { name, description, attribution, version: "1", type: "overlay", format: "pbf",
    vector_layers: Object.entries(layers).map(([id, layer]) => ({ id, minzoom: layer.zooms[0], maxzoom: layer.zooms[1], fields: layer.fields })) };
  return { bytes: writePmtiles(tiles, { tileType: TILE_TYPE.mvt, tileCompression: COMPRESSION.gzip, bounds, metadata }), tiles: tiles.length, bounds };
}

/** Areas ({properties, polygons}) as GeoJSON features numbered from 1. */
export const toFeatures = (areas) => areas.map(({ properties, polygons }, i) => feature(i + 1, polygons, properties));

// ---------------------------------------------------------------------------
// Sources and the build.

const ENVELOPE = "geometry=-124.6,32.4,-114.0,42.1&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects";
const US_GOVERNMENT_WORK = "Public domain: a work of the United States Government (17 U.S.C. 105)";
const BIA_LAR = "https://biamaps.geoplatform.gov/server/rest/services/DivLTR/BIA_AIAN_National_LAR/MapServer/0";
const NRI = "https://www.fema.gov/about/reports-and-data/openfema/nri/v120";
const NRI_STATEMENT = "This product uses the Federal Emergency Management Agency's National Risk Index dataset API or downloadable datasets but is not endorsed by FEMA. The Federal Government or FEMA cannot vouch for the data or analyses derived from these data after the data have been retrieved from the Agency's website(s).";

export const SOURCES = {
  census_tiger: { title: "TIGER/Line Shapefiles 2025: American Indian/Alaska Native/Native Hawaiian Areas (national)", publisher: "U.S. Census Bureau",
    license: US_GOVERNMENT_WORK, attribution: "U.S. Census Bureau TIGER/Line" },
  census_cb: { title: "2025 Cartographic Boundary Files, 1:500,000: counties (national), places and census tracts (California). Census's shoreline-clipped generalization of TIGER/Line.",
    publisher: "U.S. Census Bureau", license: US_GOVERNMENT_WORK, attribution: "U.S. Census Bureau Cartographic Boundary Files" },
  bia_lar: { title: "BIA AIAN National Land Area Representations (LAR), from BIA's own map service (DivLTR/BIA_AIAN_National_LAR, layer 0), features in the California envelope",
    publisher: "Bureau of Indian Affairs, Office of Trust Services, Division of Land Titles and Records, Branch of Geospatial Support",
    license: `${US_GOVERNMENT_WORK}. BIA states the data "are public information and may be used by various organizations, agencies, units of government (i.e., Federal, state, county, and city), and other entities according to the restrictions on appropriate use", subject to its disclaimer (biaDisclaimer): no legal inference can or should be made from it.`,
    attribution: "Bureau of Indian Affairs, AIAN Land Area Representations" },
  fema_nri: { title: "National Risk Index v1.20 (December 2025), table format: census tracts and counties", publisher: "Federal Emergency Management Agency",
    license: "A work of the United States Government, offered under FEMA's National Risk Index terms and conditions (femaTerms), which require the statement recorded there.",
    attribution: `FEMA National Risk Index v1.20 (December 2025). ${NRI_STATEMENT}` },
  cdc_svi: { title: "CDC/ATSDR Social Vulnerability Index 2022, United States database: census tracts and counties", publisher: "Centers for Disease Control and Prevention/Agency for Toxic Substances and Disease Registry/Geospatial Research, Analysis, and Services Program",
    license: 'CDC: "These data are available to the public at large with no constraints or limitations. If used, please reference the Centers for Disease Control and Prevention/ Agency for Toxic Substances and Disease Registry/ Geospatial Research, Analysis, and Services Program." (the SVI 2022 item metadata CDC publishes, owner data_cdc)',
    attribution: "Centers for Disease Control and Prevention/Agency for Toxic Substances and Disease Registry/Geospatial Research, Analysis, and Services Program. CDC/ATSDR Social Vulnerability Index 2022 Database U.S." },
};

const FEMA_TERMS = {
  where: "FEMA's National Risk Index terms and conditions, as published with its National Risk Index Census Tracts item (https://www.arcgis.com/home/item.html?id=9da4eeb936544335a6db0cd7a8448a51, owner FEMA_NationalRiskIndex) and referenced from https://www.fema.gov/about/openfema/data-sets/national-risk-index-data",
  statement: NRI_STATEMENT,
  citation: "Cite the dataset and its version by name or URL, and the date and time it was retrieved (the files' retrievedAt below).",
  conditions: [
    "The data are meant for planning purposes only and are not a substitute for localized risk assessment.",
    "Content modified by the user may not be represented as FEMA's; FEMA and DHS logos and seals may not be used without written authorization.",
    "No reverse engineering or attempt to derive the underlying datasets.",
    "FEMA may rescind use of the data and ask that copies be destroyed.",
    "Provided as is, with no warranty.",
  ],
};

function stripHtml(html) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text(String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&(\w+);/g, (all, name) => entities[name] ?? all));
}

const receipts = (list) => (list ?? []).map(({ path: _path, ...receipt }) => receipt);

function writeOutput(out, file, bytes) {
  const target = join(out, file);
  writeFileSync(`${target}.${process.pid}.partial`, bytes);
  renameSync(`${target}.${process.pid}.partial`, target);
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { cache: { type: "string" }, refresh: { type: "boolean" } } });
  const out = resolve(positionals[0] ?? join(here, "out"));
  const cache = resolve(values.cache ?? process.env.OPENEOC_REFERENCE_CACHE ?? join(out, "reference-cache"));
  mkdirSync(cache, { recursive: true });
  mkdirSync(out, { recursive: true });
  const inputs = {};
  const get = async (id, name, url, options) => {
    const receipt = await cached(cache, name, url, { refresh: values.refresh, ...options });
    (inputs[id] ??= []).push(receipt);
    return receipt.path;
  };
  const shapefile = (zip, stem) => readShapefile(zipBuffer(zip, `${stem}.shp`), zipBuffer(zip, `${stem}.dbf`));
  const census = "https://www2.census.gov/geo/tiger";

  // California's counties, the clip for the tribal layers and the geometry both archives draw.
  const countyZip = await get("census_cb", "cb_2025_us_county_500k.zip", `${census}/GENZ2025/shp/cb_2025_us_county_500k.zip`);
  const countyAreas = shapefile(countyZip, "cb_2025_us_county_500k").filter((r) => r.properties.STATEFP === "06")
    .map(({ properties: p, parts }) => ({ properties: { geoid: p.GEOID, name: p.NAME, namelsad: p.NAMELSAD }, polygons: shapePolygons(parts) }))
    .sort((a, b) => a.properties.geoid.localeCompare(b.properties.geoid));
  if (countyAreas.length !== 58) throw new Error(`Expected California's 58 counties, found ${countyAreas.length}`);
  const counties = countyAreas.map((c) => ({ name: c.properties.name, ...asBoundary(c.polygons) }));

  // Boundaries.
  const aiannhZip = await get("census_tiger", "tl_2025_us_aiannh.zip", `${census}/TIGER2025/AIANNH/tl_2025_us_aiannh.zip`);
  const aiannh = fromAiannh(shapefile(aiannhZip, "tl_2025_us_aiannh").filter(({ parts }) => {
    const [west, south, east, north] = asBoundary(parts.map((ring) => [ring])).bbox;
    return west < -114 && east > -124.6 && south < 42.1 && north > 32.4;
  }), counties).sort((a, b) => a.properties.geoid.localeCompare(b.properties.geoid));
  const layerJson = JSON.parse(readFileSync(await get("bia_lar", "bia-lar-layer.json", `${BIA_LAR}?f=json`), "utf8"));
  const biaLar = fromBiaLar(JSON.parse(readFileSync(await get("bia_lar", "bia-lar-california.geojson", `${BIA_LAR}/query?where=1%3D1&${ENVELOPE}`,
    { produce: arcgisQuery("OBJECTID", 100) }), "utf8")).features, counties).sort((a, b) => a.properties.larid.localeCompare(b.properties.larid));
  const placeZip = await get("census_cb", "cb_2025_06_place_500k.zip", `${census}/GENZ2025/shp/cb_2025_06_place_500k.zip`);
  const places = shapefile(placeZip, "cb_2025_06_place_500k").map(({ properties: p, parts }) => ({
    properties: { geoid: p.GEOID, name: p.NAME, namelsad: p.NAMELSAD, kind: PLACE_KINDS[p.LSAD] ?? "place" }, polygons: shapePolygons(parts),
  })).filter((area) => area.polygons.length).sort((a, b) => a.properties.geoid.localeCompare(b.properties.geoid));

  const boundaryLayers = {
    aiannh: { features: toFeatures(aiannh), zooms: BOUNDARY_ZOOMS.aiannh, fields: BOUNDARY_FIELDS.aiannh },
    bia_lar: { features: toFeatures(biaLar), zooms: BOUNDARY_ZOOMS.bia_lar, fields: BOUNDARY_FIELDS.bia_lar },
    counties: { features: toFeatures(countyAreas), zooms: BOUNDARY_ZOOMS.counties, fields: BOUNDARY_FIELDS.counties },
    places: { features: toFeatures(places), zooms: BOUNDARY_ZOOMS.places, fields: BOUNDARY_FIELDS.places },
    labels: { features: labelFeatures({ aiannh, bia_lar: biaLar, counties: countyAreas, places }), zooms: BOUNDARY_ZOOMS.labels, fields: BOUNDARY_FIELDS.labels },
  };
  const boundaryAttribution = ["census_tiger", "census_cb", "bia_lar"].map((id) => SOURCES[id].attribution).join("; ");
  const boundaries = referenceArchive(boundaryLayers, { name: "Open Source EOC boundaries", attribution: boundaryAttribution,
    description: "California tribal areas (Census AIANNH and BIA Land Area Representations), counties and places. Reference data; BIA's representations carry no legal inference." });
  const boundariesSha256 = writeOutput(out, "boundaries.pmtiles", boundaries.bytes);

  const countyOf = (name) => countyAreas.find((c) => c.properties.name === name);
  const inCounty = (name) => {
    const county = counties.find((c) => c.name === name);
    return {
      aiannh: aiannh.filter((a) => a.counties.includes(name)).map((a) => `${a.properties.namelsad} (${a.properties.classfp}, ${a.properties.class})`),
      bia_lar: biaLar.filter((a) => a.counties.includes(name)).map((a) => a.properties.larname),
      places: places.filter((a) => boundaryContains(county, ...labelPoint(a.polygons))).map((a) => a.properties.namelsad),
    };
  };
  const byClass = (areas) => Object.fromEntries(Object.keys(AIANNH_CLASSES).map((c) => [c, areas.filter((a) => a.properties.class === c).length]).filter(([, n]) => n));
  const boundaryManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    archive: "boundaries.pmtiles",
    archiveBytes: boundaries.bytes.length,
    archiveSHA256: boundariesSha256,
    bounds: boundaries.bounds,
    tiles: boundaries.tiles,
    layers: Object.fromEntries(Object.entries(boundaryLayers).map(([id, layer]) => [id, { minzoom: layer.zooms[0], maxzoom: layer.zooms[1], count: layer.features.length, fields: layer.fields }])),
    simplification: `geojson-vt at each zoom to ${TOLERANCE} of ${EXTENT} tile units (under half a pixel on a 512 pixel tile), full source detail at z12, shapes smaller than that left out; one geometry serves as the detailed and generalized pair.`,
    californiaClip: `Tribal areas: a polygon with at least ${IN_CALIFORNIA * 100} percent of its area (sampled) in a California county is kept whole, others are left out, so reservations across the state line keep their whole extent. Counties, places and the county list come from California's own Census files.`,
    aiannhClasses: { labels: AIANNH_CLASSES, codes: "Census class codes: D1, D2, D8 reservations and D3, D5 off-reservation trust land are federal; D0 joint-use; D4 state; D6 OTSA (legal/statistical area description 88) or TDSA; D9 SDTSA; E1 ANVSA; F1 Hawaiian home land.", byClass: byClass(aiannh) },
    placeKinds: "LSAD 25 city, 43 town, 57 census designated place (cdp).",
    labels: "One point per area of every layer, inside its largest polygon (the middle of the widest span along one of nine parallels), with the layer, id, name, class or kind, and approximate area in square kilometers.",
    counties: { Humboldt: inCounty("Humboldt"), "Del Norte": inCounty("Del Norte") },
    sources: ["census_tiger", "census_cb", "bia_lar"].map((id) => ({ id, ...SOURCES[id], files: receipts(inputs[id]) })),
    biaDisclaimer: stripHtml(layerJson.description),
    biaAccessNote: stripHtml(layerJson.copyrightText),
    rightsNote: "All three sources are United States Government works. BIA's Land Area Representations are for illustrative, reference and statistical use; no legal inference can or should be made from them (biaDisclaimer).",
  };
  writeFileSync(join(out, "boundaries-manifest.json"), `${JSON.stringify(boundaryManifest, null, 2)}\n`);
  console.log(`Wrote boundaries.pmtiles (${boundaries.bytes.length} bytes, ${boundaries.tiles} tiles, sha256 ${boundariesSha256})`);

  // Risk.
  const tractZip = await get("census_cb", "cb_2025_06_tract_500k.zip", `${census}/GENZ2025/shp/cb_2025_06_tract_500k.zip`);
  const tracts = shapefile(tractZip, "cb_2025_06_tract_500k").map(({ properties: p, parts }) => ({
    properties: { geoid: p.GEOID, name: p.NAMELSAD, county: text(p.NAMELSADCO).replace(/ County$/, "") }, polygons: shapePolygons(parts),
  })).filter((area) => area.polygons.length).sort((a, b) => a.properties.geoid.localeCompare(b.properties.geoid));
  const countyNames = countyAreas.map(({ properties: { geoid, name }, polygons }) => ({ properties: { geoid, name, county: name }, polygons }));
  const inState = { keep: (r) => r.STATEABBRV === "CA" };
  const nriTractRows = await csvRows(zipLines(await get("fema_nri", "NRI_Table_CensusTracts.zip", `${NRI}/NRI_Table_CensusTracts.zip`), "NRI_Table_CensusTracts.csv", "utf8"), inState);
  const nriCountyRows = await csvRows(zipLines(await get("fema_nri", "NRI_Table_Counties.zip", `${NRI}/NRI_Table_Counties.zip`), "NRI_Table_Counties.csv", "utf8"), inState);
  const inCa = { keep: (r) => r.ST_ABBR === "CA" };
  const sviTractRows = await csvRows(fileLines(await get("cdc_svi", "SVI_2022_US.csv", "https://svi.cdc.gov/Documents/Data/2022/csv/states/SVI_2022_US.csv"), "utf8"), inCa);
  const sviCountyRows = await csvRows(fileLines(await get("cdc_svi", "SVI_2022_US_county.csv", "https://svi.cdc.gov/Documents/Data/2022/csv/states_counties/SVI_2022_US_county.csv"), "utf8"), inCa);
  const joins = {
    nri_tracts: joinRows(tracts, nriTractRows, "TRACTFIPS", nriProperties),
    svi_tracts: joinRows(tracts, sviTractRows, "FIPS", sviProperties),
    nri_counties: joinRows(countyNames, nriCountyRows, "STCOFIPS", nriProperties),
    svi_counties: joinRows(countyNames, sviCountyRows, "FIPS", sviProperties),
  };
  const riskLayers = Object.fromEntries(Object.entries(joins).map(([id, { joined }]) => [id,
    { features: toFeatures(joined), zooms: RISK_ZOOMS[id], fields: RISK_FIELDS[id.split("_")[0]] }]));
  const riskAttribution = `${SOURCES.fema_nri.attribution} ${SOURCES.cdc_svi.attribution}. Census geometry: ${SOURCES.census_cb.attribution}.`;
  const risk = referenceArchive({ nri_counties: riskLayers.nri_counties, svi_counties: riskLayers.svi_counties, nri_tracts: riskLayers.nri_tracts, svi_tracts: riskLayers.svi_tracts },
    { name: "Open Source EOC risk and vulnerability", attribution: riskAttribution,
      description: "FEMA National Risk Index ratings and CDC/ATSDR Social Vulnerability Index 2022 percentile rankings for California census tracts and counties. Planning reference, not a local risk assessment." });
  const riskSha256 = writeOutput(out, "risk.pmtiles", risk.bytes);
  const pickCounty = (id, name) => {
    const { geoid } = countyOf(name).properties;
    const { properties } = joins[id].joined.find((a) => a.properties.geoid === geoid) ?? {};
    return properties;
  };
  const riskManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    archive: "risk.pmtiles",
    archiveBytes: risk.bytes.length,
    archiveSHA256: riskSha256,
    bounds: risk.bounds,
    tiles: risk.tiles,
    layers: Object.fromEntries(Object.entries(riskLayers).map(([id, layer]) => [id, { minzoom: layer.zooms[0], maxzoom: layer.zooms[1], count: layer.features.length, fields: layer.fields }])),
    zoomPair: "Counties z4 to z8 and tracts z8 to z12 (overzoomed beyond): Esri draws tracts from about 1:700,000 and counties at smaller scales, near MapLibre z8.4 to z8.8, so both are in the z8 tiles for the style to switch between.",
    simplification: `geojson-vt at each zoom to ${TOLERANCE} of ${EXTENT} tile units, full Census 1:500,000 detail at each layer's top zoom.`,
    joins: Object.fromEntries(Object.entries(joins).map(([id, { joined, missing, unused }]) => [id, { joined: joined.length, geometryWithoutRow: missing, rowsWithoutGeometry: unused }])),
    nri: { version: "1.20 (December 2025)", hazards: NRI_HAZARDS, ratings: ["Very High", "Relatively High", "Relatively Moderate", "Relatively Low", "Very Low", "No Rating", "Not Applicable", "Insufficient Data"],
      note: "Field names are FEMA's (NRIDataDictionary.csv in the download): RISK_SCORE and RISK_RATNG composite, EAL_RATNG expected annual loss, SOVI_RATNG social vulnerability, RESL_RATNG community resilience, <hazard>_RISKR hazard type risk rating. Version 1.20 replaced Riverine Flooding (RFLD) with Inland Flooding (IFLD)." },
    svi: { version: "2022, United States database (percentiles ranked nationally)", note: "RPL_THEMES overall percentile; RPL_THEME1 socioeconomic status, RPL_THEME2 household characteristics, RPL_THEME3 racial and ethnic minority status, RPL_THEME4 housing type and transportation. CDC's -999 (no ranking) is left out." },
    counties: Object.fromEntries(["Humboldt", "Del Norte"].map((name) => [name, {
      nri: pickCounty("nri_counties", name), svi: pickCounty("svi_counties", name),
      tracts: tracts.filter((t) => t.properties.county === name).length,
      tractRatings: Object.fromEntries(["RISK_RATNG", "TSUN_RISKR", "ERQK_RISKR"].map((field) => [field, joins.nri_tracts.joined.filter((t) => t.properties.county === name)
        .reduce((tally, t) => ({ ...tally, [t.properties[field] ?? "none"]: (tally[t.properties[field] ?? "none"] ?? 0) + 1 }), {})])),
    }])),
    sources: ["fema_nri", "cdc_svi", "census_cb"].map((id) => ({ id, ...SOURCES[id],
      files: receipts(inputs[id]).filter((file) => id !== "census_cb" || /county|tract/.test(file.file)) })),
    femaTerms: FEMA_TERMS,
    rightsNote: "The Risk Index is a United States Government work offered under FEMA's terms (femaTerms), whose statement travels in the archive's attribution. The SVI carries no constraints. The Census geometry is public domain.",
  };
  writeFileSync(join(out, "risk-manifest.json"), `${JSON.stringify(riskManifest, null, 2)}\n`);
  console.log(`Wrote risk.pmtiles (${risk.bytes.length} bytes, ${risk.tiles} tiles, sha256 ${riskSha256})`);
  console.log(JSON.stringify({ boundaries: boundaryManifest.layers, byClass: boundaryManifest.aiannhClasses.byClass, counties: boundaryManifest.counties,
    risk: riskManifest.layers, joins: riskManifest.joins, riskCounties: riskManifest.counties }, (key, value) => (key === "fields" ? undefined : value), 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
