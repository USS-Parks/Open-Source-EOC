import { PA_CATEGORY_LABELS } from "../dictionary/pda.js";
import { definePalette, type PaletteEntry, type PolygonStyle } from "./palette.js";

/**
 * The palettes. Esri's shipped values are kept where the research recorded
 * them (docs/process/ESRI-EM-MAP-RESEARCH-2026-09-26.md, sections 2a, 2b and
 * 3). A dark value differs only where the light one fails on the dark theme:
 * an area outline must keep 3:1 on the dark basemap, and a point color keeps
 * 3:1 under its white pictogram in both themes (checked in the tests).
 */

type Extra = Omit<PaletteEntry, "label" | "light" | "dark">;

const entry = (label: string, light: string, dark: string = light, extra: Extra = {}): PaletteEntry =>
  ({ label, light, dark, ...extra });

/** Esri's status area: a half-opaque fill under a 1.5 pt outline of the same hue. */
const AREA: PolygonStyle = { fillOpacity: 0.5, outlineWidth: 2 };
const area = (label: string, light: string, dark: string = light, polygon: PolygonStyle = AREA) =>
  entry(label, light, dark, { polygon });

/** Community lifeline condition: the product's Overview shades of FEMA's green, yellow, red and grey. */
export const LIFELINE_STATUS_PALETTE = definePalette({
  id: "lifeline_status",
  title: "Lifeline status",
  source: "FEMA Community Lifelines Toolkit 2.1 (2023) status colors, in the product's Overview shades",
  entries: {
    stable: entry("Stable", "#2e8b57", "#5fd08e"),
    stabilizing: entry("Stabilizing", "#e8a300", "#f5c542"),
    unstable: entry("Disrupted", "#d0242f", "#ff6961"),
    unknown: entry("Unknown", "#8a94a3", "#a9b4c2"),
    administrative: entry("Administrative", "#015287", "#5b9bd5"),
  },
});

/**
 * The eight Community Lifelines, for reference facilities drawn as a white
 * pictogram on a rounded square. Hues stay clear of the status colors above.
 */
export const LIFELINE_CATEGORY_PALETTE = definePalette({
  id: "lifeline_category",
  title: "Community lifeline",
  source: "Open Source EOC; FEMA assigns the lifelines no colors",
  entries: {
    safety_security: entry("Safety & Security", "#1f4e9c"),
    food_hydration_shelter: entry("Food, Hydration, Shelter", "#00796b"),
    health_medical: entry("Health & Medical", "#ad1457"),
    energy: entry("Energy", "#c25e00"),
    communications: entry("Communications", "#6a3fa0"),
    transportation: entry("Transportation", "#5d4037"),
    hazardous_materials: entry("Hazardous Materials", "#6b6b00"),
    water_systems: entry("Water Systems", "#0277bd"),
  },
});

/** Protective action areas. The product's order, warning and shelter vocabulary reads as Esri's levels. */
export const EVACUATION_PALETTE = definePalette({
  id: "evacuation_status",
  title: "Evacuation status",
  source: "Esri Emergency Management Operations, Notices and Evacuations",
  entries: {
    level_3_order: area("Evacuation order (level 3)", "#7a0000", "#d42a2a"),
    level_2_warning: area("Evacuation warning (level 2)", "#e05434"),
    level_1_advisory: area("Evacuation advisory (level 1)", "#fda328"),
    voluntary: area("Voluntary evacuation", "#f2e355", "#f2e355", { ...AREA, outline: "#e6d117" }),
    lifted: area("Evacuation order lifted", "#8cd1c8"),
    shelter_in_place: area("Shelter in place", "#ed66a6"),
    none: area("No order", "#ffffff", "#ffffff", { fillOpacity: 0.05, outlineWidth: 0.7, outline: "#858585" }),
  },
  aliases: {
    order: "level_3_order",
    warning: "level_2_warning",
    advisory: "level_1_advisory",
    shelter_order: "shelter_in_place",
  },
});

