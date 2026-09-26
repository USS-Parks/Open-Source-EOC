import { useId, type ReactNode } from "react";
import type { PaletteLegendEntry } from "@openeoc/shared";
import type { FeedLegend } from "../feeds.js";
import type { ReferenceLegend } from "../reference-layers.js";
import { SymbolPatch } from "../symbols/SymbolPatch.js";
import type { IconId } from "../symbols/glyphs.js";
import "./legend.css";

/**
 * The Map screen's legend, following Esri's rule: only layers switched on
 * and drawn at the current zoom are listed, one heading per layer and one
 * patch and domain label per class. Labels come from the shared palette
 * table, so legend text reads as the form pick lists do. The patch is drawn
 * as the map draws the class: a translucent fill under its outline for an
 * area, a line over its casing, the icon suite's pictogram on its disc, or a
 * circle at the class's radius for a graduated layer.
 */

export type LegendPatch =
  | { readonly kind: "area"; readonly color: string; readonly fillOpacity: number; readonly outline: string; readonly outlineWidth: number; readonly hatch?: boolean }
  | { readonly kind: "line"; readonly color: string; readonly casing?: string | undefined }
  | { readonly kind: "icon"; readonly icon: IconId; readonly color: string }
  | { readonly kind: "square"; readonly color: string }
  | { readonly kind: "circle"; readonly color: string; readonly radius: number };

export interface LegendClass {
  readonly key: string;
  readonly label: string;
  readonly patch: LegendPatch;
}

export interface LegendLayer {
  /** The layer list's id for the layer, so the legend follows its switch. */
  readonly id: string;
  readonly title: string;
  /** MapLibre's range: drawn from minzoom, inclusive, to maxzoom, exclusive. */
  readonly minzoom?: number | undefined;
  readonly maxzoom?: number | undefined;
  readonly classes: readonly LegendClass[];
  /** Drawn on the map but left out of the legend, as Esri lets an author choose. */
  readonly hideFromLegend?: boolean | undefined;
  readonly source?: string | undefined;
}

/** Whether a layer with this zoom range draws at the zoom. */
export function inScale(range: { readonly minzoom?: number | undefined; readonly maxzoom?: number | undefined }, zoom: number): boolean {
  return zoom >= (range.minzoom ?? 0) && zoom < (range.maxzoom ?? Infinity);
}

/** The legend's layers at a zoom: switched on, in scale, not hidden, with a class to show. */
export function visibleLegend(layers: readonly LegendLayer[], zoom: number, visible: ReadonlySet<string>): LegendLayer[] {
  return layers.filter((layer) => !layer.hideFromLegend && visible.has(layer.id) && inScale(layer, zoom) && layer.classes.length > 0);
}

/**
 * How a layer's classes draw. "auto" reads each row: its area style, else
 * its pictogram, else a plain disc, for tables that mix areas and points.
 */
export type LegendShape = "auto" | "area" | "line" | "circle" | "square";

type LegendRow = Pick<PaletteLegendEntry, "key" | "label" | "color">
  & Partial<Pick<PaletteLegendEntry, "polygon" | "icon">> & { readonly radius?: number | undefined };

const POINT_RADIUS = 5;

function patchFor(row: LegendRow, shape: LegendShape, casing: string | undefined): LegendPatch {
  const { color } = row;
  if (shape === "line") return { kind: "line", color, casing };
  if (shape === "square") return { kind: "square", color };
  if (shape === "circle") return { kind: "circle", color, radius: row.radius ?? POINT_RADIUS };
  if (shape === "area" || row.polygon) {
    const p = row.polygon ?? { fillOpacity: 0.5, outlineWidth: 1.5 };
    return { kind: "area", color, fillOpacity: p.fillOpacity, outline: p.outline ?? color, outlineWidth: p.outlineWidth, ...(p.hatch ? { hatch: true } : {}) };
  }
  if (row.icon) return { kind: "icon", icon: row.icon, color };
  return { kind: "circle", color, radius: row.radius ?? POINT_RADIUS };
}

/**
 * A legend layer from legend rows: `paletteLegend(...)` from the palette
 * table, a feed's or a reference layer's rows. Give the zoom range the
 * layer's style draws at, so the legend drops it where the map does.
 */
export function legendLayer(
  id: string,
  title: string,
  rows: readonly LegendRow[],
  shape: LegendShape = "auto",
  extra: { readonly minzoom?: number; readonly maxzoom?: number; readonly casing?: string; readonly source?: string } = {},
): LegendLayer {
  const { casing, ...rest } = extra;
  return { id, title, ...rest, classes: rows.map((row) => ({ key: row.key, label: row.label, patch: patchFor(row, shape, casing) })) };
}

