import { describe, expect, it } from "vitest";
import { PMTiles } from "../../web/node_modules/pmtiles/dist/esm/index.js";
import {
  aiannhClass, areaKm2, asBoundary, inCalifornia, joinRows, labelFeatures, labelPoint, nriProperties, referenceArchive, shapePolygons,
  sviProperties, toFeatures,
} from "./build-reference-layers.mjs";
import { boundaryContains, decodeTile, readBoundaries } from "./build-gazetteer.mjs";

// Runs under the workspace vitest, on small fixtures; nothing here uses the network.

const counties = readBoundaries(new URL("../../web/public/basemap/ca_counties.geojson", import.meta.url));
/** A box ring, clockwise (a shapefile outer ring) unless reversed. */
const box = (w, s, e, n) => [[w, s], [w, n], [e, n], [e, s], [w, s]];
const reversed = (ring) => [...ring].reverse();

function source(bytes) {
  return {
    getKey: () => "memory",
    getBytes: async (offset, length) => ({ data: bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length) }),
  };
}

describe("polygons", () => {
  it("nests shapefile holes in the smallest outer ring that holds them, and labels inside the shape", () => {
    const polygons = shapePolygons([box(0, 0, 10, 10), reversed(box(2, 2, 4, 4)), box(2.5, 2.5, 3.5, 3.5), box(20, 0, 21, 1)]);
    expect(polygons).toHaveLength(3);
    expect(polygons.find((p) => p.length === 2)[0]).toEqual(box(0, 0, 10, 10));
    expect(polygons.filter((p) => p.length === 1)).toHaveLength(2);

    // A U whose box center falls in its notch.
    const u = [[[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]]];
    expect(boundaryContains(asBoundary([u]), ...labelPoint([u]))).toBe(true);
    // A hole is not a place for a label.
    const ring = [box(0, 0, 10, 10), reversed(box(1, 1, 9, 9))];
    expect(boundaryContains(asBoundary([ring]), ...labelPoint([ring]))).toBe(true);
    expect(areaKm2([[box(0, 0, 0.1, 0.1)]])).toBeCloseTo(123.9, 0);
  });

  it("keeps the parts of a tribal area in California, whole where they cross the line", () => {
    const delNorte = [box(-124.1, 41.8, -124.0, 41.9)];
    const oregon = [box(-124.1, 42.2, -124.0, 42.3)];
    const across = [box(-124.1, 41.9, -124.0, 42.1)];
    expect(inCalifornia([delNorte, oregon], counties)).toEqual({ polygons: [delNorte], counties: ["Del Norte"] });
    expect(inCalifornia([across], counties)).toEqual({ polygons: [across], counties: ["Del Norte"] });
    expect(inCalifornia([oregon], counties)).toBeNull();
  });

  it("classes Census AIANNH areas as Esri does", () => {
    const classes = [["D2", "86"], ["D8", "85"], ["D5", "OT"], ["D3", "89"], ["D0", "83"], ["D4", "86"], ["D6", "88"], ["D6", "80"], ["D9", "92"], ["E1", "79"], ["F1", "78"]]
      .map(([CLASSFP, LSAD]) => aiannhClass({ CLASSFP, LSAD }));
    expect(classes).toEqual(["federal", "federal", "federal", "federal", "joint_use", "state", "otsa", "tdsa", "sdtsa", "anvsa", "hhl"]);
  });
});

describe("risk tables", () => {
  const tracts = ["06023000100", "06023000200"].map((geoid) => ({ properties: { geoid, name: "Census Tract", county: "Humboldt" }, polygons: [[box(-124.2, 40.7, -124.1, 40.8)]] }));

  it("joins the Risk Index and SVI to tracts by GEOID, rounding the score and leaving out blanks and -999", () => {
    const nri = joinRows(tracts, [{ TRACTFIPS: "06023000100", RISK_SCORE: "96.755725", RISK_RATNG: "Very High", TSUN_RISKR: "Relatively High", ERQK_RISKR: "" }], "TRACTFIPS", nriProperties);
    expect(nri).toMatchObject({ missing: 1, unused: 0 });
    expect(nri.joined[0].properties).toEqual({ geoid: "06023000100", name: "Census Tract", county: "Humboldt", RISK_SCORE: 96.76, RISK_RATNG: "Very High", TSUN_RISKR: "Relatively High" });
    // CDC writes tract FIPS without the leading zero.
    const svi = joinRows(tracts, [{ FIPS: "6023000200", RPL_THEMES: "0.8269", RPL_THEME1: "-999", RPL_THEME4: "0.9927" }, { FIPS: "6001400100", RPL_THEMES: "0.1" }], "FIPS", sviProperties);
    expect(svi).toMatchObject({ missing: 1, unused: 1 });
    expect(svi.joined[0].properties).toMatchObject({ geoid: "06023000200", RPL_THEMES: 0.8269, RPL_THEME4: 0.9927 });
    expect(svi.joined[0].properties.RPL_THEME1).toBeUndefined();
  });
});

describe("the archive", () => {
  const areas = [
    { properties: { geoid: "0623042", name: "Eureka", namelsad: "Eureka city", kind: "city" }, polygons: [[box(-124.2, 40.75, -124.1, 40.85)]] },
    { properties: { geoid: "0600001", name: "Tiny", namelsad: "Tiny CDP", kind: "cdp" }, polygons: [[box(-124.0, 40.8, -123.9995, 40.8005)]] },
  ];

  it("writes gzip MVT the web app's reader opens, dropping shapes too small for a zoom but keeping their labels", async () => {
    const { bytes, bounds } = referenceArchive({
      places: { features: toFeatures(areas), zooms: [4, 12], fields: { name: "String" } },
      labels: { features: labelFeatures({ places: areas }), zooms: [4, 12], fields: { name: "String" } },
    }, { name: "test", description: "test", attribution: "test" });
    expect(bounds).toEqual([-124.2, 40.75, -123.9995, 40.85]);
    const archive = new PMTiles(source(bytes));
    expect(await archive.getHeader()).toMatchObject({ tileType: 1, tileCompression: 2, minZoom: 4, maxZoom: 12 });
    expect((await archive.getMetadata()).vector_layers.map((l) => [l.id, l.minzoom, l.maxzoom])).toEqual([["places", 4, 12], ["labels", 4, 12]]);

    const tileOf = (z, lon, lat) => {
      const n = 2 ** z;
      const sin = Math.sin((lat * Math.PI) / 180);
      return [z, Math.floor(((lon + 180) / 360) * n), Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n)];
    };
    const layers = async (z) => decodeTile(Buffer.from((await archive.getZxy(...tileOf(z, -124.0, 40.8))).data), new Set(["places", "labels"]));
    const names = (layer) => layer.features.map((f) => f.props.name).sort();
    const wide = await layers(4);
    expect(names(wide.get("places"))).toEqual(["Eureka"]);
    expect(names(wide.get("labels"))).toEqual(["Eureka", "Tiny"]);
    expect(wide.get("labels").features.find((f) => f.props.name === "Tiny").props).toMatchObject({ layer: "places", id: "0600001", kind: "cdp" });
    expect(names((await layers(12)).get("places"))).toContain("Tiny");
  });
});
