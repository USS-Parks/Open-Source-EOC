import type { NormalizedItem } from "./parse.js";

/**
 * Feed presets (MP10): public hazard sources read in their own formats and
 * normalized to the fields their map symbology keys on. A preset poll is a
 * complete snapshot of its source, so it replaces the feed's items
 * (service.ts); an outage keeps the last snapshot, drawn stale.
 */

/** A finite number, or null: sources send strings, nulls, and NWPS -999 or -9999 for "no value". */
function num(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n !== -999 && n !== -9999 ? n : null;
}

/** An instant as ISO 8601, from epoch milliseconds (ArcGIS, USGS) or a date string; NWPS's year 1 is no time. */
function isoTime(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900 ? null : date.toISOString();
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Drops a third (depth) coordinate: the feed_items column is two-dimensional. */
function flat(geometry: unknown): Record<string, unknown> | null {
  const g = geometry as { type?: unknown; coordinates?: unknown } | null | undefined;
  if (!g || typeof g.type !== "string" || !Array.isArray(g.coordinates)) return null;
  const strip = (c: unknown): unknown =>
    Array.isArray(c) && typeof c[0] === "number" ? c.slice(0, 2) : Array.isArray(c) ? c.map(strip) : c;
  return { type: g.type, coordinates: strip(g.coordinates) };
}

function json(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error("feed is not valid JSON");
  }
}

type Feature = Record<string, unknown>;
const props = (feature: Feature) => (feature.properties as Record<string, unknown> | null) ?? {};

function features(body: string): Feature[] {
  const doc = json(body);
  if (doc.type !== "FeatureCollection" || !Array.isArray(doc.features))
    throw new Error("feed is not a GeoJSON FeatureCollection");
  // An ArcGIS service (WFIGS, many utilities) that stops at its record limit says so here.
  // A partial snapshot would drop fires from the map, so it fails and the last whole one stays.
  if ((doc.properties as { exceededTransferLimit?: unknown } | undefined)?.exceededTransferLimit === true)
    throw new Error("the source returned only part of its features (exceededTransferLimit); narrow the feed's query");
  return doc.features as Feature[];
}

/** api.weather.gov active alerts (GeoJSON). Zone-based alerts arrive without geometry; see resolveNwsZones. */
function nwsAlert(feature: Feature): NormalizedItem | null {
  const p = props(feature);
  // Test and exercise messages never draw as a real warning.
  if (p.status !== undefined && p.status !== "Actual") return null;
  const event = text(p.event);
  const id = text(p.id) ?? text(feature.id);
  if (!event || !id) throw new Error("NWS alert has no event or id");
  return {
    externalId: id,
    title: text(p.headline) ?? event,
    severity: text(p.severity)?.toLowerCase(),
    geometry: flat(feature.geometry),
    properties: {
      event,
      headline: text(p.headline),
      areaDesc: text(p.areaDesc),
      severity: text(p.severity),
      urgency: text(p.urgency),
      certainty: text(p.certainty),
      onset: isoTime(p.onset),
      expires: isoTime(p.ends ?? p.expires),
      senderName: text(p.senderName),
      affectedZones: Array.isArray(p.affectedZones) ? p.affectedZones.filter((z) => typeof z === "string") : [],
    },
  };
}

/** NIFC WFIGS current perimeters (poly_ and attr_ fields) and incident locations (plain fields), as ArcGIS GeoJSON. */
function wfigsFire(feature: Feature, index: number): NormalizedItem {
  const p = props(feature);
  const name = text(p.poly_IncidentName) ?? text(p.attr_IncidentName) ?? text(p.IncidentName) ?? "Unnamed fire";
  const category = text(p.attr_IncidentTypeCategory) ?? text(p.IncidentTypeCategory);
  const id = text(p.attr_UniqueFireIdentifier) ?? text(p.UniqueFireIdentifier)
    ?? text(p.poly_IRWINID) ?? text(p.attr_IrwinID) ?? text(p.IrwinID) ?? String(feature.id ?? `fire-${index}`);
  return {
    externalId: id,
    title: name,
    geometry: flat(feature.geometry),
    properties: {
      name,
      type: category === "RX" ? "prescribed" : "wildfire",
      acres: num(p.poly_GISAcres) ?? num(p.attr_IncidentSize) ?? num(p.IncidentSize)
        ?? num(p.DailyAcres) ?? num(p.CalculatedAcres) ?? num(p.DiscoveryAcres),
      containment: num(p.attr_PercentContained) ?? num(p.PercentContained),
      discovered: isoTime(p.attr_FireDiscoveryDateTime ?? p.FireDiscoveryDateTime),
      updated: isoTime(p.poly_DateCurrent ?? p.attr_ModifiedOnDateTime_dt ?? p.ModifiedOnDateTime_dt),
      state: text(p.attr_POOState) ?? text(p.POOState),
      fireId: id,
    },
  };
}

