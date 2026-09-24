import { CopMap } from "../../cop/CopMap.js";
import { geometryBounds } from "../../cop/tools.js";
import type { ThemeName } from "../../design/tokens.js";
import type { ApiClient, CollectionRef } from "../api/client.js";
import {
  assetBase,
  basemapStyleUrl,
  buildingsSource,
  jurisdictionMapBounds,
  rasterBasemaps,
  streetBasemap,
  terrainSource,
} from "../config.js";
import { useAsync } from "../data/hooks.js";

/**
 * The overview's common operating picture: the incident's map layers over the
 * basemap, framed on the incident area. The Map screen holds the full layer
 * panel and tools.
 */
export function IncidentCop(props: {
  readonly client: ApiClient;
  readonly theme: ThemeName;
  readonly incidentId: string;
  readonly collections: readonly CollectionRef[];
}) {
  const area = useAsync(() => props.client.getIncidentArea(props.incidentId), [props.incidentId]);
  const bounds = area.data?.geometry ? geometryBounds(area.data.geometry) : null;
  if (area.loading && !area.data) return <p className="eoc-overview-unavailable" role="status">Loading the incident area…</p>;
  return (
    <div className="eoc-overview-map">
      <CopMap
        key={JSON.stringify([props.incidentId, props.theme, bounds, props.collections.map((collection) => collection.id)])}
        layout="card"
        theme={props.theme}
        boards={props.collections.map((collection) => ({ id: collection.id, title: collection.title }))}
        fetchItems={(id) => props.client.collectionItems(id)}
        tileUrl={(kind, id) => kind === "board" ? `/api/v1/tiles/boards/${id}/{z}/{x}/{y}.mvt` : undefined}
        tileHeaders={() => ({ authorization: `Bearer ${props.client.fieldSyncToken()}` })}
        basemap={{ kind: "natural-earth", assetBase: assetBase() }}
        bundledBasemap={{ assetBase: assetBase() }}
        basemapStyleUrl={basemapStyleUrl()}
        streetBasemap={streetBasemap()}
        rasterBasemaps={rasterBasemaps()}
        terrain={terrainSource()}
        buildings={buildingsSource()}
        initialBounds={bounds ?? jurisdictionMapBounds()}
      />
    </div>
  );
}
