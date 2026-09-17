import { defineEnum, type Citation } from "./citations.js";

const CITATION: Citation = {
  authority: "FEMA",
  document:
    "National Incident Management System, Third Edition (October 2017); NIMS ICS Forms Booklet FEMA 502-2, ICS-213RR",
  section: "Resource management process: identify, order, mobilize, track, demobilize",
};

/** Lifecycle states of a resource request (the 213RR lane). */
export const RESOURCE_REQUEST_STATES = defineEnum(
  "resource_request.states",
  [
    "draft",
    "submitted",
    "triaged",
    "sourcing",
    "assigned",
    "deployed",
    "demobilizing",
    "closed",
    "cancelled",
  ],
  CITATION,
);

type RRState = (typeof RESOURCE_REQUEST_STATES.values)[number];

/**
 * Allowed transitions. Terminal states (`closed`, `cancelled`) have no
 * outgoing edges. Cancellation is reachable from every non-terminal state
 * except a completed demobilization, matching the NIMS ordering cycle.
 */
export const RESOURCE_REQUEST_TRANSITIONS: Readonly<Record<string, readonly RRState[]>> = {
  draft: ["submitted", "cancelled"],
  submitted: ["triaged", "cancelled"],
  triaged: ["sourcing", "cancelled"],
  sourcing: ["assigned", "cancelled"],
  assigned: ["deployed", "cancelled"],
  deployed: ["demobilizing"],
  demobilizing: ["closed"],
  closed: [],
  cancelled: [],
};