/** FEMA degree of damage, with Esri's colors: Destroyed is purple, not the end of a red ramp. */
export const DAMAGE_DEGREE_PALETTE = definePalette({
  id: "damage_degree",
  title: "Degree of damage",
  source: "FEMA Preliminary Damage Assessment Guide categories; Esri Damage Assessment colors",
  entries: {
    destroyed: entry("Destroyed", "#8335a8"),
    major: entry("Major damage", "#c93100"),
    minor: entry("Minor damage", "#e89d00"),
    affected: entry("Affected", "#ffd700"),
    inaccessible: entry("Inaccessible", "#007ac2"),
    unaffected: entry("Unaffected", "#58595b", "#9aa0a6"),
  },
});

/** FEMA Public Assistance categories of work, A to G. */
export const PA_CATEGORY_PALETTE = definePalette({
  id: "pa_category",
  title: "Public Assistance category",
  source: "FEMA PAPPG categories of work; Esri Damage Assessment colors",
  entries: {
    a_debris_removal: entry(PA_CATEGORY_LABELS["a_debris_removal"]!, "#e89d00"),
    b_emergency_protective_measures: entry(PA_CATEGORY_LABELS["b_emergency_protective_measures"]!, "#fb7d81"),
    c_roads_and_bridges: entry(PA_CATEGORY_LABELS["c_roads_and_bridges"]!, "#b2b2b2"),
    d_water_control_facilities: entry(PA_CATEGORY_LABELS["d_water_control_facilities"]!, "#1f7ac0"),
    e_buildings_and_equipment: entry(PA_CATEGORY_LABELS["e_buildings_and_equipment"]!, "#875a46", "#b5876f"),
    f_utilities: entry(PA_CATEGORY_LABELS["f_utilities"]!, "#58595b", "#8a9bb0"),
    g_parks_recreational_other: entry(PA_CATEGORY_LABELS["g_parks_recreational_other"]!, "#71d56e"),
  },
});

/**
 * Shelter status. The shelter board stores the EDXL-HAVE operating status,
 * read here as Esri's: normal is open, compromised is on alert, evacuating
 * and closed are closed. A site planned but not yet open is its own entry.
 */
export const SHELTER_STATUS_PALETTE = definePalette({
  id: "shelter_status",
  title: "Shelter status",
  source: "Esri Emergency Management Operations, Shelters; planned is Open Source EOC's",
  entries: {
    open: entry("Open", "#009656"),
    alert: entry("Alert", "#fbbc41"),
    standby: entry("Standby", "#a56daf"),
    planned: entry("Planned", "#3a78b5"),
    closed: entry("Closed", "#dc4536"),
    unknown: entry("Unknown", "#8d99ae"),
  },
  aliases: { normal: "open", compromised: "alert", evacuating: "closed" },
});

/** Road closure status, as the incident map draws closures today; detours in Esri's orange. */
export const ROAD_CLOSURE_PALETTE = definePalette({
  id: "road_closure_status",
  title: "Road closure status",
  source: "Open Source EOC incident cartography; Esri Road Closures detour orange",
  entries: {
    closed: entry("Closed", "#c9202c", "#e5452a"),
    one_lane: entry("One lane", "#92400e", "#fbbf24"),
    detour: entry("Detour", "#e69800"),
    reopened: entry("Reopened", "#166534", "#4ade80"),
  },
});

/**
 * Hazard kinds in the exercise data packs. Areas take Esri's conventions (a
 * half-opaque status fill, a hollow impact area, a hatch only for road
 * disruption); points take Esri's family colors, the icon telling the kind.
 * Each kind's label reads as its key, since data packs store the label.
 */
