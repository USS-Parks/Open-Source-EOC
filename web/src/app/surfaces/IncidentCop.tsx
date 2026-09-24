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
import { INCIDENT_KIND_LABEL, useIncident } from "../incident/context.js";
import { requestMapFocus, useMapFocus } from "../layout/map-focus.js";
import { PlaceSearch } from "../layout/PlaceSearch.js";

/** "Thu 18:00 PDT": when the area's operational period ends. */
function periodEnd(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
  }).format(new Date(iso)).replace(",", "");
}

/**
 * The overview's common operating picture: the incident area and the
 * incident's map layers over the basemap, framed on the area, with the card's
 * own legend and controls. The Map screen holds the full layer panel and tools.
 */
export function IncidentCop(props: {
  readonly client: ApiClient;
  readonly theme: ThemeName;
  readonly incidentId: string;
  readonly collections: readonly CollectionRef[];
}) {
  const { selectedIncident } = useIncident();
  const focusOnSearch = useMapFocus();
  const area = useAsync(() => props.client.getIncidentArea(props.incidentId), [props.incidentId]);
  const bounds = area.data?.geometry ? geometryBounds(area.data.geometry) : null;
  const kind = selectedIncident ? INCIDENT_KIND_LABEL[selectedIncident.kind] : undefined;
  const period = area.data?.operationalPeriod;
  // Incident boards are titled "<incident>: <board>"; the card is already the incident's.
  const prefix = selectedIncident ? `${selectedIncident.name}: ` : null;
  const shortTitle = (title: string) => (prefix && title.startsWith(prefix) ? title.slice(prefix.length) : title);
  if (area.loading && !area.data) return <p className="eoc-overview-unavailable" role="status">Loading the incident area…</p>;
  return (
    <div className="eoc-overview-map">
      <CopMap
        key={JSON.stringify([props.incidentId, props.theme, bounds, props.collections.map((collection) => collection.id)])}
        layout="card"
        inspectionMode="popup"
        theme={props.theme}
        boards={props.collections.map((collection) => ({ id: collection.id, title: shortTitle(collection.title), templateKey: collection.templateKey }))}
        incidentArea={area.data?.geometry ? {
          geometry: area.data.geometry,
          title: selectedIncident ? `${selectedIncident.name}${kind ? ` (${kind.toLowerCase()})` : ""}` : undefined,
          detail: period ? ["Estimated extent", `through ${periodEnd(period.endsAt)}`] : ["Incident area"],
        } : null}
        cardSearch={<PlaceSearch client={props.client} onChoose={requestMapFocus} />}
        onMap={focusOnSearch}
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
