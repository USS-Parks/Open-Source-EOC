import { defineEnum, type Citation } from "./citations.js";

const CITATION: Citation = {
  authority: "FEMA",
  document:
    "National Incident Management System, Third Edition (October 2017); NIMS ICS Forms Booklet FEMA 502-2, ICS-213RR",
  section: "Resource management process: identify, order, mobilize, track, demobilize",
};

/**
 * Lifecycle states of a resource request (the 213RR lane). Receipt
 * (`submitted`) never implies acceptance: the receiving organization accepts,
 * which records who owns the request, or declines it with a reason.
 */
export const RESOURCE_REQUEST_STATES = defineEnum(
  "resource_request.states",
  [
    "draft",
    "submitted",
    "accepted",
    "sourcing",
    "assigned",
    "deployed",
    "fulfilled",
    "demobilizing",
    "closed",
    "declined",
    "cancelled",
  ],
  CITATION,
  // Accepted took the place of triaged; a record or a queued field edit from before still reads.
  { triaged: "accepted" },
);

type RRState = (typeof RESOURCE_REQUEST_STATES.values)[number];

/**
 * Allowed transitions. Terminal states (`closed`, `declined`, `cancelled`)
 * have no outgoing edges. Cancellation is reachable until a resource is
 * deployed; a deployed resource is fulfilled or demobilized.
 */
export const RESOURCE_REQUEST_TRANSITIONS: Readonly<Record<string, readonly RRState[]>> = {
  draft: ["submitted", "cancelled"],
  submitted: ["accepted", "declined", "cancelled"],
  accepted: ["sourcing", "declined", "cancelled"],
  sourcing: ["assigned", "cancelled"],
  assigned: ["deployed", "cancelled"],
  deployed: ["fulfilled", "demobilizing"],
  fulfilled: ["demobilizing", "closed"],
  demobilizing: ["closed"],
  closed: [],
  declined: [],
  cancelled: [],
};

/** Moves that end a request against its asker's wishes carry a reason. */
export const RESOURCE_REQUEST_REASON_REQUIRED: readonly string[] = ["declined", "cancelled"];

/** States in which a request is finished; every other state is open. */
export const RESOURCE_REQUEST_ENDED: readonly string[] = ["closed", "declined", "cancelled"];

/**
 * How each state reads to an operator: its stage, and the next action with
 * whose it is. `triaged` is the stored name of `accepted` before September
 * 2026; request histories keep it as recorded.
 */
export const RESOURCE_REQUEST_STAGES: Readonly<Record<string, { readonly label: string; readonly next: string | null }>> = {
  draft: { label: "Draft", next: "The requester submits it" },
  submitted: { label: "Received", next: "The receiving organization accepts or declines it" },
  accepted: { label: "Accepted", next: "The owner finds a source" },
  triaged: { label: "Accepted", next: "The owner finds a source" },
  sourcing: { label: "Sourcing", next: "The owner assigns it to a position or participant" },
  assigned: { label: "Assigned", next: "The assignee deploys the resource" },
  deployed: { label: "In progress", next: "The assignee confirms it is fulfilled" },
  fulfilled: { label: "Fulfilled", next: "The assignee demobilizes or closes it" },
  demobilizing: { label: "Demobilizing", next: "The assignee closes it when the resource is back" },
  closed: { label: "Closed", next: null },
  declined: { label: "Declined", next: null },
  cancelled: { label: "Cancelled", next: null },
};

/** The stage a request's state reads as; an unknown state reads as itself. */
export function requestStage(state: string): string {
  return RESOURCE_REQUEST_STAGES[state]?.label ?? state;
}

/**
 * The delivery steps the participant a request is assigned to records on an
 * incident: the next state from each state after assignment.
 */
export const RESOURCE_REQUEST_DELIVERY_STEPS: Readonly<Partial<Record<RRState, RRState>>> = {
  assigned: "deployed",
  deployed: "fulfilled",
  fulfilled: "demobilizing",
  demobilizing: "closed",
};

export function isDeliveryStep(from: string, to: string): boolean {
  return RESOURCE_REQUEST_DELIVERY_STEPS[from as RRState] === to;
}
