import { z } from "zod";
import type { FormSection, IcsFormContent, IncidentContext } from "./forms.js";

/**
 * ICS forms as components of an incident's operational period (Veoci and air
 * gap VA37). Each form is a set of fields laid out after the NIMS ICS Forms
 * Booklet, numbered by its blocks. Blocks every form shares (the incident
 * name, the operational period and "prepared by") come from the component's
 * incident, period and the person who saved it, so they are not fields here.
 * A component's values are validated against its form, prefilled from the
 * incident's own records, and rendered to the same sections the IAP and the
 * PDF writer print.
 */

/** The edition each form's layout follows; recorded on every component. */
export const ICS_COMPONENT_EDITION = "NIMS ICS Forms Booklet, FEMA 502-2 (September 2010)";

export const ICS_COMPONENT_FORM_IDS = [
  "ICS-201", "ICS-202", "ICS-203", "ICS-204", "ICS-205", "ICS-205A", "ICS-206", "ICS-207",
  "ICS-208", "ICS-209", "ICS-211", "ICS-213", "ICS-214", "ICS-215", "ICS-215A",
] as const;
export type IcsComponentFormId = (typeof ICS_COMPONENT_FORM_IDS)[number];

export type ComponentFieldKind = "text" | "multiline" | "datetime" | "choice" | "checks" | "table";

export interface ComponentField {
  readonly key: string;
  /** The block on the Forms Booklet layout, such as "3" or "5b". */
  readonly block: string;
  readonly label: string;
  readonly kind: ComponentFieldKind;
  /** For a choice or checks field. */
  readonly options?: readonly string[];
  /** For a table field. */
  readonly columns?: readonly string[];
  /** Rows a new table starts with, for a table whose rows the booklet names. */
  readonly rows?: readonly (readonly string[])[];
}

export interface ComponentForm {
  readonly id: IcsComponentFormId;
  readonly title: string;
  /** Whether a period holds several of this form, told apart by a label. */
  readonly many: boolean;
  /** What the label names, for a form a period holds several of. */
  readonly labelHint?: string;
  readonly fields: readonly ComponentField[];
}

export type ComponentValue = string | readonly string[] | readonly (readonly string[])[];
export type ComponentValues = Readonly<Record<string, ComponentValue>>;

const YES_NO = ["Yes", "No"] as const;
const PERIODS = ["12 hours", "24 hours", "48 hours", "72 hours", "Anticipated after 72 hours"];
const periodRows = PERIODS.map((period) => [period, ""]);
const text = (key: string, block: string, label: string): ComponentField => ({ key, block, label, kind: "text" });
const long = (key: string, block: string, label: string): ComponentField => ({ key, block, label, kind: "multiline" });
const when = (key: string, block: string, label: string): ComponentField => ({ key, block, label, kind: "datetime" });
const choice = (key: string, block: string, label: string, options: readonly string[]): ComponentField =>
  ({ key, block, label, kind: "choice", options });
const checks = (key: string, block: string, label: string, options: readonly string[]): ComponentField =>
  ({ key, block, label, kind: "checks", options });
const table = (key: string, block: string, label: string, columns: readonly string[], rows?: readonly (readonly string[])[]): ComponentField =>
  ({ key, block, label, kind: "table", columns, ...(rows ? { rows } : {}) });

