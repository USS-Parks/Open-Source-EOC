import { describe, expect, it } from "vitest";
import {
  COMMUNITY_LIFELINES,
  DAMAGE_DEGREES,
  DAMAGE_DEGREE_PALETTE,
  EVACUATION_PALETTE,
  FACILITY_OPERATING_STATUS,
  HAZARD_PALETTE,
  INCIDENT_FACILITY_PALETTE,
  INCIDENT_FAMILY_PALETTE,
  INCIDENT_TYPE_PALETTE,
  LIFELINE_CATEGORY_PALETTE,
  LIFELINE_STATUS,
  LIFELINE_STATUS_PALETTE,
  PALETTES,
  PA_CATEGORIES,
  PA_CATEGORY_LABELS,
  PA_CATEGORY_PALETTE,
  ROAD_CLOSURE_PALETTE,
  SHELTER_STATUS_PALETTE,
  STANDARD_TEMPLATES,
  STATUS_FRAME_PALETTE,
  SVI_QUARTILE_PALETTE,
  SYMBOL_STATUS,
  TaskStatusSchema,
  WORK_STATUS_PALETTE,
  paletteCssVariables,
  paletteKey,
  paletteLegend,
  paletteMatch,
  paletteStep,
  type Palette,
  type PaletteEntry,
  type PaletteTheme,
} from "../../index.js";

const THEMES: readonly PaletteTheme[] = ["light", "dark"];
/** The street basemap's dark background (web/src/cop/streetstyle.ts). */
const DARK_BASEMAP = "#14181b";
/** Two colors closer than this (CIE76 delta E) are too alike to tell apart in one legend. */
const MIN_DELTA_E = 10;

