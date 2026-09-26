import { describe, expect, it } from "vitest";
import { Color, createPropertyExpression, latest } from "@maplibre/maplibre-gl-style-spec";
import { BUILDING_OCCUPANCY_PALETTE, BUILDING_ROLE_PALETTE } from "@openeoc/shared";
import { themes } from "../../design/tokens.js";
import {
  BUILDING_MIN_ZOOM,
  buildingInspection,
  buildingLegend,
  buildingPaint,
  buildingRole,
  buildingSpecs,
  buildingUse,
  footprintFor,
  type BuildingTheme,
} from "../building-styles.js";

type Spec = Parameters<typeof createPropertyExpression>[2];

/** Evaluates a paint value as MapLibre would for one footprint and its feature state. */
function paint(value: unknown, key: string, spec: Spec, properties: Record<string, unknown>, state: Record<string, unknown> = {}, zoom = 15) {
  const expression = createPropertyExpression(value as never, key, spec);
  if (expression.result !== "success") throw new Error(JSON.stringify(expression.value));
  const out = expression.value.evaluate({ zoom }, { type: 3, properties } as never, state);
  return out instanceof Color ? out.toString() : out;
}
const rgba = (hex: string) => Color.parse(hex)!.toString();
const fillColor = (mode: BuildingTheme, properties: Record<string, unknown>, state: Record<string, unknown> = {}, imagery = false, theme: "light" | "dark" = "light") =>
  paint(buildingPaint(theme, mode, imagery).fill["fill-color"], "fill-color", latest.paint_fill["fill-color"] as Spec, properties, state);
const fillOpacity = (properties: Record<string, unknown>, state: Record<string, unknown>, imagery: boolean) =>
  paint(buildingPaint("light", "use", imagery).fill["fill-opacity"], "fill-opacity", latest.paint_fill["fill-opacity"] as Spec, properties, state);

const use = BUILDING_OCCUPANCY_PALETTE.entries;
const role = BUILDING_ROLE_PALETTE.entries;

describe("building use (USA Structures occupancy classes)", () => {
  it("reads OpenStreetMap tags and Overture subtypes through the palette and its aliases", () => {
    expect(buildingUse("house")).toBe("residential");
    expect(buildingUse("apartments")).toBe("residential");
    expect(buildingUse("retail")).toBe("commercial");
    expect(buildingUse("hospital")).toBe("commercial");
    expect(buildingUse("warehouse")).toBe("industrial");
    // civic and religious are the palette's aliases for government and assembly.
    expect(buildingUse("civic")).toBe("government");
    expect(buildingUse("fire_station")).toBe("government");
    expect(buildingUse("church")).toBe("assembly");
    expect(buildingUse("school")).toBe("education");
    expect(buildingUse("barn")).toBe("agriculture");
    expect(buildingUse("garage")).toBe("utility_misc");
    // USA Structures' own OCC_CLS strings, should an archive carry them.
    expect(buildingUse("Utility and Misc")).toBe("utility_misc");
    expect(buildingUse("yes", "religious")).toBe("assembly");
    expect(buildingUse("yes")).toBe("unclassified");
    expect(buildingUse(undefined)).toBe("unclassified");
    expect(buildingUse("constructor")).toBe("unclassified");
  });

  it("colors a footprint on the map exactly as buildingUse classes it, in both themes and over imagery", () => {
    const samples: [unknown, unknown][] = [
      ["house", undefined], ["church", undefined], ["civic", undefined], ["school", undefined], ["garage", undefined],
      ["barn", undefined], ["yes", "commercial"], ["yes", "civic"], ["yes", "medical"], ["yes", undefined], ["hut", "civic"],
      ["custom_typed_value", "civic"], [undefined, undefined],
    ];
    for (const [cls, subtype] of samples) {
      const properties = { class: cls, overture_subtype: subtype };
      const key = buildingUse(cls, subtype);
      expect(fillColor("use", properties), `${cls}/${subtype}`).toBe(rgba(use[key].light));
      expect(fillColor("use", properties, {}, false, "dark"), `${cls}/${subtype}`).toBe(rgba(use[key].dark));
      expect(fillColor("use", properties, {}, true), `${cls}/${subtype}`).toBe(rgba(use[key].dark));
    }
  });
});