/** USGS earthquake summary GeoJSON (earthquakes/feed/v1.0/summary). */
function usgsQuake(feature: Feature): NormalizedItem {
  const p = props(feature);
  const id = text(feature.id);
  if (!id) throw new Error("USGS earthquake has no id");
  const mag = num(p.mag);
  const coordinates = (feature.geometry as { coordinates?: unknown[] } | null)?.coordinates ?? [];
  return {
    externalId: id,
    title: text(p.title) ?? `M ${mag ?? "?"} ${text(p.place) ?? ""}`.trim(),
    geometry: flat(feature.geometry),
    properties: {
      mag,
      magType: text(p.magType),
      // The summary feeds carry explosions and quarry blasts beside earthquakes.
      eventType: text(p.type),
      place: text(p.place),
      time: isoTime(p.time),
      depthKm: num(coordinates[2]),
      alert: text(p.alert),
      tsunami: p.tsunami === 1,
      status: text(p.status),
      url: text(p.url),
    },
  };
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** USGS ShakeMap intensity: an event's cont_mmi.json contours, or MMI polygons converted from its shapefile. */
function shakeMapIntensity(feature: Feature, index: number): NormalizedItem {
  const p = props(feature);
  const mmi = num(p.value) ?? num(p.PARAMVALUE) ?? num(p.mmi);
  if (mmi === null) throw new Error("ShakeMap feature has no MMI value");
  const roman = ROMAN[Math.min(11, Math.max(0, Math.floor(mmi) - 1))]!;
  return {
    externalId: `mmi-${mmi}-${index}`,
    title: `MMI ${roman}${Number.isInteger(mmi) ? "" : ` (${mmi})`}`,
    geometry: flat(feature.geometry),
    properties: { mmi },
  };
}

/** Customers-out fields seen in utility outage map feeds, most common first. */
const CUSTOMERS_OUT = [
  "customersOut", "customers_out", "CustomersOut", "CUSTOMERS_OUT", "customersAffected",
  "customers_affected", "CUSTOMERS_AFFECTED", "custAffected", "NumCustOut", "numCustOut",
];

/** A utility's public outage map GeoJSON: points or areas with a customers-out count. */
function utilityOutage(feature: Feature, index: number): NormalizedItem {
  const p = props(feature);
  const customersOut = CUSTOMERS_OUT.map((key) => num(p[key])).find((n) => n !== null) ?? null;
  const name = text(p.name) ?? text(p.title) ?? text(p.area);
  return {
    externalId: String(feature.id ?? p.id ?? p.outageId ?? `outage-${index}`),
    title: name ?? (customersOut === null ? "Outage" : `${customersOut} customers out`),
    geometry: flat(feature.geometry),
    properties: { ...p, customersOut },
  };
}

/** NOAA NWPS gauges (api.water.noaa.gov/nwps/v1/gauges): JSON, not GeoJSON. */
function nwpsGauges(body: string): NormalizedItem[] {
  const doc = json(body);
  if (!Array.isArray(doc.gauges)) throw new Error("not an NWPS gauges document");
  const category = (reading: Record<string, unknown> | undefined) =>
    text(reading?.floodCategory)?.toLowerCase().replace(/[\s-]+/g, "_") ?? "unknown";
  return (doc.gauges as Record<string, unknown>[]).flatMap((gauge) => {
    const lid = text(gauge.lid);
    const lat = num(gauge.latitude);
    const lon = num(gauge.longitude);
    if (!lid || lat === null || lon === null) return [];
    const status = gauge.status as Record<string, Record<string, unknown> | undefined> | undefined;
    const observed = status?.observed ?? {};
    const name = text(gauge.name) ?? lid;
    return [{
      externalId: lid,
      title: name,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        name,
        lid,
        category: category(observed),
        stage: num(observed.primary),
        stageUnit: text(observed.primaryUnit),
        flow: num(observed.secondary),
        flowUnit: text(observed.secondaryUnit),
        observedAt: isoTime(observed.validTime),
        forecastCategory: status?.forecast ? category(status.forecast) : null,
        office: text((gauge.wfo as Record<string, unknown> | undefined)?.abbreviation),
      },
    }];
  });
}

/**
 * ORNL ODIN's public county-level outages (odin.ornl.gov/odi/map): a JSON
 * array of areas, each with its county boundary and the electric meters
 * out, which ODIN counts in place of customers.
 */
function odinOutages(body: string): NormalizedItem[] {
  const doc: unknown = json(body);
  if (!Array.isArray(doc)) throw new Error("not an ODIN outage map response");
  return (doc as Record<string, unknown>[]).map((area, index) => {
    const county = text(area.countyName);
    const state = text(area.stateName);
    const utilities = [...new Set(((area.outages as Record<string, unknown>[] | undefined) ?? [])
      .map((outage) => text(outage.utilityName)).filter((name): name is string => name !== null))];
    return {
      externalId: text(area.id) ?? `odin-${index}`,
      title: [county, state].filter(Boolean).join(", ") || "Outage area",
      geometry: flat(area.feature),
      properties: {
        county,
        state,
        fips: text(area.id),
        metersOut: num(area.metersOut),
        utilities: utilities.join(", ") || null,
        detail: text(area.precisionLabel),
      },
    };
  });
}

