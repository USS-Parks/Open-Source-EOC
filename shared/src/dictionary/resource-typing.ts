import { defineEnum, type Citation } from "./citations.js";

const NIMS: Citation = {
  authority: "FEMA",
  document: "National Incident Management System, Third Edition (October 2017)",
  section: "Resource management: resource typing, tracking and demobilization",
};

/** Where a resource of the jurisdiction's pool stands. */
export const RESOURCE_STATUSES = defineEnum(
  "resource.statuses",
  ["available", "assigned", "out_of_service", "demobilized"],
  NIMS,
);

/**
 * Allowed status moves. A resource is assigned to one request at a time and
 * leaves the pool when demobilized, so demobilized has no exits.
 */
export const RESOURCE_STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  available: ["assigned", "out_of_service", "demobilized"],
  assigned: ["available", "out_of_service", "demobilized"],
  out_of_service: ["available", "demobilized"],
  demobilized: [],
};

/** The condition a resource is returned in at demobilization. */
export const RESOURCE_RETURN_CONDITIONS = defineEnum(
  "resource.return_conditions",
  ["ready", "needs_service", "damaged", "lost"],
  NIMS,
);

/**
 * The checks recorded when a resource is demobilized. This is a short list of
 * this project's own, not the text of the ICS-221 Demobilization Check-Out,
 * which an incident uses to document the release in full.
 */
export const DEMOBILIZATION_CHECKS = defineEnum(
  "resource.demobilization_checks",
  ["equipment_returned", "communications_returned", "inspected", "records_submitted"],
  { ...NIMS, section: "Demobilization; ICS-221 Demobilization Check-Out" },
);

export const DEMOBILIZATION_CHECK_LABELS: Readonly<Record<string, string>> = {
  equipment_returned: "Equipment and supplies returned",
  communications_returned: "Communications equipment returned",
  inspected: "Vehicle or equipment inspected",
  records_submitted: "Time and cost records submitted",
};

/** One type level of a kind. Type 1 is the most capable. */
export interface ResourceTypeLevel {
  readonly type: number;
  readonly capability: string;
}

/** A kind of resource; no levels means the kind has a single type. */
export interface ResourceKindDefinition {
  readonly key: string;
  readonly name: string;
  readonly discipline: string;
  readonly levels: readonly ResourceTypeLevel[];
  readonly notes: string;
}

export const RESOURCE_KIND_SEED_SOURCE =
  "FEMA National Incident Management System, Third Edition (2017); NWCG Standards for Wildland Fire Resource " +
  "Typing, PMS 200. A starter subset: the names are not Resource Typing Library Tool titles or identifiers. " +
  "Import the FEMA Resource Typing Library Tool export for the authoritative catalog.";

const levels = (count: number): ResourceTypeLevel[] =>
  Array.from({ length: count }, (_, index) => ({ type: index + 1, capability: "" }));

/** Kinds every jurisdiction starts with. Keys carry no prefix; local and imported kinds do. */
export const RESOURCE_KIND_SEED: readonly ResourceKindDefinition[] = [
  { key: "incident_management_team", name: "Incident Management Team", discipline: "Incident Management", levels: levels(5), notes: "" },
  { key: "engine", name: "Engine", discipline: "Fire", levels: levels(7), notes: "" },
  { key: "water_tender", name: "Water Tender", discipline: "Fire", levels: levels(3), notes: "" },
  { key: "hand_crew", name: "Hand Crew", discipline: "Fire", levels: levels(2), notes: "" },
  { key: "dozer", name: "Dozer", discipline: "Fire", levels: levels(3), notes: "" },
];

/**
 * Whether a resource of one type fills a request for another. Type 1 is the
 * most capable, so a lower number serves a request for a higher one; a
 * request with no type takes any type of its kind.
 */
export function typeSatisfies(resourceType: number | null, requestedType: number | null): boolean {
  return requestedType === null || (resourceType !== null && resourceType <= requestedType);
}