export const ICS_COMPONENT_FORMS: Readonly<Record<IcsComponentFormId, ComponentForm>> = {
  "ICS-201": {
    id: "ICS-201", title: "Incident Briefing", many: false,
    fields: [
      when("initiated", "3", "Date/Time Initiated"),
      long("mapSketch", "4", "Map/Sketch (describe, or name the attached map)"),
      long("situation", "5", "Situation Summary and Health and Safety Briefing"),
      long("objectives", "7", "Current and Planned Objectives"),
      table("actions", "8", "Current and Planned Actions, Strategies, and Tactics", ["Time", "Actions"]),
      table("organization", "9", "Current Organization", ["Position", "Name"]),
      table("resources", "10", "Resource Summary", ["Resource", "Resource Identifier", "Date/Time Ordered", "ETA", "Arrived", "Notes"]),
    ],
  },
  "ICS-202": {
    id: "ICS-202", title: "Incident Objectives", many: false,
    fields: [
      long("objectives", "3", "Objective(s)"),
      long("commandEmphasis", "4", "Operational Period Command Emphasis"),
      long("situationalAwareness", "4", "General Situational Awareness"),
      choice("siteSafetyPlanRequired", "5", "Site Safety Plan Required?", YES_NO),
      text("siteSafetyPlanLocation", "5", "Approved Site Safety Plan(s) Located At"),
      checks("attachments", "6", "Incident Action Plan (the items checked are included)", [
        "ICS 203", "ICS 204", "ICS 205", "ICS 205A", "ICS 206", "ICS 207", "ICS 208",
        "Map/Chart", "Weather Forecast/Tides/Currents", "Other Attachments",
      ]),
    ],
  },
  "ICS-203": {
    id: "ICS-203", title: "Organization Assignment List", many: false,
    fields: [
      table("command", "3", "Incident Commander(s) and Command Staff", ["Position", "Name"]),
      table("representatives", "4", "Agency/Organization Representatives", ["Agency/Organization", "Name"]),
      table("planning", "5", "Planning Section", ["Position", "Name"]),
      table("logistics", "6", "Logistics Section", ["Position", "Name"]),
      table("operations", "7", "Operations Section", ["Position", "Name"]),
      table("finance", "8", "Finance/Administration Section", ["Position", "Name"]),
    ],
  },
  "ICS-204": {
    id: "ICS-204", title: "Assignment List", many: true, labelHint: "Branch, division, group or staging area",
    fields: [
      text("branch", "3", "Branch"),
      text("division", "3", "Division"),
      text("group", "3", "Group"),
      text("stagingArea", "3", "Staging Area"),
      table("personnel", "4", "Operations Personnel", ["Position", "Name", "Contact Number(s)"], [
        ["Operations Section Chief", "", ""], ["Branch Director", "", ""],
        ["Division/Group Supervisor", "", ""], ["Staging Area Manager", "", ""],
      ]),
      table("resources", "5", "Resources Assigned",
        ["Resource Identifier", "Leader", "Number of Persons", "Contact", "Reporting Location, Special Equipment and Supplies, Remarks"]),
      long("workAssignments", "6", "Work Assignments"),
      long("specialInstructions", "7", "Special Instructions"),
      table("communications", "8", "Communications", ["Name/Function", "Primary Contact (cell, pager, or radio frequency/system/channel)"]),
    ],
  },
  "ICS-205": {
    id: "ICS-205", title: "Incident Radio Communications Plan", many: false,
    fields: [
      table("channels", "4", "Basic Radio Channel Use", [
        "Zone Group", "Channel Number", "Function", "Channel Name/Trunked Radio System Talkgroup", "Assignment",
        "RX Frequency (N or W)", "RX Tone/NAC", "TX Frequency (N or W)", "TX Tone/NAC", "Mode (A, D, or M)", "Remarks",
      ]),
      long("specialInstructions", "5", "Special Instructions"),
    ],
  },
  "ICS-205A": {
    id: "ICS-205A", title: "Communications List", many: false,
    fields: [
      table("contacts", "3", "Basic Local Communications Information",
        ["Incident Assigned Position", "Name", "Method(s) of Contact (phone, pager, cell, etc.)"]),
    ],
  },
  "ICS-206": {
    id: "ICS-206", title: "Medical Plan", many: false,
    fields: [
      table("aidStations", "3", "Medical Aid Stations", ["Name", "Location", "Contact Number(s)/Frequency", "Paramedics on Site?"]),
      table("transportation", "4", "Transportation", ["Ambulance Service", "Location", "Contact Number(s)/Frequency", "Level of Service (ALS or BLS)"]),
      table("hospitals", "5", "Hospitals", [
        "Hospital Name", "Address, Latitude & Longitude if Helipad", "Contact Number(s)/Frequency",
        "Travel Time (Air)", "Travel Time (Ground)", "Trauma Center (level)", "Burn Center", "Helipad",
      ]),
      long("procedures", "6", "Special Medical Emergency Procedures"),
      checks("aviation", "6", "Aviation assets", ["Aviation assets are utilized for rescue; coordinate with Air Operations"]),
      text("safetyOfficer", "8", "Approved by (Safety Officer)"),
    ],
  },
  "ICS-207": {
    id: "ICS-207", title: "Incident Organization Chart", many: false,
    fields: [table("chart", "3", "Organization Chart", ["Section", "Position", "Name"])],
  },
  "ICS-208": {
    id: "ICS-208", title: "Safety Message/Plan", many: false,
    fields: [
      long("message", "3", "Safety Message/Expanded Safety Message, Safety Plan, Site Safety Plan"),
      choice("siteSafetyPlanRequired", "4", "Site Safety Plan Required?", YES_NO),
      text("siteSafetyPlanLocation", "4", "Approved Site Safety Plan(s) Located At"),
    ],
  },
  "ICS-209": {
    id: "ICS-209", title: "Incident Status Summary", many: false,
    fields: [
      choice("reportVersion", "3", "Report Version", ["Initial", "Update", "Final"]),
      text("commanders", "4", "Incident Commander(s) & Agency or Organization"),
      text("managementOrganization", "5", "Incident Management Organization"),
      when("started", "6", "Incident Start Date/Time"),
      text("size", "7", "Current Incident Size or Area Involved"),
      text("percentContained", "8", "Percent (%) Contained or Completed"),
      text("definition", "9", "Incident Definition"),
      text("complexity", "10", "Incident Complexity Level"),
      text("sentTo", "15", "Primary Location, Organization, or Agency Sent To"),
      text("state", "16", "State"),
      text("county", "17", "County/Parish/Borough"),
      text("city", "18", "City"),
      text("locationDescription", "25", "Short Location or Area Description"),
      long("significantEvents", "28", "Significant Events for the Time Period Reported"),
      long("hazards", "29", "Primary Materials or Hazards Involved"),
      table("damage", "30", "Damage Assessment Information", ["Structural Summary", "# Threatened (72 hrs)", "# Damaged", "# Destroyed"], [
        ["Single Residences", "", "", ""], ["Nonresidential Commercial Property", "", "", ""], ["Other Minor Structures", "", "", ""],
      ]),
      table("publicStatus", "31", "Public Status Summary", ["Civilians (Public) Status", "# This Reporting Period", "Total # to Date"], [
        "Fatalities", "With Injuries/Illness", "Trapped/In Need of Rescue", "Missing", "Evacuated", "Sheltering in Place",
        "In Temporary Shelters", "Have Received Mass Immunizations", "Require Immunizations", "In Quarantine",
      ].map((row) => [row, "", ""])),
      table("responderStatus", "32", "Responder Status Summary", ["Responder Status", "# This Reporting Period", "Total # to Date"], [
        "Fatalities", "With Injuries/Illness", "Trapped/In Need of Rescue", "Missing", "Sheltering in Place",
        "Have Received Immunizations", "Require Immunizations", "In Quarantine",
      ].map((row) => [row, "", ""])),
      long("lifeSafetyRemarks", "33", "Life, Safety, and Health Status/Threat Remarks"),
      checks("threatManagement", "34", "Life, Safety, and Health Threat Management", [
        "No Likely Threat", "Potential Future Threat", "Mass Notifications in Progress", "Mass Notifications Completed",
        "No Evacuation(s) Imminent", "Planning for Evacuation", "Planning for Shelter-in-Place", "Evacuation(s) in Progress",
        "Shelter-in-Place in Progress", "Repopulation in Progress", "Mass Immunization in Progress", "Mass Immunization Complete",
        "Quarantine in Progress", "Area Restriction in Effect",
      ]),
      long("weather", "35", "Weather Concerns"),
      table("projectedActivity", "36", "Projected Incident Activity, Potential, Movement, Escalation, or Spread", ["Period", "Projection"], periodRows),
      long("strategicObjectives", "37", "Strategic Objectives"),
      table("threatSummary", "38", "Current Incident Threat Summary and Risk Information", ["Period", "Summary"], periodRows),
      table("criticalNeeds", "39", "Critical Resource Needs", ["Period", "Needs"], periodRows),
      long("strategicDiscussion", "40", "Strategic Discussion"),
      long("plannedActions", "41", "Planned Actions for Next Operational Period"),
      text("projectedSize", "42", "Projected Final Incident Size/Area"),
      text("completionDate", "43", "Anticipated Incident Management Completion Date"),
      text("costToDate", "45", "Estimated Incident Costs to Date"),
      text("projectedCost", "46", "Projected Final Incident Cost Estimate"),
      long("remarks", "47", "Remarks"),
      table("resources", "49", "Incident Resource Commitment Summary",
        ["Agency or Organization", "Resource Kind", "Number of Resources", "Number of Personnel"]),
      long("cooperatingOrganizations", "53", "Additional Cooperating and Assisting Organizations Not Listed Above"),
    ],
  },
  "ICS-211": {
    id: "ICS-211", title: "Incident Check-In List", many: false,
    fields: [
      choice("location", "3", "Check-In Location", ["Base", "Camp", "Staging Area", "ICP", "Helibase", "Other"]),
      when("start", "4", "Start Date/Time"),
      table("checkIns", "5", "Check-In Information", [
        "Resource Name or Identifier", "Agency/Organization", "Kind and Type", "Order Request #", "Date/Time Check-In",
        "Leader's Name", "Total Personnel", "Incident Contact Information", "Home Unit or Agency", "Incident Assignment",
      ]),
    ],
  },
  "ICS-213": {
    id: "ICS-213", title: "General Message", many: true, labelHint: "Subject",
    fields: [
      text("to", "2", "To (Name and Position)"),
      text("from", "3", "From (Name and Position)"),
      text("subject", "4", "Subject"),
      when("sent", "5", "Date/Time"),
      long("message", "7", "Message"),
      text("approvedBy", "8", "Approved by (Name, Position/Title)"),
      long("reply", "9", "Reply"),
      text("repliedBy", "10", "Replied by (Name, Position/Title, Date/Time)"),
    ],
  },
  "ICS-214": {
    id: "ICS-214", title: "Activity Log", many: true, labelHint: "Name and ICS position",
    fields: [
      text("name", "3", "Name"),
      text("position", "4", "ICS Position"),
      text("homeAgency", "5", "Home Agency (and Unit)"),
      table("resources", "6", "Resources Assigned", ["Name", "ICS Position", "Home Agency (and Unit)"]),
      table("activity", "7", "Activity Log", ["Date/Time", "Notable Activities"]),
    ],
  },
  "ICS-215": {
    id: "ICS-215", title: "Operational Planning Worksheet", many: false,
    fields: [
      table("assignments", "3", "Work Assignments", [
        "Branch", "Division, Group, or Other", "Work Assignment & Special Instructions", "Resources Required",
        "Resources Have", "Resources Need", "Overhead Position(s)", "Special Equipment & Supplies",
        "Reporting Location", "Requested Arrival Time",
      ]),
      text("totalRequired", "11", "Total Resources Required"),
      text("totalHave", "12", "Total Resources Have on Hand"),
      text("totalNeed", "13", "Total Resources Need to Order"),
    ],
  },
  "ICS-215A": {
    id: "ICS-215A", title: "Incident Action Plan Safety Analysis", many: false,
    fields: [
      text("location", "2", "Incident Location"),
      table("analysis", "4", "Hazards and Mitigations", ["Incident Area", "Hazards/Risks", "Mitigations"]),
      text("operationsChief", "5", "Prepared by (Operations Section Chief)"),
    ],
  },
};

