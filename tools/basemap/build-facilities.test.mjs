import { describe, expect, it } from "vitest";
import { PMTiles } from "../../web/node_modules/pmtiles/dist/esm/index.js";
import {
  SOURCES, addressLocator, californiaCheck, clusters, csvRows, dedupe, facility, facilityArchive, fromCmsDialysis, fromCmsNursingHomes, fromEia860, fromEpaFrs,
  fromFccAsr, fromNbi, fromUsgs, nbiDegrees, osmType, sameName, sheetObjects,
} from "./build-facilities.mjs";
import { decodeTile, readBoundaries } from "./build-gazetteer.mjs";

// Runs under the workspace vitest, on small fixtures; nothing here uses the network.

const ORDER = SOURCES.map((source) => source.id);
const state = readBoundaries(new URL("../../web/public/basemap/ca_state.geojson", import.meta.url))[0];
const counties = readBoundaries(new URL("../../web/public/basemap/ca_counties.geojson", import.meta.url));

function source(bytes) {
  return {
    getKey: () => "memory",
    getBytes: async (offset, length) => ({ data: bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length) }),
  };
}

describe("normalizing sources", () => {
  it("reads USGS structures, NBI coordinates and CSV quoting", async () => {
    const [hospital] = fromUsgs(49, [{ geometry: { type: "Point", coordinates: [-124.16, 40.78] },
      properties: { name: "St. Joseph Hospital", permanent_identifier: "abc", address: "2700 Dolbeer Street", city: "Eureka", state: "CA" } }]);
    expect(hospital).toMatchObject({ type: "hospital", lifeline: "health_medical", sector: "Healthcare and Public Health",
      source: "usgs_nsd", source_id: "abc", subtype: "Hospital/Medical Center", lon: -124.16, lat: 40.78 });

    expect(nbiDegrees("40454199", 2)).toBeCloseTo(40 + 45 / 60 + 41.99 / 3600, 9);
    expect(nbiDegrees("0", 2)).toBeNaN();
    const rows = await csvRows(["STATE_CODE_001,RECORD_TYPE_005A,STRUCTURE_NUMBER_008,FACILITY_CARRIED_007,FEATURES_DESC_006A,LAT_016,LONG_017,OWNER_022,ADT_029",
      "06,1,'  04 0001','Route 101','Eel River, South Fork',40454199,123471200,01,4500", "06,2,'  04 0001','x','y',0,0,01,0"], { quote: "'" });
    const bridges = fromNbi(rows);
    expect(bridges).toHaveLength(1);
    expect(bridges[0]).toMatchObject({ type: "bridge", name: "Route 101 over Eel River, South Fork", operator: "State Highway Agency", capacity: 4500 });
    expect(bridges[0].lon).toBeCloseTo(-(123 + 47 / 60 + 12 / 3600), 9);

    // A quoted field may run over lines, with the quote doubled inside it.
    const [row] = await csvRows(['"a","b"', '"one ""1""', 'two",3']);
    expect(row).toEqual({ a: 'one "1"\ntwo', b: "3" });
  });

  it("keeps constructed current antenna structures and reads EPA interests and EIA capacity", () => {
    const ra = [
      ["RA", "REG", "A1", "1001", "501", "", "", "", "C", "", "", "", "", "", "", "C", "", "", "", "", "", "", "", "RIDGE SITE", "EUREKA", "CA", "06023", "", "", "", "45.7", "", "MTOWER"],
      ["RA", "REG", "A2", "1002", "502", "", "", "", "T", "", "", "", "", "", "", "C", "", "", "", "", "", "", "", "OLD", "EUREKA", "CA", "06023", "", "", "", "30", "", "TOWER"],
      ["RA", "REG", "A3", "1003", "503", "", "", "", "C", "", "", "", "", "", "", "C", "", "", "", "", "", "", "", "ROOF", "EUREKA", "CA", "06023", "", "", "", "10", "", "BANT"],
    ];
    const co = ["1001", "1002", "1003"].map((reg) => ["CO", "REG", "", reg, "", "T", "40", "46", "30.0", "N", "", "124", "9", "0.0", "W"]);
    const en = [["EN", "REG", "", "", "501", "O", "", "", "", "Tower Co", "", "", "", "", "7075550100"]];
    const towers = fromFccAsr(ra, co, en);
    expect(towers).toHaveLength(1);
    expect(towers[0]).toMatchObject({ type: "comms_tower", source_id: "1001", operator: "Tower Co", phone: "(707) 555-0100", lat: 40.775, lon: -124.15 });

    const frs = fromEpaFrs([{ INTEREST_TYPES: "ICIS-NPDES MAJOR, LQG, POTW", LATITUDE83: "40.768", LONGITUDE83: "-124.196",
      PRIMARY_NAME: "EUREKA WWTP", REGISTRY_ID: "110", COUNTY_NAME: "HUMBOLDT COUNTY", STATE_CODE: "CA" }]);
    expect(frs.map((r) => [r.type, r.subtype, r.county])).toEqual([
      ["wastewater_treatment", "Publicly owned treatment works", "HUMBOLDT"],
      ["hazmat_site", "RCRA hazardous waste large quantity generator", "HUMBOLDT"],
    ]);

    const plants = sheetObjects([["title"], ["Plant Code", "Plant Name", "State", "Latitude", "Longitude"], ["7", "Humboldt Bay", "CA", "40.74", "-124.21"], ["8", "Elsewhere", "OR", "44", "-120"]], "Plant Code");
    const generators = [{ "Plant Code": "7", "Nameplate Capacity (MW)": "100", Technology: "Gas" }, { "Plant Code": "7", "Nameplate Capacity (MW)": "63.3", Technology: "Wind" }];
    expect(fromEia860(plants, generators)).toEqual([expect.objectContaining({ type: "power_plant", source_id: "7", capacity: 163.3, capacity_unit: "MW nameplate", subtype: "Gas" })]);
  });

  it("places dialysis addresses along TIGER address ranges, and types OpenStreetMap points", () => {
    const edge = (FULLNAME, from, to, zip, line) => ({ parts: [line], properties: { FULLNAME, LFROMHN: String(from), LTOHN: String(to),
      RFROMHN: String(from + 1), RTOHN: String(to + 1), ZIPL: zip, ZIPR: zip, PARITYL: "E", PARITYR: "O" } });
    const locate = addressLocator([
      edge("E Washington Blvd", 700, 798, "95531", [[-124.19, 41.76], [-124.18, 41.76]]),
      // The same street name in another town of the county, outside the address's ZIP code.
      edge("E Washington Blvd", 700, 798, "95567", [[-124.0, 41.9], [-123.99, 41.9]]),
      edge("Main St", 100, 198, "95501", [[-124.2, 40.8], [-124.19, 40.8]]),
      edge("Main St", 100, 198, "95540", [[-124.1, 40.6], [-124.09, 40.6]]),
    ]);
    const rows = [
      { State: "CA", "Facility Name": "Crescent City Dialysis", "Address Line 1": "780 EAST WASHINGTON BLVD, BUILDING B", "ZIP Code": "95531", "County/Parish": "Del Norte", "# of Dialysis Stations": "9" },
      { State: "CA", "Facility Name": "Odd side", "Address Line 1": "Suite 2, 781 E. Washington Boulevard", "ZIP Code": "95531", "County/Parish": "Del Norte" },
      { State: "CA", "Facility Name": "Ambiguous", "Address Line 1": "150 Main Street", "ZIP Code": "95599", "County/Parish": "Humboldt" },
      { State: "CA", "Facility Name": "Past the range", "Address Line 1": "900 E Washington Blvd", "ZIP Code": "95531", "County/Parish": "Del Norte" },
      { State: "NV", "Facility Name": "Reno", "Address Line 1": "701 E Washington Blvd", "ZIP Code": "95531", "County/Parish": "Washoe" },
    ];
    const counties = [];
    const placed = fromCmsDialysis(rows, (address, county) => {
      counties.push(county);
      return locate(address);
    });
    expect(counties).toEqual(["Del Norte", "Del Norte", "Humboldt", "Del Norte"]);
    expect(placed.map((r) => r.name)).toEqual(["Crescent City Dialysis", "Odd side"]);
    expect(placed[0]).toMatchObject({ type: "dialysis", capacity: 9, capacity_unit: "dialysis stations", lat: 41.76 });
    expect(placed[0].lon).toBeCloseTo(-124.19 + 0.01 * (80 / 98), 6);

    // A nursing home moves to its address only when that agrees with the rounded CMS point.
    const homes = fromCmsNursingHomes([
      { State: "CA", "Provider Name": "Near", "Provider Address": "790 E Washington Blvd", "ZIP Code": "95531", "County/Parish": "Del Norte", Latitude: "41.7612", Longitude: "-124.18" },
      { State: "CA", "Provider Name": "Far", "Provider Address": "790 E Washington Blvd", "ZIP Code": "95531", "County/Parish": "Del Norte", Latitude: "41.9", Longitude: "-124.1" },
    ], (address) => locate(address));
    expect(homes[0].lon).toBeCloseTo(-124.19 + 0.01 * (90 / 98), 6);
    expect(homes[1]).toMatchObject({ lon: -124.1, lat: 41.9 });

    expect(osmType({ subclass: "clinic", name: "Redwood Urgent Care" })).toBe("urgent_care");
    expect(osmType({ subclass: "clinic", name: "Open Door Clinic" })).toBeUndefined();
    expect(osmType({ subclass: "office", name: "Humboldt County Emergency Operations Center" })).toBe("eoc");
    expect(osmType({ subclass: "pharmacy" })).toBe("pharmacy");
    expect(osmType({ subclass: "university", name: "Cal Poly Humboldt" })).toBe("college");
  });

  it("keeps California facilities, names their county, and lets a shoreline point past the outline in", () => {
    const check = californiaCheck(state, counties);
    const eureka = facility("hospital", "usgs_nsd", { lon: -124.16, lat: 40.78, state: "CA" });
    expect(check(eureka)).toBeNull();
    expect(eureka).toMatchObject({ county: "Humboldt" });
    expect(eureka.state).toBeUndefined();
    // Samoa sits on the spit outside the generalized outline.
    const samoa = facility("fire_station", "osm", { lon: -124.2256, lat: 40.8194 });
    expect(check(samoa)).toBeNull();
    expect(samoa.county).toBe("Humboldt");
    expect(check(facility("fire_station", "osm", { lon: -119.94, lat: 38.96 }))).toBe("outside California");
    expect(check(facility("hospital", "usgs_nsd", { lon: -119.94, lat: 38.96, state: "NV" }))).toBe("outside California");
    expect(check(facility("hospital", "usgs_nsd", { lon: 0, lat: 0, state: "CA" }))).toBe("no coordinates");
  });
});

