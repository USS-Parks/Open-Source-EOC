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

/** An NWS product area: a quarter-opaque fill under an outline of the same color. */
const WATCH_AREA: PolygonStyle = { fillOpacity: 0.25, outlineWidth: 1.5 };
const nws = (label: string, color: string) => entry(label, color, color, { polygon: WATCH_AREA });

/**
 * NWS watches, warnings and advisories an EOC on the North Coast sees, in
 * the official colors of the NWS map color table. NWS gives some products
 * one color (Flood Watch and Flash Flood Watch are both sea green), so this
 * table is not held to the palette table's distinguishable-colors rule.
 */
const NWS_HAZARD_ENTRIES = {
  tsunami_warning: nws("Tsunami Warning", "#fd6347"),
  tsunami_advisory: nws("Tsunami Advisory", "#d2691e"),
  tsunami_watch: nws("Tsunami Watch", "#ff00ff"),
  tornado_warning: nws("Tornado Warning", "#ff0000"),
  tornado_watch: nws("Tornado Watch", "#ffff00"),
  severe_thunderstorm_warning: nws("Severe Thunderstorm Warning", "#ffa500"),
  severe_thunderstorm_watch: nws("Severe Thunderstorm Watch", "#db7093"),
  flash_flood_warning: nws("Flash Flood Warning", "#8b0000"),
  flash_flood_watch: nws("Flash Flood Watch", "#2e8b57"),
  flood_warning: nws("Flood Warning", "#00ff00"),
  flood_watch: nws("Flood Watch", "#2e8b57"),
  flood_advisory: nws("Flood Advisory", "#00ff7f"),
  coastal_flood_warning: nws("Coastal Flood Warning", "#228b22"),
  coastal_flood_watch: nws("Coastal Flood Watch", "#66cdaa"),
  coastal_flood_advisory: nws("Coastal Flood Advisory", "#7cfc00"),
  coastal_flood_statement: nws("Coastal Flood Statement", "#6b8e23"),
  high_surf_warning: nws("High Surf Warning", "#228b22"),
  high_surf_advisory: nws("High Surf Advisory", "#ba55d3"),
  beach_hazards_statement: nws("Beach Hazards Statement", "#40e0d0"),
  rip_current_statement: nws("Rip Current Statement", "#40e0d0"),
  high_wind_warning: nws("High Wind Warning", "#daa520"),
  high_wind_watch: nws("High Wind Watch", "#b8860b"),
  wind_advisory: nws("Wind Advisory", "#d2b48c"),
  winter_storm_warning: nws("Winter Storm Warning", "#ff69b4"),
  winter_storm_watch: nws("Winter Storm Watch", "#4682b4"),
  winter_weather_advisory: nws("Winter Weather Advisory", "#7b68ee"),
  blizzard_warning: nws("Blizzard Warning", "#ff4500"),
  ice_storm_warning: nws("Ice Storm Warning", "#8b008b"),
  red_flag_warning: nws("Red Flag Warning", "#ff1493"),
  fire_weather_watch: nws("Fire Weather Watch", "#ffdead"),
  extreme_heat_warning: nws("Extreme Heat Warning", "#c71585"),
  extreme_heat_watch: nws("Extreme Heat Watch", "#800000"),
  heat_advisory: nws("Heat Advisory", "#ff7f50"),
  air_quality_alert: nws("Air Quality Alert", "#808080"),
  dense_smoke_advisory: nws("Dense Smoke Advisory", "#f0e68c"),
  dense_fog_advisory: nws("Dense Fog Advisory", "#708090"),
  freeze_warning: nws("Freeze Warning", "#483d8b"),
  frost_advisory: nws("Frost Advisory", "#6495ed"),
  extreme_cold_warning: nws("Extreme Cold Warning", "#0000ff"),
  cold_weather_advisory: nws("Cold Weather Advisory", "#afeeee"),
  gale_warning: nws("Gale Warning", "#dda0dd"),
  storm_warning: nws("Storm Warning", "#9400d3"),
  hazardous_seas_warning: nws("Hazardous Seas Warning", "#d8bfd8"),
  small_craft_advisory: nws("Small Craft Advisory", "#d8bfd8"),
  special_marine_warning: nws("Special Marine Warning", "#ffa500"),
  special_weather_statement: nws("Special Weather Statement", "#ffe4b5"),
  avalanche_warning: nws("Avalanche Warning", "#1e90ff"),
  earthquake_warning: nws("Earthquake Warning", "#8b4513"),
  civil_danger_warning: nws("Civil Danger Warning", "#ffb6c1"),
  evacuation_immediate: nws("Evacuation Immediate", "#7fff00"),
  shelter_in_place_warning: nws("Shelter In Place Warning", "#fa8072"),
  hydrologic_outlook: nws("Hydrologic Outlook", "#90ee90"),
  hazardous_weather_outlook: nws("Hazardous Weather Outlook", "#eee8aa"),
};

