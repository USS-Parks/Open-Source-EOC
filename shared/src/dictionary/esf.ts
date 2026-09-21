import { defineEnum, type Citation } from "./citations.js";

const CITATION: Citation = {
  authority: "FEMA",
  document: "National Response Framework, Emergency Support Function Annexes (ESF #1-#15)",
};

/**
 * The fifteen National Response Framework Emergency Support Functions. EOCs
 * staff and track ESFs alongside the Community Lifelines; both render as
 * color-coded status cards on the incident-status dashboard.
 */
export const EMERGENCY_SUPPORT_FUNCTIONS = defineEnum(
  "esf.functions",
  [
    "esf_1_transportation",
    "esf_2_communications",
    "esf_3_public_works",
    "esf_4_firefighting",
    "esf_5_information_planning",
    "esf_6_mass_care",
    "esf_7_logistics",
    "esf_8_public_health_medical",
    "esf_9_search_rescue",
    "esf_10_oil_hazmat",
    "esf_11_agriculture_natural_resources",
    "esf_12_energy",
    "esf_13_public_safety_security",
    "esf_14_cross_sector_business_infrastructure",
    "esf_15_external_affairs",
  ],
  CITATION,
);

/**
 * ESF operating condition, colored on the same scale as the lifelines:
 * green = normal operations, yellow = stressed, red = overwhelmed, gray = not
 * activated.
 */
export const ESF_STATUS = defineEnum(
  "esf.status",
  ["normal", "stressed", "overwhelmed", "not_activated"],
  CITATION,
);

/** Doctrine color for each ESF condition (mirrors the lifeline colors). */
export const ESF_STATUS_COLOR: Readonly<Record<string, string>> = {
  normal: "green",
  stressed: "yellow",
  overwhelmed: "red",
  not_activated: "gray",
};

export const ESF_ACTIVATION = defineEnum(
  "esf.activation",
  ["unknown", "not_activated", "activated", "demobilizing", "demobilized"],
  CITATION,
);

export const ESF_CAPACITY = defineEnum(
  "esf.capacity",
  ["unknown", "adequate", "constrained", "critical"],
  CITATION,
);

export const CALIFORNIA_ESFS = defineEnum(
  "esf.california.functions",
  [
    "ca_esf_1", "ca_esf_2", "ca_esf_3", "ca_esf_4", "ca_esf_5", "ca_esf_6",
    "ca_esf_7", "ca_esf_8", "ca_esf_9", "ca_esf_10", "ca_esf_11", "ca_esf_12",
    "ca_esf_13", "ca_esf_14", "ca_esf_15", "ca_esf_16", "ca_esf_17", "ca_esf_18",
  ],
  {
    authority: "California Governor's Office of Emergency Services",
    document: "California Emergency Plan Emergency Support Functions",
  },
);

export const ESF_DEFINITIONS = {
  federal: {
    version: 1,
    source: {
      authority: "FEMA",
      title: "National Response Framework, Emergency Support Function Annexes",
    },
    functions: EMERGENCY_SUPPORT_FUNCTIONS.values,
  },
  california: {
    version: 1,
    source: {
      authority: "California Governor's Office of Emergency Services",
      title: "California Emergency Plan Emergency Support Functions",
      url: "https://www.caloes.ca.gov/office-of-the-director/operations/planning-preparedness-prevention/planning-preparedness/california-emergency-plan-emergency-support-functions/",
    },
    functions: CALIFORNIA_ESFS.values,
  },
} as const;

/** Explicit mappings supported by locally retained planning material. */
export const ESF_CROSSWALK_V1 = [
  {
    fromFramework: "california",
    fromKey: "ca_esf_16",
    toFramework: "california",
    toKey: "ca_esf_13",
    relationship: "merged_into",
  },
] as const;

export const ESF_DOCTRINE_GAPS = [
  "California ESF titles and effective dates are not retained in an approved local source.",
  "No approved local source establishes a federal-to-California ESF crosswalk; numeric alignment is not inferred.",
] as const;
