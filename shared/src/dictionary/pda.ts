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
  CITATION,
);

/**
 * Core Individual Assistance assessment record, mirroring the fields FEMA
 * gathers in a joint PDA. The damage-assessment module (VEOC-23) extends
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
