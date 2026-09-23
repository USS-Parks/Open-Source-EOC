import { BED_TYPES, FACILITY_TYPE, type BedReport, type FacilitySnapshot } from "@openeoc/shared";
import type { CopFeatureCollection } from "../cop/layers.js";
import type { Status } from "../design/components.js";

/**
 * Facilities and shelters as the status network reports them, plus the
 * pure rules the facilities screen uses to label, summarize and map them.
 * Values come from the EDXL-HAVE dictionary; the labels are for people.
 */

/** One status board row: the latest HAVE snapshot plus the registry fields. */
export interface FacilityBoardRow extends FacilitySnapshot {
  readonly contact: string | null;
  readonly location: { readonly lon: number; readonly lat: number } | null;
  readonly staleAfterSeconds: number;
}

export interface FacilityInput {
  readonly name: string;
  readonly kind: string;
  readonly contact?: string;
  readonly staleAfterSeconds?: number;
  readonly location?: { readonly lon: number; readonly lat: number };
}

export interface FacilityStatusInput {
  readonly operatingStatus: string;
  readonly emsTraffic?: string;
  readonly beds?: readonly BedReport[];
  readonly note?: string;
}

export const KIND_LABELS: Readonly<Record<string, string>> = {
  hospital: "Hospital",
  long_term_care: "Long-term care facility",
  dialysis_center: "Dialysis center",
  shelter: "Shelter",
  point_of_distribution: "Point of distribution",
  ems_agency: "EMS agency",
  public_safety_answering_point: "911 center (PSAP)",
  other: "Other facility",
};

export const OPERATING_LABELS: Readonly<Record<string, string>> = {
  normal: "Normal",
  compromised: "Compromised",
  evacuating: "Evacuating",
  closed: "Closed",
  unknown: "No report",
};

export const OPERATING_BADGE: Readonly<Record<string, Status>> = {
  normal: "success",
  compromised: "warning",
  evacuating: "critical",
  closed: "critical",
};

export const EMS_LABELS: Readonly<Record<string, string>> = {
  "": "Not reported",
  accepting: "Accepting",
  conditional: "Conditional",
  divert: "On divert",
};

export const BED_LABELS: Readonly<Record<string, string>> = {
  adult_icu: "Adult ICU",
  medical_surgical: "Medical and surgical",
  burn: "Burn",
  pediatric_icu: "Pediatric ICU",
  pediatric: "Pediatric",
  psychiatric: "Psychiatric",
  negative_pressure_isolation: "Negative-pressure isolation",
  labor_delivery: "Labor and delivery",
  other: "Other",
};

/** Bed types offered when reporting: a shelter reports its spaces as the HAVE "other" type. */
export function bedTypesFor(kind: string): readonly string[] {
  return kind === "shelter" ? ["other"] : BED_TYPES.values;
}

export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;
export const operatingLabel = (status: string): string => OPERATING_LABELS[status] ?? status;
export const bedLabel = (bedType: string): string => BED_LABELS[bedType] ?? bedType;

/** Freshness in words: the server decides staleness against each facility's window. */
export function freshness(row: FacilityBoardRow): { readonly label: string; readonly status: Status } {
  if (!row.lastUpdate) return { label: "No report yet", status: "unknown" };
  return row.stale ? { label: "Stale", status: "warning" } : { label: "Current", status: "success" };
}

/** The freshness window in words, for example "Every 2 hours". */
export function windowLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes % 60 === 0) return minutes === 60 ? "Every hour" : `Every ${minutes / 60} hours`;
  return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
}

/** Shelter capacity from reported beds: baseline is capacity, available is open spaces. */
export function shelterCounts(beds: readonly BedReport[]): { capacity: number; open: number; occupied: number } {
  const capacity = beds.reduce((sum, bed) => sum + bed.baseline, 0);
  const open = beds.reduce((sum, bed) => sum + bed.available, 0);
  return { capacity, open, occupied: Math.max(0, capacity - open) };
}

/** Bed inputs as typed, keyed by dictionary bed type. */
export type BedDraft = Readonly<Record<string, { readonly available: string; readonly baseline: string }>>;

/**
 * The typed bed rows as a report, skipping rows left blank. A row needs
 * both counts as whole numbers of zero or more.
 */
export function parseBeds(draft: BedDraft): BedReport[] {
  const beds: BedReport[] = [];
  for (const bedType of BED_TYPES.values) {
    const row = draft[bedType];
    if (!row || (row.available.trim() === "" && row.baseline.trim() === "")) continue;
    const available = Number(row.available);
    const baseline = Number(row.baseline);
    if (row.available.trim() === "" || row.baseline.trim() === "" || !Number.isInteger(available)
      || !Number.isInteger(baseline) || available < 0 || baseline < 0)
      throw new Error(`Enter both ${bedLabel(bedType).toLowerCase()} counts as whole numbers, zero or more.`);
    beds.push({ bedType, available, baseline });
  }
  return beds;
}

const SYMBOL_TYPES = new Set<string>(FACILITY_TYPE.values);

/**
 * Positioned facilities as map features. Kinds with a shipped NAPSG symbol
 * (hospital, shelter) draw it; the status frame follows the operating status.
 */
export function facilityFeatures(rows: readonly FacilityBoardRow[]): CopFeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.flatMap((row) => row.location ? [{
      type: "Feature" as const,
      id: row.organizationId,
      geometry: { type: "Point", coordinates: [row.location.lon, row.location.lat] },
      properties: {
        title: row.organizationName,
        type: kindLabel(row.facilityKind),
        status: row.operatingStatus,
        report: freshness(row).label,
        ...(SYMBOL_TYPES.has(row.facilityKind) ? { _facilityType: row.facilityKind } : {}),
      },
    }] : []),
  };
}

/** West, south, east, north around the positioned facilities, or null when none is placed. */
export function facilityBounds(rows: readonly FacilityBoardRow[]): [number, number, number, number] | null {
  const placed = rows.flatMap((row) => row.location ? [row.location] : []);
  if (placed.length === 0) return null;
  const lons = placed.map((p) => p.lon);
  const lats = placed.map((p) => p.lat);
  // A margin so a single facility is framed rather than zoomed to the maximum.
  const pad = 0.01;
  return [Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad];
}
