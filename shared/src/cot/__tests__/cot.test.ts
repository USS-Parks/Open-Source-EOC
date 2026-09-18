import { describe, expect, it } from "vitest";
import {
  cotFromXml,
  cotToXml,
  cotToGeoFeature,
  geoRecordToCot,
  type CotEvent,
} from "../cot.js";

/**
 * CoT round-trip and mapping (VEOC-29): a CoT event serializes and parses
 * both ways, an inbound event becomes a COP feature, and a VEOC geo record
 * emits as a CoT event.
 */

const event: CotEvent = {
  uid: "ANDROID-121",
  type: "a-f-G-U-C",
  time: "2026-09-18T00:00:00.000Z",
  start: "2026-09-18T00:00:00.000Z",
  stale: "2026-09-18T01:00:00.000Z",
  how: "m-g",
  point: { lat: 41.29, lon: -123.61, hae: 120, ce: 5, le: 10 },
  callsign: "EAGLE-1",
  remarks: "recon team",
};

describe("CoT XML round-trip", () => {
  it("serializes with attributes and parses back identically", () => {
    const xml = cotToXml(event);
    expect(xml).toContain('uid="ANDROID-121"');
    expect(xml).toContain('<point lat="41.29" lon="-123.61"');
    expect(xml).toContain('callsign="EAGLE-1"');
    expect(cotFromXml(xml)).toEqual(event);
  });

  it("rejects a CoT event with no point", () => {
    expect(() => cotFromXml('<event uid="x"></event>')).toThrow(/point/);
  });
});

describe("gateway mapping both directions", () => {
  it("maps an inbound CoT event to a COP feature (ATAK → COP)", () => {
    const f = cotToGeoFeature(event);
    expect(f.geometry).toEqual({ type: "Point", coordinates: [-123.61, 41.29] });
    expect(f.properties.callsign).toBe("EAGLE-1");
    expect(f.properties._source).toBe("CoT/TAK");
    expect(f.properties.cotType).toBe("a-f-G-U-C");
  });

  it("maps a VEOC geo record to a CoT event (COP → TAK)", () => {
    const cot = geoRecordToCot(
      {
        id: "rec-1",
        geometry: { type: "Point", coordinates: [-123.59, 41.3] },
        properties: { road: "SR-96", remarks: "closure" },
      },
      { time: "2026-09-18T00:00:00.000Z", staleMinutes: 30 },
    );
    expect(cot.uid).toBe("rec-1");
    expect(cot.point).toEqual({ lat: 41.3, lon: -123.59 });
    expect(cot.callsign).toBe("SR-96");
    expect(cot.stale).toBe("2026-09-18T00:30:00.000Z");
    // And it renders to valid CoT XML a TAK server can read.
    expect(cotToXml(cot)).toContain('uid="rec-1"');
  });

  it("refuses to map non-point geometry", () => {
    expect(() =>
      geoRecordToCot(
        { id: "x", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: {} },
        { time: "2026-09-18T00:00:00.000Z" },
      ),
    ).toThrow(/point/);
  });
});
