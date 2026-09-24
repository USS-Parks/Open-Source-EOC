import { useEffect, useState, type ReactNode, type RefObject } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Icon } from "../design/icons/index.js";
import type { ThemeName } from "../design/tokens.js";
import { CARD_LEGEND, legendInk, symbolDataUrl } from "./cartography.js";

export interface CardToggle {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}

const METERS_PER_MILE = 1609.344;
const NICE: Readonly<Record<"mi" | "km", readonly number[]>> = {
  mi: [1, 2, 5, 10, 20, 50, 100, 200, 500],
  km: [1, 2, 3, 5, 6, 10, 15, 20, 30, 50, 60, 100, 150, 200, 300, 500],
};

/** The largest round distance whose bar fits the width, with its tick fractions. */
export function scaleBar(metersPerPixel: number, unit: "mi" | "km", maxPixels: number): { length: number; pixels: number; ticks: readonly number[] } {
  const perUnit = unit === "mi" ? METERS_PER_MILE : 1000;
  const fits = NICE[unit].filter((length) => (length * perUnit) / metersPerPixel <= maxPixels);
  const length = fits.at(-1) ?? 1;
  // Miles read as quarter, half and whole; kilometres in even thirds when they divide cleanly.
  const ticks = unit === "km" && length % 3 === 0 ? [0, 1 / 3, 2 / 3, 1] : [0, 0.25, 0.5, 1];
  return { length, pixels: (length * perUnit) / metersPerPixel, ticks };
}

function metersPerPixel(map: MapLibreMap): number {
  const { lat } = map.getCenter();
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
}

function useMapState<T>(map: MapLibreMap | null, read: (map: MapLibreMap) => T, fallback: T): T {
  const [value, setValue] = useState<T>(() => (map ? read(map) : fallback));
  useEffect(() => {
    if (!map) return;
    const update = () => setValue(read(map));
    update();
    map.on("move", update);
    return () => { map.off("move", update); };
  }, [map]);
  return value;
}

function ScaleBar(props: { readonly map: MapLibreMap | null; readonly units: readonly ("mi" | "km")[] }) {
  const mpp = useMapState(props.map, metersPerPixel, 0);
  if (!mpp) return null;
  return (
    <div className="eoc-cop-card-scale" aria-label="Map scale">
      {props.units.map((unit) => {
        const bar = scaleBar(mpp, unit, 150);
        const name = unit === "mi" ? (bar.length === 1 ? "Mile" : "Miles") : (bar.length === 1 ? "Kilometer" : "Kilometers");
        return (
          <div key={unit} className="eoc-cop-card-scale-row" data-unit={unit}>
            <div className="eoc-cop-card-scale-bar" style={{ width: `${bar.pixels}px` }}>
              {bar.ticks.map((tick) => (
                <span key={tick} style={{ left: `${tick * 100}%` }}>{Number((tick * bar.length).toFixed(1))}</span>
              ))}
            </div>
            <span className="eoc-cop-card-scale-unit">{name}</span>
          </div>
        );
      })}
    </div>
  );
}

function NorthArrow(props: { readonly map: MapLibreMap | null }) {
  const bearing = useMapState(props.map, (map) => map.getBearing(), 0);
  return (
    <button
      type="button"
      className="eoc-cop-card-north"
      aria-label={bearing ? "Reset map to north" : "North is up"}
      onClick={() => props.map?.resetNorthPitch({ duration: 300 })}
    >
      <svg viewBox="0 0 24 40" width="21" height="35" aria-hidden="true" style={{ transform: `rotate(${-bearing}deg)` }}>
        <text x="12" y="9" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor">N</text>
        <path d="M12 13 19 37 12 31 5 37Z" fill="currentColor" />
      </svg>
    </button>
  );
}

