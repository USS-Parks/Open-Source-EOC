// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILDING_OCCUPANCY_PALETTE, HAZARD_PALETTE, ROAD_CLOSURE_PALETTE, paletteLegend } from "@openeoc/shared";
import { feedPresetLegend } from "../../feeds.js";
import { DEFAULT_REFERENCE_STATE, referenceLegends } from "../../reference-layers.js";
import {
  INITIAL_LAYER_LIST_STATE, LayerList, layerListView, scaleZoom, setLayerOpacity, switchLayer, visibleLayerIds,
  type LayerListItem,
} from "../LayerList.js";
import { MapLegend, feedLegendLayer, legendLayer, referenceLegendLayer, visibleLegend, type LegendLayer } from "../MapLegend.js";

afterEach(cleanup);

const REFERENCE = {
  facilities: { pmtilesUrl: "/basemap/facilities.pmtiles" },
  boundaries: { pmtilesUrl: "/basemap/boundaries.pmtiles" },
};

function layers(theme: "light" | "dark"): LegendLayer[] {
  return [
    legendLayer("hazards", HAZARD_PALETTE.title, paletteLegend(HAZARD_PALETTE, theme, ["fire_perimeter", "damage_area", "road_disruption", "slide"])),
    legendLayer("closures", ROAD_CLOSURE_PALETTE.title, paletteLegend(ROAD_CLOSURE_PALETTE, theme), "line", { casing: "#ffffff" }),
    legendLayer("buildings", BUILDING_OCCUPANCY_PALETTE.title, paletteLegend(BUILDING_OCCUPANCY_PALETTE, theme), "area", { minzoom: 14 }),
    feedLegendLayer("feed-quakes", feedPresetLegend("usgs_earthquakes", theme)!),
    ...referenceLegends(REFERENCE, DEFAULT_REFERENCE_STATE, theme).map(referenceLegendLayer),
  ];
}

const ALL = new Set(["hazards", "closures", "buildings", "feed-quakes", "facilities", "tribal"]);

describe("the legend's visible entries", () => {
  it("lists only layers switched on and drawn at the zoom, as Esri does", () => {
    const ids = (zoom: number, visible = ALL) => visibleLegend(layers("light"), zoom, visible).map((l) => l.id);
    expect(ids(10)).toEqual(["hazards", "closures", "feed-quakes", "facilities", "tribal"]);
    expect(ids(14)).toContain("buildings");
    expect(ids(4)).not.toContain("tribal");
    expect(ids(10, new Set(["closures"]))).toEqual(["closures"]);
    const bounded: LegendLayer = { id: "x", title: "X", minzoom: 8, maxzoom: 12, classes: layers("light")[0]!.classes };
    expect(visibleLegend([bounded], 8, new Set(["x"]))).toHaveLength(1);
    expect(visibleLegend([bounded], 12, new Set(["x"]))).toHaveLength(0);
    expect(visibleLegend([{ ...bounded, hideFromLegend: true }], 9, new Set(["x"]))).toHaveLength(0);
    expect(visibleLegend([{ ...bounded, classes: [] }], 9, new Set(["x"]))).toHaveLength(0);
  });

  it("draws each class as the map does: areas, hollow and hatched areas, cased lines, icons and graduated circles", () => {
    const [hazards, closures, buildings, quakes, facilities, tribal] = layers("light");
    const patch = (layer: LegendLayer | undefined, key: string) => layer!.classes.find((c) => c.key === key)!.patch;
    expect(hazards!.classes.map((c) => c.key)).toEqual(["fire_perimeter", "damage_area", "road_disruption", "slide"]);
    expect(patch(hazards, "fire_perimeter")).toEqual({ kind: "area", color: "#f7ada4", fillOpacity: 0.5, outline: "#e60c0c", outlineWidth: 2 });
    expect(patch(hazards, "damage_area")).toMatchObject({ kind: "area", fillOpacity: 0, outlineWidth: 4 });
    expect(patch(hazards, "road_disruption")).toMatchObject({ kind: "area", hatch: true });
    expect(patch(hazards, "slide")).toEqual({ kind: "icon", icon: "landslide", color: "#6c4000" });
    expect(patch(closures, "closed")).toEqual({ kind: "line", color: "#c9202c", casing: "#ffffff" });
    expect(patch(buildings, "residential")).toMatchObject({ kind: "area", fillOpacity: 0.45 });
    expect(quakes!.classes.map((c) => c.patch)).toContainEqual({ kind: "circle", color: "#fc0316", radius: 9 });
    expect(quakes!.source).toMatch(/Geological Survey/);
    expect(patch(facilities, "health_medical")).toEqual({ kind: "square", color: "#ad1457" });
    expect(tribal).toMatchObject({ minzoom: 5 });
    // The dark theme takes the palette's dark values.
    expect(patch(layers("dark")[1], "closed")).toMatchObject({ color: "#e5452a" });
  });
});

