import {
  DAMAGE_DEGREE_PALETTE,
  INCIDENT_FACILITY_PALETTE,
  ROAD_CLOSURE_PALETTE,
  SHELTER_STATUS_PALETTE,
  STATUS_FRAME_PALETTE,
  paletteMatch,
} from "@openeoc/shared";
import type { Map as MapLibreMap } from "maplibre-gl";
import { themes, type ThemeName } from "../design/tokens.js";
import {
  arrowImageId,
  byEntry,
  byTier,
  ensureStyleImages,
  ICON_OVERLAP,
  ICON_SIZE,
  inTier,
  labelPaint,
  LINE,
  noEntryImageId,
  paletteOrder,
  POINT,
  TIER,
} from "./hazard-styles.js";
import { sourceId } from "./layers.js";
import { iconImageId } from "./symbols/register.js";

/**
 * Incident cartography: the boards whose records carry a map meaning of
 * their own (road closures, shelters, incident facilities) draw as the
 * incident map symbols rather than generic status markers, and the incident
 * area draws as a dashed boundary. The Overview card keeps the canonical
 * frames' small SVGs, which its legend shows; the Map screen draws Esri's
 * emergency management symbols from the icon suite and the palette table,
 * damage assessments included.
 */

export const CARTOGRAPHY_TEMPLATES: ReadonlySet<string> = new Set(["road_closures", "shelters", "incident_facilities"]);

/** The boards the Map screen draws with incident cartography. */
export const MAP_CARTOGRAPHY_TEMPLATES: ReadonlySet<string> = new Set([...CARTOGRAPHY_TEMPLATES, "damage_assessment"]);

export const INCIDENT_AREA_SOURCE = "incident-area";
export const INCIDENT_AREA_LAYERS = [`${INCIDENT_AREA_SOURCE}-fill`, `${INCIDENT_AREA_SOURCE}-line`] as const;

/** Weather stations toggle apart from the other incident facilities. */
export const WEATHER_LAYER_SUFFIX = "-weather";

export type SymbolId =
  | "shelter-open" | "shelter-planned" | "closure" | "key-facility" | "hospital"
  | "critical" | "command" | "camera" | "weather" | "helibase";

const INK: Readonly<Record<ThemeName, { boundary: string; fill: string; fillOpacity: number; closure: string }>> = {
  dark: { boundary: "#12c6e6", fill: "#12c6e6", fillOpacity: 0.04, closure: "#e5452a" },
  light: { boundary: "#3f55d4", fill: "#6f8cf2", fillOpacity: 0.26, closure: "#c9202c" },
};

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 28 28">${body}</svg>`;

const house = (fill: string, stroke: string, figure: string) => svg(
  `<path d="M14 3 25 12.2V25H3V12.2Z" fill="${fill}" stroke="${stroke}" stroke-width="2.2" stroke-linejoin="round"/>` +
  `<circle cx="14" cy="14.2" r="2.6" fill="${figure}"/><path d="M9.4 23v-2.6a4.6 4.6 0 0 1 9.2 0V23Z" fill="${figure}"/>`,
);

const solidHouse = (fill: string) => svg(
  `<path d="M14 3 25.5 13H22.5V25H5.5V13H2.5Z" fill="${fill}" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/>` +
  `<rect x="11" y="16.5" width="6" height="8.5" fill="#ffffff"/>`,
);

const roundel = (glyph: string) => svg(
  `<circle cx="14" cy="14" r="11.6" fill="#1d3f94" stroke="#ffffff" stroke-width="2.2"/>${glyph}`,
);

