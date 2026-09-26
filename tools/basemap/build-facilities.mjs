#!/usr/bin/env node
// Builds the statewide California critical facilities layer: facilities.pmtiles
// and facilities-manifest.json. Federal public domain records come first;
// OpenStreetMap points from the street basemap (ODbL) fill the types no
// federal source covers and the places the federal records miss. Node only.
// Downloads are cached and reused while they still match their receipts.
//
//   node tools/basemap/build-facilities.mjs [outDir] [--cache <dir>]
//     [--basemap web/public/basemap/california.pmtiles] [--refresh]
//
// See README section 11.
import { createHash } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createInflateRaw, gzipSync, inflateRawSync } from "node:zlib";
import { archiveTiles, boundaryContains, lonLat, readBoundaries } from "./build-gazetteer.mjs";
import { COMPRESSION, TILE_TYPE, writePmtiles } from "./pmtiles-writer.mjs";

// The vector tile encoder and decoder MapLibre already depends on.
const fromMapLibre = createRequire(createRequire(new URL("../../web/package.json", import.meta.url)).resolve("maplibre-gl/package.json"));
const load = (name) => import(pathToFileURL(fromMapLibre.resolve(name)).href);
const { fromGeojsonVt } = await load("@maplibre/vt-pbf");
const { VectorTile } = await load("@mapbox/vector-tile");
const { PbfReader } = await load("pbf");

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

// ---------------------------------------------------------------------------
// Types, lifelines and sectors.

/** Each facility type, in legend order, with its FEMA Community Lifeline and CISA sector. */
export const FACILITY_TYPES = Object.freeze({
  hospital: ["health_medical", "Healthcare and Public Health"],
  urgent_care: ["health_medical", "Healthcare and Public Health"],
  fire_station: ["safety_security", "Emergency Services"],
  ems_station: ["health_medical", "Emergency Services"],
  law_enforcement: ["safety_security", "Emergency Services"],
  eoc: ["safety_security", "Emergency Services"],
  school: ["safety_security", "Government Facilities"],
  college: ["safety_security", "Government Facilities"],
  nursing_home: ["health_medical", "Healthcare and Public Health"],
  dialysis: ["health_medical", "Healthcare and Public Health"],
  pharmacy: ["health_medical", "Healthcare and Public Health"],
  power_plant: ["energy", "Energy"],
  substation: ["energy", "Energy"],
  water_treatment: ["water_systems", "Water and Wastewater Systems"],
  wastewater_treatment: ["water_systems", "Water and Wastewater Systems"],
  comms_tower: ["communications", "Communications"],
  airport: ["transportation", "Transportation Systems"],
  heliport: ["transportation", "Transportation Systems"],
  port: ["transportation", "Transportation Systems"],
  dam: ["safety_security", "Dams"],
  bridge: ["transportation", "Transportation Systems"],
  correctional: ["safety_security", "Government Facilities"],
  government: ["safety_security", "Government Facilities"],
  hazmat_site: ["hazardous_materials", "Chemical"],
});

/** The lifelines the types use, in FEMA's order; the cluster layer counts each. */
export const LIFELINES = Object.freeze(["safety_security", "health_medical", "energy", "communications",
  "transportation", "hazardous_materials", "water_systems"]);

const text = (value) => (value == null ? "" : String(value).replace(/\s+/g, " ").trim());
const number = (value) => (text(value) === "" ? Number.NaN : Number(text(value).replace(/,/g, "")));
const phone = (value) => {
  const digits = text(value).replace(/\D/g, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : text(value);
};

/** One normalized facility; empty fields are left out. `state` is only for the California check. */
export function facility(type, source, { lon, lat, ...fields }) {
  const [lifeline, sector] = FACILITY_TYPES[type];
  const record = { type, lifeline, sector, source, lon: Number(lon), lat: Number(lat) };
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "number") {
      if (Number.isFinite(value)) record[key] = value;
    } else if (text(value)) record[key] = text(value);
  }
  return record;
}

// ---------------------------------------------------------------------------
// Sources, each normalized to facilities.

/** USGS structures service layers: the type each holds and its structure class. */
export const USGS_LAYERS = Object.freeze({
  49: ["hospital", "Hospital/Medical Center"],
  50: ["ems_station", "Ambulance Service"],
  51: ["fire_station", "Fire Station/EMS Station"],
  53: ["law_enforcement", "Police Station"],
  54: ["correctional", "Prison/Correctional Facility"],
  56: ["college", "College/University"],
  57: ["college", "Technical/Trade School"],
  58: ["school", "School"],
  39: ["government", "City/Town Hall"],
  40: ["government", "Courthouse"],
  41: ["government", "State Capitol"],
  42: ["government", "State Supreme Court"],
});

export function fromUsgs(layer, features) {
  const [type, subtype] = USGS_LAYERS[layer];
  return features.map(({ geometry, properties }) => {
    // The service's GeoJSON names fields in lower case; its JSON in upper case.
    const p = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key.toLowerCase(), value]));
    return facility(type, "usgs_nsd", {
      lon: geometry?.coordinates?.[0], lat: geometry?.coordinates?.[1], name: p.name, source_id: p.permanent_identifier,
      address: p.address, city: p.city, state: p.state, subtype,
    });
  });
}

export const fromFemaEoc = (features) => features.map(({ geometry, properties: p }) => facility("eoc", "fema_state_eoc", {
  lon: geometry?.coordinates?.[0], lat: geometry?.coordinates?.[1], name: p.name, source_id: text(p.eoc_id),
  address: p.address1, city: p.city, state: p.state, phone: p.telephone, subtype: "State emergency operations center",
}));