describe("duplicates", () => {
  const at = (type, source, lon, lat, name) => facility(type, source, { lon, lat, name });

  it("keeps the federal record, merges OpenStreetMap repeats, and never merges one federal source with itself", () => {
    const records = [
      at("hospital", "osm", -124.1601, 40.7801, "St Joseph Hospital"),
      at("hospital", "usgs_nsd", -124.16, 40.78, "ST. JOSEPH HOSPITAL"),
      at("fire_station", "osm", -124.1, 40.8, "Station 1"),
      at("fire_station", "osm", -124.106, 40.8, "Station 2"),
      at("fire_station", "osm", -124.108, 40.8, "Station 2"),
      at("comms_tower", "fcc_asr", -124.2, 40.7, "Antenna structure 1"),
      at("comms_tower", "fcc_asr", -124.2003, 40.7, "Antenna structure 2"),
      at("school", "osm", -124.16, 40.78, "St Joseph School"),
    ];
    const { kept, dropped } = dedupe(records, ORDER);
    expect(kept.map((r) => [r.type, r.source, r.name])).toEqual([
      ["hospital", "usgs_nsd", "ST. JOSEPH HOSPITAL"],
      ["comms_tower", "fcc_asr", "Antenna structure 1"],
      ["comms_tower", "fcc_asr", "Antenna structure 2"],
      ["fire_station", "osm", "Station 1"],
      ["fire_station", "osm", "Station 2"],
      ["school", "osm", "St Joseph School"],
    ]);
    expect(dropped).toEqual({ "osm>usgs_nsd": 1, "osm>osm": 1 });
  });

  it("matches names by their words and numbers", () => {
    expect(sameName("Mad River Community Hospital", "MAD RIVER COMMUNITY HOSP")).toBe(true);
    expect(sameName("Providence St. Joseph Hospital", "St Joseph Hospital")).toBe(true);
    expect(sameName("Fire Station 1", "Fire Station 2")).toBe(false);
    expect(sameName("", "Fire Station 2")).toBe(false);
  });
});