const COMMON: Readonly<Record<"closure" | "command" | "camera" | "weather" | "helibase" | "key-facility" | "hospital" | "critical", string>> = {
  closure: svg(`<circle cx="14" cy="14" r="11.4" fill="#d62828" stroke="#ffffff" stroke-width="2.4"/><rect x="7.6" y="12" width="12.8" height="4" rx="1" fill="#ffffff"/>`),
  command: svg(`<path d="M14 2.4 17.5 9.7 25.4 10.7 19.6 16.1 21.1 24 14 20.1 6.9 24 8.4 16.1 2.6 10.7 10.5 9.7Z" fill="#f6a743" stroke="#6b3f08" stroke-width=".9" stroke-linejoin="round"/>`),
  camera: svg(`<rect x="2.5" y="5.5" width="23" height="17" rx="3" fill="#f4f6f8" stroke="#1d242c" stroke-width="1.2"/><rect x="6.2" y="10" width="10" height="8" rx="1.2" fill="#1d242c"/><path d="M16.6 12.6 21.8 10V18L16.6 15.4Z" fill="#1d242c"/>`),
  weather: svg(`<path d="M14 3 25.4 24H2.6Z" fill="#79aee8" stroke="#1f4f86" stroke-width="1.4" stroke-linejoin="round"/>`),
  helibase: roundel(`<path d="M10 8.4V19.6M18 8.4V19.6M10 14H18" stroke="#ffffff" stroke-width="2.8"/>`),
  "key-facility": roundel(`<path d="M14 8.2V19.8M8.2 14H19.8" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round"/>`),
  hospital: svg(`<rect x="3" y="3" width="22" height="22" rx="3" fill="#1668d9" stroke="#ffffff" stroke-width="1.2"/><path d="M9.4 8V20M18.6 8V20M9.4 14H18.6" stroke="#ffffff" stroke-width="3"/>`),
  critical: svg(`<path d="M14 3 26 24.2H2Z" fill="#f5b301" stroke="#3b2f00" stroke-width="1.6" stroke-linejoin="round"/><rect x="12.8" y="10" width="2.4" height="8" rx=".6" fill="#1a1a1a"/><circle cx="14" cy="20.9" r="1.4" fill="#1a1a1a"/>`),
};

/** Every symbol's SVG in a theme. */
export function symbolSvgs(theme: ThemeName): Readonly<Record<SymbolId, string>> {
  return theme === "dark"
    ? { ...COMMON, "shelter-open": house("#12301f", "#5fd08a", "#5fd08a"), "shelter-planned": house("#262b31", "#d9dee4", "#d9dee4") }
    : { ...COMMON, "shelter-open": solidHouse("#1f7a3a"), "shelter-planned": solidHouse("#6b7280") };
}

export function symbolImageId(id: SymbolId): string {
  return `eoc-${id}`;
}

