import { XMLParser } from "fast-xml-parser";

/**
 * Feed parsers. Each format normalizes to the same item shape;
 * everything unparseable throws with a reason, because a feed that stops
 * making sense must alarm, not quietly produce nothing.
 */

export interface NormalizedItem {
  readonly externalId: string;
  readonly title: string;
  readonly severity?: string | undefined;
  readonly geometry: Record<string, unknown> | null;
  readonly properties: Record<string, unknown>;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** CAP polygon: "lat,lon lat,lon ..." (note the order) -> GeoJSON Polygon. */
function capPolygon(text: string): Record<string, unknown> | null {
  const pairs = text.trim().split(/\s+/).map((p) => p.split(",").map(Number));
  if (pairs.length < 3 || pairs.some((p) => p.length !== 2 || p.some(Number.isNaN))) return null;
  const ring = pairs.map(([lat, lon]) => [lon, lat]);
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return { type: "Polygon", coordinates: [ring] };
}

/** CAP circle: "lat,lon radius" -> the center point (radius kept as data). */
function capCircle(text: string): { geometry: Record<string, unknown>; radiusKm: number } | null {
  const m = text.trim().split(/\s+/);
  if (m.length !== 2) return null;
  const [lat, lon] = m[0]!.split(",").map(Number);
  const radius = Number(m[1]);
  if ([lat, lon, radius].some((n) => n === undefined || Number.isNaN(n))) return null;
  return { geometry: { type: "Point", coordinates: [lon, lat] }, radiusKm: radius };
}

export function parseCap(text: string): NormalizedItem[] {
  const doc = xml.parse(text) as Record<string, unknown>;
  const alert = doc.alert as Record<string, unknown> | undefined;
  if (!alert) throw new Error("not a CAP alert document");
  const identifier = String(alert.identifier ?? "");
  if (!identifier) throw new Error("CAP alert has no identifier");
  const infos = asArray(alert.info as Record<string, unknown> | Record<string, unknown>[]);
  if (infos.length === 0) throw new Error("CAP alert has no info block");
  const info = infos[0]!;
  const areas = asArray(info.area as Record<string, unknown> | Record<string, unknown>[]);
  let geometry: Record<string, unknown> | null = null;
  const properties: Record<string, unknown> = {
    event: info.event ?? null,
    urgency: info.urgency ?? null,
    certainty: info.certainty ?? null,
    areaDesc: areas[0]?.areaDesc ?? null,
  };
  for (const area of areas) {
    const polygon = asArray(area.polygon as string | string[])[0];
    if (polygon) {
      geometry = capPolygon(String(polygon));
      if (geometry) break;
    }
    const circle = asArray(area.circle as string | string[])[0];
    if (circle) {
      const parsed = capCircle(String(circle));
      if (parsed) {
        geometry = parsed.geometry;
        properties.radiusKm = parsed.radiusKm;
        break;
      }
    }
  }
  return [
    {
      externalId: identifier,
      title: String(info.headline ?? info.event ?? identifier),
      severity: info.severity ? String(info.severity).toLowerCase() : undefined,
      geometry,
      properties,
    },
  ];
}

export function parseGeoRss(text: string): NormalizedItem[] {
  const doc = xml.parse(text) as Record<string, unknown>;
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (!channel) throw new Error("not a GeoRSS (RSS 2.0) document");
  return asArray(channel.item as Record<string, unknown> | Record<string, unknown>[]).map(
    (item, index) => {
      let geometry: Record<string, unknown> | null = null;
      const point = item.point as string | undefined;
      if (point) {
        const [lat, lon] = String(point).trim().split(/\s+/).map(Number);
        if (lat !== undefined && lon !== undefined && !Number.isNaN(lat) && !Number.isNaN(lon)) {
          geometry = { type: "Point", coordinates: [lon, lat] };
        }
      }
      return {
        externalId: String(item.guid ?? item.link ?? `item-${index}`),
        title: String(item.title ?? `item-${index}`),
        geometry,
        properties: { description: item.description ?? null },
      };
    },
  );
}

/** Cursor-on-Target event: one position report per document. */
export function parseCot(text: string): NormalizedItem[] {
  const doc = xml.parse(text) as Record<string, unknown>;
  const event = doc.event as Record<string, unknown> | undefined;
  if (!event) throw new Error("not a CoT event");
  const uid = String(event["@uid"] ?? "");
  if (!uid) throw new Error("CoT event has no uid");
  const point = event.point as Record<string, unknown> | undefined;
  const lat = Number(point?.["@lat"]);
  const lon = Number(point?.["@lon"]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) throw new Error("CoT event has no valid point");
  return [
    {
      externalId: uid,
      title: String(
        (event.detail as Record<string, Record<string, unknown>> | undefined)?.contact?.[
          "@callsign"
        ] ?? uid,
      ),
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        cotType: event["@type"] ?? null,
        time: event["@time"] ?? null,
        hae: point?.["@hae"] !== undefined ? Number(point["@hae"]) : null,
      },
    },
  ];
}

export function parseGeoJsonFeed(text: string): NormalizedItem[] {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("feed is not valid JSON");
  }
  if (doc.type === "Feature") return [normalizeFeature(doc, 0)];
  if (doc.type !== "FeatureCollection" || !Array.isArray(doc.features))
    throw new Error("feed is not a GeoJSON FeatureCollection");
  return (doc.features as Record<string, unknown>[]).map(normalizeFeature);
}

function normalizeFeature(feature: Record<string, unknown>, index: number): NormalizedItem {
  const properties = (feature.properties as Record<string, unknown>) ?? {};
  const severity = properties.severity ?? properties.status;
  return {
    externalId: String(feature.id ?? properties.id ?? `feature-${index}`),
    title: String(properties.title ?? properties.name ?? feature.id ?? `feature-${index}`),
    severity: severity === undefined || severity === null ? undefined : String(severity),
    geometry: (feature.geometry as Record<string, unknown>) ?? null,
    properties,
  };
}

export function parseFeed(kind: string, text: string): NormalizedItem[] {
  if (kind === "cap") return parseCap(text);
  if (kind === "georss") return parseGeoRss(text);
  if (kind === "cot") return parseCot(text);
  if (kind === "geojson") return parseGeoJsonFeed(text);
  throw new Error(`unknown feed kind: ${kind}`);
}
