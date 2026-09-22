import { sectionForPosition } from "../collab/plan.js";

/**
 * Electronic ICS forms and IAP assembly (VEOC-34, F5). The forms are built
 * purely from a normalized incident context, so prefill is deterministic and
 * golden-testable with no database. The server gathers the live context
 * (org chart, assignments, activity log, comms) and calls these; the IAP
 * builder assembles an operational period's forms into one document that the
 * PDF writer renders.
 */

export interface OrgEntry {
  readonly section: string;
  readonly positionKey: string;
  readonly positionTitle: string;
  readonly holder: string | null;
}
export interface ActivityLogEntry {
  readonly time: string;
  readonly entry: string;
}
export interface CheckInEntry {
  readonly name: string;
  readonly time: string;
}
export interface CommsChannel {
  readonly channel: string;
  readonly frequency: string;
  readonly assignment: string;
}
export interface ResourceLine {
  readonly item: string;
  readonly quantity: string;
  readonly state: string;
}

export type Ics204SupervisorAuthority =
  | {
      readonly kind: "position";
      readonly organizationId: string;
      readonly organizationName: string;
      readonly positionId: string;
      readonly positionKey: string;
      readonly positionTitle: string;
      readonly personId: string;
      readonly personName: string;
      readonly authority: "local_writer";
    }
  | {
      readonly kind: "incident_participant";
      readonly organizationId: string;
      readonly organizationName: string;
      readonly participantId: string;
      readonly personId: string;
      readonly personName: string;
      readonly incidentPositionTitle: string;
      readonly participantRole: "contributor" | "coordinator";
      readonly authority: "incident_owner_admin" | "incident_coordinator";
      readonly actorParticipationId: string | null;
    };

export interface Ics204AssignedResource {
  readonly name: string;
  readonly identifier: string;
  readonly leader: string;
  readonly quantity: string;
  readonly notes: string;
}

export interface Ics204Assignment {
  readonly id: string;
  readonly name: string;
  readonly supervisor: Ics204SupervisorAuthority;
  readonly tactics: readonly string[];
  readonly resources: readonly Ics204AssignedResource[];
}

export interface IncidentContext {
  readonly incidentName: string;
  readonly operationalPeriod: string;
  readonly preparedBy: string;
  readonly objectives: readonly string[];
  readonly org: readonly OrgEntry[];
  readonly activityLog: readonly ActivityLogEntry[];
  readonly checkIns: readonly CheckInEntry[];
  readonly comms: readonly CommsChannel[];
  readonly resources: readonly ResourceLine[];
  readonly safetyMessage?: string;
  readonly medicalFacilities?: readonly string[];
}

export interface FormSection {
  readonly heading: string;
  readonly lines?: readonly string[];
  readonly columns?: readonly string[];
  readonly rows?: readonly (readonly string[])[];
}
export interface IcsFormContent {
  readonly id: string;
  readonly title: string;
  readonly incidentName: string;
  readonly operationalPeriod: string;
  readonly preparedBy: string;
  readonly sections: readonly FormSection[];
}

/** The 12 electronic ICS forms this module builds. */
export const ICS_FORM_IDS = [
  "ICS-201",
  "ICS-202",
  "ICS-203",
  "ICS-204",
  "ICS-205",
  "ICS-206",
  "ICS-207",
  "ICS-208",
  "ICS-211",
  "ICS-213",
  "ICS-214",
  "ICS-215",
] as const;
export type IcsFormId = (typeof ICS_FORM_IDS)[number];

const TITLES: Record<IcsFormId, string> = {
  "ICS-201": "Incident Briefing",
  "ICS-202": "Incident Objectives",
  "ICS-203": "Organization Assignment List",
  "ICS-204": "Assignment List",
  "ICS-205": "Incident Radio Communications Plan",
  "ICS-206": "Medical Plan",
  "ICS-207": "Incident Organization Chart",
  "ICS-208": "Safety Message/Plan",
  "ICS-211": "Incident Check-In List",
  "ICS-213": "General Message",
  "ICS-214": "Activity Log",
  "ICS-215": "Operational Planning Worksheet",
};

