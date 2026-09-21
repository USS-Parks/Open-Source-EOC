import type { CatalogCoverage } from "../data-packs/catalog.js";
import type { DatasetAvailability } from "../data-packs/pack.js";

/** The five source-backed totals in an incident-area impact response. */
export const IMPACT_CATEGORIES = [
  "structures_parcels",
  "infrastructure_facilities",
  "shelters",
  "closures",
  "population",
] as const;

export type ImpactCategory = (typeof IMPACT_CATEGORIES)[number];
export type ImpactUnit = "records" | "people";
export type ImpactCoverage = "complete" | "partial" | "none" | "unknown";
export type ImpactAvailability = DatasetAvailability | "mixed";

export type ViewportBbox = readonly [west: number, south: number, east: number, north: number];
export type SpatialQueryScope =
  | { readonly kind: "incident-area"; readonly bbox: null }
  | { readonly kind: "viewport"; readonly bbox: ViewportBbox };

/** Provenance and the independently useful aggregate for one upstream source. */
export interface ImpactSourceAggregate {
  readonly catalogSourceId: string;
  readonly datasetId: string | null;
  readonly datasetKey: string;
  readonly datasetName: string;
  readonly owner: string;
  readonly license: string;
  readonly catalogCoverage: CatalogCoverage;
  readonly availability: DatasetAvailability;
  /** Actual successful ingestion time, separate from the source's data vintage. */
  readonly loadedAt: string | null;
  /** Source-reported vintage when loaded records consistently provide one. */
  readonly sourceVintage: string | null;
  readonly coverage: ImpactCoverage;
  /** Observed source aggregate. It is not promoted to a category total unless safe. */
  readonly value: number | null;
  readonly contributingRecords: number | null;
  /** Registrations with this canonical key; one newest successful registration is used. */
  readonly registrationsConsidered: number;
  readonly reason: string | null;
}

export interface ImpactCategoryAggregate {
  readonly category: ImpactCategory;
  readonly unit: ImpactUnit;
  readonly availability: ImpactAvailability;
  /** Null means unknown. It never substitutes zero for missing or partial coverage. */
  readonly value: number | null;
  readonly coverage: ImpactCoverage;
  readonly reason: string | null;
  readonly sources: readonly ImpactSourceAggregate[];
}

export interface IncidentImpactResponse {
  readonly incidentId: string;
  readonly scope?: SpatialQueryScope;
  /** The selected revision, or null when the incident has no area revision. */
  readonly areaRevision: number | null;
  readonly areaGeometryAvailable: boolean;
  readonly categories: Readonly<Record<ImpactCategory, ImpactCategoryAggregate>>;
  readonly method: {
    /** Boundary contact counts as affected. */
    readonly spatialPredicate: "ST_Intersects";
    readonly populationEstimate:
      "source population multiplied by intersected polygon geography area divided by source polygon geography area";
    readonly populationDenominator: "source polygon geography area in square metres";
    readonly overlapDeduplication:
      "distinct source_id within one selected dataset; cross-source identities are not assumed equivalent";
  };
}
