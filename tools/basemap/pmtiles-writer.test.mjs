import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PMTiles, zxyToTileId as libraryTileId } from "../../web/node_modules/pmtiles/dist/esm/index.js";
import { tilesFor } from "./build-north-coast-rasters.mjs";
import { COMPRESSION, TILE_TYPE, writePmtiles, zxyToTileId } from "./pmtiles-writer.mjs";

/** An in-memory source the pmtiles reader can open. */
function source(bytes) {
  return {
    getKey: () => "memory",
    getBytes: async (offset, length) => ({ data: bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length) }),
  };
}

describe("PMTiles writer", () => {
  it("numbers tiles as the reference library does", () => {
    for (const [z, x, y] of [[0, 0, 0], [3, 5, 2], [12, 635, 1538], [15, 5082, 12309]]) {
      expect(zxyToTileId(z, x, y)).toBe(libraryTileId(z, x, y));
    }
  });

  it("writes an archive the web app's reader opens, with shared tiles stored once and leaf directories when the root is large", async () => {
    const bounds = [-124.42, 40.48, -123.78, 41.16];
    // Enough tiles of uneven sizes that the root directory outgrows the first 16 KiB.
    const tiles = [8, 9, 10, 11, 12, 13, 14, 15, 16].flatMap((z) => tilesFor(bounds, z)).map((tile, index) => ({
      ...tile,
      data: index % 7 === 0 ? Buffer.from("shared ocean tile") : Buffer.from(`tile ${tile.z}/${tile.x}/${tile.y} ${"x".repeat((index * 7919) % 251)}`),
    }));
    const bytes = writePmtiles(tiles, { tileType: TILE_TYPE.png, bounds, metadata: { name: "test" } });
    const archive = new PMTiles(source(bytes));
    const header = await archive.getHeader();
    expect(header).toMatchObject({ minZoom: 8, maxZoom: 16, tileType: TILE_TYPE.png, numAddressedTiles: tiles.length });
    expect(header.numTileContents).toBeLessThan(tiles.length);
    expect(header.leafDirectoryLength).toBeGreaterThan(0);
    expect(await archive.getMetadata()).toEqual({ name: "test" });
    for (const tile of [tiles[0], tiles[7], tiles[1234], tiles.at(-1)]) {
      const found = await archive.getZxy(tile.z, tile.x, tile.y);
      expect(Buffer.from(found.data).toString()).toBe(tile.data.toString());
    }
    expect(await archive.getZxy(16, 0, 0)).toBeUndefined();
  });

  it("names vector tiles and their gzip compression in the header, so the reader inflates them", async () => {
    const bytes = writePmtiles([{ z: 12, x: 655, y: 1540, data: gzipSync(Buffer.from("vector tile")) }],
      { tileType: TILE_TYPE.mvt, tileCompression: COMPRESSION.gzip, bounds: [-124.3, 40.6, -124.0, 40.9], metadata: { vector_layers: [] } });
    const archive = new PMTiles(source(bytes));
    expect(await archive.getHeader()).toMatchObject({ tileType: 1, tileCompression: 2, minZoom: 12, maxZoom: 12 });
    expect(Buffer.from((await archive.getZxy(12, 655, 1540)).data).toString()).toBe("vector tile");
  });
});
