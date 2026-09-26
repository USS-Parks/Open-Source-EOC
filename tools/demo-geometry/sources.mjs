// Reads what the demo geometry generator needs from the basemap archives the
// app ships: elevation from the North Coast terrain tiles (Terrarium PNG) and
// water, roads, places and tribal land from the California vector tiles
// (OpenMapTiles), each sampled or burned onto a grid from grid.mjs.
import { closeSync, openSync, readSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PMTiles } from "../../web/node_modules/pmtiles/dist/esm/index.js";
import { decodeTile } from "../basemap/build-gazetteer.mjs";

/** A PMTiles archive on disk, read on demand. Call close() when done. */
export function openArchive(path) {
  const fd = openSync(path, "r");
  const archive = new PMTiles({
    getKey: () => path,
    getBytes: async (offset, length) => {
      const buffer = Buffer.allocUnsafe(length);
      readSync(fd, buffer, 0, length, offset);
      return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + length) };
    },
  });
  archive.close = () => closeSync(fd);
  return archive;
}

const tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const tileLon = (x, z) => (x / 2 ** z) * 360 - 180;
const tileLat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** Every z/x/y tile covering a bounding box. */
function tilesCovering([west, south, east, north], z) {
  const tiles = [];
  for (let x = Math.floor(tileX(west, z)); x <= Math.floor(tileX(east, z)); x += 1) {
    for (let y = Math.floor(tileY(north, z)); y <= Math.floor(tileY(south, z)); y += 1) tiles.push([x, y]);
  }
  return tiles;
}