/** Keyed by product; the aliases are the NWS event names, the 2025 renames' old names included. */
export const NWS_HAZARD_PALETTE = definePalette({
  id: "nws_hazard",
  title: "NWS watches, warnings and advisories",
  source: "National Weather Service map color table (weather.gov/help-map)",
  entries: NWS_HAZARD_ENTRIES,
  aliases: {
    ...Object.fromEntries(
      Object.entries(NWS_HAZARD_ENTRIES).map(([key, value]) => [value.label, key as keyof typeof NWS_HAZARD_ENTRIES]),
    ),
    "Excessive Heat Warning": "extreme_heat_warning",
    "Excessive Heat Watch": "extreme_heat_watch",
    "Wind Chill Warning": "extreme_cold_warning",
    "Wind Chill Advisory": "cold_weather_advisory",
  },
});

/** NIFC WFIGS interagency perimeters, as Esri's USA Current Wildfires draws them. */
export const WILDFIRE_PERIMETER_PALETTE = definePalette({
  id: "wildfire_perimeter",
  title: "Wildfire perimeter",
  source: "NIFC WFIGS current perimeters; Esri USA Current Wildfires colors",
  entries: {
    wildfire: entry("Wildfire", "#f7ada4", "#f7ada4", { polygon: { fillOpacity: 0.54, outlineWidth: 1, outline: "#e60c0c" } }),
    prescribed: entry("Prescribed fire", "#e8bd71", "#e8bd71", { polygon: { fillOpacity: 0.54, outlineWidth: 1, outline: "#e5a53e" } }),
  },
  aliases: { WF: "wildfire", RX: "prescribed" },
});

const fireSize = (label: string, min: number) => entry(label, "#c93100", "#c93100", { icon: "wildfire", min });

/** NIFC WFIGS incident points by size class in acres; the marker grows with the class. */
export const WILDFIRE_INCIDENT_PALETTE = definePalette({
  id: "wildfire_incident",
  title: "Wildfire incident size",
  source: "NIFC WFIGS incident locations; Esri USA Current Wildfires size classes",
  entries: {
    under_1k: fireSize("Under 1,000 acres", 0),
    ac_1k: fireSize("1,000 to 9,999 acres", 1000),
    ac_10k: fireSize("10,000 to 49,999 acres", 10000),
    ac_50k: fireSize("50,000 to 99,999 acres", 50000),
    ac_100k: fireSize("100,000 to 299,999 acres", 100000),
    ac_300k: fireSize("300,000 acres and over", 300000),
    prescribed: entry("Prescribed fire", "#b36b00", "#b36b00", { icon: "wildfire" }),
  },
});

/** USGS earthquakes by magnitude class, in Esri's colors. */
export const EARTHQUAKE_MAGNITUDE_PALETTE = definePalette({
  id: "earthquake_magnitude",
  title: "Earthquake magnitude",
  source: "USGS earthquake summary feeds; Esri USGS Recent Earthquakes colors",
  entries: {
    under_3: entry("Under 3.0", "#a8a8a8", "#a8a8a8", { min: -10 }),
    m3: entry("3.0 to 4.4", "#6ceae6", "#6ceae6", { min: 3 }),
    m4_5: entry("4.5 to 5.9", "#f2e643", "#f2e643", { min: 4.5 }),
    m6: entry("6.0 to 7.4", "#fc0316", "#fc0316", { min: 6 }),
    m7_5: entry("7.5 and over", "#242424", "#242424", { min: 7.5 }),
  },
});

