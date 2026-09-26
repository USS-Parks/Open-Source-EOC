/**
 * The position job aids: docs/guides/training/JOB-AID-*.md, the training
 * kit's single source, bundled into the web build so Help reads them with no
 * request, offline included.
 */
const FILES = import.meta.glob<string>("../../../docs/guides/training/JOB-AID-*.md", {
  query: "?raw", import: "default", eager: true,
});

export interface JobAid {
  /** The file name between JOB-AID- and .md, such as PLANNING-SECTION-CHIEF. */
  readonly key: string;
  /** From the aid's heading, "# Job Aid: <title>". */
  readonly title: string;
  readonly markdown: string;
}

export const JOB_AIDS: readonly JobAid[] = Object.entries(FILES)
  .map(([path, markdown]) => {
    const key = /JOB-AID-([A-Z-]+)\.md$/.exec(path)![1]!;
    return { key, title: /^# Job Aid: (.+)$/m.exec(markdown)?.[1]?.trim() ?? key, markdown };
  })
  .sort((a, b) => a.title.localeCompare(b.title));

/**
 * The aid for each position the standard incident templates, the shipped
 * packs and the training kit open. `nearest` marks a position with no aid of
 * its own, given the aid whose screens its work uses.
 */
export const POSITION_AIDS: Readonly<Record<string, { readonly aid: string; readonly nearest?: true }>> = {
  incident_commander: { aid: "EOC-DIRECTOR" },
  public_information_officer: { aid: "PUBLIC-INFORMATION-OFFICER" },
  liaison_officer: { aid: "LIAISON-AND-ADMINISTRATOR" },
  operations_section_chief: { aid: "OPERATIONS-SECTION-CHIEF" },
  planning_section_chief: { aid: "PLANNING-SECTION-CHIEF" },
  logistics_section_chief: { aid: "LOGISTICS-SECTION-CHIEF" },
  situation_unit_leader: { aid: "SITUATION-UNIT" },
  // The 208 safety message is written on ICS Forms, as the planning aid describes.
  safety_officer: { aid: "PLANNING-SECTION-CHIEF", nearest: true },
  // Costs and the force account are in the logistics aid.
  finance_admin_section_chief: { aid: "LOGISTICS-SECTION-CHIEF", nearest: true },
  community_liaison: { aid: "LIAISON-AND-ADMINISTRATOR", nearest: true },
  // The hotline log and its rumors are in the public information aid.
  hotline_supervisor: { aid: "PUBLIC-INFORMATION-OFFICER", nearest: true },
  // Shelters and shelter registrations are in the operations aid.
  mass_care_coordinator: { aid: "OPERATIONS-SECTION-CHIEF", nearest: true },
};

/**
 * The acting position's aid, found by its key or, for a position a
 * jurisdiction made under its own short code, by its title ("Situation Unit
 * Leader" reads as situation_unit_leader). Null when neither matches.
 */
export function aidForPosition(position: { readonly key: string; readonly title: string } | null | undefined):
  { readonly aid: JobAid; readonly nearest: boolean } | null {
  if (!position) return null;
  const byTitle = position.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const entry = POSITION_AIDS[position.key] ?? POSITION_AIDS[byTitle];
  const aid = entry && JOB_AIDS.find((candidate) => candidate.key === entry.aid);
  return aid ? { aid, nearest: entry.nearest ?? false } : null;
}
