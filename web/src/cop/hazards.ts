import { femaFloodHazardFor, type FemaFloodHazard } from "@openeoc/shared";
import { themes, type ThemeName } from "../design/tokens.js";
import type { CopFeatureCollection } from "./layers.js";
import { statusColor, type SymbolStatus } from "./symbology.js";

const STATUS_VALUES: readonly SymbolStatus[] = ["critical", "warning", "normal", "unknown"];
const FLOOD_VALUES: readonly FemaFloodHazard[] = ["high", "moderate", "unknown"];

export const FEMA_NFHL_DATASET_KEY = "fema_nfhl_flood";
export const FEMA_NFHL_ATTRIBUTION =
  "FEMA National Flood Hazard Layer (NFHL), Flood Hazard Zones layer 28. Coverage is limited to mapped flood panels.";

export const FLOOD_LEGEND = [
  { id: "high", title: "High risk (A, AE, AO)" },
  { id: "moderate", title: "Moderate risk (shaded X)" },
  { id: "unknown", title: "Unknown or unclassified" },
] as const;

export function floodColor(category: FemaFloodHazard, theme: ThemeName): string {
  if (category === "high") return theme === "light" ? "#075985" : "#38bdf8";
  if (category === "moderate") return theme === "light" ? "#4f7f99" : "#7dd3fc";
  return themes[theme].statusUnknown;
}

function statusPatternId(status: SymbolStatus, theme: ThemeName): string {
  return `hazard-status-${theme}-${status}`;
}

function floodPatternId(category: FemaFloodHazard, theme: ThemeName): string {
  return `flood-reference-${theme}-${category}`;
}

export function statusPatternExpression(theme: ThemeName): unknown[] {
  return [
    "match",
    ["get", "_symbolStatus"],
    "critical",
    statusPatternId("critical", theme),
    "warning",
    statusPatternId("warning", theme),
    "normal",
    statusPatternId("normal", theme),
    statusPatternId("unknown", theme),
  ];
}

export function floodPatternExpression(theme: ThemeName): unknown[] {
  return [
    "match",
    ["get", "_floodCategory"],
    "high",
    floodPatternId("high", theme),
    "moderate",
    floodPatternId("moderate", theme),
    floodPatternId("unknown", theme),
  ];
}

export function floodColorExpression(theme: ThemeName): unknown[] {
  return [
    "match",
    ["get", "_floodCategory"],
    "high",
    floodColor("high", theme),
    "moderate",
    floodColor("moderate", theme),
    floodColor("unknown", theme),
  ];
}

function rgba(hex: string): [number, number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

/** Small transparent hatch tile generated locally at runtime. */
export function hatchImage(color: string, direction: "forward" | "back" | "cross" = "forward") {
  const width = 8;
  const height = 8;
  const data = new Uint8Array(width * height * 4);
  const ink = rgba(color);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const forward = (x + y) % 8 < 2;
      const back = (x - y + 8) % 8 < 2;
      if ((direction === "forward" && forward) || (direction === "back" && back) || (direction === "cross" && (forward || back))) {
        const offset = (y * width + x) * 4;
        data.set(ink, offset);
      }
    }
  }
  return { width, height, data };
}

/** Install every pattern before operational GeoJSON layers are mounted. */
export function ensureHazardPatterns(
  map: { hasImage: (id: string) => boolean; addImage: (id: string, image: { width: number; height: number; data: Uint8Array }) => void },
  theme: ThemeName,
): void {
  for (const status of STATUS_VALUES) {
    const id = statusPatternId(status, theme);
    if (!map.hasImage(id)) map.addImage(id, hatchImage(statusColor(status, theme), "forward"));
  }
  for (const category of FLOOD_VALUES) {
    const id = floodPatternId(category, theme);
    const direction = category === "high" ? "cross" : category === "moderate" ? "back" : "forward";
    if (!map.hasImage(id)) map.addImage(id, hatchImage(floodColor(category, theme), direction));
  }
}

export function tagFloodFeatures(
  fc: CopFeatureCollection,
  source: { name: string; stale: boolean; ageSeconds: number | null; incomplete?: boolean | undefined },
): CopFeatureCollection {
  return {
    type: "FeatureCollection",
    features: fc.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        _source: source.name,
        _stale: source.stale,
        _ageSeconds: source.ageSeconds,
        _ageLabel: source.ageSeconds === null
          ? "never"
          : source.ageSeconds < 60
            ? "live"
            : `${Math.floor(source.ageSeconds / 60)}m ago`,
        _incomplete: source.incomplete === true,
        _floodCategory: femaFloodHazardFor(feature.properties),
      },
    })),
  };
}

export function floodLayerIds(datasetId: string): string[] {
  const source = `feed-${datasetId}`;
  return [`${source}-flood-fill`, `${source}-flood-hatch`, `${source}-flood-line`, `${source}-flood-label`];
}

export function floodLayerSpecs(datasetId: string, theme: ThemeName, labelFont?: string): unknown[] {
  const source = `feed-${datasetId}`;
  const color = floodColorExpression(theme);
  const label = labelFont
    ? [{
        id: `${source}-flood-label`,
        type: "symbol",
        source,
        minzoom: 9,
        filter: ["==", ["geometry-type"], "Polygon"],
        layout: {
          "text-field": ["get", "title"],
          "text-font": [labelFont],
          "text-size": 11,
          "text-optional": true,
        },
        paint: {
          "text-color": themes[theme].text,
          "text-halo-color": themes[theme].surface,
          "text-halo-width": 1.2,
        },
      }]
    : [];
  return [
    {
      id: `${source}-flood-fill`, type: "fill", source,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": color, "fill-opacity": 0.16 },
    },
    {
      id: `${source}-flood-hatch`, type: "fill", source,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-pattern": floodPatternExpression(theme), "fill-opacity": 0.8 },
    },
    {
      id: `${source}-flood-line`, type: "line", source,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "line-color": color, "line-width": 1.5, "line-dasharray": [3, 2] },
    },
    ...label,
  ];
}
