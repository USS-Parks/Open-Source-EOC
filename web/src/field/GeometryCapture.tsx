import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { odkPositions, odkText, type FormField } from "@openeoc/shared";
import { assetBase, basemapStyleUrl, jurisdictionMapBounds, streetBasemap } from "../app/config.js";
import { CopMap } from "../cop/CopMap.js";
import { geometryBounds } from "../cop/tools.js";
import { ActionButton } from "../design/controls.js";
import type { ThemeName } from "../design/tokens.js";

type Position = [number, number];
const SOURCE = "field-geometry-draft";
const EMPTY = async () => ({ type: "FeatureCollection" as const, features: [] });

/** The theme of the nearest themed ancestor, following it when the operator switches. */
function useAncestorTheme(ref: RefObject<HTMLElement | null>): ThemeName {
  const [theme, setTheme] = useState<ThemeName>("light");
  useLayoutEffect(() => {
    const host = ref.current?.closest("[data-theme]");
    if (!host) return;
    const read = () => setTheme(host.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(host, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [ref]);
  return theme;
}

/** Six decimal places, about ten centimeters: finer than a tap can place a point. */
const round = (degrees: number): number => Math.round(degrees * 1e6) / 1e6;
const same = (a: Position | undefined, b: Position | undefined) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

/**
 * Line (geotrace) and polygon (geoshape) capture. The answer is ODK's
 * "lat lon;lat lon" text, edited directly in the coordinate field or built
 * by tapping the map; the map is the same COP map the console uses, opened
 * only on request. A polygon is closed by repeating its first point.
 */
export function GeometryCapture(props: {
  readonly id: string;
  readonly field: FormField;
  readonly value: unknown;
  readonly error?: string | undefined;
  readonly onChange: (value: string | undefined) => void;
}) {
  const polygon = props.field.type === "geoshape";
  const host = useRef<HTMLFieldSetElement>(null);
  const theme = useAncestorTheme(host);
  const [drawing, setDrawing] = useState(false);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const points: Position[] = odkPositions(props.value) ?? [];
  const closed = polygon && points.length > 3 && same(points[0], points[points.length - 1]);
  const distinct = new Set(points.map((point) => point.join(" "))).size;
  const set = (next: Position[]) => props.onChange(next.length ? odkText(next) : undefined);
  const label = props.field.label ?? props.field.name;

  const features: unknown[] = points.map((point) => ({ type: "Feature", geometry: { type: "Point", coordinates: point }, properties: {} }));
  if (closed) features.unshift({ type: "Feature", geometry: { type: "Polygon", coordinates: [points] }, properties: {} });
  else if (points.length > 1) features.unshift({ type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: {} });
  const data = useRef<unknown>(null);
  data.current = { type: "FeatureCollection", features };
  useEffect(() => {
    if (!map) return;
    const attach = () => {
      if (map.getSource(SOURCE)) return;
      map.addSource(SOURCE, { type: "geojson", data: data.current as never });
      map.addLayer({ id: `${SOURCE}-fill`, type: "fill", source: SOURCE, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#658cac", "fill-opacity": 0.2 } });
      map.addLayer({ id: `${SOURCE}-line`, type: "line", source: SOURCE, filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": "#658cac", "line-width": 3 } });
      map.addLayer({ id: `${SOURCE}-points`, type: "circle", source: SOURCE, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": "#658cac", "circle-radius": 5, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 } });
    };
    if (map.isStyleLoaded()) attach(); else map.once("load", attach);
    return () => { map.off("load", attach); };
  }, [map]);
  useEffect(() => { (map?.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(data.current as never); }, [map, props.value]);

  return (
    <fieldset ref={host} className="eoc-field-location" aria-describedby={props.error ? `${props.id}-error` : undefined}>
      <legend>{label}{props.field.required ? " *" : ""}</legend>
      <label htmlFor={`${props.id}-coordinates`}>{polygon ? "Boundary points" : "Line points"} (latitude longitude; next point)
        <input id={`${props.id}-coordinates`} inputMode="decimal" placeholder="40.802 -124.163; 40.806 -124.171"
          value={String(props.value ?? "")} onChange={(event) => props.onChange(event.target.value || undefined)} />
      </label>
      <div className="eoc-field-geometry-actions">
        <ActionButton kind="secondary" aria-pressed={drawing} onClick={() => { if (drawing) setMap(null); setDrawing(!drawing); }}>
          {drawing ? "Stop drawing" : "Draw on map"}</ActionButton>
        <ActionButton kind="quiet" disabled={points.length === 0} onClick={() => set(points.slice(0, -1))}>Undo point</ActionButton>
        {polygon ? <ActionButton kind="quiet" disabled={closed || distinct < 3} onClick={() => set([...points, points[0]!])}>Close polygon</ActionButton> : null}
        <ActionButton kind="quiet" disabled={points.length === 0} onClick={() => set([])}>Clear</ActionButton>
      </div>
      {drawing ? <div className="eoc-field-map">
        <CopMap key={theme} theme={theme} boards={[]} fetchItems={EMPTY}
          bundledBasemap={{ assetBase: assetBase() }} basemapStyleUrl={basemapStyleUrl()} streetBasemap={streetBasemap()}
          initialBounds={geometryBounds(points.length ? { type: "LineString", coordinates: points } : null) ?? jurisdictionMapBounds()}
          picking={!closed} onPickPoint={([lon, lat]) => set([...points, [round(lon), round(lat)]])}
          onMap={(value) => { value.doubleClickZoom.disable(); setMap(value); }} />
      </div> : null}
      <small role="status">{points.length === 1 ? "1 point placed" : `${points.length} points placed`}{closed ? ", polygon closed" : ""}.
        {drawing && !closed ? ` Tap the map to add a point${polygon ? ", then close the polygon" : ""}.` : ""}</small>
      {props.error ? <small id={`${props.id}-error`} role="alert">{props.error}</small> : null}
    </fieldset>
  );
}
