import { useId } from "react";
import { inScale } from "./MapLegend.js";
import "./legend.css";

/**
 * The Map screen's layer list, in Esri's Layer List conventions: layers in
 * fixed groups, the basemaps an exclusive (radio) group, each layer with its
 * switch, an opacity slider and zoom-to, and a layer outside its zoom range
 * greyed with a note saying which way to zoom. The model is pure; the
 * component renders it and hands every change back as a new state.
 */

export type LayerGroupId = "incident" | "hazards" | "facilities" | "buildings" | "boundaries" | "risk" | "feeds" | "basemap";

export const LAYER_GROUPS: readonly { readonly id: LayerGroupId; readonly title: string; readonly exclusive?: true }[] = [
  { id: "incident", title: "Incident" },
  { id: "hazards", title: "Hazards" },
  { id: "facilities", title: "Critical facilities by lifeline" },
  { id: "buildings", title: "Buildings" },
  { id: "boundaries", title: "Boundaries" },
  { id: "risk", title: "Risk and reference" },
  { id: "feeds", title: "Live feeds" },
  { id: "basemap", title: "Basemap", exclusive: true },
];

export type Bounds = readonly [west: number, south: number, east: number, north: number];

export interface LayerListItem {
  /** The id the legend and the map's visibility use for the layer. */
  readonly id: string;
  readonly group: LayerGroupId;
  readonly title: string;
  readonly minzoom?: number | undefined;
  readonly maxzoom?: number | undefined;
  /** On until switched off; false leaves it off, as Esri does live feeds. In an exclusive group, the first on is chosen. */
  readonly defaultVisible?: boolean | undefined;
  /** What zoom-to frames; without it zoom-to only brings the layer into scale. */
  readonly bounds?: Bounds | undefined;
  /** A swatch beside the title, such as a lifeline's color. */
  readonly color?: string | undefined;
  /** False where the layer has no opacity of its own, as lifelines sharing one source. */
  readonly opacity?: false | undefined;
}

export interface LayerListState {
  readonly visible: Readonly<Record<string, boolean>>;
  /** 0 to 1; 1 when unset. */
  readonly opacity: Readonly<Record<string, number>>;
  /** The layer chosen in each exclusive group. */
  readonly chosen: Readonly<Partial<Record<LayerGroupId, string>>>;
}

export const INITIAL_LAYER_LIST_STATE: LayerListState = { visible: {}, opacity: {}, chosen: {} };

const exclusive = (group: LayerGroupId) => LAYER_GROUPS.find((g) => g.id === group)?.exclusive === true;

/** The chosen layer of an exclusive group: the state's choice, else the first on by default, else the first. */
function chosenIn(group: LayerGroupId, items: readonly LayerListItem[], state: LayerListState): string | undefined {
  const members = items.filter((item) => item.group === group);
  const choice = state.chosen[group];
  if (choice && members.some((item) => item.id === choice)) return choice;
  return (members.find((item) => item.defaultVisible !== false) ?? members[0])?.id;
}

export function isLayerOn(item: LayerListItem, items: readonly LayerListItem[], state: LayerListState): boolean {
  if (exclusive(item.group)) return chosenIn(item.group, items, state) === item.id;
  return state.visible[item.id] ?? item.defaultVisible ?? true;
}

/** The ids switched on, for the map's visibility and the legend's `visible`. */
export function visibleLayerIds(items: readonly LayerListItem[], state: LayerListState): Set<string> {
  return new Set(items.filter((item) => isLayerOn(item, items, state)).map((item) => item.id));
}

/** A switch pressed: a checkbox toggles, a radio chooses its layer. */
export function switchLayer(state: LayerListState, item: LayerListItem): LayerListState {
  if (exclusive(item.group)) return { ...state, chosen: { ...state.chosen, [item.group]: item.id } };
  return { ...state, visible: { ...state.visible, [item.id]: !(state.visible[item.id] ?? item.defaultVisible ?? true) } };
}

export function setLayerOpacity(state: LayerListState, id: string, value: number): LayerListState {
  return { ...state, opacity: { ...state.opacity, [id]: Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1)) } };
}

/** The zoom nearest `zoom` at which the layer draws; `zoom` itself when it already does. */
export function scaleZoom(item: LayerListItem, zoom: number): number {
  if (item.minzoom !== undefined && zoom < item.minzoom) return item.minzoom;
  if (item.maxzoom !== undefined && zoom >= item.maxzoom) return item.maxzoom - 0.01;
  return zoom;
}

