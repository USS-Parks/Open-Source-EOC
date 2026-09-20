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
