export const ICON_SIZES = [16, 20, 24, 32, 40, 48] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export type IconPrimitive =
  | { readonly element: "path"; readonly d: string; readonly fill?: "currentColor" }
  | { readonly element: "circle"; readonly cx: number; readonly cy: number; readonly r: number; readonly fill?: "currentColor" }
  | { readonly element: "line"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly element: "polyline"; readonly points: string }
  | { readonly element: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rx?: number };

export interface IconDefinition {
  readonly label: string;
  readonly category: "navigation" | "action" | "lifeline";
  readonly description: string;
  readonly intendedSizes: readonly IconSize[];
  readonly primitives: readonly IconPrimitive[];
  readonly provenance: "Open Source EOC original artwork";
  readonly license: "Apache-2.0";
}

const NAV_SIZES = [16, 20, 24] as const;
const ACTION_SIZES = [16, 20, 24, 32] as const;
const LIFELINE_SIZES = [20, 24, 32, 40, 48] as const;

function icon<const Category extends IconDefinition["category"]>(
  label: string,
  category: Category,
  description: string,
  intendedSizes: readonly IconSize[],
  primitives: readonly IconPrimitive[],
): IconDefinition & { readonly category: Category } {
  return {
    label,
    category,
    description,
    intendedSizes,
    primitives,
    provenance: "Open Source EOC original artwork",
    license: "Apache-2.0",
  };
}

