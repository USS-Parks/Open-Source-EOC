import type { DamageSummary, DeclarationThresholds, PaItemStatus, PublicAssistanceTotals } from "@openeoc/shared";
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
  /** The incident it was made under; none when it was recorded with no incident selected. */
  readonly incident_id?: string | null;
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

/**
 * How a report or line item reads with an incident selected. The screen
 * shows that incident's records and those recorded with no incident, which
 * belong to none in particular; these say so. With no incident selected every
 * record shows and none needs the label.
 */
export function incidentLabel(record: { readonly incident_id?: string | null }, incidentId: string | null | undefined): string | null {
  if (!incidentId) return null;
  return record.incident_id ? "This incident" : "No incident";
}

/** An official field assessment; the server records it as accepted. */
export interface FieldAssessmentInput {
  readonly incidentId?: string | null;
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

/** The threshold inputs as typed, before they are valid numbers. The statewide pair is optional. */
export interface ThresholdDraft {
  readonly population: string;
  readonly paPerCapitaIndicator: string;
  readonly iaResidenceThreshold: string;
  readonly statePopulation?: string;
  readonly statewidePerCapitaIndicator?: string;
}

/** The server's defaults for the county and IA indicators; populations and the statewide indicator have none. */
export const DEFAULT_DRAFT: ThresholdDraft = {
  population: "", paPerCapitaIndicator: "4.6", iaResidenceThreshold: "25", statePopulation: "", statewidePerCapitaIndicator: "",
};

function numberOf(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

/**
 * Valid thresholds, or null while any input is missing or out of range. The
 * state population and statewide indicator go together: both empty leaves the
 * statewide indicator out, one without the other is incomplete.
 */
export function parseThresholds(draft: ThresholdDraft): DeclarationThresholds | null {
  const population = numberOf(draft.population);
  const paPerCapitaIndicator = numberOf(draft.paPerCapitaIndicator);
  const iaResidenceThreshold = numberOf(draft.iaResidenceThreshold);
  if (!Number.isInteger(population) || population <= 0) return null;
  if (!Number.isFinite(paPerCapitaIndicator) || paPerCapitaIndicator < 0) return null;
  if (!Number.isInteger(iaResidenceThreshold) || iaResidenceThreshold < 0) return null;
  const county = { population, paPerCapitaIndicator, iaResidenceThreshold };
  const stateText = draft.statePopulation ?? "";
  const statewideText = draft.statewidePerCapitaIndicator ?? "";
  if (stateText.trim() === "" && statewideText.trim() === "") return county;
  const statePopulation = numberOf(stateText);
  const statewidePerCapitaIndicator = numberOf(statewideText);
  if (!Number.isInteger(statePopulation) || statePopulation <= 0) return null;
  if (!Number.isFinite(statewidePerCapitaIndicator) || statewidePerCapitaIndicator < 0) return null;
  return { ...county, statePopulation, statewidePerCapitaIndicator };
}

export interface Indicator {
  readonly key: "pa" | "pa_state" | "ia";
  readonly title: string;
  readonly met: boolean;
  readonly measured: string;
  readonly threshold: string;
  readonly basis: string;
}

/** What the per-capita figures divide, named so structure loss is never read as PA cost. */
export function perCapitaBasis(summary: DamageSummary): string {
  const d = summary.declaration;
  const items = summary.publicAssistance.items;
  return d.perCapitaBasis === "pa_cost"
    ? `Public Assistance cost: ${dollars(d.perCapitaAmount)} in ${items} counted ${items === 1 ? "line item" : "line items"}, categories A to G`
    : `Structure loss, not Public Assistance cost: ${dollars(d.perCapitaAmount)} estimated loss of counted structures`;
}

/** The declaration indicators in words, each with the basis of its number. */
export function declarationIndicators(summary: DamageSummary): readonly Indicator[] {
  const d = summary.declaration;
  const basis = perCapitaBasis(summary);
  const indicators: Indicator[] = [{
    key: "pa",
    title: "Public Assistance county per-capita indicator",
    met: d.paThresholdMet,
    measured: `${dollars(d.perCapitaImpact)} per resident`,
    threshold: `${dollars(d.paPerCapitaIndicator)} per resident, operator-entered`,
    basis: `${basis}, divided by an operator-entered county population of ${d.population.toLocaleString("en-US")}.`,
  }];
  if (d.statewide) indicators.push({
    key: "pa_state",
    title: "Public Assistance statewide per-capita indicator",
    met: d.statewide.met,
    measured: `${dollars(d.statewide.perCapitaImpact)} per resident`,
    threshold: `${dollars(d.statewide.indicator)} per resident, operator-entered`,
    basis: `${basis}, divided by an operator-entered state population of ${d.statewide.population.toLocaleString("en-US")}.`,
  });
  indicators.push({
    key: "ia",
    title: "Individual Assistance residences",
    met: d.iaThresholdMet,
    measured: `${summary.majorOrWorse} destroyed or major`,
    threshold: `${d.iaResidenceThreshold} residences, operator-entered`,
    basis: `${summary.byDegree.destroyed ?? 0} destroyed plus ${summary.byDegree.major ?? 0} with major damage.`,
  });
  return indicators;
}

/** One Public Assistance line item as the server lists it, in its field names. */
export interface PaItem {
  readonly id: string;
  readonly incident_id: string | null;
  readonly applicant: string;
  readonly category: string;
  readonly site: string | null;
  readonly description: string;
  readonly estimated_cost_cents: number;
  readonly insured: boolean | null;
  readonly percent_complete: number;
  readonly status: PaItemStatus;
  readonly lon: number | null;
  readonly lat: number | null;
  readonly created_at: string;
  readonly updated_at: string;
  /** When a force account was rolled into the item's cost; none when the cost was entered. */
  readonly force_account_at?: string | null;
}

export interface PaItemPage {
  readonly items: readonly PaItem[];
  readonly nextCursor: string | null;
  /** Counted totals across the jurisdiction, not only this page. */
  readonly totals: PublicAssistanceTotals;
}

/** A line item as it is written; an edit replaces every field. */
export interface PaItemInput {
  readonly incidentId?: string | null;
  readonly applicant: string;
  readonly category: string;
  readonly site: string | null;
  readonly description: string;
  readonly estimatedCostCents: number;
  readonly insured: boolean | null;
  readonly percentComplete: number;
  readonly status: PaItemStatus;
  readonly location: { readonly lon: number; readonly lat: number } | null;
}

export const PA_STATUS_LABELS: Readonly<Record<PaItemStatus, string>> = {
  draft: "Draft, not counted",
  submitted: "Submitted",
  reviewed: "Reviewed",
};

/** The line item form as typed. */
export interface PaDraft {
  readonly applicant: string;
  readonly category: string;
  readonly site: string;
  readonly description: string;
  readonly cost: string;
  readonly insured: "unknown" | "insured" | "uninsured";
  readonly percent: string;
  readonly status: PaItemStatus;
  readonly lon: string;
  readonly lat: string;
}

export const EMPTY_PA_DRAFT: PaDraft = {
  applicant: "", category: "a_debris_removal", site: "", description: "", cost: "", insured: "unknown",
  percent: "0", status: "submitted", lon: "", lat: "",
};

/** A listed line item back in the form, for editing. */
export function paDraftOf(item: PaItem): PaDraft {
  return {
    applicant: item.applicant,
    category: item.category,
    site: item.site ?? "",
    description: item.description,
    cost: (item.estimated_cost_cents / 100).toFixed(2),
    insured: item.insured === null ? "unknown" : item.insured ? "insured" : "uninsured",
    percent: String(item.percent_complete),
    status: item.status,
    lon: item.lon === null ? "" : String(item.lon),
    lat: item.lat === null ? "" : String(item.lat),
  };
}

/** The form as a line item, or an error naming the first field to fix. */
export function parsePaDraft(draft: PaDraft): PaItemInput {
  const applicant = draft.applicant.trim();
  if (!applicant) throw new Error("Enter the applicant: the public entity or eligible private nonprofit.");
  const cost = numberOf(draft.cost);
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Enter the estimated cost in dollars, zero or more.");
  const percent = numberOf(draft.percent);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error("Enter the percent complete as a whole number from 0 to 100.");
  const placed = draft.lon.trim() !== "" || draft.lat.trim() !== "";
  const lon = numberOf(draft.lon);
  const lat = numberOf(draft.lat);
  if (placed && !(Math.abs(lon) <= 180 && Math.abs(lat) <= 90))
    throw new Error("Enter both longitude and latitude in decimal degrees, or leave both empty.");
  return {
    applicant,
    category: draft.category,
    site: draft.site.trim() || null,
    description: draft.description.trim(),
    estimatedCostCents: Math.round(cost * 100),
    insured: draft.insured === "unknown" ? null : draft.insured === "insured",
    percentComplete: percent,
    status: draft.status,
    location: placed ? { lon, lat } : null,
  };
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
export function csvRows(text: string): string[][] {
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