export interface LayerRow {
  readonly item: LayerListItem;
  readonly on: boolean;
  readonly opacity: number;
  readonly outOfScale: boolean;
  /** Which way to zoom, for a layer out of scale. */
  readonly scaleNote?: string;
}

export interface LayerGroupView {
  readonly id: LayerGroupId;
  readonly title: string;
  readonly exclusive: boolean;
  readonly rows: readonly LayerRow[];
}

/** The groups in their fixed order, each with its layers in the order given; empty groups left out. */
export function layerListView(items: readonly LayerListItem[], state: LayerListState, zoom: number): LayerGroupView[] {
  return LAYER_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    exclusive: group.exclusive === true,
    rows: items.filter((item) => item.group === group.id).map((item): LayerRow => {
      const outOfScale = !inScale(item, zoom);
      const scaleNote = !outOfScale ? undefined
        : item.minzoom !== undefined && zoom < item.minzoom ? `Not drawn at this zoom: zoom in to ${item.minzoom}.`
          : `Not drawn at this zoom: zoom out below ${item.maxzoom}.`;
      return { item, on: isLayerOn(item, items, state), opacity: state.opacity[item.id] ?? 1, outOfScale, ...(scaleNote ? { scaleNote } : {}) };
    }),
  })).filter((group) => group.rows.length > 0);
}

function Row(props: {
  readonly row: LayerRow;
  readonly group: LayerGroupView;
  readonly name: string;
  readonly onSwitch: () => void;
  readonly onOpacity: (value: number) => void;
  readonly onZoomTo: () => void;
}) {
  const noteId = useId();
  const { row, group } = props;
  const { item } = row;
  return (
    <li className={`eoc-layer-row${row.outOfScale ? " is-out-of-scale" : ""}`} data-testid={`layer-${item.id}`}>
      <label>
        <input type={group.exclusive ? "radio" : "checkbox"} name={group.exclusive ? props.name : undefined} checked={row.on}
          onChange={props.onSwitch} aria-describedby={row.scaleNote ? noteId : undefined} />
        {item.color ? (
          <svg aria-hidden="true" focusable="false" width="14" height="14"><rect x="1" y="1" width="12" height="12" rx="3" fill={item.color} /></svg>
        ) : null}
        {item.title}
      </label>
      {item.bounds || row.outOfScale ? (
        <button type="button" aria-label={`Zoom to ${item.title}`} onClick={props.onZoomTo}>Zoom to</button>
      ) : null}
      {row.scaleNote ? <p id={noteId} className="eoc-layer-note">{row.scaleNote}</p> : null}
      {item.opacity === false ? null : (
        <label className="eoc-layer-opacity">
          Opacity
          <input type="range" min={0} max={100} step={5} value={Math.round(row.opacity * 100)} aria-label={`${item.title} opacity`}
            aria-valuetext={`${Math.round(row.opacity * 100)} percent`} onChange={(event) => props.onOpacity(Number(event.target.value) / 100)} />
        </label>
      )}
    </li>
  );
}

/**
 * The layer list panel. `onZoomTo` frames `item.bounds` when there are any,
 * then keeps the zoom inside the layer's range with `scaleZoom`.
 */
export function LayerList(props: {
  readonly items: readonly LayerListItem[];
  readonly state: LayerListState;
  readonly zoom: number;
  readonly onChange: (next: LayerListState) => void;
  readonly onZoomTo: (item: LayerListItem) => void;
}) {
  const { state, onChange } = props;
  const name = useId();
  return (
    <div className="eoc-layer-list">
      {layerListView(props.items, state, props.zoom).map((group) => (
        <details key={group.id} className="eoc-layer-group" open data-testid={`layer-group-${group.id}`}>
          <summary>{group.title}</summary>
          <ul aria-label={group.title}>
            {group.rows.map((row) => (
              <Row key={row.item.id} row={row} group={group} name={`${name}-${group.id}`}
                onSwitch={() => onChange(switchLayer(state, row.item))}
                onOpacity={(value) => onChange(setLayerOpacity(state, row.item.id, value))}
                onZoomTo={() => props.onZoomTo(row.item)} />
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
