import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NWS_HAZARD_PALETTE, RIVER_GAUGE_PALETTE, paletteKey } from "@openeoc/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { principalForPerson, type Principal } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { parseFeed, type NormalizedItem } from "../feeds/parse.js";
import { FEED_USER_AGENT, resolveNwsZones } from "../feeds/presets.js";
import { createFeed, feedItems, pollFeed } from "../feeds/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Live feed presets (MP10) on recorded fixtures, written by hand from each
 * source's documented format. No test reaches a live service: every fetch is
 * answered from server/src/feeds/__fixtures__.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "feeds", "__fixtures__");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const recorded = (name: string) => fixture(join("recorded-2026-09-26", name));
const ZONES = JSON.parse(fixture("nws-zones.json")) as {
  features: Array<{ id: string; properties: { id: string }; geometry: { type: string; coordinates: unknown[] } }>;
};
/** How many polygons a zone of the scene's fixture draws as. */
const zoneParts = (id: string) => {
  const geometry = ZONES.features.find((zone) => zone.properties.id === id)!.geometry;
  return geometry.type === "Polygon" ? 1 : geometry.coordinates.length;
};

/** Answers each recorded URL; anything else is a 404, and every request is logged. */
function fixtureFetch(routes: Record<string, string>, log: Array<{ url: string; agent: string | null }> = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    log.push({ url, agent: new Headers(init?.headers).get("user-agent") });
    const zone = ZONES.features.find((feature) => feature.id === url);
    if (zone) return new Response(JSON.stringify(zone), { status: 200 });
    const body = routes[url];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
  }) as never;
}

const byId = (items: readonly NormalizedItem[], id: string) => items.find((item) => item.externalId === id)!;