export function symbolDataUrl(theme: ThemeName, id: SymbolId): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(symbolSvgs(theme)[id])}`;
}

/**
 * Register the theme's symbols as map images (drawn at twice their 28 px
 * size), and the icon suite images, closure symbols and hatches the Map
 * screen's styles name (hazard-styles.ts).
 */
export async function ensureCartographyImages(map: MapLibreMap, theme: ThemeName): Promise<void> {
  await Promise.all([
    ...(Object.keys(symbolSvgs(theme)) as SymbolId[]).map(async (id) => {
      if (map.hasImage(symbolImageId(id))) return;
      const image = new Image(56, 56);
      image.src = symbolDataUrl(theme, id);
      await image.decode();
      if (!map.hasImage(symbolImageId(id))) map.addImage(symbolImageId(id), image, { pixelRatio: 2 });
    }),
    ensureStyleImages(map, theme),
  ]);
}

/** The facility kind's symbol. Dark reads hospitals and key sites as key facilities; light tells them apart. */
function facilityIcon(theme: ThemeName): unknown[] {
  return [
    "match", ["get", "kind"],
    "incident_command_post", symbolImageId("command"),
    ["helibase", "helispot"], symbolImageId("helibase"),
    "camera", symbolImageId("camera"),
    "weather_station", symbolImageId("weather"),
    "hospital", symbolImageId(theme === "dark" ? "key-facility" : "hospital"),
    symbolImageId(theme === "dark" ? "key-facility" : "critical"),
  ];
}

const ICON_LAYOUT = { "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 12, 0.95, 16, 1.15], "icon-allow-overlap": true, "icon-ignore-placement": true };

/**
 * The incident cartography layers for a board, or undefined when its
 * template has none (the board then draws as generic status markers). The
 * Overview card draws the canonical frames' symbols; the Map screen
 * ("map") draws Esri's emergency management symbols.
 */
export function cartographyLayerSpecs(
  boardId: string,
  templateKey: string | undefined,
  theme: ThemeName,
  labelFont?: string,
  layout: "card" | "map" = "card",
): unknown[] | undefined {
  if (layout === "map") return mapCartographySpecs(sourceId(boardId), templateKey, theme, labelFont);
  if (!templateKey || !CARTOGRAPHY_TEMPLATES.has(templateKey)) return undefined;
  const src = sourceId(boardId);
  const t = themes[theme];
  const point = ["==", ["geometry-type"], "Point"];
  const label = (filter: unknown[]) => labelFont
    ? [{
        id: `${src}-label`,
        type: "symbol",
        source: src,
        minzoom: 12,
        filter,
        layout: { "text-field": ["get", "_label"], "text-font": [labelFont], "text-size": 11, "text-anchor": "top", "text-offset": [0, 1.3], "text-optional": true },
        paint: { "text-color": t.text, "text-halo-color": t.surface, "text-halo-width": 1.2 },
      }]
    : [];
  if (templateKey === "road_closures") {
    const closed = ["==", ["get", "status"], "closed"];
    return [
      {
        id: `${src}-line`,
        type: "line",
        source: src,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "status"], "one_lane", t.statusWarning, "reopened", t.statusSuccess, INK[theme].closure],
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 12, 4.5, 16, 7],
        },
      },
      {
        id: `${src}-closure`,
        type: "symbol",
        source: src,
        filter: ["all", ["==", ["geometry-type"], "LineString"], closed],
        layout: { ...ICON_LAYOUT, "symbol-placement": "line-center", "icon-image": symbolImageId("closure") },
      },
      {
        id: `${src}-closure-point`,
        type: "symbol",
        source: src,
        filter: ["all", point, closed],
        layout: { ...ICON_LAYOUT, "icon-image": symbolImageId("closure") },
      },
      ...label(["==", ["geometry-type"], "LineString"]).map((spec) => ({ ...spec, layout: { ...spec.layout, "symbol-placement": "line", "text-offset": [0, 1] } })),
    ];
  }
  if (templateKey === "shelters") {
    return [
      {
        id: `${src}-shelter`,
        type: "symbol",
        source: src,
        filter: point,
        layout: {
          ...ICON_LAYOUT,
          "icon-image": ["case", ["==", ["get", "planned"], true], symbolImageId("shelter-planned"), symbolImageId("shelter-open")],
        },
      },
      ...label(point),
    ];
  }
  const weather = ["==", ["get", "kind"], "weather_station"];
  const command = labelFont
    ? [{
        id: `${src}-command-label`,
        type: "symbol",
        source: src,
        filter: ["all", point, ["==", ["get", "kind"], "incident_command_post"]],
        layout: { "text-field": "ICP", "text-font": [labelFont], "text-size": 13, "text-anchor": "left", "text-offset": [1.2, 0], "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": t.text, "text-halo-color": t.surface, "text-halo-width": 1.4 },
      }]
    : [];
  // Labels go under the facilities, so the map places each icon before its
  // label and the label finds a side the icon leaves free, never hiding it.
  const facilityLabel = label(["all", point, ["!=", ["get", "kind"], "incident_command_post"]]).map((spec) => {
    const { "text-anchor": _anchor, "text-offset": _offset, ...rest } = spec.layout;
    return { ...spec, layout: { ...rest, "text-variable-anchor": ["top", "bottom", "right", "left"], "text-radial-offset": 1.5 } };
  });
  return [
    ...facilityLabel,
    {
      // Facilities close together yield by rank at a wide zoom: command post, air base, hospital, the rest.
      id: `${src}-facility`,
      type: "symbol",
      source: src,
      filter: ["all", point, ["!", weather]],
      layout: {
        ...ICON_LAYOUT,
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
        "symbol-sort-key": ["match", ["get", "kind"], "incident_command_post", 0, ["helibase", "helispot"], 1, "hospital", 2, 3],
        "icon-image": facilityIcon(theme),
      },
    },
    {
      id: `${src}${WEATHER_LAYER_SUFFIX}`,
      type: "symbol",
      source: src,
      filter: ["all", point, weather],
      layout: { ...ICON_LAYOUT, "icon-image": symbolImageId("weather") },
    },
    ...command,
  ];
}

/** A closure's direction: Esri's Road Closures domain, or plain words. */
const ONE_WAY = ["one_direction", "One Direction", "one_way"];
const BOTH_WAYS = ["both_directions", "Both Directions", "both"];

/**
 * The Map screen's incident cartography, after Esri's emergency management
 * templates: a closure as a red line over a white casing with arrows for its
 * direction and a no-entry disc, a detour orange over white; shelters and
 * damage assessments as the icon suite's symbols in their status and FEMA
 * degree colors; incident facilities as the ICS symbols. Labels sit under
 * the symbols and give way to them.
 */
function mapCartographySpecs(src: string, templateKey: string | undefined, theme: ThemeName, labelFont?: string): unknown[] | undefined {
  if (!templateKey || !MAP_CARTOGRAPHY_TEMPLATES.has(templateKey)) return undefined;
  const grey = STATUS_FRAME_PALETTE.entries.unknown[theme];
  const labelLayout = labelFont ? { "text-font": [labelFont], "text-size": 11, "text-max-width": 10 } : undefined;
  const label = (filter: unknown, layout: Record<string, unknown>) => labelLayout
    ? [{ id: `${src}-label`, type: "symbol", source: src, ...inTier(TIER.label), minzoom: 12, filter, layout: { ...labelLayout, ...layout }, paint: labelPaint(theme) }]
    : [];
  const beside = { "text-variable-anchor": ["top", "bottom", "right", "left"], "text-radial-offset": 1.3 };
  const symbol = (id: string, filter: unknown, layout: Record<string, unknown>) =>
    ({ id: `${src}${id}`, type: "symbol", source: src, ...inTier(TIER.point), filter, layout: { "icon-size": ICON_SIZE, "icon-overlap": ICON_OVERLAP, ...layout } });

  if (templateKey === "road_closures") {
    const closed = ROAD_CLOSURE_PALETTE.entries.closed[theme];
    const image = (name: (color: string) => string) => paletteMatch(ROAD_CLOSURE_PALETTE, "status", (entry) => name(entry[theme]), name(closed));
    const direction = ["match", ["get", "direction"], ONE_WAY, "one", BOTH_WAYS, "both", ""];
    const width = (base: number) => ["interpolate", ["linear"], ["zoom"], 8, base, 12, base + 1.5, 16, base + 4];
    const line = (id: string, paint: Record<string, unknown>) =>
      ({ id: `${src}${id}`, type: "line", source: src, ...inTier(TIER.line), filter: LINE, layout: { "line-cap": "round", "line-join": "round" }, paint });
    return byTier([
      line("-casing", { "line-color": "#ffffff", "line-width": width(4.5), "line-opacity": 0.9 }),
      line("-line", { "line-color": paletteMatch(ROAD_CLOSURE_PALETTE, "status", theme, closed), "line-width": width(2) }),
      {
        id: `${src}-arrow`,
        type: "symbol",
        source: src,
        ...inTier(TIER.line),
        filter: ["all", LINE, ["!=", direction, ""]],
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 90,
          "icon-image": ["case", ["==", direction, "both"], image((color) => arrowImageId(color, true)), image((color) => arrowImageId(color))],
          "icon-rotation-alignment": "map",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 14, 1],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      },
      ...label(LINE, { "symbol-placement": "line", "text-field": ["get", "_label"], "text-offset": [0, 1.2], "text-max-angle": 30 }),
      // Always drawn, and labels give way to it.
      symbol("-closure", ["all", LINE, ["==", ["get", "status"], "closed"]], {
        "symbol-placement": "line-center",
        "icon-image": noEntryImageId(closed),
        "icon-overlap": "always",
      }),
      symbol("-closure-point", POINT, { "icon-image": image(noEntryImageId), "symbol-sort-key": paletteOrder(ROAD_CLOSURE_PALETTE, "status") }),
    ]);
  }

  if (templateKey === "shelters") {
    const shelter = (color: string) => iconImageId("shelter", color);
    const planned = ["==", ["get", "planned"], true];
    const known = (field: string) => ["==", ["typeof", ["get", field]], "number"];
    const count = (field: string) => ["to-string", ["get", field]];
    const name = ["get", "_label"];
    // At street zoom a shelter's label adds its occupancy against capacity.
    const text = ["step", ["zoom"], name, 14, [
      "case",
      ["all", known("occupancy"), known("capacity")], ["concat", name, "\n", count("occupancy"), " of ", count("capacity")],
      known("capacity"), ["concat", name, "\nCapacity ", count("capacity")],
      name,
    ]];
    return byTier([
      ...label(POINT, { ...beside, "text-field": text }),
      symbol("-shelter", POINT, {
        "icon-image": ["case", planned, shelter(SHELTER_STATUS_PALETTE.entries.planned[theme]),
          paletteMatch(SHELTER_STATUS_PALETTE, "status", (entry) => shelter(entry[theme]), shelter(SHELTER_STATUS_PALETTE.entries.unknown[theme]))],
        "symbol-sort-key": ["case", planned, Object.keys(SHELTER_STATUS_PALETTE.entries).indexOf("planned"), paletteOrder(SHELTER_STATUS_PALETTE, "status")],
      }),
    ]);
  }

  if (templateKey === "damage_assessment") {
    return [symbol("-damage", POINT, {
      "icon-image": paletteMatch(DAMAGE_DEGREE_PALETTE, "degree", (entry) => iconImageId("damage_report", entry[theme]), iconImageId("damage_report", grey)),
      "symbol-sort-key": paletteOrder(DAMAGE_DEGREE_PALETTE, "degree"),
    })];
  }

  const kind = ["get", "kind"];
  const weather = ["==", kind, "weather_station"];
  const others = ["match", kind, "camera", symbolImageId("camera"), symbolImageId("key-facility")];
  return byTier([
    ...label(["all", POINT, ["!", weather]], { ...beside, "text-field": ["get", "_label"] }),
    symbol("-facility", ["all", POINT, ["!", weather]], {
      "icon-image": byEntry(INCIDENT_FACILITY_PALETTE, "kind", Object.keys(INCIDENT_FACILITY_PALETTE.entries),
        (entry) => iconImageId(entry.icon!, entry[theme]), others),
      // Command post, air base, hospital, the rest.
      "symbol-sort-key": ["match", kind, "incident_command_post", 0, ["helibase", "helispot"], 1, "hospital", 2, 3],
    }),
    symbol(WEATHER_LAYER_SUFFIX, ["all", POINT, weather], { "icon-image": symbolImageId("weather") }),
  ]);
}

/** The incident area as a dashed boundary; light fills it faintly, dark leaves the imagery clear. */
export function incidentAreaSpecs(geometry: unknown, theme: ThemeName): { source: unknown; layers: unknown[] } {
  const ink = INK[theme];
  return {
    source: { type: "geojson", data: { type: "Feature", geometry, properties: {} } },
    layers: [
      {
        id: INCIDENT_AREA_LAYERS[0],
        type: "fill",
        source: INCIDENT_AREA_SOURCE,
        paint: { "fill-color": ink.fill, "fill-opacity": ink.fillOpacity },
      },
      {
        id: INCIDENT_AREA_LAYERS[1],
        type: "line",
        source: INCIDENT_AREA_SOURCE,
        layout: { "line-join": "round" },
        paint: { "line-color": ink.boundary, "line-width": theme === "dark" ? 2.6 : 1.8, "line-dasharray": theme === "dark" ? [2.2, 1.6] : [3, 2] },
      },
    ],
  };
}

/** A legend row: a map symbol, or the boundary and closure line keys. */
export interface LegendEntry {
  readonly label: string;
  readonly symbol?: SymbolId;
  readonly key?: "boundary" | "closure";
}

/** The card legend for each theme, naming exactly what the card draws. */
export const CARD_LEGEND: Readonly<Record<ThemeName, readonly LegendEntry[]>> = {
  dark: [
    { label: "Incident boundary", key: "boundary" },
    { label: "Road closure", key: "closure" },
    { label: "Shelter (open)", symbol: "shelter-open" },
    { label: "Shelter (planned)", symbol: "shelter-planned" },
    { label: "Key facility", symbol: "key-facility" },
    { label: "Incident command", symbol: "command" },
    { label: "Camera (RTSP)", symbol: "camera" },
    { label: "Weather station", symbol: "weather" },
    { label: "Helibase", symbol: "helibase" },
  ],
  light: [
    { label: "Incident extent", key: "boundary" },
    { label: "Road closure", key: "closure" },
    { label: "Closure point", symbol: "closure" },
    { label: "Shelter", symbol: "shelter-open" },
    { label: "Hospital", symbol: "hospital" },
    { label: "Critical facility", symbol: "critical" },
  ],
};

export function legendInk(theme: ThemeName): { boundary: string; fill: string; closure: string } {
  const ink = INK[theme];
  return { boundary: ink.boundary, fill: theme === "dark" ? "transparent" : `${ink.fill}55`, closure: ink.closure };
}
