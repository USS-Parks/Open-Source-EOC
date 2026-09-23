import type { DamageSummary, DeclarationThresholds } from "@openeoc/shared";
import type { CopFeatureCollection } from "../cop/layers.js";
import type { SymbolStatus } from "../cop/symbology.js";

/**
 * Damage assessment as the server reports it, plus the pure rules the
 * damage surface uses to label, map and explain it. Nothing here talks to
 * the network; the API client carries these shapes.
 */

export type DamageReportStatus = "submitted" | "approved" | "rejected";

/** One row of the paged assessment list, in the server's field names. */
export interface DamageReport {
  readonly id: string;
  readonly address: string;
  readonly structure_type: string;
  readonly degree: string;
  readonly source: "official" | "public";
  readonly status: DamageReportStatus;
  readonly estimated_loss: number;
  readonly insured: boolean | null;
  readonly notes: string | null;
  readonly reporter_contact: string | null;
  readonly created_at: string;
  readonly lon: number | null;
  readonly lat: number | null;
}

export interface DamageReportPage {
  readonly assessments: readonly DamageReport[];
  readonly nextCursor: string | null;
}

/** An official field assessment; the server records it as accepted. */
export interface FieldAssessmentInput {
  readonly address: string;
  readonly structureType: string;
  readonly degree: string;
  readonly ownership?: string;
  readonly insured?: boolean | null;
  readonly estimatedLoss: number;
  readonly notes?: string;
  readonly location?: { readonly lon: number; readonly lat: number };
}

/** Degrees in FEMA's reporting order, worst first. Values come from the PDA dictionary. */
export const DEGREE_ORDER = ["destroyed", "major", "minor", "affected", "inaccessible"] as const;

export const DEGREE_LABELS: Readonly<Record<string, string>> = {
  destroyed: "Destroyed",
  major: "Major damage",
  minor: "Minor damage",
  affected: "Affected",
  inaccessible: "Inaccessible",
};

export const STRUCTURE_LABELS: Readonly<Record<string, string>> = {
  single_family: "Single-family home",
  multi_family: "Multi-family building",
  mobile_home: "Mobile home",
  business: "Business",
  other: "Other structure",
};

export const OWNERSHIP_LABELS: Readonly<Record<string, string>> = {
  owned: "Owner occupied",
  rented: "Rented",
  unknown: "Not known",
};

export const SOURCE_LABELS: Readonly<Record<DamageReport["source"], string>> = {
  official: "Field assessment",
  public: "Public report",
};

export function degreeLabel(degree: string): string {
  return DEGREE_LABELS[degree] ?? "Unrecognized degree";
}

export function structureLabel(type: string): string {
  return STRUCTURE_LABELS[type] ?? type;
}

export function insuredLabel(insured: boolean | null): string {
  return insured === null ? "Not known" : insured ? "Insured" : "Uninsured";
}

/**
 * Degree to map status frame. The map speaks the five calm-screen status
 * colors, so destroyed and major share the critical frame; the inspector
 * and the legend name the degree.
 */
export const DEGREE_STATUS: Readonly<Record<string, SymbolStatus>> = {
  destroyed: "critical",
  major: "critical",
  minor: "warning",
  affected: "normal",
  inaccessible: "unknown",
};

