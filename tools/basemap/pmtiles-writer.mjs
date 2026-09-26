// A PMTiles v3 writer: tiles are stored as given (JPEG or PNG, or vector
// tiles the caller has already compressed and names with tileCompression),
// directories and metadata are gzip-compressed, and a root directory larger
// than the spec's first 16 KiB is split into leaves.
// Specification: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export const TILE_TYPE = { mvt: 1, png: 2, jpeg: 3, webp: 4 };
export const COMPRESSION = { none: 1, gzip: 2 };
const GZIP = COMPRESSION.gzip;
const HEADER_BYTES = 127;
const ROOT_LIMIT = 16384 - HEADER_BYTES;

function rotate(n, xy, rx, ry) {
  if (ry === 0) {
    if (rx === 1) {
      xy[0] = n - 1 - xy[0];
      xy[1] = n - 1 - xy[1];
    }
    [xy[0], xy[1]] = [xy[1], xy[0]];
  }
}

/** The Hilbert tile id the spec numbers z/x/y with. */
export function zxyToTileId(z, x, y) {
  let acc = 0;
  for (let t = 0; t < z; t += 1) acc += 4 ** t;
  const n = 2 ** z;
  const xy = [x, y];
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (xy[0] & s) > 0 ? 1 : 0;
    const ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    rotate(s, xy, rx, ry);
  }
  return acc + d;
}

function varints(values) {
  const bytes = [];
  for (let value of values) {
    while (value >= 0x80) {
      bytes.push((value % 0x80) | 0x80);
      value = Math.floor(value / 0x80);
    }
    bytes.push(value);
  }
  return Buffer.from(bytes);
}

function directory(entries) {
  const ids = [];
  let previous = 0;
  for (const entry of entries) {
    ids.push(entry.tileId - previous);
    previous = entry.tileId;
  }
  const offsets = entries.map((entry, i) => {
    const before = entries[i - 1];
    return before && entry.offset === before.offset + before.length ? 0 : entry.offset + 1;
  });
  return gzipSync(varints([entries.length, ...ids, ...entries.map((e) => e.runLength), ...entries.map((e) => e.length), ...offsets]));
}

/**
 * Build an archive from tiles: [{ z, x, y, data }]. Identical tiles are
 * stored once. Returns the archive bytes.
 */
export function writePmtiles(tiles, { tileType, bounds, metadata, tileCompression = COMPRESSION.none }) {
  const sorted = tiles.map((tile) => ({ ...tile, tileId: zxyToTileId(tile.z, tile.x, tile.y) }))
    .sort((a, b) => a.tileId - b.tileId);
  const seen = new Map();
  const chunks = [];
  let dataLength = 0;
  const entries = [];
  for (const tile of sorted) {
    const key = createHash("sha1").update(tile.data).digest("base64");
    let stored = seen.get(key);
    if (!stored) {
      stored = { offset: dataLength, length: tile.data.length };
      seen.set(key, stored);
      chunks.push(tile.data);
      dataLength += tile.data.length;
    }
    const last = entries.at(-1);
    if (last && last.offset === stored.offset && last.tileId + last.runLength === tile.tileId) last.runLength += 1;
    else entries.push({ tileId: tile.tileId, offset: stored.offset, length: stored.length, runLength: 1 });
  }

  let root = directory(entries);
  let leaves = Buffer.alloc(0);
  for (let size = 4096; root.length > ROOT_LIMIT; size *= 2) {
    const leafEntries = [];
    const leafBuffers = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += size) {
      const leaf = directory(entries.slice(i, i + size));
      leafEntries.push({ tileId: entries[i].tileId, offset, length: leaf.length, runLength: 0 });
      leafBuffers.push(leaf);
      offset += leaf.length;
    }
    root = directory(leafEntries);
    leaves = Buffer.concat(leafBuffers);
  }

  const meta = gzipSync(Buffer.from(JSON.stringify(metadata)));
  // Tile ids grow with zoom, so the first and last tiles hold the zoom range.
  const [minZoom, maxZoom] = [sorted[0].z, sorted.at(-1).z];
  const header = Buffer.alloc(HEADER_BYTES);
  header.write("PMTiles", 0, "latin1");
  header[7] = 3;
  const rootOffset = HEADER_BYTES;
  const metaOffset = rootOffset + root.length;
  const leafOffset = metaOffset + meta.length;
  const dataOffset = leafOffset + leaves.length;
  const u64 = (value, at) => header.writeBigUInt64LE(BigInt(value), at);
  u64(rootOffset, 8); u64(root.length, 16);
  u64(metaOffset, 24); u64(meta.length, 32);
  u64(leafOffset, 40); u64(leaves.length, 48);
  u64(dataOffset, 56); u64(dataLength, 64);
  u64(sorted.length, 72); u64(entries.length, 80); u64(chunks.length, 88);
  header[96] = 1; // clustered: tile data is in tile id order
  header[97] = GZIP;
  header[98] = tileCompression;
  header[99] = tileType;
  header[100] = minZoom;
  header[101] = maxZoom;
  const [west, south, east, north] = bounds;
  const e7 = (value, at) => header.writeInt32LE(Math.round(value * 1e7), at);
  e7(west, 102); e7(south, 106); e7(east, 110); e7(north, 114);
  header[118] = Math.round((minZoom + maxZoom) / 2);
  e7((west + east) / 2, 119); e7((south + north) / 2, 123);
  return Buffer.concat([header, root, meta, leaves, ...chunks]);
}
