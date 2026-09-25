import { COMMAND_STAFF, GENERAL_STAFF } from "../dictionary/ics.js";

/**
 * The titles of the ICS Command and General Staff positions every template
 * can open an incident with, whether or not a jurisdiction has made them yet.
 */
export const ICS_POSITION_TITLES: Readonly<Record<string, string>> = {
  incident_commander: "Incident Commander",
  public_information_officer: "Public Information Officer",
  safety_officer: "Safety Officer",
  liaison_officer: "Liaison Officer",
  operations_section_chief: "Operations Section Chief",
  planning_section_chief: "Planning Section Chief",
  logistics_section_chief: "Logistics Section Chief",
  finance_admin_section_chief: "Finance/Admin Section Chief",
};

/** The standard positions in command order: Command Staff, then General Staff. */
export const ICS_STANDARD_POSITIONS: readonly string[] = [...COMMAND_STAFF.values, ...GENERAL_STAFF.values];
