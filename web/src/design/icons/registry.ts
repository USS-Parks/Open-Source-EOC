export const ICON_SIZES = [16, 20, 24, 32, 40, 48] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export type IconPrimitive =
  | { readonly element: "path"; readonly d: string; readonly fill?: "currentColor"; readonly fillRule?: "evenodd" }
  | { readonly element: "circle"; readonly cx: number; readonly cy: number; readonly r: number; readonly fill?: "currentColor" }
  | { readonly element: "line"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly element: "polyline"; readonly points: string }
  | { readonly element: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rx?: number };

interface IconDefinition {
  readonly label: string;
  /** "glyph": a solid silhouette drawn by fill, as the canonical frames draw them. */
  readonly category: "navigation" | "action" | "lifeline" | "glyph";
  readonly description: string;
  readonly intendedSizes: readonly IconSize[];
  readonly primitives: readonly IconPrimitive[];
  /** The coordinate space of the primitives; 0 0 24 24 unless a source glyph uses its own. */
  readonly viewBox?: string;
  readonly provenance: "Open Source EOC original artwork" | "Google Material Symbols" | "Font Awesome Free 6.7.2";
  readonly license: "Apache-2.0" | "CC-BY-4.0";
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

const MATERIAL = "0 -960 960 960";
const GLYPH_SIZES = [16, 20, 24, 32, 40, 48] as const;

/** A solid silhouette: one or more filled paths in its source's coordinate space. */
function glyph(
  label: string,
  description: string,
  paths: readonly string[],
  source: { readonly viewBox: string; readonly provenance: IconDefinition["provenance"]; readonly license: IconDefinition["license"]; readonly evenodd?: boolean },
): IconDefinition & { readonly category: "glyph" } {
  return {
    label,
    category: "glyph",
    description,
    intendedSizes: GLYPH_SIZES,
    primitives: paths.map((d) => ({ element: "path", d, fill: "currentColor", ...(source.evenodd ? { fillRule: "evenodd" as const } : {}) })),
    viewBox: source.viewBox,
    provenance: source.provenance,
    license: source.license,
  };
}

const material = { viewBox: MATERIAL, provenance: "Google Material Symbols", license: "Apache-2.0" } as const;
const original = { viewBox: MATERIAL, provenance: "Open Source EOC original artwork", license: "Apache-2.0" } as const;

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
  dashboards: icon("Dashboards", "navigation", "Dashboard tiles with a bar chart", NAV_SIZES, [
    { element: "rect", x: 3, y: 3.5, width: 18, height: 17, rx: 2 },
    { element: "line", x1: 3, y1: 9, x2: 21, y2: 9 },
    { element: "line", x1: 8, y1: 17, x2: 8, y2: 13 },
    { element: "line", x1: 12, y1: 17, x2: 12, y2: 11.5 },
    { element: "line", x1: 16, y1: 17, x2: 16, y2: 14.5 },
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
  chevronDown: icon("Choose", "action", "Downward chevron", ACTION_SIZES, [
    { element: "polyline", points: "5 9 12 16 19 9" },
  ]),
  layers: icon("Map layers", "action", "Two stacked map sheets", ACTION_SIZES, [
    { element: "path", d: "M12 3.5 21 8.5 12 13.5 3 8.5Z" },
    { element: "polyline", points: "3 12.5 12 17.5 21 12.5" },
    { element: "polyline", points: "3 16.5 12 21.5 21 16.5" },
  ]),
  locate: icon("Show my location", "action", "Crosshair around a dot", ACTION_SIZES, [
    { element: "circle", cx: 12, cy: 12, r: 6.5 },
    { element: "circle", cx: 12, cy: 12, r: 2, fill: "currentColor" },
    { element: "path", d: "M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" },
  ]),
  fullscreen: icon("Full screen", "action", "Four outward corners", ACTION_SIZES, [
    { element: "path", d: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" },
  ]),
  minus: icon("Zoom out", "action", "Horizontal bar", ACTION_SIZES, [
    { element: "line", x1: 5, y1: 12, x2: 19, y2: 12 },
  ]),
  target: icon("Objective", "action", "Target rings with an arrow", ACTION_SIZES, [
    { element: "circle", cx: 11, cy: 13, r: 7.5 },
    { element: "circle", cx: 11, cy: 13, r: 3.5 },
    { element: "path", d: "M11 13 19.5 4.5M16.5 4.5h3v3" },
  ]),
  power: icon("Electricity", "action", "Lightning bolt", ACTION_SIZES, [
    { element: "path", d: "M13.5 2.5 5.5 13.5h6l-1 8 8-11h-6Z" },
  ]),
  fuel: icon("Fuel", "action", "Fuel pump", ACTION_SIZES, [
    { element: "rect", x: 4.5, y: 3.5, width: 9, height: 17, rx: 1.5 },
    { element: "line", x1: 4.5, y1: 9.5, x2: 13.5, y2: 9.5 },
    { element: "path", d: "M13.5 7.5h2.5l2.5 2.5v7.5a1.5 1.5 0 0 1-3 0V13h-2" },
  ]),
  sun: icon("Light theme", "action", "Sun with eight rays", ACTION_SIZES, [
    { element: "circle", cx: 12, cy: 12, r: 4 },
    { element: "path", d: "M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" },
  ]),
  alertCircle: icon("Needs attention", "action", "Exclamation mark in a circle", ACTION_SIZES, [
    { element: "circle", cx: 12, cy: 12, r: 9 },
    { element: "line", x1: 12, y1: 7, x2: 12, y2: 13 },
    { element: "circle", cx: 12, cy: 16.6, r: 0.9, fill: "currentColor" },
  ]),
  incident: icon("Incident", "action", "Incident folder with a check", ACTION_SIZES, [
    { element: "path", d: "M3.5 7.5h17V20h-17Z" },
    { element: "path", d: "M8 7.5V4.5h8v3" },
    { element: "polyline", points: "8.5 13.5 11 16 15.5 11.5" },
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
  communications: { ...glyph("Communications", "Cell tower with signal arcs", [
    "M196-276q-57-60-86.5-133T80-560q0-78 29.5-151T196-844l48 48q-48 48-72 110.5T148-560q0 63 24 125.5T244-324l-48 48Zm96-96q-39-39-59.5-88T212-560q0-51 20.5-100t59.5-88l48 48q-30 27-45 64t-15 76q0 36 15 73t45 67l-48 48ZM280-80l135-405q-16-14-25.5-33t-9.5-42q0-42 29-71t71-29q42 0 71 29t29 71q0 23-9.5 42T545-485L680-80h-80l-26-80H387l-27 80h-80Zm133-160h134l-67-200-67 200Zm255-132-48-48q30-27 45-64t15-76q0-36-15-73t-45-67l48-48q39 39 58 88t22 100q0 51-20.5 100T668-372Zm96 96-48-48q48-48 72-110.5T812-560q0-63-24-125.5T716-796l48-48q57 60 86.5 133T880-560q0 78-28 151t-88 133Z",
  ], material), category: "lifeline" as const, intendedSizes: LIFELINE_SIZES },
  transportation: icon("Transportation", "lifeline", "Divided roadway with lane marks", LIFELINE_SIZES, [
    { element: "path", d: "M8.5 2.5 4 21M15.5 2.5 20 21" },
    { element: "line", x1: 12, y1: 3, x2: 12, y2: 7 },
    { element: "line", x1: 12, y1: 10, x2: 12, y2: 14 },
    { element: "line", x1: 12, y1: 17, x2: 12, y2: 21 },
  ]),
  hazardousMaterials: {
    ...glyph("Hazardous Materials", "Three-lobed biohazard mark", [
      "M173.2 0c-1.8 0-3.5 .7-4.8 2C138.5 32.3 120 74 120 120c0 26.2 6 50.9 16.6 73c-22 2.4-43.8 9.1-64.2 20.5C37.9 232.8 13.3 262.4 .4 296c-.7 1.7-.5 3.7 .5 5.2c2.2 3.7 7.4 4.3 10.6 1.3C64.2 254.3 158 245.1 205 324s-8.1 153.1-77.6 173.2c-4.2 1.2-6.3 5.9-4.1 9.6c1 1.6 2.6 2.7 4.5 3c36.5 5.9 75.2 .1 109.7-19.2c20.4-11.4 37.4-26.5 50.5-43.8c13.1 17.3 30.1 32.4 50.5 43.8c34.5 19.3 73.3 25.2 109.7 19.2c1.9-.3 3.5-1.4 4.5-3c2.2-3.7 .1-8.4-4.1-9.6C379.1 477.1 324 403 371 324s140.7-69.8 193.5-21.4c3.2 2.9 8.4 2.3 10.6-1.3c1-1.6 1.1-3.5 .5-5.2c-12.9-33.6-37.5-63.2-72.1-82.5c-20.4-11.4-42.2-18.1-64.2-20.5C450 170.9 456 146.2 456 120c0-46-18.5-87.7-48.4-118c-1.3-1.3-3-2-4.8-2c-5 0-8.4 5.2-6.7 9.9C421.7 80.5 385.6 176 288 176S154.3 80.5 179.9 9.9c1.7-4.7-1.6-9.9-6.7-9.9zM240 272a48 48 0 1 1 96 0 48 48 0 1 1 -96 0zM181.7 417.6c6.3-11.8 9.8-25.1 8.6-39.8c-19.5-18-34-41.4-41.2-67.8c-12.5-8.1-26.2-11.8-40-12.4c-9-.4-18.1 .6-27.1 2.7c7.8 57.1 38.7 106.8 82.9 139.4c6.8-6.7 12.6-14.1 16.8-22.1zM288 64c-28.8 0-56.3 5.9-81.2 16.5c2 8.3 5 16.2 9 23.5c6.8 12.4 16.7 23.1 30.1 30.3c13.3-4.1 27.5-6.3 42.2-6.3s28.8 2.2 42.2 6.3c13.4-7.2 23.3-17.9 30.1-30.3c4-7.3 7-15.2 9-23.5C344.3 69.9 316.8 64 288 64zM426.9 310c-7.2 26.4-21.7 49.7-41.2 67.8c-1.2 14.7 2.2 28.1 8.6 39.8c4.3 8 10 15.4 16.8 22.1c44.3-32.6 75.2-82.3 82.9-139.4c-9-2.2-18.1-3.1-27.1-2.7c-13.8 .6-27.5 4.4-40 12.4z",
    ], { viewBox: "0 -32 576 576", provenance: "Font Awesome Free 6.7.2", license: "CC-BY-4.0" }),
    category: "lifeline" as const,
    intendedSizes: LIFELINE_SIZES,
  },
  waterSystems: icon("Water Systems", "lifeline", "Two water drops", LIFELINE_SIZES, [
    { element: "path", d: "M7.5 4.5s-4.5 5.4-4.5 9a4.5 4.5 0 0 0 9 0c0-3.6-4.5-9-4.5-9Z" },
    { element: "path", d: "M17 8.5s-3.5 4.2-3.5 7a3.5 3.5 0 0 0 7 0c0-2.8-3.5-7-3.5-7Z" },
  ]),
  // Solid glyphs, as the canonical frames draw the overview's counts, lifelines, work and rail.
  alertSolid: glyph("Needs attention", "Exclamation mark cut from a filled circle", [
    "M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z",
  ], material),
  homeSolid: glyph("Shelter", "Filled house with a doorway", [
    "M160-120v-480l320-240 320 240v480H560v-280H400v280H160Z",
  ], material),
  checkCircleSolid: glyph("Done", "Check mark cut from a filled circle", [
    "m424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z",
  ], material),
  shieldPlate: glyph("Safety and Security", "Shield outline around a filled shield", [
    "M480-80q-139-35-229.5-159.5T160-516v-244l320-120 320 120v244q0 152-90.5 276.5T480-80Zm0-84q104-33 172-132t68-220v-189l-240-90-240 90v189q0 121 68 220t172 132Zm0-316Z",
    "M480-232q-86.18-21.7-142.29-98.89T281.6-502.32v-151.28l198.4-74.4 198.4 74.4v151.28q0 94.24-56.11 171.43T480-232Z",
  ], material),
  shieldQuarters: glyph("Safety and Security", "Shield in filled and open quarters", [
    "M480-80q-139-35-229.5-159.5T160-516v-244l320-120 320 120v244q0 152-90.5 276.5T480-80Zm0-84q97-30 162-118.5T718-480H480v-315l-240 90v207q0 7 2 18h238v316Z",
  ], material),
  restaurant: glyph("Food, Hydration, Shelter", "Fork and knife", [
    "M280-80v-366q-51-14-85.5-56T160-600v-280h80v280h40v-280h80v280h40v-280h80v280q0 56-34.5 98T360-446v366h-80Zm400 0v-320H560v-280q0-83 58.5-141.5T760-880v800h-80Z",
  ], material),
  plusSolid: glyph("Health and Medical", "Filled medical cross", [
    "M360-840h240v240h240v240H600v240H360v-240H120v-240h240Z",
  ], original),
  boltSolid: glyph("Energy", "Filled lightning bolt", [
    "m320-80 40-280H160l360-520h80l-40 320h240L400-80h-80Z",
  ], material),
  roadSolid: glyph("Transportation", "Filled roadway with open lane marks", [
    "M320-840h320l200 720H120ZM448-780h64v120h-64ZM444-580h72v140h-72ZM440-360h80v160h-80Z",
  ], { ...original, evenodd: true }),
  warningSolid: glyph("Hazardous Materials", "Exclamation mark cut from a filled triangle", [
    "m40-120 440-760 440 760H40Zm440-120q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm-40-120h80v-200h-80v200Z",
  ], material),
  waterDrop: glyph("Water Systems", "Filled water drop with a highlight", [
    "M491-200q12-1 20.5-9.5T520-230q0-14-9-22.5t-23-7.5q-41 3-87-22.5T343-375q-2-11-10.5-18t-19.5-7q-14 0-23 10.5t-6 24.5q17 91 80 130t127 35ZM480-80q-137 0-228.5-94T160-408q0-100 79.5-217.5T480-880q161 137 240.5 254.5T800-408q0 140-91.5 234T480-80Z",
  ], material),
  briefcase: glyph("Equipment", "Filled briefcase", [
    "M160-120q-33 0-56.5-23.5T80-200v-440q0-33 23.5-56.5T160-720h160v-80q0-33 23.5-56.5T400-880h160q33 0 56.5 23.5T640-800v80h160q33 0 56.5 23.5T880-640v440q0 33-23.5 56.5T800-120H160Zm240-600h160v-80H400v80Z",
  ], material),
  package: glyph("Supplies", "Filled package cube", [
    "M440-91 160-252q-19-11-29.5-29T120-321v-318q0-22 10.5-40t29.5-29l280-161q19-11 40-11t40 11l280 161q19 11 29.5 29t10.5 40v318q0 22-10.5 40T800-252L520-91q-19 11-40 11t-40-11Zm0-366v274l40 23 40-23v-274l240-139v-42l-43-25-237 137-237-137-43 25v42l240 139Z",
  ], material),
  edit: glyph("Edit", "Pencil", [
    "M120-120v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm584-528 56-56-56-56-56 56 56 56Z",
  ], material),
  arrowForward: glyph("Open", "Arrow pointing right", [
    "M647-440H160v-80h487L423-744l57-56 320 320-320 320-57-56 224-224Z",
  ], material),
  truckSolid: glyph("Resources", "Filled delivery truck", [
    "M240-160q-50 0-85-35t-35-85H40v-440q0-33 23.5-56.5T120-800h560v160h120l120 160v200h-80q0 50-35 85t-85 35q-50 0-85-35t-35-85H360q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T280-280q0-17-11.5-28.5T240-320q-17 0-28.5 11.5T200-280q0 17 11.5 28.5T240-240Zm480 0q17 0 28.5-11.5T760-280q0-17-11.5-28.5T720-320q-17 0-28.5 11.5T680-280q0 17 11.5 28.5T720-240Zm-40-200h170l-90-120h-80v120Z",
  ], material),
  calendarSolid: glyph("Operational periods", "Filled calendar with day marks", [
    "M480-400q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-160 0q-17 0-28.5-11.5T280-440q0-17 11.5-28.5T320-480q17 0 28.5 11.5T360-440q0 17-11.5 28.5T320-400Zm320 0q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-160 0q-17 0-28.5-11.5T280-280q0-17 11.5-28.5T320-320q17 0 28.5 11.5T360-280q0 17-11.5 28.5T320-240Zm320 0q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240ZM200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Z",
  ], material),
  groupSolid: glyph("Participants", "Two filled people", [
    "M40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Zm720 0v-120q0-44-24.5-84.5T666-434q51 6 96 20.5t84 35.5q36 20 55 44.5t19 53.5v120H760ZM360-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm400-160q0 66-47 113t-113 47q-11 0-28-2.5t-28-5.5q27-32 41.5-71t14.5-81q0-42-14.5-81T544-792q14-5 28-6.5t28-1.5q66 0 113 47t47 113Z",
  ], material),
  gridSolid: glyph("Boards", "Four filled board tiles", [
    "M120-520v-320h320v320H120Zm0 400v-320h320v320H120Zm400-400v-320h320v320H520Zm0 400v-320h320v320H520Z",
  ], material),
} as const satisfies Readonly<Record<string, IconDefinition>>;

export type IconName = keyof typeof iconRegistry;
type LifelineIconName = {
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
  dashboards: "dashboards",
} as const satisfies Readonly<Record<string, IconName>>;

export type DestinationIconKey = keyof typeof destinationIconByKey;
