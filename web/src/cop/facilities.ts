import { FACILITY_TYPE } from "@openeoc/shared";
import type { Map as MapLibreMap } from "maplibre-gl";

/** The licensed NAPSG facility subset shipped for offline COP rendering. */
export type FacilityType = (typeof FACILITY_TYPE.values)[number];

export interface FacilitySymbol {
  readonly type: FacilityType;
  readonly title: string;
  readonly iconId: string;
  readonly assetFile: string;
  readonly catalogId: string;
}

const symbol = (
  type: FacilityType,
  title: string,
  assetFile: string,
  catalogId: string,
): FacilitySymbol => ({ type, title, iconId: `napsg-${catalogId}`, assetFile, catalogId });

export const FACILITY_SYMBOLS: readonly FacilitySymbol[] = [
  symbol("hospital", "Hospital", "hospitals.png", "hospitals"),
  symbol("urgent-care", "Urgent-care facility", "urgent-care-facilities.png", "urgent-care-facilities"),
  symbol("fire-station", "Fire station", "fire-station.png", "fire-station"),
  symbol("law-enforcement", "Law enforcement", "law-enforcement-locations.png", "law-enforcement-locations"),
  symbol("school", "School", "public-schools.png", "public-schools"),
  symbol("shelter", "Shelter", "national-shelter-system-facilities.png", "national-shelter-system-facilities"),
  symbol("local-eoc", "Local EOC", "local-emergency-operations-center-eoc.png", "local-emergency-operations-center-eoc"),
  symbol("commercial-airport", "Commercial airport", "aircraft-landing-facilities-commercial.png", "aircraft-landing-facilities-commercial"),
  symbol("heliport", "Heliport", "aircraft-landing-facilities-heliport.png", "aircraft-landing-facilities-heliport"),
] as const;

export const NAPSG_ATTRIBUTION =
  "Facility symbols: NAPSG Foundation facility symbols (catalog v4.1.5), CC BY 4.0";
export const NAPSG_SOURCE_URL = "https://www.napsgfoundation.org/symbology/";
export const NAPSG_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";

const SYMBOL_BY_TYPE = new Map(FACILITY_SYMBOLS.map((entry) => [entry.type, entry]));
const TYPE_VALUES = new Set<string>(FACILITY_TYPE.values);

/** Exact labels from the acquired NAPSG catalog selection and HIFLD category seam. */
const EXACT_SOURCE_LABELS: Readonly<Record<string, FacilityType>> = {
  hospitals: "hospital",
  "urgent care facilities": "urgent-care",
  "fire station": "fire-station",
  "law enforcement locations": "law-enforcement",
  "public schools": "school",
  "national shelter system facilities": "shelter",
  "local emergency operations center (eoc)": "local-eoc",
  "aircraft landing facilities, commercial": "commercial-airport",
  "aircraft landing facilities, heliport": "heliport",
};

/** OpenMapTiles poi.subclass values whose source meaning is specific enough. */
export const STREET_FACILITY_TYPES: Readonly<Record<string, FacilityType>> = {
  hospital: "hospital",
  fire_station: "fire-station",
  police: "law-enforcement",
  school: "school",
  shelter: "shelter",
  helipad: "heliport",
};

function normalized(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

function canonicalType(value: unknown): FacilityType | undefined {
  const candidate = normalized(value);
  return candidate && TYPE_VALUES.has(candidate) ? (candidate as FacilityType) : undefined;
}

/**
 * Read a facility type only from an explicit canonical field, an exact catalog
 * label, or a source-specific subclass with unambiguous meaning. Generic
 * clinic, town hall, community centre, and airport values stay unclassified.
 */
export function facilityTypeFor(properties: Record<string, unknown>): FacilityType | undefined {
  for (const key of ["_facilityType", "facility_type", "facilityType"]) {
    const type = canonicalType(properties[key]);
    if (type) return type;
  }
  for (const key of ["NAICS_DESC", "category"]) {
    const label = normalized(properties[key]);
    if (label && EXACT_SOURCE_LABELS[label]) return EXACT_SOURCE_LABELS[label];
  }
  const subclass = normalized(properties.subclass);
  return subclass ? STREET_FACILITY_TYPES[subclass] : undefined;
}

export function facilitySymbol(type: FacilityType | undefined): FacilitySymbol | undefined {
  return type ? SYMBOL_BY_TYPE.get(type) : undefined;
}

/**
 * facilityTypeFor as a MapLibre expression over raw record fields, for vector
 * tiles; "" when unclassified.
 * ponytail: expressions have no trim, so a padded value stays unclassified on
 * the tile path; trim server-side if padded source values turn up.
 */
export function facilityTypeExpression(): unknown {
  const canonical = Object.fromEntries(FACILITY_TYPE.values.map((type) => [type, type]));
  const lookups: [string, Readonly<Record<string, FacilityType>>][] = [
    ["_facilityType", canonical],
    ["facility_type", canonical],
    ["facilityType", canonical],
    ["NAICS_DESC", EXACT_SOURCE_LABELS],
    ["category", EXACT_SOURCE_LABELS],
    ["subclass", STREET_FACILITY_TYPES],
  ];
  return lookups.reduceRight<unknown>(
    (next, [key, table]) => ["match", ["downcase", ["to-string", ["get", key]]], ...Object.entries(table).flat(), next],
    "",
  );
}

/** MapLibre icon expression for tagged operational records. */
export function facilityIconExpression(): unknown[] {
  return [
    "match",
    ["get", "_facilityType"],
    ...FACILITY_SYMBOLS.flatMap((entry) => [entry.type, entry.iconId]),
    "",
  ];
}

/** MapLibre icon expression for the source-safe OpenMapTiles subset. */
export function streetFacilityIconExpression(): unknown[] {
  return [
    "match",
    ["get", "subclass"],
    ...Object.entries(STREET_FACILITY_TYPES).flatMap(([subclass, type]) => [
      subclass,
      SYMBOL_BY_TYPE.get(type)!.iconId,
    ]),
    "",
  ];
}

/** Load the shipped PNGs into the active style. Repeated calls are idempotent. */
export async function ensureFacilityImages(
  map: Pick<MapLibreMap, "hasImage" | "loadImage" | "addImage">,
  assetBase = "/napsg/",
): Promise<void> {
  const base = assetBase.endsWith("/") ? assetBase : `${assetBase}/`;
  await Promise.all(
    FACILITY_SYMBOLS.map(async (entry) => {
      if (map.hasImage(entry.iconId)) return;
      const image = await map.loadImage(`${base}${entry.assetFile}`);
      if (!map.hasImage(entry.iconId)) map.addImage(entry.iconId, image.data);
    }),
  );
}