const shaking = (label: string, color: string, min: number, fillOpacity = 0.6) =>
  entry(label, color, color, { min, polygon: { fillOpacity, outlineWidth: 0 } });

/** USGS ShakeMap instrumental intensity (MMI); I to III draw nothing, as Esri's layer. */
export const SHAKEMAP_MMI_PALETTE = definePalette({
  id: "shakemap_mmi",
  title: "Shaking intensity (MMI)",
  source: "USGS ShakeMap; Esri USGS Shake Intensity colors",
  entries: {
    mmi_1_3: shaking("I to III: not felt to weak", "#ffffff", 1, 0),
    mmi_4: shaking("IV: light", "#f7bfc5", 4),
    mmi_5: shaking("V: moderate", "#f5a0a6", 5),
    mmi_6_7: shaking("VI to VII: strong to very strong", "#f06167", 6),
    mmi_8: shaking("VIII: severe", "#ed4147", 8),
    mmi_9: shaking("IX: violent", "#eb2128", 9),
    mmi_10: shaking("X and over: extreme", "#e80208", 10),
  },
});

/** River gauges by NWPS flood category, in Esri's Live Stream Gauges colors. */
export const RIVER_GAUGE_PALETTE = definePalette({
  id: "river_gauge",
  title: "River gauge flood category",
  source: "NOAA National Water Prediction Service; Esri Live Stream Gauges colors",
  entries: {
    major: entry("Major flooding", "#b50000"),
    moderate: entry("Moderate flooding", "#f73500"),
    minor: entry("Minor flooding", "#ff8b00"),
    action: entry("Action stage", "#f2ca00"),
    no_flooding: entry("No flooding", "#ffffff"),
    low: entry("Low water", "#c1976f"),
    unknown: entry("Unknown or not current", "#72d2e8"),
  },
  aliases: {
    low_threshold: "low",
    obs_not_current: "unknown",
    fcst_not_current: "unknown",
    out_of_service: "unknown",
    not_defined: "unknown",
  },
});

const outage = (label: string, color: string, min: number) =>
  entry(label, color, color, { min, polygon: { fillOpacity: 0.5, outlineWidth: 1 } });

/** Customers out of power, graduated; Open Source EOC's yellow to red ramp. */
export const OUTAGE_CUSTOMERS_PALETTE = definePalette({
  id: "outage_customers",
  title: "Customers without power",
  source: "Open Source EOC; utility outage feeds assign no colors",
  entries: {
    none: outage("None reported", "#bdbdbd", 0),
    c1: outage("1 to 99", "#ffffb2", 1),
    c100: outage("100 to 999", "#fecc5c", 100),
    c1k: outage("1,000 to 4,999", "#fd8d3c", 1000),
    c5k: outage("5,000 to 19,999", "#f03b20", 5000),
    c20k: outage("20,000 and over", "#bd0026", 20000),
  },
});

/**
 * ORNL ODIN's county outages count electric meters, not customers, so they
 * read in their own unit: the same ramp and bounds, labeled in meters.
 */
export const OUTAGE_METERS_PALETTE = definePalette({
  id: "outage_meters",
  title: "Electric meters without power (ODIN)",
  source: "Open Source EOC; ORNL ODIN assigns no colors",
  entries: {
    none: outage("No meters reported out", "#bdbdbd", 0),
    m1: outage("1 to 99 meters out", "#ffffb2", 1),
    m100: outage("100 to 999 meters out", "#fecc5c", 100),
    m1k: outage("1,000 to 4,999 meters out", "#fd8d3c", 1000),
    m5k: outage("5,000 to 19,999 meters out", "#f03b20", 5000),
    m20k: outage("20,000 meters out and over", "#bd0026", 20000),
  },
});

/** The live feed presets' palettes, kept out of PALETTES: NWS and Esri set these colors, not the product. */
export const FEED_PALETTES = [
  NWS_HAZARD_PALETTE,
  WILDFIRE_PERIMETER_PALETTE,
  WILDFIRE_INCIDENT_PALETTE,
  EARTHQUAKE_MAGNITUDE_PALETTE,
  SHAKEMAP_MMI_PALETTE,
  RIVER_GAUGE_PALETTE,
  OUTAGE_CUSTOMERS_PALETTE,
  OUTAGE_METERS_PALETTE,
] as const;