export function isComponentFormId(value: string): value is IcsComponentFormId {
  return (ICS_COMPONENT_FORM_IDS as readonly string[]).includes(value);
}

/** "ICS-205A" as "ICS 205A: Communications List". */
export function componentFormLabel(formId: IcsComponentFormId): string {
  return `${formId.replace("-", " ")}: ${ICS_COMPONENT_FORMS[formId].title}`;
}

const TEXT_LIMIT = 4000;
const LONG_LIMIT = 20000;
const CELL_LIMIT = 2000;
const ROW_LIMIT = 300;

function fieldSchema(field: ComponentField): z.ZodType {
  switch (field.kind) {
    case "text":
    case "datetime":
      return z.string().max(TEXT_LIMIT);
    case "multiline":
      return z.string().max(LONG_LIMIT);
    case "choice":
      return z.union([z.literal(""), z.enum(field.options as [string, ...string[]])]);
    case "checks":
      return z.array(z.enum(field.options as [string, ...string[]])).max(field.options!.length)
        .refine((values) => new Set(values).size === values.length, "an option is checked twice");
    case "table":
      return z.array(z.array(z.string().max(CELL_LIMIT)).length(field.columns!.length)).max(ROW_LIMIT);
  }
}

/** A field's value before anything is entered. */
export function emptyValue(field: ComponentField): ComponentValue {
  if (field.kind === "checks") return [];
  if (field.kind === "table") return (field.rows ?? []).map((row) => [...row]);
  return "";
}