/** An address line's house number and street (after any building words before it, without the suite after it), with its ZIP code. */
export function addressParts(line, zip) {
  const found = /(?:^|\s)(\d+)[A-Za-z]?\s+([^,#]+)/.exec(text(line));
  const street = found?.[2].replace(/\b(suite|ste|unit|apt|bldg|building|room|rm|floor|fl|mob|module|box|area)\b.*$/i, "").trim();
  return street ? { number: Number(found[1]), street, zip: text(zip).slice(0, 5) } : null;
}

/** A nursing home is placed by its address when that agrees with the CMS point this closely. */
export const ADDRESS_AGREES_METERS = 1500;

/**
 * CMS rounds nursing home longitudes to two or three decimals (up to about
 * 400 m off), so a home is placed along its address range when
 * `geocode({number, street, zip}, county)` finds it near the CMS point, and
 * at the CMS point otherwise.
 */
export const fromCmsNursingHomes = (rows, geocode = () => null) => rows.filter((r) => r.State === "CA").map((r) => {
  const listed = { lon: number(r.Longitude), lat: number(r.Latitude) };
  const address = addressParts(r["Provider Address"], r["ZIP Code"]);
  const at = address && geocode(address, text(r["County/Parish"]));
  return facility("nursing_home", "cms_nursing_homes", {
    ...(at && meters(at, listed) <= ADDRESS_AGREES_METERS ? at : listed), name: r["Provider Name"],
    source_id: r["CMS Certification Number (CCN)"], address: r["Provider Address"], city: r["City/Town"], county: r["County/Parish"],
    state: r.State, phone: phone(r["Telephone Number"]), capacity: number(r["Number of Certified Beds"]), capacity_unit: "certified beds",
    operator: r["Legal Business Name"], subtype: r["Ownership Type"],
  });
});

/**
 * CMS lists dialysis facilities by address only. `geocode({number, street,
 * zip}, county)` returns {lon, lat} or null; a facility it cannot place is
 * left out and counted.
 */
export function fromCmsDialysis(rows, geocode) {
  const records = [];
  for (const r of rows) {
    if (r.State !== "CA") continue;
    const address = addressParts(r["Address Line 1"], r["ZIP Code"]);
    const at = address ? geocode(address, text(r["County/Parish"])) : null;
    if (!at) continue;
    records.push(facility("dialysis", "cms_dialysis", {
      ...at, name: r["Facility Name"], source_id: r["CMS Certification Number (CCN)"], address: r["Address Line 1"],
      city: r["City/Town"], county: r["County/Parish"], state: r.State, phone: phone(r["Telephone Number"]),
      capacity: number(r["# of Dialysis Stations"]), capacity_unit: "dialysis stations", operator: r["Chain Organization"],
      subtype: r["Profit or Non-Profit"],
    }));
  }
  return records;
}

/** A shapefile's records: DBF attributes and the SHP parts of a line or polygon. */
export function readShapefile(shp, dbf) {
  const fields = [];
  for (let p = 32; dbf[p] !== 0x0d; p += 32) fields.push({ name: dbf.toString("latin1", p, p + 11).replace(/\0.*$/, ""), length: dbf[p + 16] });
  const [count, headerLength, recordLength] = [dbf.readUInt32LE(4), dbf.readUInt16LE(8), dbf.readUInt16LE(10)];
  const records = [];
  for (let i = 0, s = 100; i < count; i += 1) {
    const properties = {};
    let at = headerLength + i * recordLength + 1;
    for (const field of fields) {
      properties[field.name] = dbf.toString("utf8", at, at + field.length).trim();
      at += field.length;
    }
    const parts = [];
    const type = shp.readInt32LE(s + 8);
    if (type === 3 || type === 5) {
      const [partCount, pointCount] = [shp.readInt32LE(s + 44), shp.readInt32LE(s + 48)];
      const points = s + 52 + 4 * partCount;
      for (let k = 0; k < partCount; k += 1) {
        const end = k + 1 < partCount ? shp.readInt32LE(s + 56 + 4 * k) : pointCount;
        const part = [];
        for (let j = shp.readInt32LE(s + 52 + 4 * k); j < end; j += 1) part.push([shp.readDoubleLE(points + 16 * j), shp.readDoubleLE(points + 16 * j + 8)]);
        parts.push(part);
      }
    }
    records.push({ properties, parts });
    s += 8 + shp.readInt32BE(s + 4) * 2;
  }
  return records;
}

const STREET_WORDS = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
  AVENUE: "AVE", AV: "AVE", STREET: "ST", ROAD: "RD", DRIVE: "DR", BOULEVARD: "BLVD", LANE: "LN", COURT: "CT", PLACE: "PL",
  HIGHWAY: "HWY", PARKWAY: "PKWY", EXPRESSWAY: "EXPY", CIRCLE: "CIR", TERRACE: "TER", TRAIL: "TRL", SQUARE: "SQ",
  CENTER: "CTR", MOUNT: "MT", SAINT: "ST", FORT: "FT",
};
const DIRECTIONS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
/** A street name as the words both CMS and TIGER spell alike: "East Washington Boulevard" is "E WASHINGTON BLVD". */
export const streetWords = (name) => text(name).toUpperCase().replace(/\./g, "").split(/[^A-Z0-9]+/).filter(Boolean).map((w) => STREET_WORDS[w] ?? w);

/** The point a fraction t of the way along a line. */
function along(line, t) {
  const lengths = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1]));
  let left = t * lengths.reduce((sum, l) => sum + l, 0);
  for (let i = 0; i < lengths.length; i += 1) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] ? Math.min(1, left / lengths[i]) : 0;
      return { lon: line[i][0] + f * (line[i + 1][0] - line[i][0]), lat: line[i][1] + f * (line[i + 1][1] - line[i][1]) };
    }
    left -= lengths[i];
  }
  return { lon: line[0][0], lat: line[0][1] };
}

/**
 * An address locator over TIGER/Line address range edges: the house number
 * interpolated along the edge whose name and range, on the side of its
 * parity, hold it. A street name that runs on (a building name after it)
 * is tried shorter until one matches. An edge in the address's ZIP code wins;
 * without one, a match is taken only when every candidate lies within 5 km.
 */
export function addressLocator(edges) {
  const index = new Map();
  for (const edge of edges) {
    const words = streetWords(edge.properties.FULLNAME);
    if (words.length === 0 || !edge.parts[0]?.length) continue;
    for (const key of new Set([words.join(" "), DIRECTIONS.has(words[0]) ? words.slice(1).join(" ") : ""])) {
      if (!key) continue;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(edge);
    }
  }
  return ({ number, street, zip }) => {
    const words = streetWords(street);
    for (let n = words.length; n > 0; n -= 1) {
      const matches = [];
      for (const edge of new Set(index.get(words.slice(0, n).join(" ")) ?? [])) for (const side of ["L", "R"]) {
        const p = edge.properties;
        const [from, to] = [parseInt(p[`${side}FROMHN`], 10), parseInt(p[`${side}TOHN`], 10)];
        if (!Number.isFinite(from) || !Number.isFinite(to) || number < Math.min(from, to) || number > Math.max(from, to)) continue;
        if (p[`PARITY${side}`] !== "B" && (number - from) % 2 !== 0) continue;
        matches.push({ zip: p[`ZIP${side}`] === zip, ...along(edge.parts[0], to === from ? 0.5 : (number - from) / (to - from)) });
      }
      if (matches.length === 0) continue;
      const best = matches.find((m) => m.zip)
        ?? (matches.every((m) => meters(m, matches[0]) <= 5000) ? matches[0] : null);
      return best ? { lon: Math.round(best.lon * 1e6) / 1e6, lat: Math.round(best.lat * 1e6) / 1e6 } : null;
    }
    return null;
  };
}

/** FCC structure types that are towers, masts and poles (arrays are "3TA1", "5GTA2" and the like). */
const ASR_TOWERS = /^(TOWER|MTOWER|LTOWER|GTOWER|2TOWER|POLE|UPOLE|MAST|TREE|BTWR|BMAST|BPOLE|\d+[GLM]?TA\d+)$/;
const dms = (d, m, s, hemisphere) => (Number(d) + Number(m) / 60 + Number(s) / 3600) * (hemisphere === "S" || hemisphere === "W" ? -1 : 1);

/** Constructed, current antenna structure registrations: RA, CO and EN records split on "|". */
export function fromFccAsr(ra, co, en) {
  const coordinates = new Map();
  for (const c of co) if (c[0] === "CO" && (c[5] === "T" || !coordinates.has(c[3]))) coordinates.set(c[3], c);
  const owners = new Map(en.filter((e) => e[0] === "EN" && e[5] === "O").map((e) => [e[4], e]));
  const records = new Map();
  for (const r of ra) {
    if (r[0] !== "RA" || r[1] !== "REG" || r[15] !== "C" || r[8] !== "C" || r[25] !== "CA" || !ASR_TOWERS.test(r[32])) continue;
    const c = coordinates.get(r[3]);
    if (!c) continue;
    const owner = owners.get(r[4]);
    records.set(r[3], facility("comms_tower", "fcc_asr", {
      lon: dms(c[11], c[12], c[13], c[14]), lat: dms(c[6], c[7], c[8], c[9]), name: `Antenna structure ${r[3]}`,
      source_id: r[3], address: r[23], city: r[24], state: r[25], operator: owner?.[9], phone: phone(owner?.[14]),
      subtype: `${r[32]} structure, ${number(r[30])} m above ground`,
    }));
  }
  return [...records.values()];
}

/** Rows from a sheet whose header row holds `column`, as objects. */
export function sheetObjects(rows, column) {
  const at = rows.findIndex((row) => row.includes(column));
  if (at < 0) throw new Error(`No header row with ${column}`);
  return rows.slice(at + 1).map((row) => Object.fromEntries(rows[at].map((key, i) => [key, row[i] ?? ""])));
}