describe("the preset parsers", () => {
  it("reads NWS alerts, dropping test messages, and keeps zone links for zone-based products", () => {
    const items = parseFeed("nws_alerts", fixture("nws-alerts-ca.json"));
    expect(items.map((item) => item.properties.event)).toEqual([
      "High Surf Warning", "Flash Flood Warning", "Winter Storm Warning", "Red Flag Warning", "Tsunami Advisory",
    ]);
    const surf = items[0]!;
    expect(surf).toMatchObject({ severity: "severe", geometry: null });
    expect(surf.title).toMatch(/^High Surf Warning issued/);
    expect(surf.properties).toMatchObject({ areaDesc: "Coastal Del Norte; Northern Coastal Humboldt", expires: "2026-09-28T04:00:00.000Z" });
    expect(items[1]!.geometry).toMatchObject({ type: "Polygon" });
    expect(() => parseFeed("nws_alerts", JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { id: "x" } }] })))
      .toThrow("NWS alert has no event or id");
  });

  it("draws zone-based alerts from their zones, fetched once, from the feed's origin only", async () => {
    const log: Array<{ url: string; agent: string | null }> = [];
    const feed = "https://api.weather.gov/alerts/active?area=CA";
    const items = await resolveNwsZones(parseFeed("nws_alerts", fixture("nws-alerts-ca.json")), feed, fixtureFetch({}, log));
    const [surf, flash, winter, redFlag, tsunami] = items;
    expect(surf!.geometry).toMatchObject({ type: "MultiPolygon" });
    expect((surf!.geometry!.coordinates as unknown[]).length).toBe(zoneParts("CAZ101") + zoneParts("CAZ103"));
    expect(surf!.properties.zones).toBe("CAZ101, CAZ103");
    expect(surf!.properties).not.toHaveProperty("affectedZones");
    expect(flash!.geometry).toMatchObject({ type: "Polygon" });
    expect(winter!.geometry).toMatchObject({ type: "MultiPolygon" });
    expect(tsunami!.geometry).toMatchObject({ type: "MultiPolygon" });
    // The second zone link points at another host; it is neither fetched nor drawn.
    expect((redFlag!.geometry!.coordinates as unknown[]).length).toBe(zoneParts("CAZ403"));
    expect(redFlag!.properties.zones).toBe("CAZ403");
    expect(log.some((entry) => entry.url.includes("example.invalid"))).toBe(false);
    expect(log.every((entry) => entry.agent === FEED_USER_AGENT)).toBe(true);
    const again: typeof log = [];
    await resolveNwsZones(parseFeed("nws_alerts", fixture("nws-alerts-ca.json")), feed, fixtureFetch({}, again));
    expect(again).toEqual([]);
  });

  it("reads WFIGS perimeters and incidents by fire, type and acres", () => {
    const perimeters = parseFeed("wfigs_perimeters", fixture("wfigs-perimeters.json"));
    expect(byId(perimeters, "2026-CASRF-001234")).toMatchObject({
      title: "Bluff Creek",
      properties: { type: "wildfire", acres: 12480.6, containment: 35, state: "US-CA" },
    });
    expect(byId(perimeters, "2026-CASRF-001301").properties.type).toBe("prescribed");
    const incidents = parseFeed("wfigs_incidents", fixture("wfigs-incidents.json"));
    expect(incidents.map((item) => [item.title, item.properties.type, item.properties.acres])).toEqual([
      ["Bluff Creek", "wildfire", 12480], ["Panther", "wildfire", 452],
      ["South Fork Complex", "wildfire", 64210], ["Redwood Valley Rx", "prescribed", 80],
    ]);
    expect(incidents[0]!.properties.discovered).toMatch(/^2026-09-/);
  });

  it("reads USGS earthquakes with magnitude and depth, in two dimensions", () => {
    const quakes = parseFeed("usgs_earthquakes", fixture("usgs-all-day.json"));
    expect(quakes.map((quake) => quake.properties.mag)).toEqual([1.24, 3.4, 4.8, 6.2, 7.6]);
    expect(byId(quakes, "nc75100004")).toMatchObject({
      title: "M 6.2 - 72 km WNW of Ferndale, CA",
      geometry: { type: "Point", coordinates: [-125.1014, 40.7022] },
      properties: { depthKm: 12, tsunami: true, alert: "yellow", magType: "mw" },
    });
  });

  it("reads ShakeMap contours by intensity", () => {
    const contours = parseFeed("usgs_shakemap", fixture("shakemap-cont-mmi.json"));
    expect(contours.map((contour) => [contour.title, contour.properties.mmi])).toEqual([
      ["MMI III", 3], ["MMI IV", 4], ["MMI IV (4.5)", 4.5], ["MMI V", 5], ["MMI VI", 6], ["MMI VII", 7],
    ]);
    expect(contours[0]!.geometry).toMatchObject({ type: "MultiLineString" });
  });

  it("reads NWPS gauges by observed flood category, skipping a gauge with no location", () => {
    const gauges = parseFeed("nwps_gauges", fixture("nwps-gauges.json"));
    expect(gauges.map((gauge) => [gauge.externalId, gauge.properties.category])).toEqual([
      ["KLMC1", "major"], ["FRNC1", "moderate"], ["BRGC1", "minor"], ["ARCC1", "action"],
      ["FTDC1", "no_flooding"], ["ORIC1", "low_threshold"], ["HOOC1", "not_defined"],
    ]);
    expect(byId(gauges, "KLMC1")).toMatchObject({
      geometry: { type: "Point", coordinates: [-123.9794772, 41.51092575] },
      properties: { stage: 43.2, stageUnit: "ft", flow: 412, forecastCategory: "major", office: "EKA" },
    });
    expect(byId(gauges, "FRNC1").properties.flow).toBeNull();
    expect(byId(gauges, "HOOC1").properties).toMatchObject({ stage: null, observedAt: null, forecastCategory: "fcst_not_current" });
    expect(() => parseFeed("nwps_gauges", fixture("usgs-all-day.json"))).toThrow("not an NWPS gauges document");
  });

  it("reads a utility outage feed's customers out from the fields utilities use", () => {
    const outages = parseFeed("utility_outages", fixture("utility-outages.json"));
    expect(outages.map((outage) => [outage.title, outage.properties.customersOut])).toEqual([
      ["Ferndale", 42], ["Fortuna", 356], ["Arcata", 2140], ["Eureka", 7810], ["Crescent City", 25310], ["Hoopa", 0],
    ]);
    expect(outages[3]!.geometry).toMatchObject({ type: "Polygon" });
  });
});