/** The forms a standard IAP assembles, in order. */
export const DEFAULT_IAP_FORMS: readonly IcsFormId[] = [
  "ICS-202",
  "ICS-203",
  "ICS-204",
  "ICS-205",
  "ICS-206",
  "ICS-207",
  "ICS-208",
];

function orgRows(ctx: IncidentContext): string[][] {
  return ctx.org.map((o) => [o.positionTitle, o.holder ?? "(unassigned)"]);
}

/** Build one prefilled ICS form from the incident context. */
export function buildIcsForm(formId: IcsFormId, ctx: IncidentContext): IcsFormContent {
  const base = {
    id: formId,
    title: TITLES[formId],
    incidentName: ctx.incidentName,
    operationalPeriod: ctx.operationalPeriod,
    preparedBy: ctx.preparedBy,
  };
  const sections: FormSection[] = [];
  switch (formId) {
    case "ICS-201":
      sections.push({ heading: "Current Objectives", lines: [...ctx.objectives] });
      sections.push({ heading: "Current Organization", columns: ["Position", "Name"], rows: orgRows(ctx) });
      sections.push({
        heading: "Resource Summary",
        columns: ["Resource", "Quantity", "Status"],
        rows: ctx.resources.map((r) => [r.item, r.quantity, r.state]),
      });
      break;
    case "ICS-202":
      sections.push({ heading: "Objectives", lines: [...ctx.objectives] });
      break;
    case "ICS-203":
      sections.push({
        heading: "Organization Assignment List",
        columns: ["Position", "Name"],
        rows: orgRows(ctx),
      });
      break;
    case "ICS-204": {
      const operations = ctx.org.filter((o) => o.section === "operations");
      sections.push({
        heading: "Operations Assignments",
        columns: ["Position", "Name"],
        rows: operations.map((o) => [o.positionTitle, o.holder ?? "(unassigned)"]),
      });
      break;
    }
    case "ICS-205":
      sections.push({
        heading: "Radio Channels",
        columns: ["Channel", "Frequency", "Assignment"],
        rows: ctx.comms.map((c) => [c.channel, c.frequency, c.assignment]),
      });
      break;
    case "ICS-206":
      sections.push({ heading: "Medical Aid Stations / Facilities", lines: [...(ctx.medicalFacilities ?? [])] });
      break;
    case "ICS-207": {
      const bySection = new Map<string, string[]>();
      for (const o of ctx.org) {
        if (!bySection.has(o.section)) bySection.set(o.section, []);
        bySection.get(o.section)!.push(`${o.positionTitle}: ${o.holder ?? "(unassigned)"}`);
      }
      for (const section of [...bySection.keys()].sort())
        sections.push({ heading: sectionLabel(section), lines: bySection.get(section)! });
      break;
    }
    case "ICS-208":
      sections.push({ heading: "Safety Message", lines: [ctx.safetyMessage ?? "No safety message recorded."] });
      break;
    case "ICS-211":
      sections.push({
        heading: "Check-In List",
        columns: ["Resource / Name", "Check-In Time"],
        rows: ctx.checkIns.map((c) => [c.name, c.time]),
      });
      break;
    case "ICS-213":
      sections.push({ heading: "General Message", lines: ["To:", "From:", "Subject:", "Message:"] });
      break;
    case "ICS-214":
      sections.push({
        heading: "Activity Log",
        columns: ["Time", "Notable Activity"],
        rows: ctx.activityLog.map((a) => [a.time, a.entry]),
      });
      break;
    case "ICS-215":
      sections.push({
        heading: "Operational Planning Worksheet",
        columns: ["Resource / Requirement", "Quantity", "Status"],
        rows: ctx.resources.map((r) => [r.item, r.quantity, r.state]),
      });
      break;
  }
  return { ...base, sections };
}