/** Plants with operable generators: EIA-860 schedule 2 (plants) and 3_1 (operable generators). */
export function fromEia860(plants, generators) {
  const byPlant = new Map();
  for (const g of generators) {
    const mw = number(g["Nameplate Capacity (MW)"]);
    if (!Number.isFinite(mw)) continue;
    const plant = byPlant.get(g["Plant Code"]) ?? { mw: 0, technology: new Map() };
    plant.mw += mw;
    plant.technology.set(g.Technology, (plant.technology.get(g.Technology) ?? 0) + mw);
    byPlant.set(g["Plant Code"], plant);
  }
  return plants.filter((p) => p.State === "CA" && byPlant.get(p["Plant Code"])?.mw > 0).map((p) => {
    const { mw, technology } = byPlant.get(p["Plant Code"]);
    return facility("power_plant", "eia_860", {
      lon: number(p.Longitude), lat: number(p.Latitude), name: p["Plant Name"], source_id: p["Plant Code"],
      address: p["Street Address"], city: p.City, county: p.County, state: p.State, operator: p["Utility Name"],
      capacity: Math.round(mw * 10) / 10, capacity_unit: "MW nameplate",
      subtype: [...technology].sort((a, b) => b[1] - a[1])[0][0],
    });
  });
}

/** EPA FRS interests: POTWs, drinking water treatment plants and RCRA hazardous waste handlers. */
export function fromEpaFrs(rows) {
  const records = [];
  for (const r of rows) {
    const interests = new Set(text(r.INTEREST_TYPES).split(/\s*,\s*/));
    const base = {
      lon: number(r.LONGITUDE83), lat: number(r.LATITUDE83), name: r.PRIMARY_NAME, source_id: r.REGISTRY_ID,
      address: r.LOCATION_ADDRESS, city: r.CITY_NAME, county: text(r.COUNTY_NAME).replace(/ COUNTY$/i, ""), state: r.STATE_CODE,
    };
    if (interests.has("POTW")) records.push(facility("wastewater_treatment", "epa_frs", { ...base, subtype: "Publicly owned treatment works" }));
    if (interests.has("WATER TREATMENT PLANT")) records.push(facility("water_treatment", "epa_frs", { ...base, subtype: "Drinking water treatment plant" }));
    const rcra = [
      interests.has("TSD") || interests.has("STATE REGULATED TSD") ? "treatment, storage and disposal facility" : "",
      interests.has("LQG") ? "large quantity generator" : "",
    ].filter(Boolean);
    if (rcra.length) records.push(facility("hazmat_site", "epa_frs", { ...base, subtype: `RCRA hazardous waste ${rcra.join(" and ")}` }));
  }
  return records;
}

const FAA_OWNERS = { PU: "Publicly owned", PR: "Privately owned", MA: "Air Force owned", MN: "Navy owned", MR: "Army owned", CG: "Coast Guard owned" };

/** Operational airports and heliports from the NASR airport base file. */
export const fromFaaAirports = (rows) => rows
  .filter((r) => r.STATE_CODE === "CA" && r.ARPT_STATUS === "O" && (r.SITE_TYPE_CODE === "A" || r.SITE_TYPE_CODE === "H"))
  .map((r) => facility(r.SITE_TYPE_CODE === "H" ? "heliport" : "airport", "faa_nasr", {
    lon: number(r.LONG_DECIMAL), lat: number(r.LAT_DECIMAL), name: r.ARPT_NAME, source_id: r.ARPT_ID, city: r.CITY,
    county: r.COUNTY_NAME, state: r.STATE_CODE, operator: FAA_OWNERS[r.OWNERSHIP_TYPE_CODE],
    subtype: r.FACILITY_USE_CODE === "PU" ? "Public use" : "Private use",
  }));

export const fromNid = (rows) => rows.filter((r) => r.State === "California").map((r) => facility("dam", "usace_nid", {
  lon: number(r.Longitude), lat: number(r.Latitude), name: r["Dam Name"], source_id: r["NID ID"], city: r.City,
  county: r.County, state: "CA", operator: r["Owner Names"], capacity: number(r["NID Storage (Acre-Ft)"]),
  capacity_unit: "acre-feet storage", subtype: `${text(r["Hazard Potential Classification"]) || "Undetermined"} hazard potential`,
}));

/** NBI item 22 owner codes. */
const NBI_OWNERS = {
  "01": "State Highway Agency", "02": "County Highway Agency", "03": "Town or Township Highway Agency",
  "04": "City or Municipal Highway Agency", 11: "State Park, Forest or Reservation Agency", 12: "Local Park, Forest or Reservation Agency",
  21: "Other State Agency", 25: "Other Local Agency", 26: "Private (other than railroad)", 27: "Railroad",
  31: "State Toll Authority", 32: "Local Toll Authority", 60: "Other Federal Agency", 61: "Indian Tribal Government",
  62: "Bureau of Indian Affairs", 63: "Bureau of Fish and Wildlife", 64: "U.S. Forest Service", 66: "National Park Service",
  68: "Bureau of Land Management", 69: "Bureau of Reclamation", 70: "Corps of Engineers (Civil)", 71: "Corps of Engineers (Military)",
  72: "Air Force", 73: "Navy/Marines", 74: "Army", 75: "NASA", 80: "Unknown",
};

/** An NBI coordinate: DDMMSSss (latitude, 2 degree digits) or DDDMMSSss (longitude, 3). */
export function nbiDegrees(value, degreeDigits) {
  const digits = text(value).padStart(degreeDigits + 6, "0");
  if (!/^\d+$/.test(digits) || Number(digits) === 0) return Number.NaN;
  const minutes = Number(digits.slice(degreeDigits, degreeDigits + 2));
  const seconds = Number(digits.slice(degreeDigits + 2)) / 100;
  return minutes >= 60 || seconds >= 60 ? Number.NaN : Number(digits.slice(0, degreeDigits)) + minutes / 60 + seconds / 3600;
}

/** Bridges: one NBI record per structure (the route carried on it). */
export const fromNbi = (rows) => rows.filter((r) => r.RECORD_TYPE_005A === "1").map((r) => facility("bridge", "fhwa_nbi", {
  lon: -nbiDegrees(r.LONG_017, 3), lat: nbiDegrees(r.LAT_016, 2),
  name: [r.FACILITY_CARRIED_007, r.FEATURES_DESC_006A].map(text).filter(Boolean).join(" over "),
  source_id: r.STRUCTURE_NUMBER_008, state: r.STATE_CODE_001 === "06" ? "CA" : r.STATE_CODE_001,
  operator: NBI_OWNERS[r.OWNER_022] ?? NBI_OWNERS[Number(r.OWNER_022)], capacity: number(r.ADT_029), capacity_unit: "vehicles per day",
  subtype: text(r.YEAR_BUILT_027) ? `Built ${text(r.YEAR_BUILT_027)}` : "",
}));

/** The area-weighted centroid of a polygon's largest outer ring. */
export function centroid(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best = { area: -1 };
  for (const [ring] of polygons) {
    let area = 0, x = 0, y = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      area += cross;
      x += (ring[j][0] + ring[i][0]) * cross;
      y += (ring[j][1] + ring[i][1]) * cross;
    }
    if (Math.abs(area) > best.area) best = { area: Math.abs(area), lon: x / (3 * area), lat: y / (3 * area) };
  }
  return { lon: best.lon, lat: best.lat };
}

export const fromPorts = (features) => features.filter((f) => /, CA$/.test(text(f.properties.portname))).map(({ geometry, properties: p }) =>
  facility("port", "dot_principal_ports", {
    ...centroid(geometry), name: p.portname, source_id: text(p.port), state: "CA", capacity: number(p.total),
    capacity_unit: "short tons per year", subtype: `${text(p.type)} port, national rank ${text(p.rank)}`,
  }));

/** OpenMapTiles poi subclasses with a facility type. */
export const OSM_SUBCLASSES = Object.freeze({
  hospital: "hospital", nursing_home: "nursing_home", pharmacy: "pharmacy", fire_station: "fire_station",
  police: "law_enforcement", prison: "correctional", townhall: "government", courthouse: "government",
  school: "school", college: "college", university: "college",
});

/** The facility type of an OpenMapTiles poi, by subclass, or by name for EOCs and urgent care. */
export function osmType({ subclass, name }) {
  if (/\bemergency operations? cent(?:er|re)\b|\bEOC\b/i.test(text(name))) return "eoc";
  if ((subclass === "clinic" || subclass === "doctors") && /\burgent\s*care\b/i.test(text(name))) return "urgent_care";
  return OSM_SUBCLASSES[subclass];
}