const eachFeature = (normalize: (feature: Feature, index: number) => NormalizedItem | null) =>
  (body: string): NormalizedItem[] => features(body).flatMap((feature, index) => normalize(feature, index) ?? []);

const PARSERS = {
  nws_alerts: eachFeature(nwsAlert),
  wfigs_perimeters: eachFeature(wfigsFire),
  wfigs_incidents: eachFeature(wfigsFire),
  usgs_earthquakes: eachFeature(usgsQuake),
  usgs_shakemap: eachFeature(shakeMapIntensity),
  nwps_gauges: nwpsGauges,
  utility_outages: eachFeature(utilityOutage),
  odin_outages: odinOutages,
} as const;

export type PresetKind = keyof typeof PARSERS;

export function isPresetKind(kind: string): kind is PresetKind {
  return Object.hasOwn(PARSERS, kind);
}

export function parsePreset(kind: PresetKind, body: string): NormalizedItem[] {
  return PARSERS[kind](body);
}

/** Credit lines for the map's inspector and export. The federal sources' data is public domain. */
export const PRESET_ATTRIBUTION: Readonly<Record<PresetKind, string>> = {
  nws_alerts: "National Weather Service, api.weather.gov (U.S. Government work, public domain)",
  wfigs_perimeters: "NIFC Wildland Fire Interagency Geospatial Services (WFIGS), public domain",
  wfigs_incidents: "NIFC Wildland Fire Interagency Geospatial Services (WFIGS), public domain",
  usgs_earthquakes: "U.S. Geological Survey Earthquake Hazards Program, public domain",
  usgs_shakemap: "U.S. Geological Survey ShakeMap, public domain",
  nwps_gauges: "NOAA National Water Prediction Service, public domain",
  utility_outages: "Utility outage map configured by the agency; the utility's terms apply",
  odin_outages: "ORNL Outage Data Initiative Nationwide (ODIN), odin.ornl.gov; ODIN publishes no terms of use",
};

/** Sent with every poll: api.weather.gov refuses requests that do not name their application. */
export const FEED_USER_AGENT = "Open-Source-EOC feed engine";

const ZONE_TIMEOUT_MS = 10000;
const ZONE_CACHE_LIMIT = 500;
const ZONE_FETCHES_PER_POLL = 200;
type Polygons = number[][][][];
/** Zone boundaries by URL. ponytail: an in-process cache; zones rarely change and a restart refetches them. */
const zoneCache = new Map<string, Polygons>();

async function zonePolygons(url: string, fetchImpl: typeof fetch): Promise<Polygons | null> {
  const res = await fetchImpl(url, {
    headers: { "user-agent": FEED_USER_AGENT, accept: "application/geo+json" },
    signal: AbortSignal.timeout(ZONE_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const geometry = ((await res.json()) as { geometry?: { type?: string; coordinates?: unknown } }).geometry;
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates as Polygons[number]]
    : geometry?.type === "MultiPolygon" ? (geometry.coordinates as Polygons) : null;
  if (!polygons) return null;
  if (zoneCache.size >= ZONE_CACHE_LIMIT) zoneCache.delete(zoneCache.keys().next().value!);
  zoneCache.set(url, polygons);
  return polygons;
}

/**
 * Most NWS products (winter storm, high surf, red flag, heat) name forecast,
 * county or fire zones instead of carrying a polygon. Each such alert takes
 * its zones' boundaries, fetched from the feed's own origin only (a zone link
 * anywhere else is ignored), so the stored snapshot keeps drawable geometry
 * through an outage. A zone that cannot be fetched is left out; an alert with
 * no zone drawn keeps no geometry and stays listed.
 */
export async function resolveNwsZones(
  items: readonly NormalizedItem[],
  feedUrl: string,
  fetchImpl: typeof fetch,
): Promise<NormalizedItem[]> {
  const origin = new URL(feedUrl).origin;
  let fetches = 0;
  const out: NormalizedItem[] = [];
  for (const item of items) {
    const { affectedZones, ...properties } = item.properties;
    const zones = ((affectedZones ?? []) as string[]).filter((url) => {
      try {
        return new URL(url).origin === origin;
      } catch {
        return false;
      }
    });
    properties.zones = zones.map((url) => url.slice(url.lastIndexOf("/") + 1)).join(", ") || null;
    const parts: Polygons = [];
    if (!item.geometry) {
      for (const url of zones) {
        let polygons = zoneCache.get(url) ?? null;
        // ponytail: a per-poll cap bounds a first poll's fan-out; later polls fill the rest from cache.
        if (!polygons && fetches < ZONE_FETCHES_PER_POLL) {
          fetches += 1;
          polygons = await zonePolygons(url, fetchImpl).catch(() => null);
        }
        if (polygons) parts.push(...polygons);
      }
    }
    out.push({
      ...item,
      geometry: item.geometry ?? (parts.length > 0 ? { type: "MultiPolygon", coordinates: parts } : null),
      properties,
    });
  }
  return out;
}
