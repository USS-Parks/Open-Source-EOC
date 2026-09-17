import { BoardTemplateSchema, type BoardTemplate } from "./fields.js";

/**
 * The standard board library (WebEOC's shipped set, expressed as data).
 * Every template validates against BoardTemplateSchema at module load in
 * tests; nothing here is code.
 */

const t = (raw: unknown): BoardTemplate => BoardTemplateSchema.parse(raw);

export const STANDARD_TEMPLATES: readonly BoardTemplate[] = [
  t({
    key: "activity_log",
    version: 1,
    title: "Activity Log",
    description: "Per-position chronology of actions taken (ICS 214 lane).",
    fields: [
      { key: "entry", label: "Entry", type: "text", required: true },
      { key: "notable", label: "Notable", type: "boolean" },
    ],
    views: [
      { key: "all", title: "All entries", columns: ["entry", "notable"] },
      { key: "notable", title: "Notable entries", columns: ["entry"], filter: [{ field: "notable", op: "eq", value: true }] },
    ],
  }),
  t({
    key: "significant_events",
    version: 1,
    title: "Significant Events",
    description: "Major-event journal for the incident.",
    fields: [
      { key: "summary", label: "Summary", type: "text", required: true, maxLength: 500 },
      { key: "details", label: "Details", type: "text" },
      { key: "occurred_at", label: "Occurred", type: "datetime", required: true },
      { key: "severity", label: "Severity", type: "enum", enumId: "symbology.status", required: true },
      { key: "verified", label: "Verified", type: "boolean", write: "admin" },
    ],
    views: [
      { key: "all", title: "All events", columns: ["occurred_at", "summary", "severity"], sort: { field: "occurred_at", dir: "desc" } },
      { key: "critical", title: "Critical", columns: ["occurred_at", "summary"], filter: [{ field: "severity", op: "eq", value: "critical" }] },
    ],
  }),
  t({
    key: "resource_request",
    version: 1,
    title: "Resource Requests",
    description: "ICS 213RR lifecycle board.",
    fields: [
      { key: "item", label: "Requested item", type: "text", required: true },
      { key: "quantity", label: "Quantity", type: "number", required: true },
      { key: "priority", label: "Priority", type: "enum", values: ["routine", "priority", "immediate"], required: true },
      { key: "state", label: "State", type: "enum", enumId: "resource_request.states", required: true },
      { key: "needed_by", label: "Needed by", type: "datetime" },
      { key: "notes", label: "Notes", type: "text" },
    ],
    views: [
      { key: "open", title: "Open requests", columns: ["item", "quantity", "priority", "state"], filter: [{ field: "state", op: "in", value: ["submitted", "triaged", "sourcing", "assigned", "deployed"] }] },
      { key: "all", title: "All requests", columns: ["item", "quantity", "state"] },
    ],
  }),
  t({
    key: "shelters",
    version: 1,
    title: "Shelters",
    description: "Shelter status and occupancy.",
    fields: [
      { key: "name", label: "Shelter", type: "text", required: true },
      { key: "status", label: "Status", type: "enum", enumId: "have.facility_operating_status", required: true },
      { key: "capacity", label: "Capacity", type: "number", required: true },
      { key: "occupancy", label: "Occupancy", type: "number", required: true },
      { key: "pets_accepted", label: "Pets accepted", type: "boolean" },
    ],
    views: [
      { key: "open", title: "Operating shelters", columns: ["name", "status", "capacity", "occupancy"], filter: [{ field: "status", op: "neq", value: "closed" }] },
      { key: "all", title: "All shelters", columns: ["name", "status", "occupancy"] },
    ],
  }),
  t({
    key: "road_closures",
    version: 1,
    title: "Road Closures",
    description: "Closures, roadblocks, and detours.",
    fields: [
      { key: "road", label: "Road", type: "text", required: true },
      { key: "reason", label: "Reason", type: "text", required: true },
      { key: "status", label: "Status", type: "enum", values: ["closed", "one_lane", "reopened"], required: true },
      { key: "reopen_estimate", label: "Estimated reopening", type: "datetime" },
      { key: "location", label: "Location", type: "geometry", geometryKind: "any" },
    ],
    views: [
      { key: "active", title: "Active closures", columns: ["road", "reason", "status"], filter: [{ field: "status", op: "neq", value: "reopened" }] },
      { key: "all", title: "All closures", columns: ["road", "status"] },
    ],
  }),
  t({
    key: "sign_in_out",
    version: 1,
    title: "Sign In/Out",
    description: "EOC staffing check-in board.",
    fields: [
      { key: "person", label: "Person", type: "person_ref", required: true },
      { key: "role_note", label: "Role", type: "text" },
      { key: "signed_in", label: "Signed in", type: "datetime", required: true },
      { key: "signed_out", label: "Signed out", type: "datetime" },
    ],
    views: [{ key: "present", title: "Currently present", columns: ["person", "role_note", "signed_in"] }],
  }),
  t({
    key: "situation_report",
    version: 1,
    title: "Situation Report",
    description: "Periodic situation summaries.",
    fields: [
      { key: "period", label: "Operational period", type: "text", required: true },
      { key: "summary", label: "Summary", type: "text", required: true },
      { key: "outlook", label: "Outlook", type: "text" },
      { key: "approved", label: "Approved", type: "boolean", write: "admin" },
    ],
    views: [{ key: "all", title: "All reports", columns: ["period", "summary", "approved"] }],
  }),
  t({
    key: "press_releases",
    version: 1,
    title: "Press Releases",
    description: "Public information drafts and releases (JIC lane).",
    fields: [
      { key: "headline", label: "Headline", type: "text", required: true, maxLength: 200 },
      { key: "body", label: "Body", type: "text", required: true },
      { key: "status", label: "Status", type: "enum", values: ["draft", "review", "approved", "published"], required: true, write: "admin" },
    ],
    views: [
      { key: "published", title: "Published", columns: ["headline"], filter: [{ field: "status", op: "eq", value: "published" }] },
      { key: "all", title: "All releases", columns: ["headline", "status"] },
    ],
  }),
  t({
    key: "checklists",
    version: 1,
    title: "Checklists",
    description: "Activation and position checklists.",
    fields: [
      { key: "item", label: "Checklist item", type: "text", required: true },
      { key: "done", label: "Done", type: "boolean" },
      { key: "assigned_to", label: "Assigned to", type: "person_ref" },
    ],
    views: [
      { key: "open", title: "Open items", columns: ["item", "assigned_to"], filter: [{ field: "done", op: "neq", value: true }] },
      { key: "all", title: "All items", columns: ["item", "done"] },
    ],
  }),
  t({
    key: "after_action_review",
    version: 1,
    title: "After Action Review",
    description: "Observations and corrective actions.",
    fields: [
      { key: "observation", label: "Observation", type: "text", required: true },
      { key: "recommendation", label: "Recommendation", type: "text" },
      { key: "kind", label: "Kind", type: "enum", values: ["strength", "improvement"], required: true },
      { key: "resolved", label: "Resolved", type: "boolean", write: "admin" },
    ],
    views: [
      { key: "open", title: "Open improvements", columns: ["observation", "recommendation"], filter: [{ field: "kind", op: "eq", value: "improvement" }, { field: "resolved", op: "neq", value: true }] },
      { key: "all", title: "All observations", columns: ["observation", "kind", "resolved"] },
    ],
  }),
];
