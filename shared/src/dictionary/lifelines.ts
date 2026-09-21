import { defineEnum, type Citation } from "./citations.js";

const CITATION: Citation = {
  authority: "FEMA",
  document:
    "Community Lifelines Implementation Toolkit; eighth lifeline (Water Systems) added 2023",
};

/** The eight FEMA Community Lifelines. */
export const COMMUNITY_LIFELINES = defineEnum(
  "lifelines.lifelines",
  [
    "safety_security",
    "food_hydration_shelter",
    "health_medical",
    "energy",
    "communications",
    "transportation",
    "hazardous_materials",
    "water_systems",
  ],
  CITATION,
);

/**
 * Lifeline condition. FEMA doctrine colors: green = stable, yellow =
 * stabilizing, red = unstable, gray = status unknown.
 */
export const LIFELINE_STATUS = defineEnum(
  "lifelines.status",
  ["stable", "stabilizing", "unstable", "unknown"],
  CITATION,
);

/** Doctrine color for each lifeline condition (for the calm-screen UI). */
export const LIFELINE_STATUS_COLOR: Readonly<Record<string, string>> = {
  stable: "green",
  stabilizing: "yellow",
  unstable: "red",
  unknown: "gray",
};

/** Versioned doctrine identity retained on every operational assessment. */
export const LIFELINE_DEFINITION = {
  framework: "fema_community_lifelines",
  version: 1,
  source: {
    authority: "FEMA",
    title: "Community Lifelines Implementation Toolkit",
    url: "https://emilms.fema.gov/is_2901/groups/39.html",
  },
  lifelines: COMMUNITY_LIFELINES.values,
} as const;

/**
 * The repository has no retained authoritative component/subcomponent list.
 * Local component keys remain supported, but must not be represented as FEMA
 * doctrine until this gap is resolved from an approved source.
 */
export const LIFELINE_DOCTRINE_GAPS = [
  "Authoritative FEMA component and subcomponent definitions are not retained locally.",
] as const;