/** A live feed preset's legend (`feedPresetLegend`), under the feed's layer list id. */
export function feedLegendLayer(id: string, legend: FeedLegend, range: { readonly minzoom?: number; readonly maxzoom?: number } = {}): LegendLayer {
  const shape = legend.rows[0]?.shape;
  return legendLayer(id, legend.title, legend.rows, shape === "area" ? "area" : shape === "circle" ? "circle" : "auto", { ...range, source: legend.source });
}

/** A statewide reference layer's legend (`referenceLegends`); its id is the layer list id. */
export function referenceLegendLayer(legend: ReferenceLegend): LegendLayer {
  return legendLayer(legend.id, legend.title, legend.rows, legend.patch, {
    ...(legend.minzoom === undefined ? {} : { minzoom: legend.minzoom }),
    ...(legend.maxzoom === undefined ? {} : { maxzoom: legend.maxzoom }),
  });
}

const PATCH = 20;

/** One class's patch, decorative: the label beside it carries the meaning. */
function Patch(props: { readonly patch: LegendPatch; readonly box: number }) {
  // useId holds characters a url(#...) reference does not take.
  const hatchId = `eoc-hatch-${useId().replace(/[^\w-]/g, "")}`;
  const { patch, box } = props;
  if (patch.kind === "icon") return <SymbolPatch id={patch.icon} color={patch.color} size={PATCH} />;
  const svg = (width: number, height: number, children: ReactNode) => (
    <svg className="eoc-legend-patch" aria-hidden="true" focusable="false" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {children}
    </svg>
  );
  switch (patch.kind) {
    case "area": {
      const inset = Math.min(patch.outlineWidth, 3) / 2 + 1;
      return svg(PATCH, 14, <>
        {patch.hatch ? (
          <defs>
            <pattern id={hatchId} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke={patch.color} strokeWidth="1.5" />
            </pattern>
          </defs>
        ) : null}
        <rect x={inset} y={inset} width={PATCH - 2 * inset} height={14 - 2 * inset}
          fill={patch.hatch ? `url(#${hatchId})` : patch.color} fillOpacity={patch.hatch ? 1 : patch.fillOpacity}
          stroke={patch.outlineWidth > 0 ? patch.outline : "currentColor"}
          strokeOpacity={patch.outlineWidth > 0 ? 1 : 0.25} strokeWidth={Math.min(patch.outlineWidth, 3) || 1} />
      </>);
    }
    case "line":
      return svg(PATCH, 14, <>
        {patch.casing ? <line x1="1" y1="7" x2={PATCH - 1} y2="7" stroke={patch.casing} strokeWidth="6" strokeLinecap="round" /> : null}
        <line x1="1" y1="7" x2={PATCH - 1} y2="7" stroke={patch.color} strokeWidth="3" strokeLinecap="round" />
      </>);
    case "square":
      return svg(PATCH, PATCH, <rect x="2" y="2" width={PATCH - 4} height={PATCH - 4} rx="4" fill={patch.color} />);
    case "circle":
      // A hairline in the text color keeps a white or pale class visible on either theme.
      return svg(box, box, <circle cx={box / 2} cy={box / 2} r={patch.radius} fill={patch.color} stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />);
  }
}

/** The legend panel. `visible` holds the ids the layer list has switched on (`visibleLayerIds`). */
export function MapLegend(props: { readonly layers: readonly LegendLayer[]; readonly zoom: number; readonly visible: ReadonlySet<string> }) {
  const shown = visibleLegend(props.layers, props.zoom, props.visible);
  return (
    <section className="eoc-legend" aria-label="Map legend">
      {shown.length === 0 ? <p className="eoc-legend-empty">No layer with a legend draws at this zoom.</p> : null}
      {shown.map((layer) => {
        // Graduated circles share one box, so their sizes compare.
        const box = Math.max(PATCH, ...layer.classes.map((c) => (c.patch.kind === "circle" ? 2 * c.patch.radius + 2 : 0)));
        return (
          <details key={layer.id} className="eoc-legend-layer" open data-testid={`legend-${layer.id}`}>
            <summary>{layer.title}</summary>
            <ul aria-label={layer.title}>
              {layer.classes.map((c) => (
                <li key={c.key}>
                  <span className="eoc-legend-patch-box" style={{ width: box }}><Patch patch={c.patch} box={box} /></span>
                  {c.label}
                </li>
              ))}
            </ul>
            {layer.source ? <p className="eoc-legend-source">{layer.source}</p> : null}
          </details>
        );
      })}
    </section>
  );
}
