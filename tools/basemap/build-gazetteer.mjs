#!/usr/bin/env node
// Builds the offline address-search gazetteer from an OpenMapTiles PMTiles
// archive (the street basemap generate-california.sh writes), optionally
// merging a county address-point file. Node only, no dependencies.
//
//   node tools/basemap/build-gazetteer.mjs <archive.pmtiles>
//     [--out tools/basemap/out/gazetteer.tsv] [--addresses <points.csv|.geojson>]
//     [--places <boundaries.geojson>] [--zoom <z>]
//
// --places names each street and point of interest by the city boundary that
// contains it (GeoJSON polygons with a NAME or name property, such as Census
// TIGER places); without it, or outside every boundary, the nearest
// settlement names it.
//
// The output is one tab-separated entry per line after a format header:
//   kind  name  class  context  lon  lat  key  addresses
// kind is place, street or poi; key is the normalized search key; addresses
// (streets only) is "number,lon,lat" joined by ";". See README section 10.
import { closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { GAZETTEER_HEADER, searchKey } from "../../server/src/geocode/normalize.ts";

// ---------------------------------------------------------------------------
// PMTiles v3 (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md)

function decompress(buf, kind) {
  if (kind === 1) return buf;
  if (kind === 2 || (kind === 0 && buf[0] === 0x1f && buf[1] === 0x8b)) return gunzipSync(buf);
  if (kind === 3) return brotliDecompressSync(buf);
  if (kind === 0) return buf;
  throw new Error(`unsupported PMTiles compression ${kind}`);
}

function readDirectory(buf) {
  let pos = 0;
  const varint = () => {
    let value = 0;
    let scale = 1;
    let byte;
    do {
      byte = buf[pos++];
      value += (byte & 0x7f) * scale;
      scale *= 128;
    } while (byte & 0x80);
    return value;
  };
  const entries = Array.from({ length: varint() }, () => ({ tileId: 0, runLength: 0, length: 0, offset: 0 }));
  let id = 0;
  for (const entry of entries) entry.tileId = id += varint();
  for (const entry of entries) entry.runLength = varint();
  for (const entry of entries) entry.length = varint();
  entries.forEach((entry, i) => {
    const value = varint();
    const previous = entries[i - 1];
    entry.offset = value === 0 && previous ? previous.offset + previous.length : value - 1;
  });
  return entries;
}

/** Hilbert tile id to z/x/y, as the PMTiles spec numbers tiles. */
export function tileIdToZxy(id) {
  let z = 0;
  let base = 0;
  while (base + 4 ** z <= id) {
    base += 4 ** z;
    z += 1;
  }
  let t = id - base;
  let x = 0;
  let y = 0;
  for (let s = 1; s < 2 ** z; s *= 2) {
    const rx = 1 & (t >>> 1);
    const ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      [x, y] = [y, x];
    }
    x += s * rx;
    y += s * ry;
    t >>>= 2;
  }
  return { z, x, y };
}