/**
 * A component's values, checked against its form: every field present (a
 * missing one takes its empty value), each of its kind and size, and no field
 * the form does not have. Throws a ZodError naming the field.
 */
export function validateComponentValues(formId: IcsComponentFormId, values: unknown): Record<string, ComponentValue> {
  const form = ICS_COMPONENT_FORMS[formId];
  const shape = Object.fromEntries(form.fields.map((field) => [field.key, fieldSchema(field).optional()]));
  const parsed = z.object(shape).strict().parse(values ?? {}) as Record<string, ComponentValue | undefined>;
  return Object.fromEntries(form.fields.map((field) => [field.key, parsed[field.key] ?? emptyValue(field)]));
}

/** What a prefill reads beside the incident's records. */
export interface ComponentPrefillExtras {
  /** The acting position of the person starting the form, for a 214. */
  readonly preparedRole?: string;
  /** When the incident opened, for a 201 and a 209. */
  readonly incidentStart?: string;
}

const orgRows = (ctx: IncidentContext, sections?: readonly string[]) => ctx.org
  .filter((entry) => !sections || sections.includes(entry.section))
  .map((entry) => [entry.positionTitle, entry.holder ?? ""]);

/**
 * A new component's values, drawn from the incident's own records: its
 * positions and their holders, the activity log, check-ins, the resource
 * requests and the radio channels board. What the records do not hold stays
 * empty for the preparer.
 */
