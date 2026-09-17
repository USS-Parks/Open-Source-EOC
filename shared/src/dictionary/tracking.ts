import { defineEnum, type Citation } from "./citations.js";

const SALT: Citation = {
  authority: "National guideline (SALT consensus)",
  document:
    "SALT Mass Casualty Triage (Sort, Assess, Lifesaving interventions, Treatment/transport); START categories retained for interoperability",
};

const TRACKING: Citation = {
  authority: "Project doctrine derived from mass-care practice",
  document:
    "Cross-agency tracking object model (patient/evacuee/animal/asset) informed by patient-tracking and reunification practice; see research document section 1.2",
};

/** Kinds of objects tracked across agency handoffs. */
export const TRACKING_KINDS = defineEnum(
  "tracking.kinds",
  ["patient", "evacuee", "companion_animal", "asset"],
  TRACKING,
);

/** Mass-casualty triage categories. */
export const TRIAGE_CATEGORIES = defineEnum(
  "tracking.triage_categories",
  ["minor", "delayed", "immediate", "expectant", "deceased"],
  SALT,
);

/** Custody chain states from field capture through reunification. */
export const CUSTODY_STATES = defineEnum(
  "tracking.custody_states",
  [
    "registered",
    "in_transit",
    "at_receiving_facility",
    "at_shelter",
    "transferred",
    "discharged",
    "reunified",
  ],
  TRACKING,
);
