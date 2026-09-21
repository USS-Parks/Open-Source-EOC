import { type DataPackDataset, type FieldMapping } from "./pack.js";

/**
 * California operational data catalog (VEOC-79F). A curated registry of
 * documented California sources an operator can onboard into an incident as a
 * data pack, with no code change. Each entry records its owner, license, actual
 * geographic coverage, field mapping, refresh method and cadence. Onboarding
 * reuses the 79C data-pack path; loading stays on the existing push/poll seam
 * (outbound fetching is gated separately). A source that is documented but not
 * yet integrated is a named gap (available:false), never a silent omission, and
 * a county source is never labeled statewide.
 */

export const CATALOG_CATEGORIES = [
  "boundaries",
  "roads_closures",
  "parcels_buildings",
  "hazards",
  "shelters",
  "critical_facilities",
  "population",
  "lifelines",
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export type RefreshMethod = "push" | "poll";

/** [west, south, east, north] in WGS84 degrees. */
export type Bbox = readonly [number, number, number, number];

/** The California envelope, the coverage of a genuinely statewide source. */
export const CALIFORNIA_BBOX: Bbox = [-124.48, 32.53, -114.13, 42.01];

export interface CatalogCoverage {
  readonly label: string;
  /** true only when the source covers all of California; a sub-area source is
   *  false, so it is never mislabeled statewide. */
  readonly statewide: boolean;
  readonly bbox: Bbox;
}

export interface CatalogSource {
  readonly id: string;
  readonly category: CatalogCategory;
  readonly name: string;
  readonly owner: string;
  /** The jurisdiction slug that owns the onboarded pack (the source owner). */
  readonly ownerSlug: string;
  readonly license: string;
  readonly coverage: CatalogCoverage;
  readonly kind: DataPackDataset["kind"];
  readonly url?: string;
  readonly fieldMapping: FieldMapping;
  readonly refreshMethod: RefreshMethod;
  /** Poll cadence in seconds, or null for a pushed or on-demand source. */
  readonly cadenceSeconds: number | null;
  readonly staleAfterSeconds: number;
  /** true when the source is integrated and onboardable; false marks a
   *  documented but not-yet-integrated named gap. */
  readonly available: boolean;
  readonly notes?: string;
}

/** A catalog source annotated for a specific incident (VEOC-79F): whether it
 *  covers the incident's operational area, and whether it is already onboarded. */
export interface CatalogEntryStatus extends CatalogSource {
  readonly coversIncident: boolean;
  readonly onboarded: boolean;
}

function statewide(label = "California statewide"): CatalogCoverage {
  return { label, statewide: true, bbox: CALIFORNIA_BBOX };
}

export const CALIFORNIA_CATALOG: readonly CatalogSource[] = [
  {
    id: "ca-county-boundaries",
    category: "boundaries",
    name: "California county boundaries",
    owner: "California Department of Technology (State Geoportal)",
    ownerSlug: "ca-state-geoportal",
    license: "Public domain (California open data)",
    coverage: statewide(),
    kind: "geojson",
    url: "https://gis.data.ca.gov",
    fieldMapping: { title: "properties.COUNTY_NAME", sourceId: "properties.FIPS", geometry: "geometry" },
    refreshMethod: "poll",
    cadenceSeconds: 604800,
    staleAfterSeconds: 604800,
    available: true,
  },
  {
    id: "caltrans-lcs-closures",
    category: "roads_closures",
    name: "Caltrans lane and road closures",
    owner: "California Department of Transportation (Caltrans)",
    ownerSlug: "caltrans",
    license: "Public domain (Caltrans open data)",
    coverage: statewide(),
    kind: "geojson",
    url: "https://cwwp2.dot.ca.gov",
    fieldMapping: {
      title: "properties.location",
      status: "properties.status",
      category: "properties.closureType",
      sourceId: "properties.id",
      geometry: "geometry",
    },
    refreshMethod: "poll",
    cadenceSeconds: 300,
    staleAfterSeconds: 1800,
    available: true,
  },
  {
    id: "calfire-incidents",
    category: "hazards",
    name: "CAL FIRE active incidents",
    owner: "California Department of Forestry and Fire Protection (CAL FIRE)",
    ownerSlug: "cal-fire",
    license: "Public domain (CAL FIRE open data)",
    coverage: statewide(),
    kind: "geojson",
    url: "https://incidents.fire.ca.gov",
    fieldMapping: {
      title: "properties.Name",
      severity: "properties.AcresBurned",
      status: "properties.Status",
      sourceId: "properties.UniqueId",
      geometry: "geometry",
    },
    refreshMethod: "poll",
    cadenceSeconds: 900,
    staleAfterSeconds: 3600,
    available: true,
  },
  {
    id: "hifld-critical-facilities",
    category: "critical_facilities",
    name: "Critical facilities (HIFLD Open)",
    owner: "Homeland Infrastructure Foundation-Level Data (HIFLD)",
    ownerSlug: "hifld",
    license: "Public domain (HIFLD Open)",
    coverage: statewide(),
    kind: "geojson",
    url: "https://hifld-geoplatform.opendata.arcgis.com",
    fieldMapping: { title: "properties.NAME", category: "properties.NAICS_DESC", geometry: "geometry" },
    refreshMethod: "poll",
    cadenceSeconds: 604800,
    staleAfterSeconds: 604800,
    available: true,
  },
  {
    id: "census-acs-population",
    category: "population",
    name: "Census ACS block-group population",
    owner: "U.S. Census Bureau (American Community Survey)",
    ownerSlug: "us-census",
    license: "Public domain (U.S. Government work)",
    coverage: statewide(),
    kind: "table",
    url: "https://www.census.gov/programs-surveys/acs",
    fieldMapping: { title: "NAME", category: "B01003_001E", sourceId: "GEO_ID" },
    refreshMethod: "poll",
    cadenceSeconds: 2592000,
    staleAfterSeconds: 604800,
    available: true,
  },
  {
    id: "humboldt-parcels",
    category: "parcels_buildings",
    name: "Humboldt County parcels",
    owner: "Humboldt County Assessor",
    ownerSlug: "humboldt-county",
    license: "Public record (county open data)",
    coverage: { label: "Humboldt County", statewide: false, bbox: [-124.44, 40.0, -123.41, 41.47] },
    kind: "geojson",
    url: "https://humboldtgov.org",
    fieldMapping: { title: "properties.APN", category: "properties.UseCode", sourceId: "properties.APN", geometry: "geometry" },
    refreshMethod: "poll",
    cadenceSeconds: 2592000,
    staleAfterSeconds: 604800,
    available: true,
    notes: "County coverage only; parcels elsewhere in California require that county's own source.",
  },
  {
    id: "fema-nfhl-flood",
    category: "hazards",
    name: "FEMA National Flood Hazard Layer",
    owner: "Federal Emergency Management Agency (FEMA)",
    ownerSlug: "fema",
    license: "Public domain (U.S. Government work)",
    coverage: statewide("California, mapped flood panels only"),
    kind: "geojson",
    fieldMapping: { title: "properties.FLD_ZONE", category: "properties.ZONE_SUBTY", geometry: "geometry" },
    refreshMethod: "poll",
    cadenceSeconds: null,
    staleAfterSeconds: 604800,
    available: false,
    notes: "Named gap: live NFHL fetching is not implemented. A local data pack may supply layer 28 fields FLD_ZONE, ZONE_SUBTY and SFHA_TF by paginated bbox. Coverage is by mapped panel, not universal.",
  },
  {
    id: "statewide-shelters",
    category: "shelters",
    name: "Open shelters, statewide feed",
    owner: "American Red Cross / Cal OES (National Shelter System)",
    ownerSlug: "cal-oes",
    license: "Restricted; no documented open feed",
    coverage: statewide(),
    kind: "geojson",
    fieldMapping: { title: "properties.name", status: "properties.status", geometry: "geometry" },
    refreshMethod: "push",
    cadenceSeconds: null,
    staleAfterSeconds: 3600,
    available: false,
    notes: "Named gap: no documented open statewide shelter feed; shelters are onboarded per incident by a participating organization.",
  },
];

export function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * Whether a catalog source's coverage includes an incident area's bounding box.
 * A statewide source covers any California area; a sub-area source covers only
 * where its bounding box overlaps, so an uncovered area stays explicitly unknown
 * rather than borrowing another region's data.
 */
export function catalogCovers(source: CatalogSource, areaBbox: Bbox): boolean {
  return bboxIntersects(source.coverage.bbox, areaBbox);
}

/**
 * Map a catalog source to a data-pack dataset for onboarding (VEOC-79F reuses
 * the 79C data-pack path). The dataset key is the catalog id in lower_snake.
 */
export function catalogToDataset(source: CatalogSource): DataPackDataset {
  return {
    key: source.id.replace(/-/g, "_"),
    name: source.name,
    kind: source.kind,
    ...(source.url ? { url: source.url } : {}),
    fieldMapping: source.fieldMapping,
    staleAfterSeconds: source.staleAfterSeconds,
  };
}
