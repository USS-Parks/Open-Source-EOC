import { z } from "zod";
import { defineEnum, type Citation } from "./citations.js";

const CITATION: Citation = {
  authority: "FEMA",
  document: "Preliminary Damage Assessment Guide (May 2020) and PDA Pocket Guide",
};

/** Degree-of-damage classification used in preliminary damage assessment. */
export const DAMAGE_DEGREES = defineEnum(
  "pda.damage_degrees",
  ["affected", "minor", "major", "destroyed", "inaccessible"],
  CITATION,
);

/** Residence types recorded for Individual Assistance assessments. */
export const IA_STRUCTURE_TYPES = defineEnum(
  "pda.ia_structure_types",
  ["single_family", "multi_family", "mobile_home", "business", "other"],
  CITATION,
);

/** Occupancy/ownership status for Individual Assistance assessments. */
export const IA_OWNERSHIP = defineEnum(
  "pda.ia_ownership",
  ["owned", "rented", "unknown"],
  CITATION,
);

const PAPPG: Citation = {
  authority: "FEMA",
  document: "Public Assistance Program and Policy Guide (PAPPG), FP 104-009-2, Version 5.0 as amended, for incidents declared on or after January 6, 2025",
  section: "Categories of work: emergency work (A and B) and permanent work (C to G)",
};

/** Public Assistance work categories A through G. */
export const PA_CATEGORIES = defineEnum(
  "pda.pa_categories",
  [
    "a_debris_removal",
    "b_emergency_protective_measures",
    "c_roads_and_bridges",
    "d_water_control_facilities",
    "e_buildings_and_equipment",
    "f_utilities",
    "g_parks_recreational_other",
  ],
  PAPPG,
);

/** Display label for each Public Assistance work category, as the PAPPG names it. */
export const PA_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  a_debris_removal: "Category A: Debris removal",
  b_emergency_protective_measures: "Category B: Emergency protective measures",
  c_roads_and_bridges: "Category C: Roads and bridges",
  d_water_control_facilities: "Category D: Water control facilities",
  e_buildings_and_equipment: "Category E: Buildings and equipment",
  f_utilities: "Category F: Utilities",
  g_parks_recreational_other: "Category G: Parks, recreational and other facilities",
};

/**
 * Core Individual Assistance assessment record, mirroring the fields FEMA
 * gathers in a joint PDA. The damage-assessment module extends
 * this; it must never narrow it.
 */
export const IaAssessmentSchema = z.object({
  structureType: IA_STRUCTURE_TYPES.schema,
  ownership: IA_OWNERSHIP.schema,
  degree: DAMAGE_DEGREES.schema,
  insured: z.boolean().nullable(),
  waterDepthInches: z.number().min(0).nullable(),
  habitable: z.boolean().nullable(),
  notes: z.string().max(4000).optional(),
});

export type IaAssessment = z.infer<typeof IaAssessmentSchema>;
