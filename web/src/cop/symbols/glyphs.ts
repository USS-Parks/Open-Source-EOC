/**
 * The Open Source EOC map icon suite: 40 original pictograms, drawn for this
 * project and licensed with it under Apache-2.0.
 *
 * Each glyph is SVG inner markup on a 24 by 24 grid in one color: filled
 * shapes inherit the fill, stroked lines use `currentColor`, and cutouts are
 * even-odd holes, so the shape color shows through them. Features are at
 * least 2 units wide, the live area is about 3 to 21, and there is no text:
 * the ICS letters are drawn as paths. `compose.ts` places a glyph on its disc
 * or rounded square.
 */

export const ICON_IDS = [
  "hospital", "urgent_care", "fire_station", "ems_station", "law_enforcement", "eoc",
  "school", "college", "nursing_home", "dialysis", "pharmacy", "power_plant",
  "substation", "water_treatment", "wastewater_treatment", "comms_tower", "airport", "heliport",
  "port", "dam", "bridge", "correctional", "government", "hazmat_site",
  "command_post", "staging_area", "incident_base", "camp", "helibase", "distribution_point", "shelter",
  "wildfire", "structure_fire", "landslide", "flooding", "hazmat_release", "earthquake",
  "tsunami", "road_block", "damage_report",
] as const;

export type IconId = (typeof ICON_IDS)[number];

/** Reference critical facilities, incident facilities, and hazards and field reports. */
export type IconGroup = "critical" | "incident" | "hazard";

/** The FEMA Community Lifeline a critical facility belongs to. */
export type Lifeline =
  | "safety_security" | "health_medical" | "energy" | "communications"
  | "transportation" | "hazardous_materials" | "water_systems";

export interface Glyph {
  readonly title: string;
  readonly group: IconGroup;
  readonly lifeline?: Lifeline;
  /** SVG inner markup on the 24 grid. */
  readonly body: string;
}

const n = (v: number) => String(Math.round(v * 100) / 100);