describe("building role", () => {
  it("is public for government, education and assembly, critical infrastructure where a facility joined, else private", () => {
    expect(buildingRole("government")).toBe("public");
    expect(buildingRole("education")).toBe("public");
    expect(buildingRole("assembly")).toBe("public");
    expect(buildingRole("residential")).toBe("private");
    expect(buildingRole("unclassified")).toBe("private");
    expect(buildingRole("commercial", "hospital")).toBe("critical_infrastructure");
  });

  it("draws the same rule on the map", () => {
    expect(fillColor("role", { class: "school" })).toBe(rgba(role.public.light));
    expect(fillColor("role", { class: "yes", overture_subtype: "religious" })).toBe(rgba(role.public.light));
    expect(fillColor("role", { class: "house" })).toBe(rgba(role.private.light));
    expect(fillColor("role", { class: "hotel" }, { facilityType: "hospital", facility: "Saint Joseph" }))
      .toBe(rgba(role.critical_infrastructure.light));
  });
});

describe("precedence: operational status over role over use", () => {
  it("lets a record's status color any footprint in every theme, and more strongly", () => {
    const t = themes.light;
    const colors = { critical: t.statusCritical, warning: t.statusWarning, normal: t.statusSuccess };
    for (const mode of ["use", "role", "plain"] as const) {
      for (const [status, color] of Object.entries(colors)) {
        expect(fillColor(mode, { class: "house" }, { status, facilityType: "hospital" }), `${mode}/${status}`).toBe(rgba(color));
      }
    }
    expect(fillOpacity({ class: "house" }, { status: "critical" }, false)).toBe(0.85);
    // An unknown status leaves the footprint as its class draws it.
    expect(fillColor("use", { class: "house" }, { status: "unknown" })).toBe(rgba(use.residential.light));
    // Under a heavier outline in the map's ink, apart from any class of the same hue.
    const outline = buildingPaint("light", "use").outline;
    const line = (key: string, state: Record<string, unknown>) =>
      paint(outline[key], key, latest.paint_line[key as "line-color"] as Spec, { class: "retail" }, state, 16);
    expect(line("line-color", { status: "critical" })).toBe(rgba(themes.light.text));
    expect(line("line-color", {})).toBe(rgba(use.commercial.light));
    expect(line("line-width", { status: "critical" })).toBeGreaterThan(line("line-width", {}) as number);
  });

  it("fills a class that says something at 0.5 to 0.7 on the street map and 0.35 to 0.5 over imagery, the quiet class lighter", () => {
    for (const imagery of [false, true]) {
      const [low, high] = imagery ? [0.35, 0.5] : [0.5, 0.7];
      const loud = fillOpacity({ class: "house" }, {}, imagery) as number;
      expect(loud).toBeGreaterThanOrEqual(low);
      expect(loud).toBeLessThanOrEqual(high);
      expect(fillOpacity({ class: "yes" }, {}, imagery)).toBeLessThan(loud);
    }
  });

  it("marks critical infrastructure only in the role theme", () => {
    expect(fillColor("use", { class: "hotel" }, { facilityType: "hospital" })).toBe(rgba(use.commercial.light));
    expect(fillColor("plain", { class: "hotel" }, { facilityType: "hospital" })).toBe(rgba(use.unclassified.light));
  });
});

