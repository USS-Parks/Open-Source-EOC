import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import { CopMap } from "../src/cop/CopMap.js";
import type { CopFeatureCollection } from "../src/cop/layers.js";

// E2E harness page: renders the real CopMap against the live API using a
// token and board id from the query string, and exposes the map instance
// for the test to interrogate.

const params = new URLSearchParams(location.search);
const token = params.get("token") ?? "";
const boardId = params.get("board") ?? "";
const title = params.get("title") ?? "Road Closures";

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
  <div style={{ height: "100vh" }}>
    <CopMap
      theme="light"
      boards={[{ id: boardId, title }]}
      fetchItems={fetchItems}
      pollMs={1000}
      center={[-123.61, 41.29]}
      zoom={11}
      onMap={(map) => {
        window.__map = map;
      }}
    />
  </div>,
);