/** A stroked line in the glyph color. */
const line = (d: string, width = 2.4, cap: "round" | "butt" = "round") =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="${cap}" stroke-linejoin="${cap === "round" ? "round" : "miter"}"/>`;

/** A star with `points` tips, the first straight up. */
function star(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  const step = Math.PI / points;
  const corners = Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + i * step;
    return `${n(cx + r * Math.cos(a))} ${n(cy + r * Math.sin(a))}`;
  });
  return `M${corners.join("L")}Z`;
}

const critical = (title: string, lifeline: Lifeline, body: string): Glyph => ({ title, group: "critical", lifeline, body });
const incident = (title: string, body: string): Glyph => ({ title, group: "incident", body });
const hazard = (title: string, body: string): Glyph => ({ title, group: "hazard", body });

export const GLYPHS: Readonly<Record<IconId, Glyph>> = {
  hospital: critical("Hospital", "health_medical",
    `<path d="M5 4h4v6h6V4h4v16h-4v-6H9v6H5z"/>`),
  urgent_care: critical("Urgent care clinic", "health_medical",
    `<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z"/>`),
  fire_station: critical("Fire station", "safety_security",
    `<path d="M10 10 6.4 2.8 12 4.6 17.6 2.8 14 10 21.2 6.4 19.4 12 21.2 17.6 14 14 17.6 21.2 12 19.4 6.4 21.2 10 14 2.8 17.6 4.6 12 2.8 6.4Z"/>`),
  ems_station: critical("EMS station", "health_medical",
    `<path fill-rule="evenodd" d="M2.5 4.5H14V8H17.5L21.5 12.5V17H20.3A3.6 3.6 0 0 0 13.7 17H10.3A3.6 3.6 0 0 0 3.7 17H2.5ZM7.15 6.5H9.35V8.4H11.25V10.6H9.35V12.5H7.15V10.6H5.25V8.4H7.15ZM15.5 9.5H17.3L19.7 12.3H15.5Z"/>` +
    `<circle cx="7" cy="18.3" r="2.4"/><circle cx="17" cy="18.3" r="2.4"/>`),
  law_enforcement: critical("Law enforcement", "safety_security",
    `<path fill-rule="evenodd" d="M12 2.8 20 5.6V11.2C20 16 16.8 19.4 12 21.2 7.2 19.4 4 16 4 11.2V5.6Z${star(12, 11.6, 4.8, 2.1)}"/>`),
  eoc: critical("Emergency operations center", "safety_security",
    `<path d="${star(12, 12.9, 9.6, 4.3)}"/>`),
  school: critical("School", "safety_security",
    `<path fill-rule="evenodd" d="M3 21V12.2L11 6.7V1.5H13L19.5 3.2 13 4.9V6.7L21 12.2V21H14V16.2A2 2 0 0 0 10 16.2V21ZM5.5 13.5H8V16H5.5ZM16 13.5H18.5V16H16Z"/>`),
  college: critical("College or university", "safety_security",
    `<path d="M12 4.5 22 9 12 13.5 2 9Z"/>` +
    `<path d="M6.5 12.6V15.8C6.5 17.6 9 19 12 19S17.5 17.6 17.5 15.8V12.6L12 15.1Z"/>` +
    line("M19.5 10V16", 2, "butt") + `<rect x="18.3" y="15.5" width="2.4" height="2.6" rx=".6"/>`),
  nursing_home: critical("Nursing home", "health_medical",
    `<circle cx="12.6" cy="4.6" r="2.4"/>` +
    line("M11.4 9.4 9.6 14.4", 3.6) + line("M11.2 10.2 15 13", 2.6) +
    line("M9.6 14.4 7.8 19.8M9.6 14.4 12.2 19.8", 3.2) + line("M16 12.4 16.6 20.4", 2.2)),
  dialysis: critical("Dialysis center", "health_medical",
    `<path d="M8 4C5.4 4 3.2 7.3 3.2 12S5.4 20 8 20C10.1 20 11.2 18.6 11.2 17.1 11.2 15.2 8.8 14.5 8.8 12S11.2 8.8 11.2 6.9C11.2 5.4 10.1 4 8 4ZM16 4C18.6 4 20.8 7.3 20.8 12S18.6 20 16 20C13.9 20 12.8 18.6 12.8 17.1 12.8 15.2 15.2 14.5 15.2 12S12.8 8.8 12.8 6.9C12.8 5.4 13.9 4 16 4Z"/>`),
  pharmacy: critical("Pharmacy", "health_medical",
    line("M9.45 18.22 18.22 9.45A2.6 2.6 0 0 0 14.55 5.78L5.78 14.55A2.6 2.6 0 0 0 9.45 18.22Z", 2) +
    `<path d="M14.55 14.55 18.93 10.16A3.6 3.6 0 0 0 13.84 5.07L9.45 9.45Z"/>`),
  power_plant: critical("Power plant", "energy",
    `<path fill-rule="evenodd" d="M3 21V11.5L8 8.5V11.5L13 8.5V11.5H14.5V3H18.5V11.5H21V21ZM10.6 12.8 6.8 17.2H9.3L8.4 20.2 12.2 15.7H9.7Z"/>`),
  substation: critical("Electric substation", "energy",
    `<path d="M13.8 2.5H18L14.2 10H18.5L8 21.5 10.8 12.8H6Z"/>`),
  water_treatment: critical("Water treatment plant", "water_systems",
    `<rect x="5.5" y="3" width="7" height="2" rx="1"/><rect x="8" y="4" width="2" height="4"/>` +
    `<path d="M3 7.5H12C15.3 7.5 17.5 9.7 17.5 13V14.5H13.5V13C13.5 12.2 12.8 11.5 12 11.5H3Z"/>` +
    `<path d="M15.5 15.8 17.17 17.21A2.6 2.6 0 1 1 13.83 17.21Z"/>`),
  wastewater_treatment: critical("Wastewater treatment plant", "water_systems",
    line("M19.5 12.5A7.5 7.5 0 1 1 16.82 6.75", 2.2) + `<path d="M18.05 4.65 18.81 8.42 14.97 8.33Z"/>` +
    `<path d="M12 7.6 14.2 10.8A3.2 3.2 0 1 1 9.8 10.8Z"/>`),
  comms_tower: critical("Communications tower", "communications",
    line("M12 10.5 7.5 21M12 10.5 16.5 21M9.3 16.8H14.7", 2.2) + `<circle cx="12" cy="9" r="2.2"/>` +
    line("M15.83 5.79A5 5 0 0 1 15.83 12.21M8.17 5.79A5 5 0 0 0 8.17 12.21M18.51 3.54A8.5 8.5 0 0 1 18.51 14.46M5.49 3.54A8.5 8.5 0 0 0 5.49 14.46", 2)),
  airport: critical("Airport", "transportation",
    `<path d="M12 2.5C13.1 2.5 13.5 3.6 13.5 5V9.2L21 13.6V15.6L13.5 13.2V18L16 19.8V21.3L12 20.2 8 21.3V19.8L10.5 18V13.2L3 15.6V13.6L10.5 9.2V5C10.5 3.6 10.9 2.5 12 2.5Z"/>`),
  heliport: critical("Heliport", "transportation",
    line("M2.5 4H19.5", 2, "butt") + `<rect x="10" y="4" width="2" height="4"/>` +
    `<path d="M3 12.3C3 9.7 5.2 7.8 8.2 7.8H11.4C13.9 7.8 15.6 9.3 16.1 11H19.4V7.6H21.4V14.4H19.4V13H16C15.3 15 13.5 16.3 11.2 16.3H7C4.8 16.3 3 14.6 3 12.3Z"/>` +
    `<rect x="6.2" y="16" width="2" height="2.4"/><rect x="11.4" y="16" width="2" height="2.4"/>` + line("M2.8 18.2C3.2 19 3.8 19.4 4.6 19.4H16", 2)),
  port: critical("Port", "transportation",
    `<circle cx="12" cy="5.3" r="1.9" fill="none" stroke="currentColor" stroke-width="2"/>` +
    line("M12 8.2V20M8 10.5H16", 2.4) + line("M5 14.5C5.5 18.3 8.5 20.4 12 20.4S18.5 18.3 19 14.5", 2.4) +
    `<path d="M3 16 5.2 12 7.6 15.4ZM21 16 18.8 12 16.4 15.4Z"/>`),
  dam: critical("Dam", "safety_security",
    `<path d="M11 3.5H14.2L21 21H11Z"/>` +
    line("M3 9.5Q4.5 8 6 9.5T9 9.5M3 15Q4.5 13.5 6 15T9 15", 2.2)),
  bridge: critical("Bridge", "transportation",
    `<path d="M5.8 3.5H8.2V20.5H5.8ZM15.8 3.5H18.2V20.5H15.8ZM2.5 13.6H21.5V16.2H2.5Z"/>` +
    line("M8.2 5.5Q12 14 15.8 5.5M5.8 5.5 2.6 12M18.2 5.5 21.4 12", 2.2)),
  correctional: critical("Correctional facility", "safety_security",
    `<rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M7 5H9V19H7ZM11 5H13V19H11ZM15 5H17V19H15Z"/>`),
  government: critical("Government building", "safety_security",
    `<path fill-rule="evenodd" d="M12 3 21 8.2H20V18.8H21V21H3V18.8H4V8.2H3ZM6.2 10H8.6V18H6.2ZM10.8 10H13.2V18H10.8ZM15.4 10H17.8V18H15.4Z"/>`),
  hazmat_site: critical("Hazardous materials site", "hazardous_materials",
    `<path d="M8.8 3H15.2V5H14.2V9.2L16.32 12.6H7.68L9.8 9.2V5H8.8ZM6.56 14.4H17.44L19.8 18.2C20.7 19.7 19.9 21 18.2 21H5.8C4.1 21 3.3 19.7 4.2 18.2Z"/>`),

  command_post: incident("Incident command post",
    `<rect x="5" y="5" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 5H19L5 19Z"/>`),
  staging_area: incident("Staging area",
    line("M15.11 7.12A3.8 3.1 0 1 0 12 12A3.8 3.1 0 1 1 8.89 16.88", 3.2, "butt")),
  incident_base: incident("Incident base",
    line("M8 12H12.4A3 3 0 0 0 12.4 6H7.6V18H13A3 3 0 0 0 13 12H8", 3.2, "butt")),
  camp: incident("Camp",
    line("M17.06 7.99A6 6 0 1 0 17.06 16.01", 3.2, "butt")),
  helibase: incident("Helibase",
    line("M7.6 4.4V19.6M16.4 4.4V19.6M7.6 12H16.4", 3.2, "butt")),
  distribution_point: incident("Point of distribution",
    `<path d="M7 3H10.8V6.2H13.2V3H17V11.4H7Z"/><rect x="2.5" y="13.5" width="2.6" height="7"/>` +
    `<path d="M6 13.8H9.8C10.9 13.8 11.7 14.5 11.8 15.4H15.2L19.4 13.1C20.4 12.6 21.5 13.4 21 14.4L18.3 18.9C17.7 19.9 16.7 20.5 15.6 20.5H6Z"/>`),
  shelter: incident("Shelter",
    line("M3.5 11 12 4 20.5 11", 2.8) + `<circle cx="12" cy="11" r="2.2"/>` +
    `<path d="M8.4 20.5V17.6C8.4 15.6 10 14.4 12 14.4S15.6 15.6 15.6 17.6V20.5Z"/>`),

  wildfire: hazard("Wildfire",
    `<path d="M5.6 7.5 8.8 12.2H7.4L9.4 16H6.8V19.5H4.4V16H1.8L3.8 12.2H2.4Z"/>` +
    `<path d="M16.2 2.5C16.6 5.9 21.4 8.4 21.4 13.6 21.4 17.1 19 19.5 16 19.5 13 19.5 10.8 17.3 10.8 14.4 10.8 12 12 10.6 13.1 9.3 13.2 10.9 13.8 12 14.7 12.5 14.4 8.5 14.8 5.2 16.2 2.5Z"/>` +
    `<rect x="2" y="19.5" width="20" height="2"/>`),
  structure_fire: hazard("Structure fire",
    `<path fill-rule="evenodd" d="M2.5 11.5 12 3 21.5 11.5H19.5V21H4.5V11.5ZM12.2 8.8C12.9 11.4 16 12.9 16 16 16 18 14.3 19.3 12 19.3S8 18 8 15.9C8 14.5 8.8 13.5 9.6 12.6 9.8 13.8 10.4 14.5 11 14.8 11 12.6 11.4 10.4 12.2 8.8Z"/>`),
  landslide: hazard("Landslide",
    `<path d="M3 21V4.5C5 4.5 6.3 5.6 7.2 7.3L12.4 17.2C13.3 18.9 14.4 19.4 16 19.4H21V21Z"/>` +
    `<path d="M10.6 8.6 13 6.8 15.2 8.4 14.6 11.2 11.6 11.6ZM15.4 13.6 18.2 11.2 21 12.8 20.6 16.2 17 16.6Z"/>`),
  flooding: hazard("Flooding",
    `<path d="M4.5 10.2 12 4 19.5 10.2H17.5V12.4H6.5V10.2Z"/>` +
    line("M3 15.8Q5.25 14.2 7.5 15.8T12 15.8T16.5 15.8T21 15.8M3 19.8Q5.25 18.2 7.5 19.8T12 19.8T16.5 19.8T21 19.8", 2.2)),
  hazmat_release: hazard("Gas or hazardous materials release",
    `<path fill-rule="evenodd" d="M6.5 18C4 18 2.5 16.3 2.5 14.2 2.5 12.2 3.9 10.7 5.8 10.4 6.4 7.3 9 5 12.2 5 15.2 5 17.7 7.1 18.3 9.9 20.2 10.4 21.5 12.1 21.5 14.1 21.5 16.3 19.8 18 17.6 18ZM11 8.3H13V13.3H11ZM11 14.6H13V16.4H11Z"/>`),
  earthquake: hazard("Earthquake",
    line("M2.5 12.5H6.2L8.4 8 11 18 13.6 4 16.2 16 18 10.5 19.2 12.5H21.5", 2.2)),
  tsunami: hazard("Tsunami",
    `<path d="M2.5 20.5C3.5 12 8.6 5 15.2 5 18.6 5 21.2 7 21.5 9.8 21.7 11.8 20.3 13.3 18.4 13.3 16.9 13.3 15.8 12.2 15.8 10.8 15.8 9.8 16.4 9.1 17.3 8.9 15.7 8.1 13.4 8.6 12 10.4 10 13 10.1 17.2 12.6 20.5Z"/>`),
  road_block: hazard("Road block",
    `<path fill-rule="evenodd" d="M3 6.5H21V12H3ZM6.5 11 8.8 7.5H11L8.7 11ZM12.5 11 14.8 7.5H17L14.7 11Z"/>` +
    line("M6.5 12V20.5M17.5 12V20.5", 2.4) + line("M4 20.5H9M15 20.5H20", 2)),
  damage_report: hazard("Damage report",
    `<path d="M10.8 4.55 9.3 8.5 12.3 12.5 9.8 16.5 11.3 21H5V11.8H2.5ZM13.2 4.55 21.5 11.8H19V21H13.7L12.2 16.5 14.7 12.5 11.7 8.5Z"/>`),
};
