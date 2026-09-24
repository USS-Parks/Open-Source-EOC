import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Gazetteer } from "../../server/src/geocode/gazetteer.ts";
import { GAZETTEER_HEADER } from "../../server/src/geocode/normalize.ts";
import {
  archiveTiles, createGazetteerBuilder, decodeTile, lonLat, readAddressPoints, tileIdToZxy,
} from "./build-gazetteer.mjs";

// Runs under the workspace vitest (not node --test) so the normal CI run covers it.

const BUNDLED = fileURLToPath(new URL("../../web/public/basemap/basemap.pmtiles", import.meta.url));

/** The z/x/y tile holding a point, as a web map numbers tiles. */
function tileOf(z, lon, lat) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
}

const point = (name, props, px, py) => ({ type: 1, props: { name, ...props }, parts: [[px, py]] });
const line = (name, cls, coords) => ({ type: 2, props: { name, class: cls }, parts: [coords] });
const layer = (...features) => ({ extent: 4096, features });

const A = tileOf(14, -124.16, 40.8);
const B = tileOf(14, -122.19, 41.41);

function fixture() {
  const builder = createGazetteerBuilder();
  builder.addTile(14, A.x, A.y, new Map([
    ["place", layer(point("Eureka", { class: "city" }, 2048, 2048))],
    ["transportation_name", layer(
      line("3rd St", "tertiary", [500, 1000, 3500, 1000]),
      line("Eureka Way", "minor", [500, 3000, 1500, 3000]),
      line("Eureka", "minor", [2500, 3000, 3500, 3000]),
      line("Main St", "minor", [500, 3800, 1500, 3800]),
    )],
    ["housenumber", layer(
      { type: 1, props: { housenumber: "816" }, parts: [[2000, 1020]] },
      // No named street within reach: dropped and counted.
      { type: 1, props: { housenumber: "9" }, parts: [[2000, 2000]] },
    )],
    ["poi", layer(point("Humboldt County Courthouse", { class: "town_hall", subclass: "courthouse" }, 2100, 1100))],
  ]));
  builder.addTile(14, B.x, B.y, new Map([
    ["place", layer(point("Weed", { class: "town" }, 1000, 1000))],
    ["mountain_peak", layer(point("Mt Shasta", { class: "peak" }, 3000, 3000))],
    ["transportation_name", layer(line("Main St", "minor", [500, 2000, 1500, 2000]))],
  ]));
  const [countyLon, countyLat] = lonLat(14, A.x, A.y, 4096, 2200, 1004);
  const [replacedLon, replacedLat] = lonLat(14, A.x, A.y, 4096, 2010, 1006);
  builder.addAddressPoints([
    { number: "820", street: "3rd Street", city: "Eureka", lon: countyLon, lat: countyLat },
    { number: "816", street: "3rd St", city: "Eureka", lon: replacedLon, lat: replacedLat },
    { number: "", street: "3rd St", city: "Eureka", lon: countyLon, lat: countyLat },
  ]);
  const { lines, counts } = builder.build();
  const gazetteer = new Gazetteer(Buffer.from(`${GAZETTEER_HEADER}\t2026-09-23T00:00:00Z\n${lines.join("\n")}\n`));
  return { gazetteer, counts, county: [countyLon, countyLat], replaced: [replacedLon, replacedLat] };
}

describe("PMTiles and vector tile reading", () => {
  it("numbers tiles along the Hilbert curve the PMTiles spec uses", () => {
    expect(tileIdToZxy(0)).toEqual({ z: 0, x: 0, y: 0 });
    expect([1, 2, 3, 4].map(tileIdToZxy)).toEqual([
      { z: 1, x: 0, y: 0 }, { z: 1, x: 0, y: 1 }, { z: 1, x: 1, y: 1 }, { z: 1, x: 1, y: 0 },
    ]);
    expect(tileIdToZxy(5)).toEqual({ z: 2, x: 0, y: 0 });
  });

  it("decodes Eureka from the bundled basemap at its true position", () => {
    const want = tileOf(8, -124.16, 40.8);
    const tiles = [...archiveTiles(BUNDLED, 8)].filter((tile) => tile.x === want.x && tile.y === want.y);
    expect(tiles).toHaveLength(1);
    const places = decodeTile(tiles[0].data, new Set(["places"])).get("places");
    const eureka = places.features.find((feature) => feature.props.NAME === "Eureka");
    const [lon, lat] = lonLat(8, want.x, want.y, places.extent, ...eureka.parts[0]);
    // Within the archive's own z8 quantization (about 1 km); a wrong tile is off by a whole degree.
    expect(Math.abs(lon + 124.1475)).toBeLessThan(0.02);
    expect(Math.abs(lat - 40.8022)).toBeLessThan(0.02);
  });
});

