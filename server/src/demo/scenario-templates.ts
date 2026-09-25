import { COMMAND_STAFF, GENERAL_STAFF } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { IncidentTemplateSchema, type IncidentTemplate } from "../incidents/service.js";

/**
 * The activation templates the exercise scenarios start from: a wildfire
 * complex, a flood and an earthquake with tsunami. They sit beside the
 * standard library rather than in it, so the demo can seed them into any
 * database it builds; the activation picker offers the standard library.
 */
export const SCENARIO_INCIDENT_TEMPLATES: readonly IncidentTemplate[] = [
  {
    key: "wildfire_complex",
    title: "Wildfire Complex",
    positions: [...COMMAND_STAFF.values, ...GENERAL_STAFF.values],
    boards: [
      "significant_events",
      "activity_log",
      "resource_request",
      "shelters",
      "road_closures",
      "field_reports",
      "incident_facilities",
      "sign_in_out",
    ],
    checklists: [
      {
        position: "incident_commander",
        items: [
          "Assume command and announce on the significant events board",
          "Confirm unified command with every jurisdiction the fires touch",
          "Set initial incident objectives",
          "Establish the operational period",
        ],
      },
      {
        position: "operations_section_chief",
        items: ["Confirm resource status with dispatch for each fire", "Open the resource request board"],
      },
      {
        position: "planning_section_chief",
        items: ["Track each start and its perimeter", "Prepare the next operational period briefing"],
      },
      {
        position: "public_information_officer",
        items: ["Draft the initial public statement", "Agree release approval with every agency in command"],
      },
    ],
  },
  {
    key: "flood",
    title: "Flood",
    positions: [...COMMAND_STAFF.values, ...GENERAL_STAFF.values],
    boards: [
      "significant_events",
      "activity_log",
      "resource_request",
      "shelters",
      "road_closures",
      "field_reports",
      "incident_facilities",
      "damage_assessment",
      "sign_in_out",
    ],
    checklists: [
      {
        position: "incident_commander",
        items: [
          "Assume command and announce on the significant events board",
          "Set initial incident objectives",
          "Establish the operational period",
        ],
      },
      {
        position: "operations_section_chief",
        items: ["Confirm road, river and utility status with field crews", "Open the resource request board"],
      },
      {
        position: "planning_section_chief",
        items: ["Track river forecasts and the next storm's arrival", "Collect lifeline assessments for the situation report", "Start initial damage assessment"],
      },
      {
        position: "public_information_officer",
        items: ["Draft the initial public statement", "Confirm media contact roster"],
      },
    ],
  },
  {
    key: "earthquake_tsunami",
    title: "Earthquake and Tsunami",
    positions: [...COMMAND_STAFF.values, ...GENERAL_STAFF.values],
    boards: [
      "significant_events",
      "activity_log",
      "resource_request",
      "shelters",
      "road_closures",
      "field_reports",
      "incident_facilities",
      "damage_assessment",
      "sign_in_out",
    ],
    checklists: [
      {
        position: "incident_commander",
        items: [
          "Assume command and announce on the significant events board",
          "Hold re-entry to the tsunami zone until the all clear",
          "Set initial incident objectives",
          "Establish the operational period",
        ],
      },
      {
        position: "operations_section_chief",
        items: ["Account for EOC staff and field crews", "Reach isolated communities by any available means", "Open the resource request board"],
      },
      {
        position: "planning_section_chief",
        items: ["Collect lifeline assessments, marking what is unknown as unknown", "Start rapid damage assessment of critical facilities and bridges"],
      },
      {
        position: "logistics_section_chief",
        items: ["Inventory local resources before outside help arrives", "Name an air or sea resupply point"],
      },
      {
        position: "public_information_officer",
        items: ["Draft the initial public statement", "Confirm how messages reach people without power or cellular service"],
      },
    ],
  },
];

/** Put the scenario templates in the database, leaving any stored copy alone. */
export async function ensureScenarioTemplates(sql: Sql): Promise<void> {
  for (const template of SCENARIO_INCIDENT_TEMPLATES) {
    const t = IncidentTemplateSchema.parse(template);
    await sql`
      insert into incident_templates (key, title, definition)
      values (${t.key}, ${t.title}, ${sql.json(t)})
      on conflict (key) do nothing`;
  }
}