export function dollars(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Accepted reports that carry a position, as map features colored by degree. */
export function reportFeatures(reports: readonly DamageReport[]): CopFeatureCollection {
  return {
    type: "FeatureCollection",
    features: reports.flatMap((report) => report.lon === null || report.lat === null ? [] : [{
      type: "Feature" as const,
      id: report.id,
      geometry: { type: "Point", coordinates: [report.lon, report.lat] },
      properties: {
        title: report.address,
        degree: degreeLabel(report.degree),
        source: SOURCE_LABELS[report.source],
        estimated_loss: dollars(report.estimated_loss),
        severity: DEGREE_STATUS[report.degree] ?? "unknown",
      },
    }]),
  };
}

/** West, south, east, north around the positioned reports, or null when none has a position. */
export function reportBounds(reports: readonly DamageReport[]): [number, number, number, number] | null {
  const lons: number[] = [];
  const lats: number[] = [];
  for (const report of reports) {
    if (report.lon === null || report.lat === null) continue;
    lons.push(report.lon);
    lats.push(report.lat);
  }
  if (lons.length === 0) return null;
  // A margin so a single report is framed rather than zoomed to the maximum.
  const pad = 0.01;
  return [Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad];
}

/** The threshold inputs as typed, before they are valid numbers. */
export interface ThresholdDraft {
  readonly population: string;
  readonly paPerCapitaIndicator: string;
  readonly iaResidenceThreshold: string;
}

/** The server's defaults for the two indicators; population has none. */
export const DEFAULT_DRAFT: ThresholdDraft = { population: "", paPerCapitaIndicator: "4.6", iaResidenceThreshold: "25" };

function numberOf(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

/** Valid thresholds, or null while any input is missing or out of range. */
export function parseThresholds(draft: ThresholdDraft): DeclarationThresholds | null {
  const population = numberOf(draft.population);
  const paPerCapitaIndicator = numberOf(draft.paPerCapitaIndicator);
  const iaResidenceThreshold = numberOf(draft.iaResidenceThreshold);
  if (!Number.isInteger(population) || population <= 0) return null;
  if (!Number.isFinite(paPerCapitaIndicator) || paPerCapitaIndicator < 0) return null;
  if (!Number.isInteger(iaResidenceThreshold) || iaResidenceThreshold < 0) return null;
  return { population, paPerCapitaIndicator, iaResidenceThreshold };
}

export interface Indicator {
  readonly key: "pa" | "ia";
  readonly title: string;
  readonly met: boolean;
  readonly measured: string;
  readonly threshold: string;
  readonly basis: string;
}

/** The two declaration indicators in words, each with the basis of its number. */
export function declarationIndicators(summary: DamageSummary): readonly Indicator[] {
  const d = summary.declaration;
  return [
    {
      key: "pa",
      title: "Public Assistance per-capita indicator",
      met: d.paThresholdMet,
      measured: `${dollars(d.perCapitaImpact)} per resident`,
      threshold: `${dollars(d.paPerCapitaIndicator)} per resident`,
      basis: `${dollars(summary.totalEstimatedLoss)} counted loss divided by a population of ${d.population.toLocaleString("en-US")}.`,
    },
    {
      key: "ia",
      title: "Individual Assistance residences",
      met: d.iaThresholdMet,
      measured: `${summary.majorOrWorse} destroyed or major`,
      threshold: `${d.iaResidenceThreshold} residences`,
      basis: `${summary.byDegree.destroyed ?? 0} destroyed plus ${summary.byDegree.major ?? 0} with major damage.`,
    },
  ];
}

/** File name for the declaration support download, dated by the local day. */
export function declarationFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `declaration-support-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.md`;
}

/** One parcel of the baseline field assessments are matched against. */
export interface DamageBaselineRow {
  readonly parcelId: string;
  readonly address: string;
  readonly structureType: string;
  readonly replacementValue: number;
  readonly location?: { readonly lon: number; readonly lat: number };
}

/** CSV text as rows of cells; quoted cells may hold commas, quotes and line breaks. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

/**
 * Baseline parcels from an uploaded file. JSON is an array of parcels or an
 * object with a `rows` array, passed as written. CSV needs a header naming
 * parcelId, address, structureType and replacementValue, with optional lon
 * and lat; header case, spaces and underscores do not matter.
 */
export function parseBaseline(text: string, fileName: string): DamageBaselineRow[] {
  const start = text.trimStart()[0];
  if (/\.json$/i.test(fileName) || start === "[" || start === "{") {
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error("The baseline file is not valid JSON."); }
    const rows = Array.isArray(value) ? value : (value as { rows?: unknown } | null)?.rows;
    if (!Array.isArray(rows)) throw new Error("A JSON baseline is an array of parcels or an object with a rows array.");
    return rows as DamageBaselineRow[];
  }
  const [header, ...body] = csvRows(text);
  const names = (header ?? []).map((name) => name.trim().toLowerCase().replace(/[^a-z]/g, ""));
  if (!["parcelid", "address", "structuretype", "replacementvalue"].every((name) => names.includes(name)))
    throw new Error("The CSV header needs parcelId, address, structureType and replacementValue columns.");
  const cell = (row: readonly string[], ...keys: string[]) => {
    const index = names.findIndex((name) => keys.includes(name));
    return index < 0 ? "" : (row[index] ?? "").trim();
  };
  return body.map((row, index) => {
    const value = Number(cell(row, "replacementvalue").replace(/[$,]/g, ""));
    if (!Number.isFinite(value)) throw new Error(`Row ${index + 2}: the replacement value is not a number.`);
    const lon = cell(row, "lon", "longitude");
    const lat = cell(row, "lat", "latitude");
    return {
      parcelId: cell(row, "parcelid"),
      address: cell(row, "address"),
      structureType: cell(row, "structuretype"),
      replacementValue: value,
      ...(lon && lat ? { location: { lon: Number(lon), lat: Number(lat) } } : {}),
    };
  });
}