function Legend(props: { readonly theme: ThemeName; readonly strip?: boolean }) {
  const ink = legendInk(props.theme);
  return (
    <ul className={`eoc-cop-card-legend${props.strip ? " is-strip" : ""}`} aria-label="Map legend">
      {CARD_LEGEND[props.theme].map((entry) => (
        <li key={entry.label}>
          {entry.symbol ? <img src={symbolDataUrl(props.theme, entry.symbol)} alt="" width={20} height={20} /> : (
            <span
              aria-hidden="true"
              className={`eoc-cop-card-key is-${entry.key}`}
              style={entry.key === "boundary" ? { borderColor: ink.boundary, backgroundColor: ink.fill } : { backgroundColor: ink.closure }}
            />
          )}
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

function Checks(props: { readonly toggles: readonly CardToggle[] }) {
  return (
    <>
      {props.toggles.map((toggle) => (
        <li key={toggle.id}>
          <label>
            <input type="checkbox" checked={toggle.checked} onChange={toggle.onChange} />
            {toggle.label}
          </label>
        </li>
      ))}
    </>
  );
}

/**
 * The map controls drawn over the overview's map card. Dark carries the
 * legend panel, a collapsible layer list and zoom buttons; light carries the
 * layer checklist with more layers, place search, location and full screen,
 * and a legend strip. Every control acts on the live map.
 */
export function CardOverlays(props: {
  readonly theme: ThemeName;
  readonly map: MapLibreMap | null;
  readonly frame: RefObject<HTMLElement | null>;
  readonly toggles: readonly CardToggle[];
  readonly more: readonly CardToggle[];
  readonly search?: ReactNode;
}) {
  const [layersOpen, setLayersOpen] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === props.frame.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  if (props.theme === "dark") {
    return (
      <div className="eoc-cop-card-overlays" data-card-theme="dark">
        <Legend theme="dark" />
        <NorthArrow map={props.map} />
        <div className="eoc-cop-card-layers">
          <button type="button" aria-label="Map layers" aria-expanded={layersOpen} onClick={() => setLayersOpen((open) => !open)}>
            <Icon name="layers" size={20} decorative />
          </button>
          {layersOpen ? <ul><Checks toggles={props.toggles} /></ul> : null}
        </div>
        <div className="eoc-cop-card-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => props.map?.zoomIn()}><Icon name="add" size={20} decorative /></button>
          <button type="button" aria-label="Zoom out" onClick={() => props.map?.zoomOut()}><Icon name="minus" size={20} decorative /></button>
        </div>
        <ScaleBar map={props.map} units={["mi"]} />
      </div>
    );
  }

  const locate = () => {
    if (!navigator.geolocation) {
      setNotice("Location is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setNotice("");
        props.map?.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: Math.max(props.map.getZoom(), 12), duration: 600 });
      },
      () => setNotice("Your location could not be found."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void props.frame.current?.requestFullscreen().catch(() => setNotice("Full screen is not available here."));
  };
  return (
    <div className="eoc-cop-card-overlays" data-card-theme="light">
      {layersOpen ? (
        <ul className="eoc-cop-card-checks" aria-label="Map layers">
          <Checks toggles={props.toggles} />
          <li className="eoc-cop-card-more">
            <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
              <Icon name="chevronDown" size={16} decorative />
              More layers
            </button>
            {moreOpen ? <ul><Checks toggles={props.more} /></ul> : null}
          </li>
        </ul>
      ) : null}
      <div className="eoc-cop-card-tools">
        {props.search}
        <button type="button" aria-label="Show my location" onClick={locate}><Icon name="locate" size={20} decorative /></button>
        <button type="button" aria-label="Map layers" aria-expanded={layersOpen} onClick={() => setLayersOpen((open) => !open)}>
          <Icon name="layers" size={20} decorative />
        </button>
        <button type="button" aria-label={fullscreen ? "Exit full screen" : "Full screen"} aria-pressed={fullscreen} onClick={toggleFullscreen}>
          <Icon name="fullscreen" size={20} decorative />
        </button>
      </div>
      {notice ? <p role="status" className="eoc-cop-card-notice">{notice}</p> : null}
      <Legend theme="light" strip />
      <NorthArrow map={props.map} />
      <ScaleBar map={props.map} units={["mi", "km"]} />
    </div>
  );
}
