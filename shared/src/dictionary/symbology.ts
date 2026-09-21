import { defineEnum, type Citation } from "./citations.js";

const CITATION: Citation = {
  authority: "NAPSG Foundation",
  document: "Incident Symbology Guideline and Symbol Set v4.0 (March 2020)",
};

/**
 * Top-level NAPSG symbol categories. The full symbol library (hundreds of
 * symbols, shipped as SVG) is imported with the COP map in roster session
 * VEOC-17; these categories are the canonical organizing structure.
 */
export const SYMBOL_CATEGORIES = defineEnum(
  "symbology.categories",
  ["incident", "operations", "infrastructure", "damage"],
  CITATION,
);

/**
 * Point-status frame convention: symbol frames communicate status by shape
 * and color per the NAPSG guideline.
 */
export const SYMBOL_STATUS = defineEnum(
  "symbology.status",
  ["normal", "warning", "critical", "unknown"],
  CITATION,
);

const FEMA_NFHL_CITATION: Citation = {
  authority: "Federal Emergency Management Agency (FEMA)",
  document: "National Flood Hazard Layer, Flood Hazard Zones layer 28 (FLD_ZONE and ZONE_SUBTY)",
};

/** Static NFHL reference categories. These never become incident status. */
export const FEMA_FLOOD_HAZARD = defineEnum(
  "symbology.femaFloodHazard",
  ["high", "moderate", "unknown"],
  FEMA_NFHL_CITATION,
);
export type FemaFloodHazard = (typeof FEMA_FLOOD_HAZARD.values)[number];

/**
 * Classify only the locally documented NFHL families. X is moderate only when
 * its subtype identifies the shaded 0.2 percent annual-chance area. Every
 * other or absent value stays unknown, never "no flood risk".
 */
export function femaFloodHazardFor(fields: {
  readonly FLD_ZONE?: unknown;
  readonly ZONE_SUBTY?: unknown;
  readonly title?: unknown;
  readonly category?: unknown;
}): FemaFloodHazard {
  const zone = String(fields.FLD_ZONE ?? fields.title ?? "").trim().toUpperCase();
  const subtype = String(fields.ZONE_SUBTY ?? fields.category ?? "").trim().toUpperCase();
  if (["A", "AE", "AO"].includes(zone)) return "high";
  if (zone === "X" && (/(^|\W)SHADED(\W|$)/.test(subtype) || subtype.includes("0.2 PCT"))) return "moderate";
  return "unknown";
}
