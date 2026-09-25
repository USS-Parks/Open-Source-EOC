// Builds the North Coast offline raster archives the COP uses as basemaps:
//   north-coast-imagery.pmtiles  USDA NAIP imagery through the USGS National
//                                Map (USGSImageryOnly), JPEG, z8 to z14 over
//                                the region and z15 over the Humboldt Bay area
//   north-coast-terrain.pmtiles  USGS 3DEP elevation (3DEPElevation image
//                                service), Terrarium-encoded PNG, z8 to z13
// Both sources are public domain. The Humboldt Bay area runs from Trinidad to
// Fortuna; the region around it covers whatever an incident map framed on that
// area shows, and reaches north through Del Norte County to the Oregon line and
// east past Willow Creek and Weitchpec for the exercise scenarios there. Tiles
// are fetched once and cached under
// tools/basemap/out/north-coast-cache, so a rerun resumes.
//
//   node tools/basemap/build-north-coast-rasters.mjs [--out web/public/basemap]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, URLSearchParams } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { TILE_TYPE, writePmtiles } from "./pmtiles-writer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const NORTH_COAST_BOUNDS = [-124.42, 40.48, -123.78, 41.16];
export const NORTH_COAST_REGION = [-124.75, 40.3, -123.3, 42.05];
const IMAGERY = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";
const ELEVATION = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
const HALF = 20037508.342789244;

export function tilesFor(bounds, z) {
  const [west, south, east, north] = bounds;
  const n = 2 ** z;
  const x = (lon) => Math.floor(((lon + 180) / 360) * n);
  const y = (lat) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const tiles = [];
  for (let tx = x(west); tx <= x(east); tx += 1) for (let ty = y(north); ty <= y(south); ty += 1) tiles.push({ z, x: tx, y: ty });
  return tiles;
}

/** A tile's Web Mercator extent: west, south, east, north in metres. */
export function mercatorBounds({ z, x, y }) {
  const size = (2 * HALF) / 2 ** z;
  return [-HALF + x * size, HALF - (y + 1) * size, -HALF + (x + 1) * size, HALF - y * size];
}

/** Float32 samples of an uncompressed, single-band TIFF, striped or tiled; missing tiles read as zero. */
export function readFloatTiff(buffer) {
  const little = buffer.toString("latin1", 0, 2) === "II";
  const u16 = (at) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
  const u32 = (at) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
  const ifd = u32(4);
  const tags = new Map();
  const wanted = new Set([256, 257, 259, 273, 279, 322, 323, 324, 325]);
  for (let i = 0; i < u16(ifd); i += 1) {
    const at = ifd + 2 + i * 12;
    const [tag, type, count] = [u16(at), u16(at + 2), u32(at + 4)];
    if (!wanted.has(tag)) continue;
    const size = type === 3 ? 2 : 4;
    const base = count * size > 4 ? u32(at + 8) : at + 8;
    tags.set(tag, Array.from({ length: count }, (_, k) => (size === 2 ? u16(base + k * 2) : u32(base + k * 4))));
  }
  const [width] = tags.get(256);
  const [height] = tags.get(257);
  if ((tags.get(259)?.[0] ?? 1) !== 1) throw new Error("compressed TIFF");
  const samples = new Float32Array(width * height);
  const float = (at) => (little ? buffer.readFloatLE(at) : buffer.readFloatBE(at));
  if (tags.has(324)) {
    const [tileWidth] = tags.get(322);
    const [tileHeight] = tags.get(323);
    const across = Math.ceil(width / tileWidth);
    const sizes = tags.get(325);
    tags.get(324).forEach((offset, tile) => {
      // A tile with no data (all NoData, open water) is written empty; it stays sea level.
      if (sizes[tile] < tileWidth * tileHeight * 4 || offset + sizes[tile] > buffer.length) return;
      const [left, top] = [(tile % across) * tileWidth, Math.floor(tile / across) * tileHeight];
      for (let row = 0; row < tileHeight && top + row < height; row += 1) {
        for (let col = 0; col < tileWidth && left + col < width; col += 1) {
          samples[(top + row) * width + left + col] = float(offset + (row * tileWidth + col) * 4);
        }
      }
    });
    return { width, height, samples };
  }
  let index = 0;
  const counts = tags.get(279);
  tags.get(273).forEach((offset, strip) => {
    for (let at = offset; at < offset + counts[strip] && index < samples.length; at += 4) samples[index++] = float(at);
  });
  return { width, height, samples };
}