/** Every tile of one zoom level in an archive: {z, x, y, data} with data decompressed. */
export function* archiveTiles(path, zoom) {
  const fd = openSync(path, "r");
  try {
    const read = (offset, length) => {
      const buf = Buffer.allocUnsafe(length);
      if (readSync(fd, buf, 0, length, offset) !== length) throw new Error(`${path}: truncated archive`);
      return buf;
    };
    const h = read(0, 127);
    if (h.toString("latin1", 0, 7) !== "PMTiles" || h[7] !== 3) throw new Error(`${path} is not a PMTiles v3 archive`);
    if (h[99] !== 1) throw new Error(`${path} does not hold vector (MVT) tiles`);
    const u64 = (offset) => Number(h.readBigUInt64LE(offset));
    const [leafOffset, dataOffset, internal, tileCompression] = [u64(40), u64(56), h[97], h[98]];
    const z = zoom ?? h[101];
    const first = (4 ** z - 1) / 3;
    const last = first + 4 ** z;
    function* walk(offset, length) {
      const entries = readDirectory(decompress(read(offset, length), internal));
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry.runLength === 0) {
          const next = entries[i + 1]?.tileId ?? Infinity;
          if (entry.tileId < last && next > first) yield* walk(leafOffset + entry.offset, entry.length);
          continue;
        }
        const from = Math.max(entry.tileId, first);
        const to = Math.min(entry.tileId + entry.runLength, last);
        if (from >= to) continue;
        const data = decompress(read(dataOffset + entry.offset, entry.length), tileCompression);
        for (let id = from; id < to; id += 1) yield { ...tileIdToZxy(id), data };
      }
    }
    yield* walk(u64(8), u64(16));
  } finally {
    closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Mapbox Vector Tile decoding, only what the gazetteer reads.

class Proto {
  constructor(buf, pos, end) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }
  varint() {
    let value = 0;
    let scale = 1;
    let byte;
    do {
      byte = this.buf[this.pos++];
      value += (byte & 0x7f) * scale;
      scale *= 128;
    } while (byte & 0x80);
    return value;
  }
  range() {
    const length = this.varint();
    const start = this.pos;
    this.pos += length;
    return [start, this.pos];
  }
  string() {
    const [start, end] = this.range();
    return this.buf.toString("utf8", start, end);
  }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`unsupported protobuf wire type ${wire}`);
  }
}

function readValue(p) {
  const [start, end] = p.range();
  const v = new Proto(p.buf, start, end);
  let value = null;
  while (v.pos < v.end) {
    const key = v.varint();
    const field = key >> 3;
    if (field === 1) value = v.string();
    else if (field === 2) {
      value = v.buf.readFloatLE(v.pos);
      v.pos += 4;
    } else if (field === 3) {
      value = v.buf.readDoubleLE(v.pos);
      v.pos += 8;
    } else if (field === 4 || field === 5) value = v.varint();
    else if (field === 6) {
      const zigzag = v.varint();
      value = zigzag % 2 ? -(zigzag + 1) / 2 : zigzag / 2;
    } else if (field === 7) value = v.varint() === 1;
    else v.skip(key & 7);
  }
  return value;
}

/** Point and line parts in tile coordinates, each a flat [x0, y0, x1, y1, ...]. */
function readGeometry(buf, start, end) {
  const p = new Proto(buf, start, end);
  const parts = [];
  let part = [];
  let x = 0;
  let y = 0;
  let command = 0;
  let count = 0;
  while (p.pos < p.end) {
    if (count === 0) {
      const c = p.varint();
      command = c & 7;
      count = c >> 3;
      if (command === 7) {
        count = 0;
        continue;
      }
    }
    count -= 1;
    const dx = p.varint();
    const dy = p.varint();
    x += (dx >>> 1) ^ -(dx & 1);
    y += (dy >>> 1) ^ -(dy & 1);
    if (command === 1) parts.push((part = []));
    part.push(x, y);
  }
  return parts;
}

/** The named layers of one tile: name -> {extent, features: [{type, props, parts}]}. */
export function decodeTile(buf, wanted) {
  const layers = new Map();
  const tile = new Proto(buf, 0, buf.length);
  while (tile.pos < tile.end) {
    const key = tile.varint();
    if (key >> 3 !== 3) {
      tile.skip(key & 7);
      continue;
    }
    const [start, end] = tile.range();
    const layer = new Proto(buf, start, end);
    let name = "";
    let extent = 4096;
    const keys = [];
    const values = [];
    const features = [];
    while (layer.pos < layer.end) {
      const lkey = layer.varint();
      const field = lkey >> 3;
      if (field === 1) name = layer.string();
      else if (field === 2) features.push(layer.range());
      else if (field === 3) keys.push(layer.string());
      else if (field === 4) values.push(readValue(layer));
      else if (field === 5) extent = layer.varint();
      else layer.skip(lkey & 7);
    }
    if (!wanted.has(name)) continue;
    layers.set(name, {
      extent,
      features: features.map(([fStart, fEnd]) => {
        const f = new Proto(buf, fStart, fEnd);
        const feature = { type: 0, props: {}, parts: [] };
        while (f.pos < f.end) {
          const fkey = f.varint();
          const field = fkey >> 3;
          if (field === 2) {
            const [tStart, tEnd] = f.range();
            const tags = new Proto(buf, tStart, tEnd);
            while (tags.pos < tags.end) feature.props[keys[tags.varint()]] = values[tags.varint()];
          } else if (field === 3) feature.type = f.varint();
          else if (field === 4) feature.parts = readGeometry(buf, ...f.range());
          else f.skip(fkey & 7);
        }
        return feature;
      }),
    });
  }
  return layers;
}