describe("clusters and the archive", () => {
  const records = [
    facility("hospital", "usgs_nsd", { lon: -124.16, lat: 40.78, name: "Hospital", county: "Humboldt" }),
    facility("pharmacy", "osm", { lon: -124.161, lat: 40.781, name: "Pharmacy" }),
    facility("fire_station", "usgs_nsd", { lon: -124.162, lat: 40.782, name: "Station" }),
    facility("bridge", "fhwa_nbi", { lon: -122.4, lat: 37.8, name: "Bridge", capacity: 120000, capacity_unit: "vehicles per day" }),
  ];

  it("counts each lifeline in a grid cell and names the most common", () => {
    const [eureka, bay] = clusters(records, 8);
    expect(eureka).toMatchObject({ count: 3, lifeline: "health_medical", health_medical: 2, safety_security: 1, transportation: 0 });
    expect(eureka.lon).toBeCloseTo(-124.161, 6);
    expect(bay).toMatchObject({ count: 1, lifeline: "transportation", transportation: 1 });
    // A fine grid splits what a coarse one groups.
    expect(clusters(records.slice(0, 3), 6)).toHaveLength(1);
  });

  it("writes an archive the web app's reader opens: gzip MVT, clusters to z11, facilities from z12", async () => {
    const { bytes, bounds } = facilityArchive(records, { attribution: "test", description: "test" });
    expect(bounds).toEqual([-124.162, 37.8, -122.4, 40.782]);
    const archive = new PMTiles(source(bytes));
    expect(await archive.getHeader()).toMatchObject({ tileType: 1, tileCompression: 2, minZoom: 6, maxZoom: 14 });
    const metadata = await archive.getMetadata();
    expect(metadata.vector_layers.map((layer) => [layer.id, layer.minzoom, layer.maxzoom])).toEqual([["facility_clusters", 6, 11], ["facilities", 12, 14]]);

    const tileOf = (z, lon, lat) => {
      const n = 2 ** z;
      const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
      return [z, Math.floor(((lon + 180) / 360) * n), y];
    };
    const layerAt = async (z, lon, lat, name) => decodeTile(Buffer.from((await archive.getZxy(...tileOf(z, lon, lat))).data), new Set([name])).get(name);
    for (const record of records) expect((await layerAt(14, record.lon, record.lat, "facilities")).features.map((f) => f.props.type)).toContain(record.type);
    const eureka = await layerAt(14, -124.16, 40.78, "facilities");
    expect(eureka.features.find((f) => f.props.type === "hospital").props).toMatchObject({ lifeline: "health_medical", county: "Humboldt", source: "usgs_nsd" });
    const bay = await layerAt(12, -122.4, 37.8, "facilities");
    expect(bay.features[0].props).toMatchObject({ type: "bridge", capacity: 120000 });
    const cluster = await layerAt(8, -124.16, 40.78, "facility_clusters");
    expect(cluster.features[0].props).toMatchObject({ count: 3, lifeline: "health_medical", health_medical: 2 });
    expect(await archive.getZxy(...tileOf(12, -120, 35))).toBeUndefined();
  });
});