export function prefillComponent(formId: IcsComponentFormId, ctx: IncidentContext, extras: ComponentPrefillExtras = {}): Record<string, ComponentValue> {
  const values: Record<string, ComponentValue> = Object.fromEntries(
    ICS_COMPONENT_FORMS[formId].fields.map((field) => [field.key, emptyValue(field)]));
  const objectives = ctx.objectives.join("\n");
  const log = ctx.activityLog.map((entry) => [entry.time, entry.entry]);
  switch (formId) {
    case "ICS-201":
      values.initiated = extras.incidentStart ?? "";
      values.objectives = objectives;
      values.organization = orgRows(ctx);
      values.resources = ctx.resources.map((r) => [r.item, "", "", "", "", [r.quantity && `Quantity ${r.quantity}`, r.state].filter(Boolean).join("; ")]);
      break;
    case "ICS-202":
      values.objectives = objectives;
      values.attachments = ["ICS 203", "ICS 204", "ICS 205", "ICS 206", "ICS 207", "ICS 208"];
      break;
    case "ICS-203":
      values.command = orgRows(ctx, ["command"]);
      values.planning = orgRows(ctx, ["planning"]);
      values.logistics = orgRows(ctx, ["logistics"]);
      values.operations = orgRows(ctx, ["operations"]);
      values.finance = orgRows(ctx, ["finance_admin"]);
      break;
    case "ICS-204": {
      const chief = ctx.org.find((entry) => entry.positionKey === "operations_section_chief");
      const personnel = values.personnel as string[][];
      if (chief?.holder) personnel[0] = ["Operations Section Chief", chief.holder, ""];
      break;
    }
    case "ICS-205":
      values.channels = ctx.comms.map((c) => ["", "", "", c.channel, c.assignment, c.frequency, "", c.frequency, "", "", ""]);
      break;
    case "ICS-205A":
      values.contacts = orgRows(ctx).map(([position, name]) => [position!, name!, ""]);
      break;
    case "ICS-206":
      values.hospitals = (ctx.medicalFacilities ?? []).map((name) => [name, "", "", "", "", "", "", ""]);
      break;
    case "ICS-207":
      values.chart = ctx.org.map((entry) => [sectionName(entry.section), entry.positionTitle, entry.holder ?? ""]);
      break;
    case "ICS-208":
      values.message = ctx.safetyMessage ?? "";
      break;
    case "ICS-209":
      values.reportVersion = "Update";
      values.started = extras.incidentStart ?? "";
      values.strategicObjectives = objectives;
      values.significantEvents = ctx.activityLog.slice(-20).map((entry) => `${entry.time} ${entry.entry}`).join("\n");
      break;
    case "ICS-211":
      values.checkIns = ctx.checkIns.map((c) => [c.name, "", "", "", c.time, "", "", "", "", ""]);
      break;
    case "ICS-213":
      values.from = [ctx.preparedBy, extras.preparedRole].filter(Boolean).join(", ");
      break;
    case "ICS-214":
      values.name = ctx.preparedBy;
      values.position = extras.preparedRole ?? "";
      values.activity = log;
      break;
    case "ICS-215":
      values.assignments = ctx.resources.map((r) => ["", "", r.item, r.quantity, "", "", "", "", "", ""]);
      break;
    case "ICS-215A":
      values.analysis = [["", "", ""]];
      break;
  }
  return values;
}