export const iconRegistry = {
  overview: icon("Overview", "navigation", "House with a centered doorway", NAV_SIZES, [
    { element: "path", d: "M3.5 10.5 12 3.5l8.5 7" },
    { element: "path", d: "M5.5 9.5V20h13V9.5" },
    { element: "path", d: "M9.5 20v-6h5v6" },
  ]),
  map: icon("Map", "navigation", "Three folded map panels", NAV_SIZES, [
    { element: "path", d: "m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z" },
    { element: "line", x1: 9, y1: 3, x2: 9, y2: 19 },
    { element: "line", x1: 15, y1: 5, x2: 15, y2: 21 },
  ]),
  lifelines: icon("ESFs and Lifelines", "navigation", "Three linked service nodes", NAV_SIZES, [
    { element: "circle", cx: 12, cy: 4.5, r: 2 },
    { element: "circle", cx: 5, cy: 17.5, r: 2 },
    { element: "circle", cx: 19, cy: 17.5, r: 2 },
    { element: "path", d: "M11 6.3 6 15.7M13 6.3l5 9.4M7 17.5h10" },
  ]),
  sitrep: icon("Situation report", "navigation", "Report page with two text lines", NAV_SIZES, [
    { element: "path", d: "M6 2.5h8l4 4V21.5H6Z" },
    { element: "path", d: "M14 2.5v4h4" },
    { element: "line", x1: 9, y1: 11, x2: 15, y2: 11 },
    { element: "line", x1: 9, y1: 15, x2: 15, y2: 15 },
  ]),
  boards: icon("Boards", "navigation", "Four-cell board grid", NAV_SIZES, [
    { element: "rect", x: 3, y: 4, width: 18, height: 16, rx: 1.5 },
    { element: "line", x1: 3, y1: 10, x2: 21, y2: 10 },
    { element: "line", x1: 10, y1: 4, x2: 10, y2: 20 },
  ]),
  resources: icon("Resources", "navigation", "Supply box", NAV_SIZES, [
    { element: "path", d: "m4 7 8-4 8 4-8 4Z" },
    { element: "path", d: "M4 7v10l8 4 8-4V7M12 11v10" },
  ]),
  tasks: icon("Tasks", "navigation", "Checked task square", NAV_SIZES, [
    { element: "rect", x: 3.5, y: 3.5, width: 17, height: 17, rx: 2 },
    { element: "polyline", points: "7.5 12 10.5 15 17 8.5" },
  ]),
  fieldReports: icon("Field reports", "navigation", "Clipboard report", NAV_SIZES, [
    { element: "rect", x: 5, y: 4, width: 14, height: 17, rx: 2 },
    { element: "path", d: "M9 4V2.5h6V4" },
    { element: "path", d: "M15 11.5c0 2.5-3 5.2-3 5.2s-3-2.7-3-5.2a3 3 0 1 1 6 0Z" },
    { element: "circle", cx: 12, cy: 11.5, r: 0.8, fill: "currentColor" },
  ]),
  operationalPeriods: icon("Operational periods", "navigation", "Calendar with period marker", NAV_SIZES, [
    { element: "rect", x: 3, y: 5, width: 18, height: 16, rx: 2 },
    { element: "line", x1: 7, y1: 2.5, x2: 7, y2: 7.5 },
    { element: "line", x1: 17, y1: 2.5, x2: 17, y2: 7.5 },
    { element: "line", x1: 3, y1: 10, x2: 21, y2: 10 },
    { element: "circle", cx: 12, cy: 15, r: 2.5 },
  ]),
  iap: icon("IAP planning", "navigation", "Plan page with checklist", NAV_SIZES, [
    { element: "path", d: "M6 2.5h9l3 3V21.5H6Z" },
    { element: "path", d: "M15 2.5v3h3" },
    { element: "polyline", points: "8.5 11 10 12.5 12 10" },
    { element: "line", x1: 13, y1: 11, x2: 16, y2: 11 },
    { element: "polyline", points: "8.5 16 10 17.5 12 15" },
    { element: "line", x1: 13, y1: 16, x2: 16, y2: 16 },
  ]),
  participants: icon("Participants", "navigation", "Three people", NAV_SIZES, [
    { element: "circle", cx: 12, cy: 7, r: 3 },
    { element: "circle", cx: 5.5, cy: 9, r: 2 },
    { element: "circle", cx: 18.5, cy: 9, r: 2 },
    { element: "path", d: "M6.5 20v-2c0-3 2.5-5 5.5-5s5.5 2 5.5 5v2" },
    { element: "path", d: "M2.5 19v-1.5c0-2.2 1.4-3.8 3.5-4.3M21.5 19v-1.5c0-2.2-1.4-3.8-3.5-4.3" },
  ]),
  messages: icon("Messages", "navigation", "Conversation bubble", NAV_SIZES, [
    { element: "path", d: "M4 4.5h16v12H9l-5 4Z" },
    { element: "line", x1: 8, y1: 9, x2: 16, y2: 9 },
    { element: "line", x1: 8, y1: 13, x2: 13, y2: 13 },
  ]),
  settings: icon("Settings", "navigation", "Eight-tooth settings gear", NAV_SIZES, [
    { element: "circle", cx: 12, cy: 12, r: 3 },
    { element: "path", d: "M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" },
  ]),
  help: icon("Help", "navigation", "Question mark in a circle", NAV_SIZES, [
    { element: "circle", cx: 12, cy: 12, r: 9 },
    { element: "path", d: "M9.7 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.2.9-1.2 1.7" },
    { element: "circle", cx: 12, cy: 17, r: 0.7, fill: "currentColor" },
  ]),
  theme: icon("Theme", "navigation", "Crescent moon", NAV_SIZES, [
    { element: "path", d: "M19.5 15.2A8.5 8.5 0 0 1 8.8 4.5 8.5 8.5 0 1 0 19.5 15.2Z" },
  ]),
  incidentSetup: icon("Incident setup", "navigation", "Incident flag over a baseline", NAV_SIZES, [
    { element: "line", x1: 5, y1: 3, x2: 5, y2: 21 },
    { element: "path", d: "M5 4h12l-2.5 4L17 12H5" },
    { element: "line", x1: 2.5, y1: 21, x2: 9, y2: 21 },
  ]),
  datasets: icon("Datasets", "navigation", "Three-tier data cylinder", NAV_SIZES, [
    { element: "path", d: "M4 6c0-2 3.6-3.5 8-3.5S20 4 20 6s-3.6 3.5-8 3.5S4 8 4 6Z" },
    { element: "path", d: "M4 6v6c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5V6" },
    { element: "path", d: "M4 12v6c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5v-6" },
  ]),
  forms: icon("Forms", "navigation", "Form page with input rows", NAV_SIZES, [
    { element: "path", d: "M6 2.5h8l4 4V21.5H6Z" },
    { element: "path", d: "M14 2.5v4h4" },
    { element: "rect", x: 8.5, y: 10, width: 2.5, height: 2.5, rx: 0.4 },
    { element: "line", x1: 13.5, y1: 11.2, x2: 16, y2: 11.2 },
    { element: "line", x1: 8.5, y1: 16.5, x2: 16, y2: 16.5 },
  ]),
  smartForms: icon("Smart Forms", "navigation", "Branching form workflow", NAV_SIZES, [
    { element: "path", d: "M6 2.5h8l4 4V21.5H6ZM14 2.5v4h4" },
    { element: "circle", cx: 9, cy: 10, r: 1 },
    { element: "circle", cx: 15, cy: 14, r: 1 },
    { element: "circle", cx: 9, cy: 18, r: 1 },
    { element: "path", d: "M10 10h2v8h-2M12 14h2" },
  ]),
  tracking: icon("Tracking", "navigation", "Location pin with movement trail", NAV_SIZES, [
    { element: "path", d: "M16.5 9.5c0 4-4.5 8.5-4.5 8.5S7.5 13.5 7.5 9.5a4.5 4.5 0 1 1 9 0Z" },
    { element: "circle", cx: 12, cy: 9.5, r: 1.5 },
    { element: "path", d: "M4 17.5c-1.3.5-2 1.1-2 1.8 0 1.5 4.5 2.7 10 2.7s10-1.2 10-2.7c0-.7-.7-1.3-2-1.8" },
  ]),
  aar: icon("After action review", "navigation", "Review page with return arrow", NAV_SIZES, [
    { element: "path", d: "M6 2.5h9l3 3V14" },
    { element: "path", d: "M15 2.5v3h3M6 2.5v19h8" },
    { element: "path", d: "M20.5 17.5h-6m0 0 2.5-2.5m-2.5 2.5L17 20" },
  ]),
  feeds: icon("Feeds", "navigation", "Inbound signal arcs", NAV_SIZES, [
    { element: "circle", cx: 6, cy: 18, r: 1.5, fill: "currentColor" },
    { element: "path", d: "M4.5 11.5a8 8 0 0 1 8 8M4.5 6a13.5 13.5 0 0 1 13.5 13.5" },
  ]),
  files: icon("Files", "navigation", "Two stacked document pages", NAV_SIZES, [
    { element: "path", d: "M7 2.5h8l4 4V19H7Z" },
    { element: "path", d: "M15 2.5v4h4M7 6H4.5v15.5H16V19" },
  ]),
  alerts: icon("Notifications", "navigation", "Notification bell", NAV_SIZES, [
    { element: "path", d: "M5 17.5h14l-1.5-2.5v-4.5a5.5 5.5 0 0 0-11 0V15Z" },
    { element: "path", d: "M10 20.5a2.5 2.5 0 0 0 4 0" },
  ]),
  jic: icon("Joint Information Center", "navigation", "Broadcast podium", NAV_SIZES, [
    { element: "path", d: "M8 10h8l1 11H7Z" },
    { element: "line", x1: 12, y1: 10, x2: 12, y2: 6 },
    { element: "circle", cx: 12, cy: 4.5, r: 1.5 },
    { element: "path", d: "M7 3a5 5 0 0 0 0 4M17 3a5 5 0 0 1 0 4" },
  ]),
  templates: icon("Templates", "navigation", "Layered reusable pages", NAV_SIZES, [
    { element: "rect", x: 7, y: 3, width: 12, height: 15, rx: 1 },
    { element: "path", d: "M7 6H4.5v15H16v-3" },
    { element: "line", x1: 10, y1: 8, x2: 16, y2: 8 },
    { element: "line", x1: 10, y1: 12, x2: 16, y2: 12 },
  ]),
  boardCustomization: icon("Board customization", "navigation", "Board panel with adjustment sliders", NAV_SIZES, [
    { element: "rect", x: 3, y: 3, width: 18, height: 18, rx: 2 },
    { element: "line", x1: 6, y1: 8, x2: 18, y2: 8 },
    { element: "circle", cx: 9, cy: 8, r: 1.5 },
    { element: "line", x1: 6, y1: 12, x2: 18, y2: 12 },
    { element: "circle", cx: 15, cy: 12, r: 1.5 },
    { element: "line", x1: 6, y1: 16, x2: 18, y2: 16 },
    { element: "circle", cx: 11, cy: 16, r: 1.5 },
  ]),
  add: icon("Add", "action", "Plus sign", ACTION_SIZES, [
    { element: "line", x1: 12, y1: 4, x2: 12, y2: 20 },
    { element: "line", x1: 4, y1: 12, x2: 20, y2: 12 },
  ]),
  report: icon("Create report", "action", "Report page", ACTION_SIZES, [
    { element: "path", d: "M6 2.5h8l4 4V21.5H6Z" },
    { element: "path", d: "M14 2.5v4h4M12 10v7M8.5 13.5h7" },
  ]),
  briefing: icon("Briefing view", "action", "Presentation screen", ACTION_SIZES, [
    { element: "rect", x: 2.5, y: 4, width: 19, height: 13, rx: 1.5 },
    { element: "line", x1: 12, y1: 17, x2: 12, y2: 21 },
    { element: "line", x1: 8, y1: 21, x2: 16, y2: 21 },
  ]),
  search: icon("Search", "action", "Magnifying glass", ACTION_SIZES, [
    { element: "circle", cx: 10.5, cy: 10.5, r: 6.5 },
    { element: "line", x1: 15.5, y1: 15.5, x2: 21, y2: 21 },
  ]),
  compare: icon("Compare periods", "action", "Three comparison bars", ACTION_SIZES, [
    { element: "line", x1: 5, y1: 20, x2: 5, y2: 11 },
    { element: "line", x1: 12, y1: 20, x2: 12, y2: 4 },
    { element: "line", x1: 19, y1: 20, x2: 19, y2: 8 },
  ]),
  close: icon("Close", "action", "Diagonal close cross", ACTION_SIZES, [
    { element: "line", x1: 5, y1: 5, x2: 19, y2: 19 },
    { element: "line", x1: 19, y1: 5, x2: 5, y2: 19 },
  ]),
  chevronRight: icon("Open", "action", "Right-facing chevron", ACTION_SIZES, [
    { element: "polyline", points: "9 5 16 12 9 19" },
  ]),
  clock: icon("Time", "action", "Clock face", ACTION_SIZES, [
    { element: "circle", cx: 12, cy: 12, r: 9 },
    { element: "polyline", points: "12 7 12 12 16 14" },
  ]),
  source: icon("Source", "action", "Clipboard source record", ACTION_SIZES, [
    { element: "rect", x: 5, y: 5, width: 14, height: 16, rx: 2 },
    { element: "path", d: "M9 5V3h6v2" },
    { element: "circle", cx: 12, cy: 11, r: 2 },
    { element: "path", d: "M8.5 17c.7-2 2-3 3.5-3s2.8 1 3.5 3" },
  ]),
  safetySecurity: icon("Safety and Security", "lifeline", "Protective shield with check", LIFELINE_SIZES, [
    { element: "path", d: "M12 2.5 20 5.5v6.3c0 5-3.3 8.3-8 9.7-4.7-1.4-8-4.7-8-9.7V5.5Z" },
    { element: "polyline", points: "8 12 11 15 16.5 9.5" },
  ]),
  foodHydrationShelter: icon("Food, Hydration, Shelter", "lifeline", "Shelter house with doorway", LIFELINE_SIZES, [
    { element: "path", d: "m2.5 11.2 9.5-8 9.5 8" },
    { element: "path", d: "M5 10v11h14V10" },
    { element: "path", d: "M12 12s-2.5 3-2.5 5a2.5 2.5 0 0 0 5 0c0-2-2.5-5-2.5-5Z" },
  ]),
  healthMedical: icon("Health and Medical", "lifeline", "Medical cross", LIFELINE_SIZES, [
    { element: "path", d: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z" },
  ]),
  energy: icon("Energy", "lifeline", "Electric transmission tower", LIFELINE_SIZES, [
    { element: "path", d: "M10 2.5h4L17.5 21M10 2.5 6.5 21M8.2 12h7.6M7.3 16.5h9.4M9 7.5h6M6.2 9.5h11.6M8 21l4-4.5 4 4.5" },
  ]),
  communications: icon("Communications", "lifeline", "Radio mast with signal arcs", LIFELINE_SIZES, [
    { element: "circle", cx: 12, cy: 7, r: 1.5, fill: "currentColor" },
    { element: "path", d: "M12 8.5 8.5 21M12 8.5 15.5 21M9.5 16h5" },
    { element: "path", d: "M8.5 3.5a5 5 0 0 0 0 7M15.5 3.5a5 5 0 0 1 0 7M5.5 1a8.5 8.5 0 0 0 0 12M18.5 1a8.5 8.5 0 0 1 0 12" },
  ]),
  transportation: icon("Transportation", "lifeline", "Divided roadway with lane marks", LIFELINE_SIZES, [
    { element: "path", d: "M8.5 2.5 4 21M15.5 2.5 20 21" },
    { element: "line", x1: 12, y1: 3, x2: 12, y2: 7 },
    { element: "line", x1: 12, y1: 10, x2: 12, y2: 14 },
    { element: "line", x1: 12, y1: 17, x2: 12, y2: 21 },
  ]),
  hazardousMaterials: icon("Hazardous Materials", "lifeline", "Three-lobed biohazard mark", LIFELINE_SIZES, [
    { element: "circle", cx: 12, cy: 12, r: 1.5, fill: "currentColor" },
    { element: "path", d: "M9 9.5A4.5 4.5 0 1 1 15 9.5M9.8 12.8A4.5 4.5 0 1 1 8.2 9.7M14.2 12.8A4.5 4.5 0 1 0 15.8 9.7" },
    { element: "path", d: "M10.7 10.8 9 8.3M13.3 10.8 15 8.3M12 13.5v3" },
  ]),
  waterSystems: icon("Water Systems", "lifeline", "Three water drops", LIFELINE_SIZES, [
    { element: "path", d: "M12 2.5s-4 5-4 8a4 4 0 0 0 8 0c0-3-4-8-4-8Z" },
    { element: "path", d: "M5.5 13.5s-3 3.8-3 6a3 3 0 0 0 6 0c0-2.2-3-6-3-6ZM18.5 13.5s-3 3.8-3 6a3 3 0 0 0 6 0c0-2.2-3-6-3-6Z" },
  ]),
} as const satisfies Readonly<Record<string, IconDefinition>>;

export type IconName = keyof typeof iconRegistry;
export type LifelineIconName = {
  [Name in IconName]: (typeof iconRegistry)[Name]["category"] extends "lifeline" ? Name : never;
}[IconName];

export const navigationIconNames = Object.keys(iconRegistry).filter(
  (name): name is IconName => iconRegistry[name as IconName].category === "navigation",
);
export const actionIconNames = Object.keys(iconRegistry).filter(
  (name): name is IconName => iconRegistry[name as IconName].category === "action",
);
export const lifelineIconNames = Object.keys(iconRegistry).filter(
  (name): name is LifelineIconName => iconRegistry[name as IconName].category === "lifeline",
);

export const lifelineIconByKey = {
  safety_security: "safetySecurity",
  food_hydration_shelter: "foodHydrationShelter",
  health_medical: "healthMedical",
  energy: "energy",
  communications: "communications",
  transportation: "transportation",
  hazardous_materials: "hazardousMaterials",
  water_systems: "waterSystems",
} as const satisfies Readonly<Record<string, LifelineIconName>>;

export type LifelineKey = keyof typeof lifelineIconByKey;

/** Stable icon mapping for every D02 current and planned destination. */
export const destinationIconByKey = {
  map: "map",
  overview: "overview",
  incidentSetup: "incidentSetup",
  datasets: "datasets",
  boards: "boards",
  sitrep: "sitrep",
  forms: "forms",
  iap: "iap",
  smartForms: "smartForms",
  resources: "resources",
  tracking: "tracking",
  aar: "aar",
  feeds: "feeds",
  messages: "messages",
  files: "files",
  alerts: "alerts",
  lifelines: "lifelines",
  tasks: "tasks",
  fieldReports: "fieldReports",
  operationalPeriods: "operationalPeriods",
  participants: "participants",
  jic: "jic",
  templates: "templates",
  settings: "settings",
  boardCustomization: "boardCustomization",
} as const satisfies Readonly<Record<string, IconName>>;

export type DestinationIconKey = keyof typeof destinationIconByKey;
