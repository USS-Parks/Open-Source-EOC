import { describe, expect, it } from "vitest";
import { toMgrs, toUsng } from "../mgrs.js";

/**
 * Reference positions are the centers of 1 m grid cells, projected back to
 * WGS84 by PROJ (PostGIS ST_Transform from the UTM EPSG zone), so a correct
 * forward conversion must land in exactly that cell. The first two are
 * published examples: the USNG standard's Washington Monument and the NGA
 * MGRS format example 4QFJ1234567890.
 */
const REFERENCES: readonly [string, number, number, string][] = [
  ["Washington Monument", -77.0351913258, 38.8895042212, "18SUJ2348706483"],
  ["NGA format example, Oahu", -157.9160763175, 21.4098011578, "4QFJ1234567890"],
  ["Sydney, southern hemisphere", 151.2140283575, -33.8586594875, "56HLH3478652080"],
  ["Norway zone 32 exception", 4.9999920517, 60.0000024344, "32VKM7697958157"],
  ["Svalbard zone 33 exception", 20.000000029, 78.0000026844, "33XXG1591463320"],
];

describe("MGRS and USNG grid references", () => {
  it.each(REFERENCES)("%s", (_name, lng, lat, mgrs) => {
    expect(toMgrs(lng, lat)).toBe(mgrs);
  });

  it("writes USNG as the same reference with spaces", () => {
    expect(toUsng(-77.0351913258, 38.8895042212)).toBe("18S UJ 23487 06483");
    expect(toUsng(-157.9160763175, 21.4098011578)).toBe("4Q FJ 12345 67890");
  });

  it("wraps longitude and has no reference in the polar areas", () => {
    expect(toMgrs(-77.0351913258 + 360, 38.8895042212)).toBe("18SUJ2348706483");
    expect(toMgrs(0, 84.5)).toBeNull();
    expect(toMgrs(0, -80.5)).toBeNull();
    expect(toMgrs(Number.NaN, 0)).toBeNull();
  });
});
