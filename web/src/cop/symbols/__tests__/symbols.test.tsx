// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { composeIcon, shapeFor, type IconShape } from "../compose.js";
import { GLYPHS, ICON_IDS } from "../glyphs.js";
import type { Map as MapLibreMap } from "maplibre-gl";
import { ensureIconImages, iconImageId, symbolDataUrl, type ImageHost } from "../register.js";
import { SymbolPatch } from "../SymbolPatch.js";

// Type check only: a MapLibre map can take the icons.
const _mapTakesIcons = (map: MapLibreMap): ImageHost => map;

const SVG_NS = "http://www.w3.org/2000/svg";
const ELEMENTS = new Set(["path", "circle", "rect"]);
const ATTRIBUTES = new Set([
  "d", "cx", "cy", "r", "x", "y", "width", "height", "rx", "fill", "fill-rule",
  "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
]);

function parse(markup: string): Document {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  return doc;
}

type Point = [number, number];

/** Points bounding an elliptical arc: its ends plus samples along it (SVG spec F.6.5). */
function arcPoints(from: Point, rx: number, ry: number, rotation: number, large: number, sweep: number, to: Point): Point[] {
  const phi = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const scale = Math.max(1, Math.sqrt((x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)));
  rx *= scale;
  ry *= scale;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
  const angle = (ux: number, uy: number) => Math.atan2(uy, ux);
  const start = angle((x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((-x1 - cx1) / rx, (-y1 - cy1) / ry) - start;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  return Array.from({ length: 65 }, (_, i) => {
    const t = start + (delta * i) / 64;
    return [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  });
}

/** Every end point, control point and arc sample of a path. Bezier curves lie inside their control points. */
function pathPoints(d: string): Point[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const points: Point[] = [];
  let cur: Point = [0, 0];
  let start: Point = [0, 0];
  let cmd = "";
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const at = (x: number, y: number): Point => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    switch (cmd.toUpperCase()) {
      case "M": cur = at(num(), num()); start = cur; points.push(cur); cmd = rel ? "l" : "L"; break;
      case "L": case "T": cur = at(num(), num()); points.push(cur); break;
      case "H": cur = [rel ? cur[0] + num() : num(), cur[1]]; points.push(cur); break;
      case "V": cur = [cur[0], rel ? cur[1] + num() : num()]; points.push(cur); break;
      case "C": points.push(at(num(), num()), at(num(), num())); cur = at(num(), num()); points.push(cur); break;
      case "S": case "Q": points.push(at(num(), num())); cur = at(num(), num()); points.push(cur); break;
      case "A": {
        const [rx, ry, rot, large, sweep] = [num(), num(), num(), num(), num()];
        const to = at(num(), num());
        points.push(...arcPoints(cur, rx, ry, rot, large, sweep, to));
        cur = to;
        break;
      }
      case "Z": cur = start; break;
      default: throw new Error(`unexpected path command ${cmd}`);
    }
  }
  return points;
}

/** The glyph's extent on the 24 grid, strokes included. */
function bounds(doc: Document): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const el of Array.from(doc.documentElement.children)) {
    const pad = el.getAttribute("stroke") ? Number(el.getAttribute("stroke-width")) / 2 : 0;
    const a = (name: string) => Number(el.getAttribute(name) ?? 0);
    const points: Point[] =
      el.tagName === "path" ? pathPoints(el.getAttribute("d")!) :
      el.tagName === "circle" ? [[a("cx") - a("r"), a("cy") - a("r")], [a("cx") + a("r"), a("cy") + a("r")]] :
      [[a("x"), a("y")], [a("x") + a("width"), a("y") + a("height")]];
    for (const [x, y] of points) {
      min = Math.min(min, x - pad, y - pad);
      max = Math.max(max, x + pad, y + pad);
    }
  }
  return { min, max };
}