describe("the legend panel", () => {
  it.each(["light", "dark"] as const)("groups classes under collapsible layer headings on the %s theme", async (theme) => {
    const view = render(<MapLegend layers={layers(theme)} zoom={10} visible={ALL} />);
    const legend = screen.getByRole("region", { name: "Map legend" });
    expect(within(legend).queryByText(BUILDING_OCCUPANCY_PALETTE.title)).toBeNull();
    const closures = within(legend).getByRole("list", { name: ROAD_CLOSURE_PALETTE.title });
    expect(within(closures).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Closed", "One lane", "Detour", "Reopened"]);
    const group = screen.getByTestId("legend-closures") as HTMLDetailsElement;
    expect(group.open).toBe(true);
    fireEvent.click(within(group).getByText(ROAD_CLOSURE_PALETTE.title));
    expect(group.open).toBe(false);
    // Patches are decorative; the icon suite's pictogram draws in its class color.
    expect(screen.getByTestId("legend-hazards").querySelector(".eoc-symbol-patch")?.getAttribute("aria-hidden")).toBe("true");
    expect((await axe.run(view.container)).violations).toEqual([]);
  });

  it("says so when nothing with a legend draws", () => {
    render(<MapLegend layers={layers("light")} zoom={10} visible={new Set()} />);
    expect(screen.getByText("No layer with a legend draws at this zoom.")).toBeTruthy();
  });
});

const ITEMS: LayerListItem[] = [
  { id: "basemap-street", group: "basemap", title: "Streets" },
  { id: "basemap-imagery", group: "basemap", title: "Imagery" },
  { id: "hazards", group: "hazards", title: "Hazard areas", bounds: [-124.3, 40.6, -123.9, 41] },
  { id: "buildings", group: "buildings", title: "Buildings by use", minzoom: 14 },
  { id: "ll-health", group: "facilities", title: "Health & Medical", color: "#ad1457", opacity: false },
  { id: "feed-quakes", group: "feeds", title: "USGS earthquakes", defaultVisible: false },
  { id: "tracts", group: "risk", title: "Risk by tract", minzoom: 8, maxzoom: 12 },
];

describe("the layer list model", () => {
  it("groups layers in Esri's order, leaves out empty groups and greys layers out of scale", () => {
    const view = layerListView(ITEMS, INITIAL_LAYER_LIST_STATE, 10);
    expect(view.map((g) => g.id)).toEqual(["hazards", "facilities", "buildings", "risk", "feeds", "basemap"]);
    const row = (id: string, zoom = 10) => layerListView(ITEMS, INITIAL_LAYER_LIST_STATE, zoom).flatMap((g) => g.rows).find((r) => r.item.id === id)!;
    expect(row("buildings")).toMatchObject({ outOfScale: true, scaleNote: "Not drawn at this zoom: zoom in to 14." });
    expect(row("tracts", 12)).toMatchObject({ outOfScale: true, scaleNote: "Not drawn at this zoom: zoom out below 12." });
    expect(row("tracts")).toMatchObject({ outOfScale: false });
    expect(row("hazards")).not.toHaveProperty("scaleNote");
  });

  it("switches checkboxes, keeps the basemap exclusive and leaves live feeds off until chosen", () => {
    expect([...visibleLayerIds(ITEMS, INITIAL_LAYER_LIST_STATE)].sort())
      .toEqual(["basemap-street", "buildings", "hazards", "ll-health", "tracts"]);
    let state = switchLayer(INITIAL_LAYER_LIST_STATE, ITEMS[1]!);
    state = switchLayer(state, ITEMS[5]!);
    state = switchLayer(state, ITEMS[2]!);
    const on = visibleLayerIds(ITEMS, state);
    expect(on.has("basemap-imagery") && !on.has("basemap-street")).toBe(true);
    expect(on.has("feed-quakes")).toBe(true);
    expect(on.has("hazards")).toBe(false);
  });

  it("clamps opacity and finds the zoom that brings a layer into scale", () => {
    expect(setLayerOpacity(INITIAL_LAYER_LIST_STATE, "hazards", 1.4).opacity["hazards"]).toBe(1);
    expect(setLayerOpacity(INITIAL_LAYER_LIST_STATE, "hazards", -1).opacity["hazards"]).toBe(0);
    expect(scaleZoom(ITEMS[3]!, 10)).toBe(14);
    expect(scaleZoom(ITEMS[6]!, 13)).toBeCloseTo(11.99);
    expect(scaleZoom(ITEMS[6]!, 9)).toBe(9);
  });
});

describe("the layer list panel", () => {
  it("renders radios for basemaps, checkboxes, opacity and zoom-to, and hands back each change", async () => {
    const onChange = vi.fn();
    const onZoomTo = vi.fn();
    const view = render(<LayerList items={ITEMS} state={INITIAL_LAYER_LIST_STATE} zoom={10} onChange={onChange} onZoomTo={onZoomTo} />);
    const basemap = screen.getByRole("list", { name: "Basemap" });
    const imagery = within(basemap).getByRole("radio", { name: "Imagery" });
    expect((within(basemap).getByRole("radio", { name: "Streets" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(imagery);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ chosen: { basemap: "basemap-imagery" } }));
    fireEvent.click(screen.getByRole("checkbox", { name: "USGS earthquakes" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visible: { "feed-quakes": true } }));
    fireEvent.change(screen.getByRole("slider", { name: "Hazard areas opacity" }), { target: { value: "40" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ opacity: { hazards: 0.4 } }));
    expect(screen.queryByRole("slider", { name: "Health & Medical opacity" })).toBeNull();
    // Out of scale: greyed, described, and offered a zoom that brings it in.
    const buildings = screen.getByRole("checkbox", { name: "Buildings by use" });
    expect(screen.getByTestId("layer-buildings").className).toContain("is-out-of-scale");
    expect(document.getElementById(buildings.getAttribute("aria-describedby")!)?.textContent).toBe("Not drawn at this zoom: zoom in to 14.");
    fireEvent.click(screen.getByRole("button", { name: "Zoom to Buildings by use" }));
    expect(onZoomTo).toHaveBeenLastCalledWith(ITEMS[3]);
    expect(screen.getByRole("button", { name: "Zoom to Hazard areas" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zoom to USGS earthquakes" })).toBeNull();
    expect((await axe.run(view.container)).violations).toEqual([]);
  });
});