/** Planetiler numbers a feature as the OSM id times ten plus 1, 2 or 3 for a node, way or relation. */
const osmId = (id) => `${["osm", "node", "way", "relation"][id % 10] ?? "osm"}/${Math.floor(id / 10)}`;

/** Facilities from one basemap tile's poi layer. */
export function fromOsmTile(z, x, y, data) {
  const layer = new VectorTile(new PbfReader(data)).layers.poi;
  const records = [];
  for (let i = 0; i < (layer?.length ?? 0); i += 1) {
    const feature = layer.feature(i);
    const type = osmType(feature.properties);
    if (!type || feature.type !== 1) continue;
    const [point] = feature.loadGeometry()[0];
    if (point.x < 0 || point.y < 0 || point.x >= layer.extent || point.y >= layer.extent) continue;
    const [lon, lat] = lonLat(z, x, y, layer.extent, point.x, point.y);
    records.push(facility(type, "osm", { lon, lat, name: feature.properties.name, source_id: osmId(feature.id), subtype: feature.properties.subclass }));
  }
  return records;
}

// ---------------------------------------------------------------------------
// California, counties and duplicates.

const METERS_PER_DEGREE = 111_320;
const meters = (a, b) => Math.hypot((a.lon - b.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180), a.lat - b.lat) * METERS_PER_DEGREE;

function distanceToBoundary(boundary, lon, lat) {
  let best = Infinity;
  for (const polygon of boundary.polygons) for (const ring of polygon) {
    for (let i = 1; i < ring.length; i += 1) {
      const [ax, ay] = ring[i - 1];
      const [bx, by] = ring[i];
      const dx = bx - ax, dy = by - ay;
      const t = dx || dy ? Math.min(1, Math.max(0, ((lon - ax) * dx + (lat - ay) * dy) / (dx * dx + dy * dy))) : 0;
      best = Math.min(best, meters({ lon, lat }, { lon: ax + t * dx, lat: ay + t * dy }));
    }
  }
  return best;
}

/** Counties on the ocean or the bays, where the generalized outline can leave a shoreline facility outside. */
const SHORE_COUNTIES = new Set(["Del Norte", "Humboldt", "Mendocino", "Sonoma", "Marin", "San Francisco", "San Mateo", "Santa Cruz",
  "Monterey", "San Luis Obispo", "Santa Barbara", "Ventura", "Los Angeles", "Orange", "San Diego", "Alameda", "Contra Costa",
  "Solano", "Napa", "Santa Clara"]);

/**
 * A check that places a facility in California and names its county, or
 * returns why not. A source that names the state is believed within 10 km of
 * the outline; an OpenStreetMap point outside it must be within 5 km of a
 * shore county (the outline cuts off spits such as Samoa's by 2.5 km) and
 * between the Mexican and Oregon lines.
 */
export function californiaCheck(state, counties) {
  return (record) => {
    const { lon, lat } = record;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || (lon === 0 && lat === 0)) return "no coordinates";
    let county = counties.find((c) => boundaryContains(c, lon, lat));
    if (!county) {
      const [nearest] = counties.map((c) => ({ c, d: distanceToBoundary(c, lon, lat) })).sort((a, b) => a.d - b.d);
      const inside = record.state
        ? record.state === "CA" && nearest.d <= 10_000
        : boundaryContains(state, lon, lat) || (nearest.d <= 5_000 && SHORE_COUNTIES.has(nearest.c.name) && lat > 32.54 && lat < 41.995);
      if (!inside) return "outside California";
      county = nearest.c;
    } else if (record.state && record.state !== "CA") return "outside California";
    record.county = county.name;
    delete record.state;
    return null;
  };
}

const NAME_ALIASES = { dept: "department", ctr: "center", centre: "center", st: "saint", hosp: "hospital", elem: "elementary",
  sch: "school", co: "county", mt: "mount", ft: "fort", jr: "junior", sr: "senior", med: "medical", comm: "community" };
const NAME_STOP = new Set(["the", "of", "and", "at", "inc", "llc"]);

export function nameTokens(name) {
  return new Set(text(name).toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/)
    .filter(Boolean).map((token) => NAME_ALIASES[token] ?? token).filter((token) => !NAME_STOP.has(token)));
}

/** Names that share most of their words and the same numbers ("Station 1" is never "Station 2"). */
export function sameName(a, b) {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (x.size === 0 || y.size === 0) return false;
  const numbers = (set) => [...set].filter((token) => /^\d+$/.test(token)).sort().join(",");
  if (numbers(x) !== numbers(y)) return false;
  let shared = 0;
  for (const token of x) if (y.has(token)) shared += 1;
  return shared / (x.size + y.size - shared) >= 0.6;
}

export const DUPLICATE_METERS = 150;
export const SAME_NAME_METERS = 1000;
const CELL_DEGREES = 0.015;

/**
 * Drop duplicates: a facility of the same type from another source within
 * DUPLICATE_METERS, or with the same name within SAME_NAME_METERS, is the
 * same place. Records are taken in `sourceOrder`, so a federal record is kept
 * whole and the OpenStreetMap point that repeats it is dropped. Records of
 * one federal source never merge with each other (adjacent towers, dams and
 * bridges are distinct); OpenStreetMap points do (a node and a building
 * outline for one hospital). Returns the kept records and, per "dropped>kept"
 * source pair, how many were dropped.
 */
