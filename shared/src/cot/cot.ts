import { XMLBuilder, XMLParser } from "fast-xml-parser";

/**
 * Cursor-on-Target (CoT) event model and gateway mapping (F20).
 * CoT is the TAK ecosystem's wire format. This bridges it both ways: an
 * ATAK track parses to a COP feature, and a VEOC geo record emits as a
 * CoT event a TAK server can consume. Pure and isomorphic, so the gateway
 * logic is shared and testable without a network.
 */

export interface CotPoint {
  readonly lat: number;
  readonly lon: number;
  readonly hae?: number | undefined;
  readonly ce?: number | undefined;
  readonly le?: number | undefined;
}

export interface CotEvent {
  readonly uid: string;
  readonly type: string;
  readonly time: string;
  readonly start: string;
  readonly stale: string;
  readonly how?: string | undefined;
  readonly point: CotPoint;
  readonly callsign?: string | undefined;
  readonly remarks?: string | undefined;
}

/** Unknown ground track; a sensible default when a record has no CoT type. */
export const COT_DEFAULT_TYPE = "a-u-G";
const DEFAULT_CE = 9999999;
const DEFAULT_LE = 9999999;

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

export function cotToXml(e: CotEvent): string {
  const point: Record<string, unknown> = {
    "@_lat": String(e.point.lat),
    "@_lon": String(e.point.lon),
    "@_hae": String(e.point.hae ?? 0),
    "@_ce": String(e.point.ce ?? DEFAULT_CE),
    "@_le": String(e.point.le ?? DEFAULT_LE),
  };
  const detail: Record<string, unknown> = {};
  if (e.callsign) detail.contact = { "@_callsign": e.callsign };
  if (e.remarks) detail.remarks = e.remarks;
  const event: Record<string, unknown> = {
    "@_version": "2.0",
    "@_uid": e.uid,
    "@_type": e.type,
    "@_time": e.time,
    "@_start": e.start,
    "@_stale": e.stale,
    ...(e.how ? { "@_how": e.how } : {}),
    point,
    ...(Object.keys(detail).length ? { detail } : {}),
  };
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
    suppressEmptyNode: true,
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build({ event })}`;
}

export function cotFromXml(xml: string): CotEvent {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml) as { event?: Record<string, unknown> };
  const ev = doc.event;
  if (!ev) throw new Error("not a CoT event");
  const uid = ev["@_uid"] as string | undefined;
  const point = ev.point as Record<string, unknown> | undefined;
  const lat = num(point?.["@_lat"]);
  const lon = num(point?.["@_lon"]);
  if (!uid) throw new Error("CoT event has no uid");
  if (lat === undefined || lon === undefined) throw new Error("CoT event has no valid point");
  const detail = ev.detail as Record<string, unknown> | undefined;
  const contact = detail?.contact as Record<string, unknown> | undefined;
  const remarks = detail?.remarks;
  const out: CotEvent = {
    uid,
    type: (ev["@_type"] as string) ?? COT_DEFAULT_TYPE,
    time: (ev["@_time"] as string) ?? "",
    start: (ev["@_start"] as string) ?? "",
    stale: (ev["@_stale"] as string) ?? "",
    how: ev["@_how"] as string | undefined,
    point: {
      lat,
      lon,
      hae: num(point?.["@_hae"]),
      ce: num(point?.["@_ce"]),
      le: num(point?.["@_le"]),
    },
    callsign: (contact?.["@_callsign"] as string | undefined) ?? undefined,
    remarks: remarks !== undefined ? String(remarks) : undefined,
  };
  return out;
}

export interface GeoFeature {
  readonly type: "Feature";
  readonly id: string;
  readonly geometry: { type: "Point"; coordinates: [number, number] } | null;
  readonly properties: Record<string, unknown>;
}

/** A VEOC geo record (a board record or feed item with a point) → CoT. */
export function geoRecordToCot(
  record: {
    id: string;
    geometry: { type: string; coordinates: number[] | number[][] } | null;
    properties?: Record<string, unknown>;
  },
  meta: { time: string; staleMinutes?: number; type?: string },
): CotEvent {
  if (!record.geometry || record.geometry.type !== "Point")
    throw new Error("only point geometry maps to a CoT event");
  const [lon, lat] = record.geometry.coordinates as [number, number];
  const props = record.properties ?? {};
  const staleMs = (meta.staleMinutes ?? 60) * 60 * 1000;
  const callsign = (props.callsign ?? props.name ?? props.label ?? props.road) as string | undefined;
  return {
    uid: record.id,
    type: meta.type ?? COT_DEFAULT_TYPE,
    time: meta.time,
    start: meta.time,
    stale: new Date(new Date(meta.time).getTime() + staleMs).toISOString(),
    how: "m-g",
    point: { lat, lon },
    ...(callsign ? { callsign } : {}),
    ...(props.remarks ? { remarks: String(props.remarks) } : {}),
  };
}

/** An inbound CoT event → a COP-ready GeoJSON feature. */
export function cotToGeoFeature(e: CotEvent): GeoFeature {
  return {
    type: "Feature",
    id: e.uid,
    geometry: { type: "Point", coordinates: [e.point.lon, e.point.lat] },
    properties: {
      callsign: e.callsign ?? e.uid,
      cotType: e.type,
      _source: "CoT/TAK",
      _cotTime: e.time,
      ...(e.remarks ? { remarks: e.remarks } : {}),
    },
  };
}