describe("gazetteer build and search", () => {
  it("attaches house numbers to the nearest named street and lets county points win", () => {
    const { counts } = fixture();
    expect(counts).toMatchObject({
      places: 2, streets: 5, pois: 2, osmAddresses: 1, unplacedAddresses: 1, countyAddresses: 2, skippedCountyRows: 1,
      addresses: 2,
    });
  });

  it("puts an exact house number on a matching street first", () => {
    const { gazetteer, replaced, county } = fixture();
    const [first] = gazetteer.search("816 3rd st eureka", { limit: 5 });
    expect(first).toMatchObject({ kind: "address", label: "816 3rd St", detail: "Eureka", zoom: 18 });
    expect([first.lon, first.lat]).toEqual(replaced);
    const [countyOnly] = gazetteer.search("820 3rd street", { limit: 5 });
    expect(countyOnly).toMatchObject({ kind: "address", label: "820 3rd St" });
    expect([countyOnly.lon, countyOnly.lat]).toEqual(county);
  });

  it("ranks the city above a street of the same name, and both above a longer name", () => {
    const results = fixture().gazetteer.search("eureka", { limit: 5 });
    expect(results.map((r) => [r.kind, r.label])).toEqual([["place", "Eureka"], ["street", "Eureka"], ["street", "Eureka Way"]]);
  });

  it("orders equal matches nearest first", () => {
    const { gazetteer } = fixture();
    expect(gazetteer.search("main st", { limit: 5, near: [-124.16, 40.8] }).map((r) => r.detail)).toEqual(["Eureka", "Weed"]);
    expect(gazetteer.search("main st", { limit: 5, near: [-122.19, 41.41] }).map((r) => r.detail)).toEqual(["Weed", "Eureka"]);
  });

  it("finds the peak by an abbreviation or a half-typed word", () => {
    const { gazetteer } = fixture();
    for (const query of ["mt sha", "mount sh"]) {
      expect(gazetteer.search(query, { limit: 5 })[0]).toMatchObject({ kind: "poi", label: "Mt Shasta", detail: "peak, Weed" });
    }
  });

  it("returns nothing for an empty or unknown query", () => {
    const { gazetteer } = fixture();
    expect(gazetteer.search("  ,  ", { limit: 5 })).toEqual([]);
    expect(gazetteer.search("zzqx", { limit: 5 })).toEqual([]);
  });

  it("refuses a file that is not a gazetteer", () => {
    expect(() => new Gazetteer(Buffer.from("place\tEureka\n"))).toThrow(/not an OpenEOC gazetteer/);
    expect(() => new Gazetteer(Buffer.from(`${GAZETTEER_HEADER}\nplace\tEureka\n`))).toThrow(/malformed gazetteer line/);
  });
});

describe("county address point files", () => {
  it("reads a CSV by header name, with a byte order mark and quoted fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "gazetteer-"));
    try {
      const path = join(dir, "points.csv");
      const bom = String.fromCharCode(0xfeff);
      writeFileSync(path, `${bom}Lat,Lon,Number,Street,City\r\n40.8,-124.16,816,"3rd St, Unit ""A""",Eureka\r\n`);
      expect(readAddressPoints(path)).toEqual([
        { number: "816", street: '3rd St, Unit "A"', city: "Eureka", lon: "-124.16", lat: "40.8" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