// ---------------------------------------------------------------------------
// The gazetteer.

export const GAZETTEER_LAYERS = new Set([
  "place", "transportation_name", "housenumber", "poi", "aerodrome_label", "mountain_peak",
]);
const SKIPPED_PLACES = new Set(["continent", "country", "state", "province"]);
const SETTLEMENTS = new Set(["city", "town", "village", "hamlet"]);
// Named paths, rails and ferries are searchable but never take a house number.
const NOT_ADDRESS_STREETS = new Set(["path", "track", "ferry", "rail", "transit", "raceway", "aerialway"]);
/** Same-named street pieces this close (degrees, about 2 km) are one street. */
const MERGE_DEGREES = 0.02;
/** A house number farther than this from any named street (tile units, about 120 m at z14) is dropped. */
const ADDRESS_REACH = 250;

const round5 = (value) => Math.round(value * 1e5) / 1e5;
const clean = (text) => String(text).replace(/[\t\r\n]+/g, " ").trim();

/** Tile coordinates to WGS84 longitude and latitude, rounded to 1e-5 degrees. */
export function lonLat(z, x, y, extent, px, py) {
  const n = 2 ** z;
  const lon = ((x + px / extent) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI;
  return [round5(lon), round5(lat)];
}

function segmentDistance2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

const touches = (a, b, pad) =>
  a.minLon - pad <= b.maxLon && b.minLon - pad <= a.maxLon && a.minLat - pad <= b.maxLat && b.minLat - pad <= a.maxLat;

/** Whether a point is inside a closed ring of [lon, lat] pairs (even-odd rule). */
function inRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a boundary (polygons of an outer ring and holes) contains a point. */
export function boundaryContains(boundary, lon, lat) {
  const [minLon, minLat, maxLon, maxLat] = boundary.bbox;
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return false;
  return boundary.polygons.some(([outer, ...holes]) => inRing(outer, lon, lat) && !holes.some((hole) => inRing(hole, lon, lat)));
}

export function createGazetteerBuilder() {
  const places = new Map();
  const pois = new Map();
  /** City boundaries on the settlement grid, smallest first. */
  const boundaryGrid = new Map();
  /** search key -> street clusters */
  const streets = new Map();
  const counts = { tiles: 0, osmAddresses: 0, unplacedAddresses: 0, countyAddresses: 0, skippedCountyRows: 0 };

  function streetCluster(name, key, box, context) {
    let clusters = streets.get(key);
    if (!clusters) streets.set(key, (clusters = []));
    let cluster = clusters.find((candidate) => touches(candidate, box, MERGE_DEGREES));
    if (!cluster) {
      cluster = { name, cls: "", context, ...box, best: -1, lon: box.minLon, lat: box.minLat, addresses: [] };
      clusters.push(cluster);
    }
    cluster.minLon = Math.min(cluster.minLon, box.minLon);
    cluster.minLat = Math.min(cluster.minLat, box.minLat);
    cluster.maxLon = Math.max(cluster.maxLon, box.maxLon);
    cluster.maxLat = Math.max(cluster.maxLat, box.maxLat);
    return cluster;
  }

  function addPoint(target, entry, precision) {
    const key = searchKey(entry.name);
    if (!key) return;
    const id = `${key}|${entry.lon.toFixed(precision)}|${entry.lat.toFixed(precision)}`;
    if (!target.has(id)) target.set(id, { ...entry, key });
  }

  function addTile(z, x, y, layers) {
    counts.tiles += 1;
    const inside = (extent, px, py) => px >= 0 && py >= 0 && px < extent && py < extent;
    for (const [layerName, layer] of layers) {
      if (layerName === "transportation_name" || layerName === "housenumber") continue;
      for (const f of layer.features) {
        const name = f.props.name;
        if (typeof name !== "string" || !name.trim()) continue;
        const cls = layerName === "aerodrome_label" ? "airport" : String(f.props.subclass ?? f.props.class ?? "");
        if (layerName === "place" && SKIPPED_PLACES.has(cls)) continue;
        for (const [px, py] of f.parts) {
          if (!inside(layer.extent, px, py)) continue;
          const [lon, lat] = lonLat(z, x, y, layer.extent, px, py);
          const entry = { name: clean(name), cls, lon, lat };
          if (layerName === "place") addPoint(places, entry, 2);
          else addPoint(pois, entry, 3);
        }
      }
    }
    const roads = layers.get("transportation_name");
    const tileStreets = [];
    for (const f of roads?.features ?? []) {
      const name = clean(f.props.name || f.props.ref || "");
      const key = searchKey(name);
      if (!key || f.type !== 2) continue;
      for (const part of f.parts) {
        let length = 0;
        let [minX, minY, maxX, maxY] = [part[0], part[1], part[0], part[1]];
        for (let i = 2; i < part.length; i += 2) {
          length += Math.hypot(part[i] - part[i - 2], part[i + 1] - part[i - 1]);
          minX = Math.min(minX, part[i]);
          maxX = Math.max(maxX, part[i]);
          minY = Math.min(minY, part[i + 1]);
          maxY = Math.max(maxY, part[i + 1]);
        }
        const [minLon, maxLat] = lonLat(z, x, y, roads.extent, minX, minY);
        const [maxLon, minLat] = lonLat(z, x, y, roads.extent, maxX, maxY);
        const cluster = streetCluster(name, key, { minLon, minLat, maxLon, maxLat }, "");
        const cls = String(f.props.class ?? "");
        if (length > cluster.best) {
          const mid = 2 * Math.floor(part.length / 4);
          [cluster.lon, cluster.lat] = lonLat(z, x, y, roads.extent, part[mid], part[mid + 1]);
          cluster.best = length;
          cluster.cls = cls;
        }
        if (!NOT_ADDRESS_STREETS.has(cls)) tileStreets.push({ part, cluster, minX, minY, maxX, maxY });
      }
    }
    const numbers = layers.get("housenumber");
    for (const f of numbers?.features ?? []) {
      const number = clean(f.props.housenumber ?? "").replace(/[,;]/g, "/");
      if (!number) continue;
      for (const [px, py] of f.parts) {
        if (!inside(numbers.extent, px, py)) continue;
        let nearest = null;
        let best = ADDRESS_REACH * ADDRESS_REACH;
        for (const s of tileStreets) {
          if (px < s.minX - ADDRESS_REACH || px > s.maxX + ADDRESS_REACH || py < s.minY - ADDRESS_REACH || py > s.maxY + ADDRESS_REACH) continue;
          for (let i = 2; i < s.part.length; i += 2) {
            const d = segmentDistance2(px, py, s.part[i - 2], s.part[i - 1], s.part[i], s.part[i + 1]);
            if (d < best) [best, nearest] = [d, s.cluster];
          }
        }
        if (!nearest) {
          counts.unplacedAddresses += 1;
          continue;
        }
        nearest.addresses.push([number, ...lonLat(z, x, y, numbers.extent, px, py)]);
        counts.osmAddresses += 1;
      }
    }
  }

  /** County address points: {number, street, city, lon, lat}. */
  function addAddressPoints(points) {
    for (const point of points) {
      const number = clean(point.number ?? "").replace(/[,;]/g, "/");
      const street = clean(point.street ?? "");
      const key = searchKey(street);
      const lon = Number(point.lon);
      const lat = Number(point.lat);
      if (!number || !key || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
        counts.skippedCountyRows += 1;
        continue;
      }
      const cluster = streetCluster(street, key, { minLon: lon, minLat: lat, maxLon: lon, maxLat: lat }, clean(point.city ?? ""));
      if (cluster.best < 0) [cluster.lon, cluster.lat, cluster.best] = [round5(lon), round5(lat), 0];
      cluster.addresses.push([number, round5(lon), round5(lat)]);
      counts.countyAddresses += 1;
    }
  }

  /** The gazetteer lines (without the header) and the entry counts. */
  function build() {
    // Settlement lookup for context, on a 0.2 degree grid searched 3 x 3.
    const grid = new Map();
    const cell = (lon, lat) => `${Math.floor(lon * 5)},${Math.floor(lat * 5)}`;
    for (const place of places.values()) {
      if (!SETTLEMENTS.has(place.cls)) continue;
      const id = cell(place.lon, place.lat);
      if (!grid.has(id)) grid.set(id, []);
      grid.get(id).push(place);
    }
    // The containing city boundary when one was given, else the nearest settlement.
    const near = (lon, lat) => {
      const city = boundaryGrid.get(cell(lon, lat))?.find((boundary) => boundaryContains(boundary, lon, lat));
      if (city) return city.name;
      let found = "";
      let best = Infinity;
      const [cx, cy] = [Math.floor(lon * 5), Math.floor(lat * 5)];
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const place of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            const d = (place.lon - lon) ** 2 * 0.64 + (place.lat - lat) ** 2;
            if (d < best) [best, found] = [d, place.name];
          }
        }
      }
      return found;
    };
    const lines = [];
    const line = (kind, name, cls, context, lon, lat, key, addresses = "") =>
      lines.push([kind, name, cls, context, lon, lat, key, addresses].join("\t"));
    for (const p of places.values()) line("place", p.name, p.cls, "", p.lon, p.lat, p.key);
    let streetCount = 0;
    let addressCount = 0;
    for (const [key, clusters] of streets) {
      // Pieces met from both ends before their middle are joined here.
      for (let i = 0; i < clusters.length; i += 1) {
        for (let j = clusters.length - 1; j > i; j -= 1) {
          const [a, b] = [clusters[i], clusters[j]];
          if (!touches(a, b, MERGE_DEGREES)) continue;
          a.minLon = Math.min(a.minLon, b.minLon);
          a.minLat = Math.min(a.minLat, b.minLat);
          a.maxLon = Math.max(a.maxLon, b.maxLon);
          a.maxLat = Math.max(a.maxLat, b.maxLat);
          if (b.best > a.best) [a.lon, a.lat, a.best, a.cls] = [b.lon, b.lat, b.best, b.cls];
          a.context ||= b.context;
          a.addresses.push(...b.addresses);
          clusters.splice(j, 1);
          j = clusters.length;
        }
      }
      for (const s of clusters) {
        // County points come last, so a county number replaces the OSM one.
        const byNumber = new Map(s.addresses.map((a) => [a[0].toLowerCase(), a]));
        addressCount += byNumber.size;
        streetCount += 1;
        line("street", s.name, s.cls, s.context || near(s.lon, s.lat), s.lon, s.lat, key,
          [...byNumber.values()].map((a) => a.join(",")).join(";"));
      }
    }
    for (const p of pois.values()) line("poi", p.name, p.cls, near(p.lon, p.lat), p.lon, p.lat, p.key);
    return { lines, counts: { ...counts, places: places.size, streets: streetCount, pois: pois.size, addresses: addressCount } };
  }

  /** City boundaries: { name, bbox, polygons }. A point inside one takes its name as context. */
  function addBoundaries(boundaries) {
    const sized = [...boundaries].sort((a, b) =>
      (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) - (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]));
    for (const boundary of sized) {
      for (let cx = Math.floor(boundary.bbox[0] * 5); cx <= Math.floor(boundary.bbox[2] * 5); cx += 1) {
        for (let cy = Math.floor(boundary.bbox[1] * 5); cy <= Math.floor(boundary.bbox[3] * 5); cy += 1) {
          const id = `${cx},${cy}`;
          if (!boundaryGrid.has(id)) boundaryGrid.set(id, []);
          boundaryGrid.get(id).push(boundary);
        }
      }
    }
    counts.boundaries = (counts.boundaries ?? 0) + boundaries.length;
  }

  return { addTile, addAddressPoints, addBoundaries, build };
}