function sectionLabel(section: string): string {
  return section
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export interface IapDocument {
  readonly incidentName: string;
  readonly operationalPeriod: string;
  readonly preparedBy: string;
  readonly forms: readonly IcsFormContent[];
  readonly ics204Assignments?: readonly Ics204Assignment[];
}

/** Assemble the operational period's forms into one IAP document. */
export function assembleIap(
  ctx: IncidentContext,
  formIds: readonly IcsFormId[] = DEFAULT_IAP_FORMS,
): IapDocument {
  return {
    incidentName: ctx.incidentName,
    operationalPeriod: ctx.operationalPeriod,
    preparedBy: ctx.preparedBy,
    forms: formIds.map((id) => buildIcsForm(id, ctx)),
  };
}

function supervisorLines(supervisor: Ics204SupervisorAuthority): string[] {
  const title = supervisor.kind === "position"
    ? supervisor.positionTitle
    : supervisor.incidentPositionTitle;
  const grant = supervisor.kind === "incident_participant"
    ? `Named incident authority: ${supervisor.participantRole} (${supervisor.participantId})`
    : `Position authority: ${supervisor.positionKey} (${supervisor.positionId})`;
  return [
    `Supervisor: ${supervisor.personName} - ${title}`,
    `Organization: ${supervisor.organizationName} (${supervisor.organizationId})`,
    grant,
    `Assignment authority: ${supervisor.authority}`,
  ];
}

/** Replace the ICS-204 form in a stored IAP snapshot without changing other forms. */
export function withIcs204Assignments(
  iap: IapDocument,
  assignments: readonly Ics204Assignment[],
): IapDocument {
  const form: IcsFormContent = {
    id: "ICS-204",
    title: TITLES["ICS-204"],
    incidentName: iap.incidentName,
    operationalPeriod: iap.operationalPeriod,
    preparedBy: iap.preparedBy,
    sections: assignments.flatMap((assignment) => [
      {
        heading: `Assignment: ${assignment.name}`,
        lines: supervisorLines(assignment.supervisor),
      },
      {
        heading: `Tactics - ${assignment.name}`,
        lines: [...assignment.tactics],
      },
      {
        heading: `Resources - ${assignment.name}`,
        columns: ["Resource", "Identifier", "Leader", "Quantity", "Notes"],
        rows: assignment.resources.map((resource) => [
          resource.name,
          resource.identifier,
          resource.leader,
          resource.quantity,
          resource.notes,
        ]),
      },
    ]),
  };
  const current = iap.forms.findIndex((candidate) => candidate.id === "ICS-204");
  const forms = [...iap.forms];
  if (current >= 0) forms[current] = form;
  else forms.push(form);
  return { ...iap, forms, ics204Assignments: [...assignments] };
}

/** Ensure position keys route to a known ICS section (re-exported helper). */
export function orgSectionFor(positionKey: string): string {
  return sectionForPosition(positionKey);
}

/** A deterministic, flat text projection of an IAP for rendering and snapshots. */
export function iapToTextLines(iap: IapDocument): string[] {
  const lines: string[] = [];
  lines.push(`INCIDENT ACTION PLAN`);
  lines.push(`Incident: ${iap.incidentName}`);
  lines.push(`Operational Period: ${iap.operationalPeriod}`);
  lines.push(`Prepared by: ${iap.preparedBy}`);
  lines.push("");
  for (const form of iap.forms) {
    lines.push(`${form.id} ${form.title}`);
    for (const section of form.sections) {
      lines.push(`  ${section.heading}`);
      if (section.columns) lines.push(`    ${section.columns.join(" | ")}`);
      for (const row of section.rows ?? []) lines.push(`    ${row.join(" | ")}`);
      for (const line of section.lines ?? []) lines.push(`    ${line}`);
    }
    lines.push("");
  }
  return lines;
}
