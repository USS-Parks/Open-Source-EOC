import { COMMAND_STAFF, ICS_SECTIONS } from "../dictionary/ics.js";

/**
 * Incident collaboration-space planning (F15). Pure, isomorphic
 * derivation of the channel structure and its membership from the incident's
 * ICS positions and their current holders. The server drives whichever
 * adapter (Mattermost, Matrix) is configured from this plan, and the same
 * plan degrades to in-app notifications when no backend is present. Keeping
 * it pure means the structure is testable without any backend at all.
 */

/** A person currently holding an incident position. */
export interface PositionHolder {
  readonly positionKey: string;
  readonly personId: string;
  readonly email: string;
}

export interface PlannedChannel {
  /** The ICS section this channel serves, or "all" for the incident-wide one. */
  readonly section: string;
  /** A backend-safe channel name. */
  readonly name: string;
  /** A human-readable display name. */
  readonly displayName: string;
  /** Person ids who should be members, sorted and de-duplicated. */
  readonly memberPersonIds: readonly string[];
  /** Emails for those members, in the same order. */
  readonly memberEmails: readonly string[];
}

export interface SpacePlan {
  readonly spaceName: string;
  readonly spaceDisplayName: string;
  readonly channels: readonly PlannedChannel[];
}

/** Map an ICS position key to the section whose channel it belongs in. */
export function sectionForPosition(positionKey: string): string {
  if (COMMAND_STAFF.values.includes(positionKey as never)) return "command";
  if (positionKey === "incident_commander") return "command";
  if (positionKey.endsWith("_section_chief")) {
    const section = positionKey.slice(0, -"_section_chief".length);
    if (ICS_SECTIONS.values.includes(section as never)) return section;
  }
  if (ICS_SECTIONS.values.includes(positionKey as never)) return positionKey;
  // Anything unmapped coordinates under command rather than vanishing.
  return "command";
}

/** Lowercase, hyphenated, backend-safe slug bounded to a sane length. */
export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "incident";
}

/**
 * Build the space plan: one channel per ICS section present among the
 * incident's positions, plus an incident-wide channel, with membership
 * taken from the current holders. Sections are included when the incident
 * carries a position in them, whether or not anyone holds it yet, so the
 * structure is stable and a later assignment simply gains membership.
 */
export function planIncidentSpace(
  incidentName: string,
  positionKeys: readonly string[],
  holders: readonly PositionHolder[],
): SpacePlan {
  const slug = slugify(incidentName);
  const sections = [...new Set(positionKeys.map(sectionForPosition))].sort();

  const holdersBySection = new Map<string, PositionHolder[]>();
  for (const h of holders) {
    const section = sectionForPosition(h.positionKey);
    if (!holdersBySection.has(section)) holdersBySection.set(section, []);
    holdersBySection.get(section)!.push(h);
  }

  const channels: PlannedChannel[] = [];
  channels.push(channel(slug, "all", "All", holders));
  for (const section of sections) {
    channels.push(channel(slug, section, sectionLabel(section), holdersBySection.get(section) ?? []));
  }
  return {
    spaceName: slug,
    spaceDisplayName: incidentName,
    channels,
  };
}

function channel(
  slug: string,
  section: string,
  label: string,
  members: readonly PositionHolder[],
): PlannedChannel {
  // De-duplicate by person id (a person may hold more than one position),
  // and keep emails aligned to the sorted id order for deterministic sync.
  const byId = new Map<string, string>();
  for (const m of members) byId.set(m.personId, m.email);
  const ids = [...byId.keys()].sort();
  return {
    section,
    name: `${slug}-${section}`,
    displayName: label,
    memberPersonIds: ids,
    memberEmails: ids.map((id) => byId.get(id)!),
  };
}

function sectionLabel(section: string): string {
  return section
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