describe("the preset parsers on the sources' own responses (recorded 2026-09-26)", () => {
  it("keeps every NWS color in the palette equal to the NWS map color table", () => {
    const table = JSON.parse(recorded("nws-map-colors.json")) as { rows: Array<[string, number, string, string]> };
    const official = new Map(table.rows.map(([event, , , hex]) => [event, hex]));
    for (const entry of Object.values(NWS_HAZARD_PALETTE.entries)) expect(entry.light, entry.label).toBe(official.get(entry.label));
  });

  it("reads api.weather.gov alerts and draws one from its zone's own boundary", async () => {
    const alerts = parseFeed("nws_alerts", recorded("nws-alerts-ca.json"));
    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(alert.externalId).toMatch(/^urn:oid:/);
      expect(paletteKey(NWS_HAZARD_PALETTE, alert.properties.event as string), alert.properties.event as string).toBeDefined();
    }
    const [first] = alerts;
    const zoneUrl = (first!.properties.affectedZones as string[])[0]!;
    const [drawn] = await resolveNwsZones([first!], "https://api.weather.gov/alerts/active?area=CA",
      fixtureFetch({ [zoneUrl]: recorded("nws-zone-CAZ103.json") }));
    expect(drawn!.geometry).toMatchObject({ type: "MultiPolygon" });
  });

  it("reads WFIGS perimeters and incidents, and refuses a response the service cut short", () => {
    for (const [kind, name] of [["wfigs_perimeters", "wfigs-perimeters-ca.json"], ["wfigs_incidents", "wfigs-incidents-ca.json"]] as const) {
      // The samples were taken with a record limit, so the service marked them partial.
      expect(() => parseFeed(kind, recorded(name))).toThrow("exceededTransferLimit");
      const whole = JSON.parse(recorded(name)) as Record<string, unknown>;
      delete whole.properties;
      const fires = parseFeed(kind, JSON.stringify(whole));
      for (const fire of fires) {
        expect(fire.externalId, kind).toMatch(/^\d{4}-[A-Z]{2}[A-Z0-9]+-\d+$/);
        expect(fire.properties.state).toBe("US-CA");
        expect(fire.properties.acres).toBeGreaterThan(0);
        expect(fire.properties.discovered).toMatch(/^20\d\d-/);
      }
      if (kind === "wfigs_incidents") expect(fires.map((fire) => fire.properties.type)).toContain("prescribed");
      if (kind === "wfigs_perimeters") expect(fires[0]!.properties.updated).toMatch(/^20\d\d-/);
    }
  });

  it("reads USGS summary GeoJSON, keeping the event type", () => {
    const events = parseFeed("usgs_earthquakes", recorded("usgs-all-day.json"));
    expect(events).toHaveLength(5);
    expect(events.map((event) => event.properties.eventType)).toContain("quarry blast");
    for (const event of events) {
      expect((event.geometry as { coordinates: number[] }).coordinates).toHaveLength(2);
      expect(typeof event.properties.mag).toBe("number");
      expect(event.properties.depthKm).not.toBeNull();
    }
  });

  it("reads a ShakeMap cont_mmi.json product", () => {
    const contours = parseFeed("usgs_shakemap", recorded("shakemap-cont-mmi-us6000txpi.json"));
    expect(contours.map((contour) => contour.properties.mmi)).toEqual([4, 4.5, 5, 5.5, 6, 6.5, 7]);
    expect(contours[0]!.geometry).toMatchObject({ type: "MultiLineString" });
  });

  it("reads NWPS gauges and their flood categories", () => {
    const gauges = parseFeed("nwps_gauges", recorded("nwps-gauges.json"));
    expect(gauges).toHaveLength(8);
    const categories = new Set(gauges.map((gauge) => gauge.properties.category as string));
    expect([...categories].sort()).toEqual(["no_flooding", "not_defined"]);
    for (const category of categories) expect(paletteKey(RIVER_GAUGE_PALETTE, category), category).toBeDefined();
    expect(gauges.find((gauge) => gauge.properties.forecastCategory === "fcst_not_current")).toBeDefined();
  });

  it("reads ORNL ODIN's county outages in meters, with the county boundary and the reporting utilities", () => {
    const counties = parseFeed("odin_outages", recorded("odin-map-ca.json"));
    expect(counties.map((county) => [county.externalId, county.title, county.properties.metersOut])).toEqual([
      ["06029", "Kern, California", 123], ["06083", "Santa Barbara, California", 1891], ["06093", "Siskiyou, California", 4],
    ]);
    expect(counties[1]!.geometry).toMatchObject({ type: "MultiPolygon" });
    expect(counties[1]!.geometry).not.toHaveProperty("properties");
    expect(counties[0]!.properties).toMatchObject({ fips: "06029", utilities: "SOUTHERN CALIFORNIA EDISON CO", detail: "County-level outage summary" });
    expect(counties[2]!.properties.utilities).toBe("PACIFICORP");
    expect(() => parseFeed("odin_outages", recorded("usgs-all-day.json"))).toThrow("not an ODIN outage map response");
  });
});

