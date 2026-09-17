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