/** Elevation in metres as a Terrarium RGB PNG; missing or nonsense values are sea level. */
export function terrariumPng(width, height, samples) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (width * 3 + 1)] = 0;
    for (let col = 0; col < width; col += 1) {
      const elevation = samples[row * width + col];
      const v = (Number.isFinite(elevation) && elevation > -500 && elevation < 9000 ? elevation : 0) + 32768;
      const at = row * (width * 3 + 1) + 1 + col * 3;
      raw[at] = Math.floor(v / 256);
      raw[at + 1] = Math.floor(v) % 256;
      raw[at + 2] = Math.floor((v - Math.floor(v)) * 256);
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The response body, or null where the service has no tile (open ocean has no imagery). */
async function fetchWithRetry(url, accept) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "OpenSourceEOC-basemap-builder" } });
      if (response.status === 404) return null;
      const type = response.headers.get("content-type") ?? "";
      if (response.ok && accept.test(type)) return Buffer.from(await response.arrayBuffer());
      throw new Error(`${response.status} ${type}`);
    } catch (error) {
      if (attempt >= 5) throw new Error(`${url}: ${error.message}`, { cause: error });
      await new Promise((done) => setTimeout(done, 1000 * attempt));
    }
  }
}

async function collect(name, tiles, fetchTile, cache) {
  mkdirSync(cache, { recursive: true });
  const out = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < tiles.length) {
      const tile = tiles[next++];
      const file = join(cache, `${tile.z}-${tile.x}-${tile.y}`);
      const data = existsSync(file) ? readFileSync(file) : await fetchTile(tile) ?? Buffer.alloc(0);
      if (!existsSync(file)) writeFileSync(file, data);
      // An empty cache entry records a tile the service does not have.
      if (data.length > 0) out.push({ ...tile, data });
      done += 1;
      if (done % 250 === 0) console.log(`${name}: ${done} of ${tiles.length}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

async function main() {
  const outArg = process.argv.indexOf("--out");
  const outDir = resolve(outArg > 0 ? process.argv[outArg + 1] : join(HERE, "..", "..", "web", "public", "basemap"));
  const cache = join(HERE, "out", "north-coast-cache");
  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  const imageryTiles = [
    ...range(8, 14).flatMap((z) => tilesFor(NORTH_COAST_REGION, z)),
    ...tilesFor(NORTH_COAST_BOUNDS, 15),
  ];
  const imagery = await collect("imagery", imageryTiles, (tile) =>
    fetchWithRetry(IMAGERY.replace("{z}", tile.z).replace("{y}", tile.y).replace("{x}", tile.x), /^image\//), join(cache, "imagery"));
  writeFileSync(join(outDir, "north-coast-imagery.pmtiles"), writePmtiles(imagery, {
    tileType: TILE_TYPE.jpeg,
    bounds: NORTH_COAST_REGION,
    metadata: {
      name: "North Coast imagery",
      description: "USDA NAIP imagery of the North Coast, Cape Mendocino to the Oregon line, through the USGS National Map (USGSImageryOnly).",
      attribution: "Imagery: USDA NAIP via USGS The National Map",
      type: "baselayer",
      format: "jpg",
    },
  }));

  const terrainTiles = range(8, 13).flatMap((z) => tilesFor(NORTH_COAST_REGION, z));
  const terrain = await collect("terrain", terrainTiles, async (tile) => {
    const query = new URLSearchParams({
      bbox: mercatorBounds(tile).join(","), bboxSR: "3857", imageSR: "3857", size: "256,256",
      format: "tiff", pixelType: "F32", interpolation: "RSP_BilinearInterpolation", compression: "None", f: "image",
    });
    const tiff = await fetchWithRetry(`${ELEVATION}?${query}`, /tiff/);
    if (!tiff) return null;
    const { width, height, samples } = readFloatTiff(tiff);
    return terrariumPng(width, height, samples);
  }, join(cache, "terrain"));
  writeFileSync(join(outDir, "north-coast-terrain.pmtiles"), writePmtiles(terrain, {
    tileType: TILE_TYPE.png,
    bounds: NORTH_COAST_REGION,
    metadata: {
      name: "North Coast terrain",
      description: "USGS 3DEP elevation of the North Coast, Cape Mendocino to the Oregon line, Terrarium-encoded for hillshade.",
      attribution: "Elevation: USGS 3DEP",
      type: "overlay",
      format: "png",
      encoding: "terrarium",
    },
  }));
  console.log(`wrote ${imagery.length} imagery and ${terrain.length} terrain tiles to ${outDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
