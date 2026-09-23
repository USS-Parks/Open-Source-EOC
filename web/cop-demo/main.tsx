import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "../src/design/base.css";
import { CopMap } from "../src/cop/CopMap.js";
import type { CopFeatureCollection } from "../src/cop/layers.js";
import {
  assetBase,
  basemapStyleUrl,
  buildingsSource,
  jurisdictionOverlays,
  jurisdictionMapBounds,
  rasterBasemaps,
  streetBasemap,
  terrainSource,
} from "../src/app/config.js";
import { toCssVariables, themes, fontStack, type ThemeName } from "../src/design/tokens.js";

// E2E harness page: renders the real CopMap against the live API using a
// token and board id from the query string, and exposes the map instance
// for the test to interrogate. It doubles as the basemap testbed: any
// OPENEOC_* query parameter becomes runtime config (street PMTiles, gallery
// rasters, terrain), `bundled=1` mounts the bundled offline basemap, and
// `theme=dark` flips the theme, so a basemap can be proven in a real browser
// with no API running (leave `board` unset).

const params = new URLSearchParams(location.search);
const token = params.get("token") ?? "";
const boardId = params.get("board") ?? "";
const title = params.get("title") ?? "Road Closures";
const theme: ThemeName = params.get("theme") === "dark" ? "dark" : "light";
const runtimeConfig: Record<string, string> = {};
for (const [key, value] of params) if (key.startsWith("OPENEOC_")) runtimeConfig[key] = value;
(globalThis as { OPENEOC?: Record<string, string> }).OPENEOC = runtimeConfig;

declare global {
  interface Window {
    __map: unknown;
  }
}

async function fetchItems(id: string): Promise<CopFeatureCollection> {
  const res = await fetch(`/api/v1/ogc/collections/${id}/items`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return (await res.json()) as CopFeatureCollection;
}

createRoot(document.getElementById("app")!).render(
  <div style={{ height: "100vh", ...toCssVariables(theme), fontFamily: fontStack, color: themes[theme].text, background: themes[theme].bg }}>
    <CopMap
      theme={theme}
      boards={boardId ? [{ id: boardId, title }] : []}
      fetchItems={fetchItems}
      tileUrl={(kind, id) => (kind === "board" ? `/api/v1/tiles/boards/${id}/{z}/{x}/{y}.mvt` : undefined)}
      tileHeaders={() => ({ authorization: `Bearer ${token}` })}
      pollMs={1000}
      center={[-123.61, 41.29]}
      zoom={11}
      exportContext={{
        incidentName: params.get("incident"),
        operationalPeriod: params.get("period"),
        handling: params.get("handling"),
      }}
      bundledBasemap={params.get("bundled") === "1" ? { assetBase: assetBase() } : undefined}
      basemapStyleUrl={basemapStyleUrl()}
      streetBasemap={streetBasemap()}
      rasterBasemaps={rasterBasemaps()}
      terrain={terrainSource()}
      buildings={buildingsSource()}
      jurisdictionOverlays={jurisdictionOverlays()}
      initialBounds={runtimeConfig.OPENEOC_MAP_BOUNDS ? jurisdictionMapBounds() : undefined}
      onMap={(map) => {
        window.__map = map;
      }}
    />
  </div>,
);