const HAZARD_ENTRIES = {
  fire_perimeter: area("Fire perimeter", "#f7ada4", "#f7ada4", { ...AREA, outline: "#e60c0c" }),
  evacuation_order: { ...EVACUATION_PALETTE.entries.level_3_order, label: "Evacuation order" },
  evacuation_warning: { ...EVACUATION_PALETTE.entries.level_2_warning, label: "Evacuation warning" },
  flood_extent: area("Flood extent", "#1f7ac0", "#4ea3e8"),
  tsunami_inundation: area("Tsunami inundation", "#00897b", "#26b3a0"),
  liquefaction: area("Liquefaction", "#8c5a2b", "#c08a55"),
  power_outage: area("Power outage", "#3f51b5", "#7986cb"),
  damage_area: area("Damage area", "#8335a8", "#b36ad6", { fillOpacity: 0, outlineWidth: 4 }),
  road_disruption: area("Road disruption", "#c9202c", "#ff4f6d", { fillOpacity: 0.5, outlineWidth: 1.5, hatch: true }),
  spot_fire: entry("Spot fire", "#c93100", "#c93100", { icon: "wildfire" }),
  structure_fire: entry("Structure fire", "#c93100", "#c93100", { icon: "structure_fire" }),
  slide: entry("Slide", "#6c4000", "#6c4000", { icon: "landslide" }),
  gas_leak: entry("Gas leak", "#b36b00", "#b36b00", { icon: "hazmat_release" }),
  hazardous_materials: entry("Hazardous materials", "#b36b00", "#b36b00", { icon: "hazmat_release" }),
  bridge_damage: entry("Bridge damage", "#8335a8", "#8335a8", { icon: "damage_report" }),
  road_block: entry("Road block", "#c93100", "#c93100", { icon: "road_block" }),
};

export const HAZARD_PALETTE = definePalette({
  id: "hazard",
  title: "Hazard",
  source: "Esri Emergency Management templates and NIFC WFIGS perimeters; exercise data pack kinds",
  entries: HAZARD_ENTRIES,
  aliases: Object.fromEntries(
    Object.entries(HAZARD_ENTRIES).map(([key, value]) => [value.label, key as keyof typeof HAZARD_ENTRIES]),
  ),
});

/** Esri's incident type families: one color each, the type told by its pictogram. */
export const INCIDENT_FAMILY_PALETTE = definePalette({
  id: "incident_family",
  title: "Incident family",
  source: "Esri Emergency Management Operations, Incident Points",
  entries: {
    fire_health: entry("Fire and public health", "#c93100"),
    geologic: entry("Wildfire and geologic", "#6c4000"),
    flood_wind: entry("Flood and wind", "#83c96e"),
    weather: entry("Weather and agriculture", "#71d56e"),
    hazmat_other: entry("Hazardous materials and other", "#e89d00"),
    law_enforcement: entry("Law enforcement", "#007ac2"),
    transportation: entry("Transportation", "#58595b"),
  },
});

type IncidentFamily = keyof typeof INCIDENT_FAMILY_PALETTE.entries;

const incidentType = (label: string, family: IncidentFamily): PaletteEntry => {
  const { light, dark } = INCIDENT_FAMILY_PALETTE.entries[family];
  return entry(label, light, dark, { family });
};

/** Esri's 23 incident types, each in its family's color. */
export const INCIDENT_TYPE_PALETTE = definePalette({
  id: "incident_type",
  title: "Incident type",
  source: "Esri Emergency Management Operations, Incident Points",
  entries: {
    fire: incidentType("Fire", "fire_health"),
    public_health: incidentType("Public health", "fire_health"),
    wildfire: incidentType("Wildfire", "geologic"),
    earthquake: incidentType("Earthquake", "geologic"),
    tsunami: incidentType("Tsunami", "geologic"),
    volcano: incidentType("Volcano", "geologic"),
    flooding: incidentType("Flooding", "flood_wind"),
    hurricane: incidentType("Hurricane", "flood_wind"),
    tornado: incidentType("Tornado", "flood_wind"),
    severe_thunderstorm: incidentType("Severe thunderstorm", "weather"),
    winter_storm: incidentType("Winter storm", "weather"),
    marine: incidentType("Marine", "weather"),
    agricultural_animal_health: incidentType("Agricultural animal health", "weather"),
    chemical: incidentType("Chemical", "hazmat_other"),
    cyber: incidentType("Cyber", "hazmat_other"),
    radiological: incidentType("Radiological", "hazmat_other"),
    infestation: incidentType("Infestation", "hazmat_other"),
    other: incidentType("Other", "hazmat_other"),
    civil_disturbance: incidentType("Civil disturbance", "law_enforcement"),
    criminal_activity: incidentType("Criminal activity", "law_enforcement"),
    air: incidentType("Air", "transportation"),
    rail: incidentType("Rail", "transportation"),
    vehicle: incidentType("Vehicle", "transportation"),
  },
});

