import { defineEnum, type Citation } from "./citations.js";

const NIMS: Citation = {
  authority: "FEMA",
  document: "National Incident Management System, Third Edition (October 2017)",
  section: "Incident Command System structure",
};

const FORMS_BOOKLET: Citation = {
  authority: "FEMA",
  document: "NIMS ICS Forms Booklet, FEMA 502-2 (September 2010)",
};

/** ICS organizational sections. */
export const ICS_SECTIONS = defineEnum(
  "ics.sections",
  [
    "command",
    "operations",
    "planning",
    "logistics",
    "finance_admin",
    "intelligence_investigations",
  ],
  NIMS,
);

/** Command Staff positions. */
export const COMMAND_STAFF = defineEnum(
  "ics.command_staff",
  [
    "incident_commander",
    "public_information_officer",
    "safety_officer",
    "liaison_officer",
  ],
  NIMS,
);

/** General Staff positions. */
export const GENERAL_STAFF = defineEnum(
  "ics.general_staff",
  [
    "operations_section_chief",
    "planning_section_chief",
    "logistics_section_chief",
    "finance_admin_section_chief",
  ],
  NIMS,
);

/** Registry entry for a standard ICS form. */
export interface IcsFormEntry {
  readonly id: string;
  readonly title: string;
  readonly citation: Citation;
}

/**
 * Standard ICS form registry. Full per-form field sets are implemented with
 * the forms engine in roster session VEOC-34; the registry is the canonical
 * list they must cover.
 */
export const ICS_FORMS: readonly IcsFormEntry[] = [
  { id: "ICS-201", title: "Incident Briefing", citation: FORMS_BOOKLET },
  { id: "ICS-202", title: "Incident Objectives", citation: FORMS_BOOKLET },
  { id: "ICS-203", title: "Organization Assignment List", citation: FORMS_BOOKLET },
  { id: "ICS-204", title: "Assignment List", citation: FORMS_BOOKLET },
  { id: "ICS-205", title: "Incident Radio Communications Plan", citation: FORMS_BOOKLET },
  { id: "ICS-205A", title: "Communications List", citation: FORMS_BOOKLET },
  { id: "ICS-206", title: "Medical Plan", citation: FORMS_BOOKLET },
  { id: "ICS-207", title: "Incident Organization Chart", citation: FORMS_BOOKLET },
  { id: "ICS-208", title: "Safety Message/Plan", citation: FORMS_BOOKLET },
  { id: "ICS-209", title: "Incident Status Summary", citation: FORMS_BOOKLET },
  { id: "ICS-210", title: "Resource Status Change", citation: FORMS_BOOKLET },
  { id: "ICS-211", title: "Incident Check-In List", citation: FORMS_BOOKLET },
  { id: "ICS-213", title: "General Message", citation: FORMS_BOOKLET },
  { id: "ICS-213RR", title: "Resource Request Message", citation: FORMS_BOOKLET },
  { id: "ICS-214", title: "Activity Log", citation: FORMS_BOOKLET },
  { id: "ICS-215", title: "Operational Planning Worksheet", citation: FORMS_BOOKLET },
  { id: "ICS-215A", title: "Incident Action Plan Safety Analysis", citation: FORMS_BOOKLET },
];