const linear = (hex: string) =>
  [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = linear(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function lab(hex: string): [number, number, number] {
  const [r, g, b] = linear(hex);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const deltaE = (a: string, b: string) => {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

const entries = (palette: Palette) => Object.entries(palette.entries);

function closestPair(list: readonly (readonly [string, string])[]): { distance: number; pair: string } {
  let best = { distance: Infinity, pair: "" };
  list.forEach(([a, colorA], i) => list.slice(i + 1).forEach(([b, colorB]) => {
    const distance = deltaE(colorA, colorB);
    if (distance < best.distance) best = { distance, pair: `${a} and ${b}` };
  }));
  return best;
}

describe("the palette table", () => {
  it("gives every coded value a label and a valid color in both themes", () => {
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
    for (const palette of PALETTES) {
      expect(entries(palette).length, palette.id).toBeGreaterThan(1);
      const labels = entries(palette).map(([, entry]) => entry.label);
      expect(new Set(labels).size, `${palette.id} labels`).toBe(labels.length);
      for (const [key, entry] of entries(palette)) {
        expect(key, palette.id).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(entry.label.trim(), `${palette.id}.${key}`).not.toBe("");
        for (const theme of THEMES) expect(entry[theme], `${palette.id}.${key} ${theme}`).toMatch(/^#[0-9a-f]{6}$/);
        if (entry.polygon?.outline) expect(entry.polygon.outline).toMatch(/^#[0-9a-f]{6}$/);
      }
      for (const [alias, key] of Object.entries(palette.aliases ?? {})) {
        expect(palette.entries, `${palette.id} alias ${alias}`).toHaveProperty(key);
        expect(Object.hasOwn(palette.entries, alias), `${palette.id} alias ${alias} shadows a key`).toBe(false);
      }
    }
  });

  it("covers the product's stored vocabularies", () => {
    const keys = (palette: Palette) => Object.keys(palette.entries);
    const resolves = (palette: Palette, values: readonly string[]) =>
      expect(values.filter((value) => paletteKey(palette, value) === undefined), palette.id).toEqual([]);
    expect(keys(LIFELINE_CATEGORY_PALETTE)).toEqual([...COMMUNITY_LIFELINES.values]);
    resolves(LIFELINE_STATUS_PALETTE, LIFELINE_STATUS.values);
    expect(LIFELINE_STATUS_PALETTE.entries.unstable.label).toBe("Disrupted");
    resolves(DAMAGE_DEGREE_PALETTE, DAMAGE_DEGREES.values);
    expect(keys(PA_CATEGORY_PALETTE)).toEqual([...PA_CATEGORIES.values]);
    for (const [key, entry] of entries(PA_CATEGORY_PALETTE)) expect(entry.label).toBe(PA_CATEGORY_LABELS[key]);
    resolves(SHELTER_STATUS_PALETTE, FACILITY_OPERATING_STATUS.values);
    const closures = STANDARD_TEMPLATES.find((t) => t.key === "road_closures")!.fields.find((f) => f.key === "status")!;
    resolves(ROAD_CLOSURE_PALETTE, "values" in closures ? (closures.values as readonly string[]) : []);
    resolves(WORK_STATUS_PALETTE, TaskStatusSchema.options);
    resolves(HAZARD_PALETTE, [
      "Fire perimeter", "Evacuation order", "Evacuation warning", "Shelter in place", "Flood extent", "Tsunami inundation", "Liquefaction",
      "Power outage", "Damage area", "Road disruption", "Spot fire", "Slide", "Structure fire", "Gas leak",
      "Bridge damage", "Hazardous materials", "Road block",
    ]);
    expect(keys(INCIDENT_TYPE_PALETTE)).toHaveLength(23);
    const facilities = STANDARD_TEMPLATES.find((t) => t.key === "incident_facilities")!.fields.find((f) => f.key === "kind")!;
    const kinds = ("values" in facilities ? (facilities.values as readonly string[]) : []).filter((kind) => paletteKey(INCIDENT_FACILITY_PALETTE, kind));
    expect(kinds).toEqual(["incident_command_post", "helibase", "helispot", "staging_area", "base", "camp", "hospital"]);
    expect(keys(STATUS_FRAME_PALETTE).sort()).toEqual([...SYMBOL_STATUS.values].sort());
  });

  it("keeps white pictograms at 3:1 on lifeline, hazard and incident facility icon colors, in both themes", () => {
    const pictogram: [string, PaletteEntry][] = [
      ...entries(LIFELINE_CATEGORY_PALETTE),
      ...entries(HAZARD_PALETTE).filter(([, entry]) => entry.icon),
      ...entries(INCIDENT_FACILITY_PALETTE),
    ];
    expect(pictogram.length).toBe(22);
    for (const [key, entry] of pictogram) {
      for (const theme of THEMES) expect(contrast("#ffffff", entry[theme]), `${key} ${theme}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps lifeline category colors clear of the lifeline status colors", () => {
    for (const theme of THEMES) {
      for (const [category, entry] of entries(LIFELINE_CATEGORY_PALETTE)) {
        for (const [status, statusEntry] of entries(LIFELINE_STATUS_PALETTE)) {
          expect(deltaE(entry[theme], statusEntry[theme]), `${category} and ${status} (${theme})`).toBeGreaterThanOrEqual(15);
        }
      }
    }
  });

  it("keeps every entry in a palette distinguishable from the others", () => {
    for (const theme of THEMES) {
      for (const palette of PALETTES) {
        // Incident types, incident facilities and hazard points take a family's color; the pictogram tells them apart.
        if (palette === INCIDENT_TYPE_PALETTE || palette === INCIDENT_FACILITY_PALETTE) continue;
        const list = entries(palette)
          .filter(([, entry]) => palette !== HAZARD_PALETTE || entry.polygon)
          .map(([key, entry]) => [key, entry[theme]] as const);
        const { distance, pair } = closestPair(list);
        expect(distance, `${palette.id} ${theme}: ${pair}`).toBeGreaterThanOrEqual(MIN_DELTA_E);
      }
    }
  });

  it("colors each incident type and hazard point by its family", () => {
    for (const [key, entry] of entries(INCIDENT_TYPE_PALETTE)) {
      const family = INCIDENT_FAMILY_PALETTE.entries[entry.family as keyof typeof INCIDENT_FAMILY_PALETTE.entries];
      expect([entry.light, entry.dark], key).toEqual([family.light, family.dark]);
    }
    const points = entries(HAZARD_PALETTE).filter(([, entry]) => entry.icon);
    expect(new Set(points.map(([, entry]) => entry.light)).size).toBeLessThan(points.length);
  });

  it("keeps an area's outline at 3:1 on the dark basemap where the outline carries its edge", () => {
    for (const palette of PALETTES) {
      for (const [key, entry] of entries(palette)) {
        const polygon = entry.polygon;
        if (!polygon || polygon.fillOpacity > 0.5 || polygon.outlineWidth === 0 || (polygon.outlineOpacity ?? 1) < 1) continue;
        const outline = polygon.outline ?? entry.dark;
        expect(contrast(outline, DARK_BASEMAP), `${palette.id}.${key}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("uses Esri's shipped values where the research recorded them", () => {
    expect(EVACUATION_PALETTE.entries.level_3_order.light).toBe("#7a0000");
    expect(EVACUATION_PALETTE.entries.level_3_order.polygon).toEqual({ fillOpacity: 0.5, outlineWidth: 2 });
    expect(DAMAGE_DEGREE_PALETTE.entries.destroyed.light).toBe("#8335a8");
    expect(SHELTER_STATUS_PALETTE.entries.open.light).toBe("#009656");
    expect(HAZARD_PALETTE.entries.evacuation_order.light).toBe(EVACUATION_PALETTE.entries.level_3_order.light);
  });
});

describe("the palette helpers", () => {
  it("builds a MapLibre match expression with aliases in the entry's branch", () => {
    const expression = paletteMatch(SHELTER_STATUS_PALETTE, "status", "light", "#000000");
    expect(expression.slice(0, 4)).toEqual(["match", ["get", "status"], ["open", "normal"], "#009656"]);
    expect(expression).toHaveLength(2 + 2 * 6 + 1);
    expect(expression.at(-1)).toBe("#000000");
    expect(expression).toContainEqual(["closed", "evacuating"]);
    expect(paletteMatch(HAZARD_PALETTE, "category", (entry) => entry.icon ?? "", "")).toContainEqual(["road_block", "Road block"]);
    expect(paletteMatch(DAMAGE_DEGREE_PALETTE, "degree", "dark", "#888888").slice(2, 4)).toEqual(["destroyed", "#8335a8"]);
  });

  it("builds a step expression from class lower bounds", () => {
    expect(paletteStep(SVI_QUARTILE_PALETTE, "RPL_THEMES", "light", "#cccccc")).toEqual([
      "step", ["number", ["get", "RPL_THEMES"], -1], "#cccccc",
      0, "#ffffcc", 0.25, "#a1dab4", 0.5, "#41b6c4", 0.75, "#225ea8",
    ]);
  });

  it("lists legend rows in table order, only for the values present", () => {
    expect(paletteLegend(ROAD_CLOSURE_PALETTE, "dark").map((row) => [row.key, row.label, row.color])).toEqual([
      ["closed", "Closed", "#e5452a"], ["one_lane", "One lane", "#fbbf24"], ["detour", "Detour", "#e69800"], ["reopened", "Reopened", "#4ade80"],
    ]);
    expect(paletteLegend(SHELTER_STATUS_PALETTE, "light", ["closed", "normal", "nonsense"]).map((row) => row.key)).toEqual(["open", "closed"]);
    expect(paletteKey(SHELTER_STATUS_PALETTE, "constructor")).toBeUndefined();
  });

  it("emits CSS custom properties named by key", () => {
    expect(paletteCssVariables(WORK_STATUS_PALETTE, "light", "eoc-series")).toMatchObject({
      "--eoc-series-not-started": "#5f6b7a",
      "--eoc-series-past-due": "#c81e1e",
    });
  });
});