/**
 * Work status for tasks, checklists, IAP and requests. Each color reads on
 * its theme's surface and under the chart kit's chip ink (the kit's tests).
 */
export const WORK_STATUS_PALETTE = definePalette({
  id: "work_status",
  title: "Work status",
  source: "Open Source EOC",
  entries: {
    not_started: entry("Not started", "#5f6b7a", "#8f9aa8"),
    in_progress: entry("In progress", "#b45309", "#f28a2e"),
    in_approval: entry("In approval", "#0e7490", "#2cc1d9"),
    approved: entry("Approved", "#1d63d8", "#4b9cf5"),
    complete: entry("Complete", "#15803d", "#4cbb6c"),
    past_due: entry("Past due", "#c81e1e", "#ef5159"),
    closed: entry("Closed", "#6f42c1", "#b392f0"),
    cancelled: entry("Cancelled", "#7a6232", "#c9a66b"),
  },
  aliases: { open: "not_started", completed: "complete", overdue: "past_due" },
});

/** Esri's choropleth rule: a solid fill under a 25 percent black hairline, drawn at 65 percent. */
const CHOROPLETH: PolygonStyle = { fillOpacity: 0.65, outlineWidth: 1.2, outline: "#000000", outlineOpacity: 0.25 };
const rating = (label: string, color: string) => entry(label, color, color, { polygon: CHOROPLETH });

/** FEMA National Risk Index rating; aliases are the index's own strings. */
export const NRI_RATING_PALETTE = definePalette({
  id: "nri_rating",
  title: "National Risk Index rating",
  source: "FEMA National Risk Index; Esri Hazard Mitigation Planning colors",
  entries: {
    very_high: rating("Very high", "#c7445d"),
    relatively_high: rating("Relatively high", "#e07069"),
    relatively_moderate: rating("Relatively moderate", "#f0d55d"),
    relatively_low: rating("Relatively low", "#509bc7"),
    very_low: rating("Very low", "#4d6dbd"),
  },
  aliases: {
    "Very High": "very_high",
    "Relatively High": "relatively_high",
    "Relatively Moderate": "relatively_moderate",
    "Relatively Low": "relatively_low",
    "Very Low": "very_low",
  },
});

const quartile = (label: string, color: string, min: number) =>
  entry(label, color, color, { min, polygon: { fillOpacity: 0.7, outlineWidth: 0 } });

/** CDC/ATSDR Social Vulnerability Index percentile (RPL_THEMES) in four classes. */
export const SVI_QUARTILE_PALETTE = definePalette({
  id: "svi_quartile",
  title: "Social vulnerability",
  source: "CDC/ATSDR SVI; Esri's four-class YlGnBu",
  entries: {
    lowest: quartile("Lowest (0 to 0.25)", "#ffffcc", 0),
    low_moderate: quartile("Low to moderate (0.25 to 0.50)", "#a1dab4", 0.25),
    moderate_high: quartile("Moderate to high (0.50 to 0.75)", "#41b6c4", 0.5),
    highest: quartile("Highest (0.75 to 1)", "#225ea8", 0.75),
  },
});

const TRIBAL: PolygonStyle = { fillOpacity: 0.5, outlineWidth: 1, outline: "#8c8c8c" };
const tribal = (label: string, color: string) => entry(label, color, color, { polygon: TRIBAL });

