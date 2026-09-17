import { defineEnum, type Citation } from "./citations.js";

const CITATION: Citation = {
  authority: "OASIS",
  document: "Emergency Data Exchange Language Hospital AVailability Exchange (EDXL-HAVE) v2.0",
};

/** Overall facility operating status. */
export const FACILITY_OPERATING_STATUS = defineEnum(
  "have.facility_operating_status",
  ["normal", "compromised", "evacuating", "closed"],
  CITATION,
);

/** EMS traffic posture toward a facility. */
export const EMS_TRAFFIC_STATUS = defineEnum(
  "have.ems_traffic_status",
  ["accepting", "conditional", "divert"],
  CITATION,
);

/** Bed types reported through facility status networks. */
export const BED_TYPES = defineEnum(
  "have.bed_types",
  [
    "adult_icu",
    "medical_surgical",
    "burn",
    "pediatric_icu",
    "pediatric",
    "psychiatric",
    "negative_pressure_isolation",
    "labor_delivery",
    "other",
  ],
  CITATION,
);

/** Facility kinds participating in a standing status network. */
export const FACILITY_KINDS = defineEnum(
  "have.facility_kinds",
  [
    "hospital",
    "long_term_care",
    "dialysis_center",
    "shelter",
    "point_of_distribution",
    "ems_agency",
    "public_safety_answering_point",
    "other",
  ],
  CITATION,
);