describe("the icon suite's glyphs", () => {
  it("is exactly the 40 icons of the plan, in order", () => {
    expect(ICON_IDS).toEqual([
      "hospital", "urgent_care", "fire_station", "ems_station", "law_enforcement", "eoc", "school", "college",
      "nursing_home", "dialysis", "pharmacy", "power_plant", "substation", "water_treatment", "wastewater_treatment",
      "comms_tower", "airport", "heliport", "port", "dam", "bridge", "correctional", "government", "hazmat_site",
      "command_post", "staging_area", "incident_base", "camp", "helibase", "distribution_point", "shelter",
      "wildfire", "structure_fire", "landslide", "flooding", "hazmat_release", "earthquake", "tsunami", "road_block",
      "damage_report",
    ]);
    expect(Object.keys(GLYPHS)).toEqual([...ICON_IDS]);
  });

  it("groups them 24 critical, 7 incident and 9 hazard, with a lifeline for each critical facility only", () => {
    const count = (group: string) => ICON_IDS.filter((id) => GLYPHS[id].group === group).length;
    expect([count("critical"), count("incident"), count("hazard")]).toEqual([24, 7, 9]);
    for (const id of ICON_IDS) {
      expect(GLYPHS[id].title).toMatch(/^[A-Z]/);
      expect(Boolean(GLYPHS[id].lifeline)).toBe(GLYPHS[id].group === "critical");
    }
  });

  it.each(ICON_IDS)("%s is self-contained SVG on the 24 grid", (id) => {
    const body = GLYPHS[id].body;
    expect(body).not.toMatch(/href|url\(|<script|<text|<image|<use|<foreignObject|style=/i);
    const doc = parse(`<svg xmlns="${SVG_NS}" viewBox="0 0 24 24">${body}</svg>`);
    for (const el of Array.from(doc.documentElement.querySelectorAll("*"))) {
      expect(ELEMENTS.has(el.tagName), `<${el.tagName}>`).toBe(true);
      for (const attr of Array.from(el.attributes)) expect(ATTRIBUTES.has(attr.name), attr.name).toBe(true);
      const paint = [el.getAttribute("fill"), el.getAttribute("stroke")].filter((v) => v && v !== "none");
      expect(paint.every((v) => v === "currentColor"), "one color only").toBe(true);
    }
    const { min, max } = bounds(doc);
    expect(max - min, "the glyph fills its live area").toBeGreaterThan(14);
    expect(min).toBeGreaterThanOrEqual(1);
    expect(max).toBeLessThanOrEqual(23);
  });
});

describe("composed symbols", () => {
  it("follows the convention: critical facilities square, the command post ICS, the rest discs", () => {
    expect(shapeFor("hospital")).toBe("square");
    expect(shapeFor("command_post")).toBe("ics");
    expect(shapeFor("shelter")).toBe("disc");
    expect(shapeFor("wildfire")).toBe("disc");
  });

  it.each(ICON_IDS.flatMap((id) => (["disc", "square", "ics"] as IconShape[]).map((shape) => [id, shape] as const)))(
    "%s as %s is a well-formed SVG document",
    (id, shape) => {
      const svg = composeIcon(id, shape, "#1f4e9c", 24, 2);
      const root = parse(svg).documentElement;
      expect(root.tagName).toBe("svg");
      expect(root.getAttribute("width")).toBe("48");
      expect(root.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg).toContain('fill="#1f4e9c"');
      expect(svg).not.toMatch(/href|url\(|<script|<text|id=/);
    },
  );

  it("refuses a color that is not #rrggbb", () => {
    expect(() => composeIcon("eoc", "square", "red", 24)).toThrow(/#rrggbb/);
    expect(() => composeIcon("eoc", "square", '#000"/><script>', 24)).toThrow(/#rrggbb/);
  });
});

describe("map registration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("names images by icon and color and encodes a data URL", () => {
    expect(iconImageId("hospital", "#C62839")).toBe("eoc-sym-hospital-c62839");
    expect(decodeURIComponent(symbolDataUrl("shelter", "#009656"))).toMatch(/^data:image\/svg\+xml;charset=utf-8,<svg /);
  });

  it("adds each image once, at the device pixel ratio but never below 2", async () => {
    const decoded: number[] = [];
    vi.stubGlobal("Image", class {
      src = "";
      constructor(readonly width: number, readonly height: number) {}
      decode() {
        decoded.push(this.width);
        return Promise.resolve();
      }
    });
    vi.stubGlobal("devicePixelRatio", 1.25);
    const images = new Map<string, { pixelRatio: number }>();
    const map = {
      hasImage: (id: string) => images.has(id),
      addImage: vi.fn((id: string, _image: unknown, options: { pixelRatio: number }) => void images.set(id, options)),
    };
    const icons = [{ id: "hospital", color: "#c62839" }, { id: "shelter", color: "#009656" }, { id: "hospital", color: "#c62839" }] as const;
    await ensureIconImages(map, icons);
    await ensureIconImages(map, icons);
    expect(map.addImage).toHaveBeenCalledTimes(2);
    expect([...images.keys()]).toEqual(["eoc-sym-hospital-c62839", "eoc-sym-shelter-009656"]);
    expect(images.get("eoc-sym-hospital-c62839")).toEqual({ pixelRatio: 2 });
    expect(decoded.every((width) => width === 48)).toBe(true);

    vi.stubGlobal("devicePixelRatio", 3);
    await ensureIconImages(map, [{ id: "eoc", color: "#1f4e9c" }]);
    expect(images.get("eoc-sym-eoc-1f4e9c")).toEqual({ pixelRatio: 3 });
  });
});

describe("SymbolPatch", () => {
  afterEach(cleanup);

  it("is decorative by default and named when given a label", () => {
    const { container } = render(<><SymbolPatch id="hospital" color="#c62839" /><SymbolPatch id="eoc" color="#1f4e9c" label="Emergency operations center" /></>);
    const [decorative] = Array.from(container.querySelectorAll(".eoc-symbol-patch"));
    expect(decorative?.getAttribute("aria-hidden")).toBe("true");
    expect(decorative?.querySelector("svg")?.getAttribute("width")).toBe("20");
    expect(screen.getByRole("img", { name: "Emergency operations center" }).querySelector("svg")).not.toBeNull();
  });
});