function sectionName(section: string): string {
  return section.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ").replace("Finance Admin", "Finance/Administration");
}

export interface ComponentHeader {
  readonly incidentName: string;
  readonly operationalPeriod: string;
  readonly preparedBy: string;
  readonly label?: string;
}

/** A component as the sections the IAP, the preview and the PDF writer print, every field in block order. */
export function componentToFormContent(formId: IcsComponentFormId, values: ComponentValues, header: ComponentHeader): IcsFormContent {
  const form = ICS_COMPONENT_FORMS[formId];
  const sections: FormSection[] = form.fields.map((field) => {
    const heading = `${field.block}. ${field.label}`;
    const value = values[field.key] ?? emptyValue(field);
    switch (field.kind) {
      case "checks": {
        const checked = new Set(value as readonly string[]);
        return { heading, lines: field.options!.map((option) => `[${checked.has(option) ? "X" : " "}] ${option}`) };
      }
      case "table":
        return { heading, columns: field.columns!, rows: value as readonly (readonly string[])[] };
      case "multiline":
        return { heading, lines: String(value).split("\n") };
      default:
        return { heading, lines: [String(value)] };
    }
  });
  return {
    id: formId,
    title: header.label ? `${form.title}: ${header.label}` : form.title,
    incidentName: header.incidentName,
    operationalPeriod: header.operationalPeriod,
    preparedBy: header.preparedBy,
    sections,
  };
}