describe("a preset feed through the feed engine", () => {
  let admin: Sql;
  let runtime: Sql;
  let seed: Awaited<ReturnType<typeof seedIdentity>>;
  let principal: Principal;

  beforeAll(async () => {
    ({ admin, runtime } = await freshDb());
    seed = await seedIdentity(admin);
    principal = await principalForPerson(runtime, seed.adminId);
  });

  afterAll(async () => {
    await runtime.end();
    await admin.end();
  });

  const create = (raw: Record<string, unknown>) =>
    withPerson(runtime, seed.adminId, (tx) => createFeed(tx, principal, seed.jurisdictionId, raw));
  const layer = (id: string, now?: Date) =>
    withPerson(runtime, seed.adminId, (tx) => feedItems(tx, principal, id, {}, now));

  it("lands NWS alerts with zone geometry, credits the source, and names itself to NWS", async () => {
    const url = "https://api.weather.gov/alerts/active?area=CA";
    const { id } = await create({ name: "NWS alerts (CA)", kind: "nws_alerts", url, pollIntervalSeconds: 300 });
    const log: Array<{ url: string; agent: string | null }> = [];
    expect(await pollFeed(runtime, principal, id, fixtureFetch({ [url]: fixture("nws-alerts-ca.json") }, log)))
      .toEqual({ ok: true, items: 5 });
    expect(log[0]).toEqual({ url, agent: FEED_USER_AGENT });
    const result = await layer(id);
    expect(result.feed).toMatchObject({ kind: "nws_alerts", attribution: expect.stringContaining("National Weather Service") });
    const surf = result.features.find((feature) => (feature.properties as Record<string, unknown>).event === "High Surf Warning")!;
    expect((surf.geometry as { type: string }).type).toBe("MultiPolygon");
    expect(surf.properties).toMatchObject({ zones: "CAZ101, CAZ103", _stale: false });
  });

  it("replaces its items with each poll's snapshot, and keeps the last one, stale, through an outage", async () => {
    const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
    const { id } = await create({ name: "USGS earthquakes", kind: "usgs_earthquakes", url, pollIntervalSeconds: 300, staleAfterSeconds: 900 });
    const day = JSON.parse(fixture("usgs-all-day.json")) as { features: unknown[] };
    const polledAt = new Date(Date.now() - 2 * 3600 * 1000);
    await pollFeed(runtime, principal, id, fixtureFetch({ [url]: JSON.stringify(day) }), polledAt);
    expect((await layer(id)).numberReturned).toBe(5);
    // The magnitude 1.2 quake aged out of the source's past day: the next poll's snapshot drops it.
    const later = new Date(polledAt.getTime() + 60_000);
    await pollFeed(runtime, principal, id, fixtureFetch({ [url]: JSON.stringify({ ...day, features: day.features.slice(1) }) }), later);
    const current = await layer(id);
    expect(current.features.map((feature) => (feature.properties as Record<string, unknown>).mag)).not.toContain(1.24);
    expect(current.numberReturned).toBe(4);
    // The source stops answering: the failure keeps those four, marked stale with their age.
    const outage = await pollFeed(runtime, principal, id, fixtureFetch({}), new Date(later.getTime() + 60_000));
    expect(outage.ok).toBe(false);
    const stale = await layer(id);
    expect(stale.numberReturned).toBe(4);
    expect(stale.feed.stale).toBe(true);
    expect(stale.feed.ageSeconds).toBeGreaterThan(6000);
    expect((stale.features[0]!.properties as Record<string, unknown>)._stale).toBe(true);
  });

  it("accepts every preset kind and keeps the four general formats", async () => {
    for (const [kind, name] of [
      ["wfigs_perimeters", "wfigs-perimeters.json"], ["wfigs_incidents", "wfigs-incidents.json"],
      ["usgs_shakemap", "shakemap-cont-mmi.json"], ["nwps_gauges", "nwps-gauges.json"], ["utility_outages", "utility-outages.json"],
      ["odin_outages", "recorded-2026-09-26/odin-map-ca.json"],
    ] as const) {
      const url = `https://fixtures.example.test/${name}`;
      const { id } = await create({ name: kind, kind, url });
      const result = await pollFeed(runtime, principal, id, fixtureFetch({ [url]: fixture(name) }));
      expect(result, kind).toMatchObject({ ok: true });
      expect((await layer(id)).numberReturned, kind).toBe(result.items);
    }
    await expect(create({ name: "Unknown", kind: "esri_live_feed", url: "https://example.test/x" })).rejects.toThrow();
  });
});