/** An 8-bit RGB or RGBA PNG as {width, height, channels, pixels}. */
export function decodePng(png) {
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 3;
  const data = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("only 8-bit, non-interlaced PNG");
      channels = body[9] === 6 ? 4 : body[9] === 2 ? 3 : 0;
      if (!channels) throw new Error("only RGB or RGBA PNG");
    } else if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const x = raw[row * (stride + 1) + 1 + i];
      const a = i >= channels ? pixels[row * stride + i - channels] : 0;
      const b = row > 0 ? pixels[(row - 1) * stride + i] : 0;
      const c = i >= channels && row > 0 ? pixels[(row - 1) * stride + i - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[row * stride + i] = (x + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/**
 * Elevation in metres at each grid cell's centre, sampled bilinearly from
 * the Terrarium tiles at zoom `z`. Open water reads as sea level.
 */
export async function elevation(archive, grid, z = 13) {
  const bbox = [grid.lon(-1), grid.lat(grid.H), grid.lon(grid.W), grid.lat(-1)];
  const tiles = new Map();
  for (const [x, y] of tilesCovering(bbox, z)) {
    const found = await archive.getZxy(z, x, y);
    tiles.set(`${x}/${y}`, found ? decodePng(Buffer.from(found.data)) : null);
  }
  const sample = (px, py) => {
    const tile = tiles.get(`${Math.floor(px / 256)}/${Math.floor(py / 256)}`);
    if (!tile) return 0;
    const col = Math.min(tile.width - 1, Math.floor(px) % 256);
    const row = Math.min(tile.height - 1, Math.floor(py) % 256);
    const at = (row * tile.width + col) * tile.channels;
    return tile.pixels[at] * 256 + tile.pixels[at + 1] + tile.pixels[at + 2] / 256 - 32768;
  };
  const out = new Float32Array(grid.size);
  for (let row = 0; row < grid.H; row += 1) {
    const py = tileY(grid.lat(row), z) * 256 - 0.5;
    const y0 = Math.floor(py);
    const fy = py - y0;
    for (let col = 0; col < grid.W; col += 1) {
      const px = tileX(grid.lon(col), z) * 256 - 0.5;
      const x0 = Math.floor(px);
      const fx = px - x0;
      out[row * grid.W + col] =
        (sample(x0, y0) * (1 - fx) + sample(x0 + 1, y0) * fx) * (1 - fy) +
        (sample(x0, y0 + 1) * (1 - fx) + sample(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  return out;
}

/**
 * The vector tiles at zoom `z` over a grid, each with its decoded `layers`
 * and a `toLonLat(px, py)` for its tile coordinates.
 */
export async function vectorTiles(archive, grid, layers, z = 14) {
  const bbox = [grid.lon(-1), grid.lat(grid.H), grid.lon(grid.W), grid.lat(-1)];
  const out = [];
  for (const [x, y] of tilesCovering(bbox, z)) {
    const found = await archive.getZxy(z, x, y);
    if (!found) continue;
    const decoded = decodeTile(Buffer.from(found.data), new Set(layers));
    out.push({
      x, y, z, layers: decoded,
      toLonLat: (px, py, extent) => [tileLon(x + px / extent, z), tileLat(y + py / extent, z)],
    });
  }
  return out;
}

/**
 * Burns the polygons of `layer` that `keep(props)` accepts onto a grid mask,
 * even-odd, each tile filling only its own extent so tile buffers never
 * double up.
 */
export function burnPolygons(grid, tiles, layer, keep) {
  const mask = new Uint8Array(grid.size);
  for (const tile of tiles) {
    const found = tile.layers.get(layer);
    if (!found) continue;
    const { extent } = found;
    const [west, north] = tile.toLonLat(0, 0, extent);
    const [east, south] = tile.toLonLat(extent, extent, extent);
    const colFrom = Math.max(0, Math.ceil(grid.x(west)));
    const colTo = Math.min(grid.W, Math.ceil(grid.x(east)));
    const rowFrom = Math.max(0, Math.ceil(grid.y(north)));
    const rowTo = Math.min(grid.H, Math.ceil(grid.y(south)));
    if (colFrom >= colTo || rowFrom >= rowTo) continue;
    for (const feature of found.features) {
      if (feature.type !== 3 || !keep(feature.props)) continue;
      const edges = [];
      for (const part of feature.parts) {
        const points = [];
        for (let i = 0; i < part.length; i += 2) {
          const [lon, lat] = tile.toLonLat(part[i], part[i + 1], extent);
          points.push([grid.x(lon), grid.y(lat)]);
        }
        for (let i = 0; i < points.length; i += 1) edges.push([points[i], points[(i + 1) % points.length]]);
      }
      fillEdges(grid, mask, edges, [colFrom, colTo, rowFrom, rowTo]);
    }
  }
  return mask;
}

/** Fills the inside of closed edges (even-odd) within [colFrom, colTo) and [rowFrom, rowTo). */
function fillEdges(grid, mask, edges, [colFrom, colTo, rowFrom, rowTo]) {
  for (let row = rowFrom; row < rowTo; row += 1) {
    const crossings = [];
    for (const [[x0, y0], [x1, y1]] of edges) {
      if ((y0 <= row) !== (y1 <= row)) crossings.push(x0 + ((row - y0) / (y1 - y0)) * (x1 - x0));
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(colFrom, Math.ceil(crossings[k]));
      const to = Math.min(colTo, Math.ceil(crossings[k + 1]));
      for (let col = from; col < to; col += 1) mask[row * grid.W + col] = 1;
    }
  }
}

/** Burns GeoJSON rings of [lon, lat] (a polygon's or several polygons') onto a grid mask, even-odd. */
export function burnRings(grid, rings, mask = new Uint8Array(grid.size)) {
  const edges = [];
  for (const ring of rings) {
    const points = ring.map(([lon, lat]) => [grid.x(lon), grid.y(lat)]);
    for (let i = 0; i < points.length; i += 1) edges.push([points[i], points[(i + 1) % points.length]]);
  }
  fillEdges(grid, mask, edges, [0, grid.W, 0, grid.H]);
  return mask;
}

/** The line features of `layer` that `keep(props)` accepts, as {props, coords: [[lon, lat], ...]}. */
export function lines(tiles, layer, keep) {
  const out = [];
  for (const tile of tiles) {
    const found = tile.layers.get(layer);
    if (!found) continue;
    for (const feature of found.features) {
      if (feature.type !== 2 || !keep(feature.props)) continue;
      for (const part of feature.parts) {
        const coords = [];
        for (let i = 0; i < part.length; i += 2) coords.push(tile.toLonLat(part[i], part[i + 1], found.extent));
        out.push({ props: feature.props, coords });
      }
    }
  }
  return out;
}

/** The point features of `layer` that `keep(props)` accepts, as {props, coords: [lon, lat]}. */
export function points(tiles, layer, keep) {
  const out = [];
  for (const tile of tiles) {
    const found = tile.layers.get(layer);
    if (!found) continue;
    for (const feature of found.features) {
      if (feature.type !== 1 || !keep(feature.props)) continue;
      for (const part of feature.parts) out.push({ props: feature.props, coords: tile.toLonLat(part[0], part[1], found.extent) });
    }
  }
  return out;
}

/** Marks every cell a set of lines passes through. */
export function burnLines(grid, features, mask = new Uint8Array(grid.size)) {
  for (const { coords } of features) {
    for (let i = 0; i + 1 < coords.length; i += 1) {
      const [x0, y0] = [grid.x(coords[i][0]), grid.y(coords[i][1])];
      const [x1, y1] = [grid.x(coords[i + 1][0]), grid.y(coords[i + 1][1])];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3));
      for (let s = 0; s <= steps; s += 1) {
        const col = Math.round(x0 + ((x1 - x0) * s) / steps);
        const row = Math.round(y0 + ((y1 - y0) * s) / steps);
        if (col >= 0 && row >= 0 && col < grid.W && row < grid.H) mask[row * grid.W + col] = 1;
      }
    }
  }
  return mask;
}

/** The nearest point to `at` on any of the lines, with its distance in metres. */
export function nearestOnLines(features, [lon, lat]) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110574;
  let best = null;
  for (const { coords, props } of features) {
    for (let i = 0; i + 1 < coords.length; i += 1) {
      const ax = (coords[i][0] - lon) * kx;
      const ay = (coords[i][1] - lat) * ky;
      const bx = (coords[i + 1][0] - lon) * kx;
      const by = (coords[i + 1][1] - lat) * ky;
      const dx = bx - ax;
      const dy = by - ay;
      const length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (!best || d < best.distance) {
        best = { distance: d, props, coords: [lon + (ax + t * dx) / kx, lat + (ay + t * dy) / ky] };
      }
    }
  }
  return best;
}

/** The crossing of two sets of lines nearest to `near`, or null when they never cross. */
export function crossing(one, two, [lon, lat]) {
  let best = null;
  for (const a of one) for (const b of two) {
    for (let i = 0; i + 1 < a.coords.length; i += 1) for (let j = 0; j + 1 < b.coords.length; j += 1) {
      const [[x1, y1], [x2, y2]] = [a.coords[i], a.coords[i + 1]];
      const [[x3, y3], [x4, y4]] = [b.coords[j], b.coords[j + 1]];
      const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (d === 0) continue;
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
      const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const point = [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
      const far = Math.hypot(point[0] - lon, point[1] - lat);
      if (!best || far < best.far) best = { far, coords: point };
    }
  }
  return best?.coords ?? null;
}