/** Census American Indian, Alaska Native and Native Hawaiian Areas by class. */
export const AIANNH_PALETTE = definePalette({
  id: "aiannh_class",
  title: "American Indian, Alaska Native and Native Hawaiian areas",
  source: "Census TIGER AIANNH; Esri Living Atlas colors",
  entries: {
    federal_reservation: tribal("Federal reservation or off-reservation trust land", "#ed5151"),
    joint_use: tribal("Joint-use area", "#3caf99"),
    state_reservation: tribal("State reservation", "#ffde3e"),
    anvsa: tribal("Alaska Native village statistical area", "#149ece"),
    hawaiian_home_land: tribal("Hawaiian home land", "#a7c636"),
    otsa: tribal("Oklahoma tribal statistical area", "#fc921f"),
    tdsa: tribal("Tribal designated statistical area", "#f789d8"),
  },
});

/** A building's outline over a translucent fill, over the street basemap or imagery. */
const BUILDING: PolygonStyle = { fillOpacity: 0.45, outlineWidth: 1 };
const building = (label: string, light: string, dark: string) => area(label, light, dark, BUILDING);

/**
 * Building use: USA Structures occupancy classes. Aliases are the dataset's
 * own OCC_CLS strings and the basemap's current building use values.
 */
export const BUILDING_OCCUPANCY_PALETTE = definePalette({
  id: "building_occupancy",
  title: "Building use",
  source: "FEMA USA Structures occupancy classes; Open Source EOC colors",
  entries: {
    residential: building("Residential", "#e8b03a", "#f2c14e"),
    commercial: building("Commercial", "#d9534f", "#f06c68"),
    industrial: building("Industrial", "#8e63c7", "#b08ae6"),
    government: building("Government", "#3f6fd1", "#6f97ee"),
    education: building("Education", "#f08a24", "#ffa24d"),
    assembly: building("Assembly", "#d4589b", "#ec7fbb"),
    agriculture: building("Agriculture", "#6fa53a", "#8cc757"),
    utility_misc: building("Utility and miscellaneous", "#2a9d8f", "#4cc2b3"),
    unclassified: building("Unclassified", "#9aa1a9", "#aab2bb"),
  },
  aliases: {
    Residential: "residential",
    Commercial: "commercial",
    Industrial: "industrial",
    Government: "government",
    Education: "education",
    Assembly: "assembly",
    Agriculture: "agriculture",
    "Utility and Misc": "utility_misc",
    Unclassified: "unclassified",
    civic: "government",
    religious: "assembly",
  },
});

/** Building role: critical infrastructure is joined from the facility layer. */
export const BUILDING_ROLE_PALETTE = definePalette({
  id: "building_role",
  title: "Building role",
  source: "Open Source EOC",
  entries: {
    private: building("Private", "#a89f91", "#b8b0a3"),
    public: building("Public", "#3f6fd1", "#6f97ee"),
    critical_infrastructure: building("Critical infrastructure", "#c2185b", "#f0588f"),
  },
});

/** Every palette, for tests, the swatch sheet and pickers. */
export const PALETTES = [
  LIFELINE_STATUS_PALETTE,
  LIFELINE_CATEGORY_PALETTE,
  EVACUATION_PALETTE,
  DAMAGE_DEGREE_PALETTE,
  PA_CATEGORY_PALETTE,
  SHELTER_STATUS_PALETTE,
  ROAD_CLOSURE_PALETTE,
  HAZARD_PALETTE,
  INCIDENT_FAMILY_PALETTE,
  INCIDENT_TYPE_PALETTE,
  WORK_STATUS_PALETTE,
  NRI_RATING_PALETTE,
  SVI_QUARTILE_PALETTE,
  AIANNH_PALETTE,
  BUILDING_OCCUPANCY_PALETTE,
  BUILDING_ROLE_PALETTE,
] as const;