describe("zoom range and themes", () => {
  it("draws the fill and outline from z14 only, and nothing when off", () => {
    const spec = buildingSpecs({ pmtilesUrl: "/b.pmtiles" }, "dark") as { layers: { id: string; minzoom: number; layout: { visibility: string } }[] };
    expect(BUILDING_MIN_ZOOM).toBe(14);
    expect(spec.layers.map((layer) => [layer.id, layer.minzoom, layer.layout.visibility])).toEqual([
      ["building-use", 14, "visible"],
      ["building-outline", 14, "visible"],
    ]);
    expect(buildingPaint("light", "off").visibility).toBe("none");
    const outline = buildingPaint("light", "use").outline;
    expect(paint(outline["line-color"], "line-color", latest.paint_line["line-color"] as Spec, { class: "school" })).toBe(rgba(use.education.light));
    expect(paint(outline["line-width"], "line-width", latest.paint_line["line-width"] as Spec, {}, {}, 14)).toBeLessThanOrEqual(1);
  });

  it("gives each theme its legend rows in palette order, none when off", () => {
    expect(buildingLegend("use", "light")!.rows.map((row) => row.key)).toEqual(Object.keys(use));
    expect(buildingLegend("use", "light")!.title).toBe("Building use");
    expect(buildingLegend("role", "dark")!.rows.map((row) => [row.key, row.color])).toEqual(
      Object.entries(role).map(([key, entry]) => [key, entry.dark]));
    expect(buildingLegend("role", "light", true)!.rows[0]!.color).toBe(role.private.dark);
    expect(buildingLegend("plain", "light")!.rows).toHaveLength(1);
    expect(buildingLegend("off", "light")).toBeUndefined();
    expect(buildingLegend("use", "light")!.minzoom).toBe(14);
  });
});

describe("the facility join", () => {
  // A 20 by 20 meter footprint at Eureka's latitude, and its neighbor 30 m east.
  const lat = 40.8;
  const dx = 1 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const dy = 1 / 110_540;
  const square = (id: number, x0: number) => ({
    id,
    geometry: { type: "Polygon", coordinates: [[[x0, lat], [x0 + 20 * dx, lat], [x0 + 20 * dx, lat + 20 * dy], [x0, lat + 20 * dy], [x0, lat]]] },
  });
  const lng = -124.16;
  const footprints = [square(1, lng), square(2, lng + 50 * dx)];

  it("takes the footprint a facility lies in", () => {
    expect(footprintFor("hospital", [lng + 10 * dx, lat + 10 * dy], footprints)).toBe(1);
    expect(footprintFor("hospital", [lng + 60 * dx, lat + 10 * dy], footprints)).toBe(2);
  });

  it("else the nearest within 20 m, as for a point geocoded to the parking lot", () => {
    expect(footprintFor("fire_station", [lng + 34 * dx, lat + 10 * dy], footprints)).toBe(1);
    expect(footprintFor("fire_station", [lng + 38 * dx, lat + 10 * dy], footprints)).toBe(2);
    expect(footprintFor("fire_station", [lng + 10 * dx, lat + 45 * dy], footprints)).toBeUndefined();
  });

  it("never marks a building for a bridge, dam or tower", () => {
    for (const type of ["bridge", "dam", "comms_tower", undefined]) {
      expect(footprintFor(type, [lng + 10 * dx, lat + 10 * dy], footprints)).toBeUndefined();
    }
  });
});

describe("the inspector", () => {
  it("shows the use, role, class, subtype and a joined facility", () => {
    const inspection = buildingInspection(
      { class: "yes", overture_subtype: "medical", osm_id: 123 },
      { facility: "Providence Saint Joseph Hospital Eureka", facilityType: "hospital", status: "warning" },
      { pmtilesUrl: "/b.pmtiles", overtureRelease: "2026-08-19.0" },
    );
    expect(inspection.title).toBe("Providence Saint Joseph Hospital Eureka");
    expect(inspection.kind).toBe("Building footprint");
    expect(inspection.status).toBe("warning");
    expect(inspection.facilityType).toBe("Hospital");
    expect(inspection.attribution).toContain("Overture Maps Foundation");
    expect(Object.fromEntries(inspection.rows.map((row) => [row.label, row.value]))).toEqual({
      Use: "Commercial",
      Role: "Critical infrastructure",
      "OpenStreetMap building tag": "yes",
      "Overture subtype": "medical",
      "Facility inside": "Providence Saint Joseph Hospital Eureka",
      "Facility type": "Hospital",
      "OpenStreetMap id": "123",
    });
  });

  it("names an unjoined footprint by its use and claims no status", () => {
    const inspection = buildingInspection({ class: "church" }, {}, undefined);
    expect(inspection.title).toBe("Assembly building");
    expect(inspection.status).toBeUndefined();
    expect(inspection.rows.find((row) => row.label === "Role")?.value).toBe("Public");
  });
});