export function dedupe(records, sourceOrder) {
  const rank = new Map(sourceOrder.map((id, i) => [id, i]));
  const ordered = [...records].sort((a, b) => rank.get(a.source) - rank.get(b.source));
  const grid = new Map();
  const kept = [];
  const dropped = {};
  for (const record of ordered) {
    const cx = Math.floor(record.lon / CELL_DEGREES);
    const cy = Math.floor(record.lat / CELL_DEGREES);
    let match = null;
    for (let dx = -1; dx <= 1 && !match; dx += 1) for (let dy = -1; dy <= 1 && !match; dy += 1) {
      for (const other of grid.get(`${record.type}/${cx + dx}/${cy + dy}`) ?? []) {
        if (other.source === record.source && record.source !== "osm") continue;
        const d = meters(record, other);
        if (d <= DUPLICATE_METERS || (d <= SAME_NAME_METERS && sameName(record.name, other.name))) {
          match = other;
          break;
        }
      }
    }
    if (match) {
      const pair = `${record.source}>${match.source}`;
      dropped[pair] = (dropped[pair] ?? 0) + 1;
      continue;
    }
    kept.push(record);
    const key = `${record.type}/${cx}/${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(record);
  }
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Clusters and tiles.

export const EXTENT = 4096;
export const FACILITY_ZOOMS = [12, 13, 14];
export const CLUSTER_ZOOMS = [6, 7, 8, 9, 10, 11];
/** Cluster cells per tile side: 8 gives cells of 64 px on a 512 px tile. */
const CELLS_PER_TILE = 8;

/** Web Mercator position in [0, 1). */
function world(lon, lat) {
  const sin = Math.sin((lat * Math.PI) / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

/**
 * Grid clusters at one zoom: each cell's facilities become one point at their
 * mean position with the count, the most common lifeline (FEMA order breaks a
 * tie) and a count per lifeline.
 */
export function clusters(records, zoom) {
  const size = 2 ** zoom * CELLS_PER_TILE;
  const cells = new Map();
  for (const record of records) {
    const [x, y] = world(record.lon, record.lat);
    const key = `${Math.floor(x * size)}/${Math.floor(y * size)}`;
    const cell = cells.get(key) ?? { count: 0, lon: 0, lat: 0, ...Object.fromEntries(LIFELINES.map((l) => [l, 0])) };
    cell.count += 1;
    cell.lon += record.lon;
    cell.lat += record.lat;
    cell[record.lifeline] += 1;
    cells.set(key, cell);
  }
  return [...cells.keys()].sort().map((key) => {
    const cell = cells.get(key);
    const lifeline = LIFELINES.reduce((best, l) => (cell[l] > cell[best] ? l : best), LIFELINES[0]);
    return { ...cell, lon: cell.lon / cell.count, lat: cell.lat / cell.count, lifeline };
  });
}

/**
 * Points binned into the tiles of one zoom as geojson-vt features, with a
 * buffer so a symbol near a tile edge draws whole in its neighbor too.
 * Each point is {lon, lat, id?, tags}.
 */
export function binPoints(points, zoom, buffer = 64) {
  const n = 2 ** zoom;
  const tiles = new Map();
  for (const point of points) {
    const [wx, wy] = world(point.lon, point.lat);
    const px = wx * n * EXTENT;
    const py = wy * n * EXTENT;
    const tx = Math.floor(px / EXTENT);
    const ty = Math.floor(py / EXTENT);
    for (let x = tx - 1; x <= tx + 1; x += 1) for (let y = ty - 1; y <= ty + 1; y += 1) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const lx = Math.round(px - x * EXTENT);
      const ly = Math.round(py - y * EXTENT);
      if (lx < -buffer || ly < -buffer || lx > EXTENT + buffer || ly > EXTENT + buffer) continue;
      const key = `${x}/${y}`;
      if (!tiles.has(key)) tiles.set(key, { z: zoom, x, y, features: [] });
      tiles.get(key).features.push({ ...(point.id ? { id: point.id } : {}), type: 1, geometry: [[lx, ly]], tags: point.tags });
    }
  }
  return [...tiles.values()];
}

/** Each tile's features as a gzip-compressed MVT holding one layer. */
export const encodeTiles = (tiles, layer) => tiles.map(({ z, x, y, features }) =>
  ({ z, x, y, data: gzipSync(fromGeojsonVt({ [layer]: { features } }, { version: 2, extent: EXTENT })) }));

export const FACILITY_FIELDS = Object.freeze({
  type: "String", lifeline: "String", sector: "String", name: "String", subtype: "String", source: "String",
  source_id: "String", address: "String", city: "String", county: "String", phone: "String", operator: "String",
  capacity: "Number", capacity_unit: "String",
});

/** The archive: facilities from z12 to z14, clusters from z6 to z11. */
export function facilityTiles(records) {
  const points = records.map((record, i) => {
    const { lon, lat, ...tags } = record;
    return { lon, lat, id: i + 1, tags };
  });
  return [
    ...CLUSTER_ZOOMS.flatMap((z) => encodeTiles(binPoints(clusters(records, z).map(({ lon, lat, ...tags }) => ({ lon, lat, tags })), z), "facility_clusters")),
    ...FACILITY_ZOOMS.flatMap((z) => encodeTiles(binPoints(points, z), "facilities")),
  ];
}

export function facilityArchive(records, { attribution, description }) {
  const bounds = records.reduce(([w, s, e, n], r) => [Math.min(w, r.lon), Math.min(s, r.lat), Math.max(e, r.lon), Math.max(n, r.lat)],
    [Infinity, Infinity, -Infinity, -Infinity]);
  const metadata = {
    name: "Open Source EOC critical facilities",
    description,
    attribution,
    version: "1",
    type: "overlay",
    format: "pbf",
    vector_layers: [
      { id: "facility_clusters", minzoom: CLUSTER_ZOOMS[0], maxzoom: CLUSTER_ZOOMS.at(-1),
        fields: { count: "Number", lifeline: "String", ...Object.fromEntries(LIFELINES.map((l) => [l, "Number"])) } },
      { id: "facilities", minzoom: FACILITY_ZOOMS[0], maxzoom: FACILITY_ZOOMS.at(-1), fields: FACILITY_FIELDS },
    ],
  };
  const tiles = facilityTiles(records);
  return { bytes: writePmtiles(tiles, { tileType: TILE_TYPE.mvt, tileCompression: COMPRESSION.gzip, bounds, metadata }), tiles: tiles.length, bounds };
}

// ---------------------------------------------------------------------------
// Files: downloads, zip members, CSV and XLSX.

async function sha256File(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

const USER_AGENT = "Mozilla/5.0 (compatible; Open-Source-EOC-facilities-builder/1)";
/** The plan raises any single source over 1 GB with Basho before it is downloaded. */
const MAX_BYTES = 1_000_000_000;

async function request(url, attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(600_000) });
      if (response.ok) return response;
      if (response.status < 500 && response.status !== 429) throw Object.assign(new Error(`HTTP ${response.status} ${url}`), { final: true });
      throw new Error(`HTTP ${response.status} ${url}`);
    } catch (error) {
      if (error.final || attempt === attempts) throw error;
      await new Promise((done) => setTimeout(done, 2000 * 2 ** (attempt - 1)));
    }
  }
}

async function fetchFile(url, target) {
  const response = await request(url);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error(`${url} is over 1 GB; raise it before downloading`);
  let bytes = 0;
  const cap = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    done(bytes > MAX_BYTES ? new Error(`${url} is over 1 GB; raise it before downloading`) : null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), cap, createWriteStream(target));
  return response.headers.get("last-modified") ?? undefined;
}

/** Every feature an ArcGIS layer query returns, paged in object id order, as one GeoJSON file. */
function arcgisQuery(oidField, pageSize = 1000) {
  return async (url, target) => {
    const count = (await (await request(`${url}&returnCountOnly=true&f=json`)).json()).count;
    if (!Number.isInteger(count)) throw new Error(`No feature count from ${url}`);
    const features = [];
    for (let offset = 0; offset < count; offset += pageSize) {
      const page = await (await request(`${url}&outFields=*&outSR=4326&orderByFields=${oidField}&resultOffset=${offset}&resultRecordCount=${pageSize}&f=geojson`)).json();
      if (!Array.isArray(page.features)) throw new Error(`Bad page at ${offset} from ${url}`);
      features.push(...page.features);
    }
    if (features.length !== count || new Set(features.map((f) => f.id ?? f.properties?.[oidField])).size !== count)
      throw new Error(`${url} returned ${features.length} distinct features, expected ${count}`);
    writeFileSync(target, JSON.stringify({ type: "FeatureCollection", features }));
    return undefined;
  };
}

/**
 * A source file in the cache, fetched once. A cached file is reused while it
 * matches the size and SHA-256 its receipt recorded; --refresh fetches again.
 */
async function cached(cache, name, url, { refresh = false, produce = fetchFile } = {}) {
  const file = join(cache, name);
  const receiptFile = `${file}.receipt.json`;
  if (!refresh && existsSync(file) && existsSync(receiptFile)) {
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
    const actual = await sha256File(file);
    if (receipt.url === url && receipt.bytes === actual.bytes && receipt.sha256 === actual.sha256) {
      console.log(`Reusing ${name} (${receipt.bytes} bytes, retrieved ${receipt.retrievedAt})`);
      return { ...receipt, path: file };
    }
  }
  console.log(`Fetching ${name} from ${url}`);
  const partial = `${file}.partial`;
  const retrievedAt = new Date().toISOString();
  const lastModified = await produce(url, partial);
  const { bytes, sha256 } = await sha256File(partial);
  renameSync(partial, file);
  const receipt = { file: name, url, bytes, sha256, retrievedAt, ...(lastModified ? { lastModified } : {}) };
  writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  return { ...receipt, path: file };
}

/** Bytes from a file path or a Buffer. */
function readBytes(source, offset, length) {
  if (Buffer.isBuffer(source)) return source.subarray(offset, offset + length);
  const fd = openSync(source, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, offset);
    return buffer;
  } finally {
    closeSync(fd);
  }
}

/** A member of a zip archive (a path or a Buffer): {method, compressed, start}. No zip64. */
function member(source, name) {
  const size = Buffer.isBuffer(source) ? source.length : statSync(source).size;
  const tail = readBytes(source, Math.max(0, size - 65_557), Math.min(size, 65_557));
  const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Not a zip archive");
  const directory = readBytes(source, tail.readUInt32LE(end + 16), tail.readUInt32LE(end + 12));
  for (let p = 0; p + 46 <= directory.length;) {
    const nameLength = directory.readUInt16LE(p + 28);
    if (directory.toString("utf8", p + 46, p + 46 + nameLength) === name) {
      const offset = directory.readUInt32LE(p + 42);
      const compressed = directory.readUInt32LE(p + 20);
      const method = directory.readUInt16LE(p + 10);
      if (compressed === 0xffffffff || offset === 0xffffffff) throw new Error("Zip64 archives are not supported");
      if (method !== 0 && method !== 8) throw new Error(`${name} uses zip method ${method}`);
      const local = readBytes(source, offset, 30);
      return { method, compressed, start: offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28) };
    }
    p += 46 + nameLength + directory.readUInt16LE(p + 30) + directory.readUInt16LE(p + 32);
  }
  throw new Error(`${name} is not in the zip archive`);
}

/** One zip member's bytes. */
export function zipBuffer(source, name) {
  const { start, compressed, method } = member(source, name);
  const data = readBytes(source, start, compressed);
  return method === 0 ? data : inflateRawSync(data);
}

/** One zip member's lines, streamed. */
function zipLines(path, name, encoding) {
  const { start, compressed, method } = member(path, name);
  const raw = createReadStream(path, { start, end: start + compressed - 1 });
  const input = method === 0 ? raw : raw.pipe(createInflateRaw());
  raw.on("error", (error) => input.destroy(error));
  input.setEncoding(encoding);
  return createInterface({ input, crlfDelay: Infinity });
}

const fileLines = (path, encoding) => createInterface({ input: createReadStream(path, { encoding }), crlfDelay: Infinity });

/** One CSV line split into fields, with `quote` doubled inside a quoted field. */
export function splitCsv(line, quote = '"') {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c !== quote) field += c;
      else if (line[i + 1] === quote) {
        field += quote;
        i += 1;
      } else quoted = false;
    } else if (c === quote) quoted = true;
    else if (c === ",") {
      fields.push(field);
      field = "";
    } else field += c;
  }
  fields.push(field);
  return fields;
}

/**
 * CSV rows as objects keyed by the header, after `skip` preamble lines; a
 * quoted field may span lines. Only rows `keep` accepts are held.
 */
export async function csvRows(lines, { quote = '"', skip = 0, keep = () => true } = {}) {
  const rows = [];
  let header = null;
  let pending = "";
  let skipped = 0;
  for await (const line of lines) {
    if (skipped < skip) {
      skipped += 1;
      continue;
    }
    pending = pending ? `${pending}\n${line}` : line;
    if ((pending.split(quote).length - 1) % 2 === 1) continue;
    const fields = splitCsv(pending, quote);
    pending = "";
    if (!header) header = fields.map((f) => f.trim());
    else if (fields.length > 1) {
      const row = Object.fromEntries(header.map((key, i) => [key, fields[i] ?? ""]));
      if (keep(row)) rows.push(row);
    }
  }
  return rows;
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const xmlText = (value) => value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, code) => (code[0] !== "#" ? XML_ENTITIES[code] ?? all
  : String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)))));

/** The first worksheet of an XLSX workbook as rows of cell text. */
export function xlsxRows(workbook) {
  const shared = [...zipBuffer(workbook, "xl/sharedStrings.xml").toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(([, si]) => xmlText([...si.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map(([, t]) => t).join("")));
  const rows = [];
  for (const [, row] of zipBuffer(workbook, "xl/worksheets/sheet1.xml").toString("utf8").matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const [, column, attributes, body = ""] of row.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const index = [...column].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? /<t(?: [^>]*)?>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "";
      cells[index] = /t="s"/.test(attributes) ? shared[Number(value)] : xmlText(value);
    }
    rows.push(Array.from(cells, (cell) => cell ?? ""));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The build.

const ENVELOPE = "geometry=-124.6,32.4,-114.0,42.1&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects";
const US_GOVERNMENT_WORK = "Public domain: a work of the United States Government (17 U.S.C. 105)";
const ODBL_ATTRIBUTION = "Contains OpenStreetMap data (c) OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0: https://www.openstreetmap.org/copyright";

/** Every source, in the order duplicates are resolved: the first is kept. */
export const SOURCES = [
  { id: "usgs_nsd", title: "USGS National Structures Dataset, The National Map structures service", publisher: "U.S. Geological Survey",
    license: `${US_GOVERNMENT_WORK}. The service description states that The National Map offers "free downloads of public domain structures data".`,
    attribution: "USGS The National Map, National Structures Dataset" },
  { id: "fema_state_eoc", title: "State Emergency Operations Centers (EOC)", publisher: "Federal Emergency Management Agency",
    license: `${US_GOVERNMENT_WORK}. Served by FEMA's own GIS server with no license terms.`, attribution: "FEMA" },
  { id: "cms_nursing_homes", title: "Nursing homes including rehab services: Provider Information, placed with Census TIGER/Line address ranges (see cmsPlacement)", publisher: "Centers for Medicare & Medicaid Services",
    license: `${US_GOVERNMENT_WORK}. The data.cms.gov catalog (https://data.cms.gov/data.json) lists its datasets under https://www.usa.gov/government-works.`,
    attribution: "CMS Provider Data Catalog" },
  { id: "cms_dialysis", title: "Dialysis Facility - Listing by Facility, placed with Census TIGER/Line address ranges (see cmsPlacement)", publisher: "Centers for Medicare & Medicaid Services",
    license: `${US_GOVERNMENT_WORK}. The data.cms.gov catalog (https://data.cms.gov/data.json) lists its datasets under https://www.usa.gov/government-works.`,
    attribution: "CMS Provider Data Catalog; U.S. Census Bureau TIGER/Line" },
  { id: "eia_860", title: "Form EIA-860 annual electric generator data, 2025", publisher: "U.S. Energy Information Administration",
    license: `${US_GOVERNMENT_WORK}. EIA: "U.S. government publications are in the public domain and are not subject to copyright protection." (https://www.eia.gov/about/copyrights_reuse.php)`,
    attribution: "U.S. Energy Information Administration, Form EIA-860" },
  { id: "epa_frs", title: "Facility Registry Service, California single file", publisher: "U.S. Environmental Protection Agency",
    license: `${US_GOVERNMENT_WORK}.`, attribution: "U.S. EPA Facility Registry Service" },
  { id: "fcc_asr", title: "Antenna Structure Registration, weekly public access file", publisher: "Federal Communications Commission",
    license: `${US_GOVERNMENT_WORK}.`, attribution: "FCC Antenna Structure Registration" },
  { id: "faa_nasr", title: "NASR 28-day subscription, airport data (CSV), cycle 2026-09-03", publisher: "Federal Aviation Administration",
    license: `${US_GOVERNMENT_WORK}.`, attribution: "FAA National Airspace System Resources" },
  { id: "usace_nid", title: "National Inventory of Dams", publisher: "U.S. Army Corps of Engineers",
    license: `${US_GOVERNMENT_WORK}. The public release omits the fields USACE does not release to the public.`, attribution: "USACE National Inventory of Dams" },
  { id: "fhwa_nbi", title: "National Bridge Inventory, California, 2025", publisher: "Federal Highway Administration",
    license: `${US_GOVERNMENT_WORK}.`, attribution: "FHWA National Bridge Inventory" },
  { id: "dot_principal_ports", title: "Principal Ports (National Transportation Atlas Database)", publisher: "U.S. Department of Transportation, Bureau of Transportation Statistics, from USACE Waterborne Commerce Statistics",
    license: `${US_GOVERNMENT_WORK}. Served by DOT's own geo.dot.gov server.`, attribution: "USDOT BTS National Transportation Atlas Database" },
  { id: "osm", title: "OpenStreetMap points of interest in the California street basemap", publisher: "OpenStreetMap contributors",
    license: "Open Database License (ODbL) 1.0", attribution: ODBL_ATTRIBUTION },
];

/** Types with no usable source, said plainly rather than filled. */
export const GAPS = {
  substation: "No public domain federal substation layer exists (the former HIFLD layer came from a commercial vendor and HIFLD Open is gone), and the shipped OpenStreetMap basemap does not carry power=substation. No substations are included.",
};

/** Where each type comes from and what it misses. */
const COVERAGE = {
  hospital: "USGS NSD hospitals and medical centers, with OpenStreetMap hospitals the federal layer misses.",
  urgent_care: "OpenStreetMap clinics and doctors whose name says urgent care. No federal layer lists urgent care centers; coverage is only what OpenStreetMap holds.",
  fire_station: "USGS NSD fire and EMS stations, with OpenStreetMap fire stations the federal layer misses, named or not.",
  ems_station: "USGS NSD ambulance services. Combined fire and EMS stations are drawn as fire stations.",
  law_enforcement: "USGS NSD police stations, with OpenStreetMap police stations the federal layer misses.",
  eoc: "FEMA's State EOC layer (the Cal OES State Operations Center) and OpenStreetMap points named as an emergency operations center. County and city EOCs have no public source and are mostly absent.",
  school: "USGS NSD schools, with OpenStreetMap schools the federal layer misses.",
  college: "USGS NSD colleges, universities and technical or trade schools, with OpenStreetMap colleges and universities the federal layer misses.",
  nursing_home: "CMS certified nursing homes, with OpenStreetMap nursing homes CMS does not list. CMS rounds its longitudes to two or three decimals (up to about 400 m off), so a home is placed along its TIGER/Line address range when that lies within 1.5 km of the CMS point, and at the CMS point otherwise.",
  dialysis: "CMS Medicare-certified dialysis facilities. CMS gives addresses only; each is placed on the street centerline by interpolating its house number along the matching U.S. Census TIGER/Line 2025 address range in its county (public domain), so a location can be tens of meters off. Facilities whose address matches no range are left out and counted.",
  pharmacy: "OpenStreetMap pharmacies. No public domain federal pharmacy layer with locations exists.",
  power_plant: "EIA-860 2025 plants with operable generators; capacity is the sum of operable nameplate capacity.",
  water_treatment: "EPA FRS facilities with the SDWIS interest 'WATER TREATMENT PLANT' that carry coordinates. Many are treated wells, many FRS records have no coordinates and are left out, and some coordinates are the water system's address rather than the plant.",
  wastewater_treatment: "EPA FRS facilities with the POTW interest (publicly owned treatment works).",
  comms_tower: "FCC antenna structure registrations that are constructed towers, masts and poles. Registration covers structures over 200 feet or near airports, so most small cell sites are absent.",
  airport: "FAA NASR operational airports, public and private use.",
  heliport: "FAA NASR operational heliports, public and private use (most are hospital and private pads).",
  port: "BTS principal ports (the 150 largest U.S. ports by tonnage), placed at the centroid of each port area. Smaller harbors such as Humboldt Bay and Crescent City are not in it.",
  dam: "USACE National Inventory of Dams entries in California.",
  bridge: "FHWA National Bridge Inventory 2025 highway bridges in California, one per structure.",
  correctional: "USGS NSD prisons and correctional facilities, with OpenStreetMap prisons the federal layer misses.",
  government: "USGS NSD city and town halls, courthouses, the State Capitol and the State Supreme Court, with OpenStreetMap town halls and courthouses the federal layer misses.",
  hazmat_site: "EPA FRS RCRA hazardous waste treatment, storage and disposal facilities and large quantity generators with coordinates. There is no open national Tier II chemical facility layer.",
};

async function readSources({ cache, refresh, basemap, counties }) {
  const inputs = {};
  const records = {};
  const add = (id, list) => (records[id] = [...(records[id] ?? []), ...list]);
  const get = async (id, name, url, options) => {
    const receipt = await cached(cache, name, url, { refresh, ...options });
    (inputs[id] ??= []).push(receipt);
    return receipt.path;
  };
  const geojson = (path) => JSON.parse(readFileSync(path, "utf8")).features;

  const usgs = "https://carto.nationalmap.gov/arcgis/rest/services/structures/MapServer";
  for (const layer of Object.keys(USGS_LAYERS))
    add("usgs_nsd", fromUsgs(layer, geojson(await get("usgs_nsd", `usgs-structures-${layer}.geojson`, `${usgs}/${layer}/query?where=1%3D1&${ENVELOPE}`, { produce: arcgisQuery("OBJECTID") }))));

  add("fema_state_eoc", fromFemaEoc(geojson(await get("fema_state_eoc", "fema-state-eoc.geojson",
    "https://gis.fema.gov/arcgis/rest/services/FEMA/STATE_EOC/FeatureServer/0/query?where=state%3D%27CA%27", { produce: arcgisQuery("objectid") }))));

  // CMS nursing homes and dialysis facilities, placed along Census TIGER/Line address ranges in their county.
  const inState = { keep: (r) => r.State === "CA" };
  const nursingHomes = await csvRows(fileLines(await get("cms_nursing_homes", "NH_ProviderInfo_Aug2026.csv",
    "https://data.cms.gov/provider-data/sites/default/files/resources/328596835e6db31b2564cd733c3795f4_1786724150/NH_ProviderInfo_Aug2026.csv"), "utf8"), inState);
  const dialysis = await csvRows(fileLines(await get("cms_dialysis", "DFC_FACILITY.csv",
    "https://data.cms.gov/provider-data/sites/default/files/resources/c04d84bc5c641284494bee4f20f17f9c_1781625941/DFC_FACILITY.csv"), "utf8"), inState);
  // California's county FIPS codes are the odd numbers from 001 in alphabetical order of the county names.
  const names = counties.map((c) => c.name.toLowerCase()).sort();
  const fips = (county) => (names.includes(text(county).toLowerCase()) ? `06${String(2 * names.indexOf(text(county).toLowerCase()) + 1).padStart(3, "0")}` : null);
  if (names.length !== 58 || fips("Humboldt") !== "06023" || fips("Yuba") !== "06115") throw new Error("The county list does not give California's FIPS codes");
  const locators = {};
  for (const code of [...new Set([...nursingHomes, ...dialysis].map((r) => fips(r["County/Parish"])).filter(Boolean))].sort()) {
    const zip = await get("census_tiger", `tl_2025_${code}_addrfeat.zip`, `https://www2.census.gov/geo/tiger/TIGER2025/ADDRFEAT/tl_2025_${code}_addrfeat.zip`);
    locators[code] = addressLocator(readShapefile(zipBuffer(zip, `tl_2025_${code}_addrfeat.shp`), zipBuffer(zip, `tl_2025_${code}_addrfeat.dbf`)));
  }
  const found = new Set();
  const locate = (address, county) => {
    const at = locators[fips(county)]?.(address) ?? null;
    if (at) found.add(`${at.lon},${at.lat}`);
    return at;
  };
  add("cms_nursing_homes", fromCmsNursingHomes(nursingHomes, locate));
  const nursingHomesByAddress = records.cms_nursing_homes.filter((r) => found.has(`${r.lon},${r.lat}`)).length;
  add("cms_dialysis", fromCmsDialysis(dialysis, locate));

  const eia = await get("eia_860", "eia8602025.zip", "https://www.eia.gov/electricity/data/eia860/xls/eia8602025.zip");
  add("eia_860", fromEia860(sheetObjects(xlsxRows(zipBuffer(eia, "2___Plant_Y2025.xlsx")), "Plant Code"),
    sheetObjects(xlsxRows(zipBuffer(eia, "3_1_Generator_Y2025.xlsx")), "Plant Code")));

  const frs = await get("epa_frs", "state_single_ca.zip", "https://ordsext.epa.gov/FLA/www3/state_files/state_single_ca.zip");
  add("epa_frs", fromEpaFrs(await csvRows(zipLines(frs, "STATE_SINGLE_CA.CSV", "latin1"),
    { keep: (r) => /\b(POTW|WATER TREATMENT PLANT|TSD|LQG)\b/.test(r.INTEREST_TYPES) })));

  const asr = await get("fcc_asr", "r_tower.zip", "https://data.fcc.gov/download/pub/uls/complete/r_tower.zip");
  const dat = async (name) => (await Array.fromAsync(zipLines(asr, name, "latin1"))).map((line) => line.split("|"));
  add("fcc_asr", fromFccAsr(await dat("RA.dat"), await dat("CO.dat"), await dat("EN.dat")));

  const faa = await get("faa_nasr", "03_Sep_2026_APT_CSV.zip", "https://nfdc.faa.gov/webContent/28DaySub/extra/03_Sep_2026_APT_CSV.zip");
  add("faa_nasr", fromFaaAirports(await csvRows(zipLines(faa, "APT_BASE.csv", "latin1"))));

  add("usace_nid", fromNid(await csvRows(fileLines(await get("usace_nid", "nid-nation.csv", "https://nid.sec.usace.army.mil/api/nation/csv"), "utf8"),
    { skip: 1, keep: (r) => r.State === "California" })));

  add("fhwa_nbi", fromNbi(await csvRows(fileLines(await get("fhwa_nbi", "CA25.txt", "https://www.fhwa.dot.gov/bridge/nbi/2025/delimited/CA25.txt"), "latin1"), { quote: "'" })));

  add("dot_principal_ports", fromPorts(geojson(await get("dot_principal_ports", "dot-principal-ports.geojson",
    `https://geo.dot.gov/server/rest/services/Hosted/principal_ports_view/FeatureServer/0/query?where=1%3D1&${ENVELOPE}`, { produce: arcgisQuery("objectid") }))));

  // OpenStreetMap: one record per OSM object, though the basemap repeats a point in each neighbor tile's buffer.
  const osm = new Map();
  for (const tile of archiveTiles(basemap)) for (const record of fromOsmTile(tile.z, tile.x, tile.y, tile.data)) osm.set(record.source_id, record);
  add("osm", [...osm.values()]);

  const placement = {
    addressRanges: "U.S. Census Bureau TIGER/Line 2025 address range feature files (ADDRFEAT), one per county, public domain (a work of the United States Government, 17 U.S.C. 105)",
    nursingHomes: { inCalifornia: nursingHomes.length, placedByAddress: nursingHomesByAddress, atCmsPoint: nursingHomes.length - nursingHomesByAddress },
    dialysis: { inCalifornia: dialysis.length, placedByAddress: records.cms_dialysis.length, leftOut: dialysis.length - records.cms_dialysis.length },
    files: (inputs.census_tiger ?? []).map(({ path: _path, ...receipt }) => receipt),
  };
  return { inputs, records, placement };
}

async function localInput(path, role) {
  const { bytes, sha256 } = await sha256File(path);
  return { file: relative(repo, path).replaceAll("\\", "/"), role, bytes, sha256, modifiedAt: statSync(path).mtime.toISOString() };
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    cache: { type: "string" }, basemap: { type: "string" }, refresh: { type: "boolean" },
  } });
  const out = resolve(positionals[0] ?? join(here, "out"));
  const cache = resolve(values.cache ?? process.env.OPENEOC_FACILITIES_CACHE ?? join(out, "facilities-cache"));
  const basemap = resolve(values.basemap ?? join(repo, "web/public/basemap/california.pmtiles"));
  mkdirSync(cache, { recursive: true });
  mkdirSync(out, { recursive: true });
  if (!existsSync(basemap)) throw new Error(`The OpenMapTiles street basemap is needed: ${basemap}`);
  const state = readBoundaries(join(repo, "web/public/basemap/ca_state.geojson"))[0];
  const counties = readBoundaries(join(repo, "web/public/basemap/ca_counties.geojson"));

  const { inputs, records, placement } = await readSources({ cache, refresh: values.refresh, basemap, counties });
  const check = californiaCheck(state, counties);
  const counts = {};
  const inCalifornia = [];
  for (const source of SOURCES) {
    const tally = { read: 0, kept: 0, "no coordinates": 0, "outside California": 0, duplicates: 0 };
    for (const record of records[source.id] ?? []) {
      tally.read += 1;
      const reason = check(record);
      if (reason) tally[reason] += 1;
      else inCalifornia.push(record);
    }
    counts[source.id] = tally;
  }
  const order = SOURCES.map((s) => s.id);
  const { kept, dropped } = dedupe(inCalifornia, order);
  for (const [pair, n] of Object.entries(dropped)) counts[pair.split(">")[0]].duplicates += n;
  const typeOrder = Object.keys(FACILITY_TYPES);
  kept.sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || order.indexOf(a.source) - order.indexOf(b.source)
    || text(a.source_id).localeCompare(text(b.source_id)) || a.lon - b.lon || a.lat - b.lat);
  for (const record of kept) counts[record.source].kept += 1;

  const attribution = `Facilities: ${[...new Set(SOURCES.filter((s) => s.id !== "osm").flatMap((s) => s.attribution.split("; ")))].join("; ")}. ${ODBL_ATTRIBUTION}`;
  const description = "California critical facilities by type and FEMA Community Lifeline, from U.S. public domain sources and OpenStreetMap. Reference data, not an authoritative inventory.";
  const archive = facilityArchive(kept, { attribution, description });
  const output = join(out, "facilities.pmtiles");
  writeFileSync(`${output}.${process.pid}.partial`, archive.bytes);
  renameSync(`${output}.${process.pid}.partial`, output);
  const archiveSha256 = createHash("sha256").update(archive.bytes).digest("hex");

  const byType = (list) => Object.fromEntries(typeOrder.map((type) => [type, list.filter((r) => r.type === type).length]));
  const inCounty = (name) => byType(kept.filter((r) => r.county === name));
  const basemapInput = await localInput(basemap, "OpenMapTiles street basemap, poi layer at z14");
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    archive: "facilities.pmtiles",
    archiveBytes: archive.bytes.length,
    archiveSHA256: archiveSha256,
    bounds: archive.bounds,
    tiles: archive.tiles,
    layers: {
      facility_clusters: { minzoom: CLUSTER_ZOOMS[0], maxzoom: CLUSTER_ZOOMS.at(-1), note: `Grid clusters, ${CELLS_PER_TILE} cells per tile side, at the members' mean position; count, dominant lifeline and a count per lifeline.` },
      facilities: { minzoom: FACILITY_ZOOMS[0], maxzoom: FACILITY_ZOOMS.at(-1), fields: FACILITY_FIELDS },
    },
    clipBoundary: "web/public/basemap/ca_state.geojson and ca_counties.geojson",
    total: kept.length,
    types: Object.fromEntries(typeOrder.map((type) => [type, {
      lifeline: FACILITY_TYPES[type][0], sector: FACILITY_TYPES[type][1], count: kept.filter((r) => r.type === type).length,
      bySource: Object.fromEntries(order.map((id) => [id, kept.filter((r) => r.type === type && r.source === id).length]).filter(([, n]) => n > 0)),
      coverage: GAPS[type] ?? COVERAGE[type],
    }])),
    counties: { Humboldt: inCounty("Humboldt"), "Del Norte": inCounty("Del Norte") },
    gaps: GAPS,
    dedupe: {
      rule: `Same type, and within ${DUPLICATE_METERS} m, or within ${SAME_NAME_METERS} m with the same name (shared words at least 60 percent, numbers equal). Sources are taken in the order listed; the first record is kept whole. Records of one federal source never merge with each other; OpenStreetMap points do.`,
      dropped,
    },
    sources: SOURCES.map((source) => ({ ...source, types: [...new Set((records[source.id] ?? []).map((r) => r.type))], counts: counts[source.id],
      files: source.id === "osm" ? [basemapInput]
        : (inputs[source.id] ?? []).map(({ path: _path, ...receipt }) => receipt) })),
    cmsPlacement: placement,
    odblAttribution: ODBL_ATTRIBUTION,
    rightsNote: "The federal records are public domain. The OpenStreetMap records (source osm) are ODbL: this archive holds a derivative database of OpenStreetMap, so it and any database made from it keep the ODbL and the attribution above.",
  };
  const manifestPath = join(out, "facilities-manifest.json");
  writeFileSync(`${manifestPath}.${process.pid}.partial`, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(`${manifestPath}.${process.pid}.partial`, manifestPath);
  console.log(`Wrote ${output} (${manifest.archiveBytes} bytes, ${kept.length} facilities, ${archive.tiles} tiles, sha256 ${archiveSha256}) and facilities-manifest.json`);
  console.log(JSON.stringify({ total: kept.length, types: byType(kept), counties: manifest.counties, counts }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