// ---------------------------------------------------------------------------
// County address points.

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === "\n") {
      row.push(field);
      field = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A CSV with columns number, street, city, lon, lat, or GeoJSON points with number, street, city properties. */
export function readAddressPoints(path) {
  // A leading byte order mark (spreadsheet exports) is not part of the first header.
  const raw = readFileSync(path, "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (/\.(geo)?json$/i.test(path)) {
    return (JSON.parse(text).features ?? []).map((f) => {
      const props = Object.fromEntries(Object.entries(f.properties ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      const [lon, lat] = f.geometry?.type === "Point" ? f.geometry.coordinates : [NaN, NaN];
      return { number: props.number, street: props.street, city: props.city, lon, lat };
    });
  }
  const [header = [], ...rows] = parseCsv(text).filter((r) => r.some((cell) => cell.trim()));
  const columns = header.map((h) => h.trim().toLowerCase());
  const index = Object.fromEntries(["number", "street", "city", "lon", "lat"].map((name) => {
    const at = columns.indexOf(name);
    if (at < 0 && name !== "city") throw new Error(`${path}: missing column ${name}`);
    return [name, at];
  }));
  return rows.map((r) => ({
    number: r[index.number],
    street: r[index.street],
    city: index.city >= 0 ? r[index.city] : "",
    lon: r[index.lon],
    lat: r[index.lat],
  }));
}

/** City boundaries from GeoJSON polygons or multipolygons named by NAME or name. */
export function readBoundaries(path) {
  const raw = readFileSync(path, "utf8");
  const collection = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  const boundaries = [];
  for (const feature of collection.features ?? []) {
    const props = Object.fromEntries(Object.entries(feature.properties ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const name = clean(props.name ?? "");
    const geometry = feature.geometry;
    const polygons = geometry?.type === "Polygon" ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
    if (!name || polygons.length === 0) continue;
    const bbox = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [outer] of polygons) {
      for (const [lon, lat] of outer) {
        bbox[0] = Math.min(bbox[0], lon); bbox[1] = Math.min(bbox[1], lat);
        bbox[2] = Math.max(bbox[2], lon); bbox[3] = Math.max(bbox[3], lat);
      }
    }
    boundaries.push({ name, bbox, polygons });
  }
  return boundaries;
}

// ---------------------------------------------------------------------------

export function buildGazetteer({ archive, zoom, addresses, places, out, log = () => {} }) {
  const started = Date.now();
  const builder = createGazetteerBuilder();
  for (const tile of archiveTiles(archive, zoom)) {
    builder.addTile(tile.z, tile.x, tile.y, decodeTile(tile.data, GAZETTEER_LAYERS));
  }
  log(`read tiles in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (addresses) builder.addAddressPoints(readAddressPoints(addresses));
  if (places) builder.addBoundaries(readBoundaries(places));
  const { lines, counts } = builder.build();
  mkdirSync(dirname(out), { recursive: true });
  const temporary = `${out}.partial`;
  const fd = openSync(temporary, "w");
  try {
    writeSync(fd, `${GAZETTEER_HEADER}\t${new Date().toISOString()}\n`);
    for (let i = 0; i < lines.length; i += 10_000) writeSync(fd, `${lines.slice(i, i + 10_000).join("\n")}\n`);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, out);
  return { ...counts, seconds: Math.round((Date.now() - started) / 100) / 10 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: "string" }, addresses: { type: "string" }, places: { type: "string" }, zoom: { type: "string" } },
  });
  const [archive] = positionals;
  if (!archive) {
    console.error("usage: node tools/basemap/build-gazetteer.mjs <archive.pmtiles> [--out file] [--addresses file] [--places file] [--zoom z]");
    process.exit(2);
  }
  const out = resolve(values.out ?? fileURLToPath(new URL("out/gazetteer.tsv", import.meta.url)));
  const summary = buildGazetteer({
    archive,
    zoom: values.zoom === undefined ? undefined : Number(values.zoom),
    addresses: values.addresses,
    places: values.places,
    out,
    log: (message) => console.error(message),
  });
  console.log(JSON.stringify({ out, ...summary }, null, 2));
}
