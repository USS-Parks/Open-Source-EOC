import { CopMap } from "../../cop/CopMap.js";
import type { ThemeName } from "../../design/tokens.js";
import type { ApiClient, CollectionRef, FeedHealth } from "../api/client.js";
import { assetBase, basemapStyleUrl } from "../config.js";
import { EmptyState } from "../screens/parts.js";

/**
 * The map-first canvas: the live COP filling the center. Every geo board is
 * a togglable layer, fed from the OGC Features endpoint the CopMap already
 * consumes. When no board carries a location field there is nothing to
 * draw, so the surface says so rather than showing an empty basemap.
 */
export function MapSurface(props: {
  client: ApiClient;
  theme: ThemeName;
  collections: readonly CollectionRef[];
  feeds: readonly FeedHealth[];
}) {
  const feedLayers = props.feeds.filter((f) => f.enabled).map((f) => ({ id: f.id, title: f.name }));
  const empty = props.collections.length === 0 && feedLayers.length === 0;
  return (
    <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
      {empty ? (
        <EmptyState
          label="No map layers yet"
          hint="Boards with a location field and live feeds appear here as COP layers."
        />
      ) : (
        <CopMap
          theme={props.theme}
          boards={props.collections.map((c) => ({ id: c.id, title: c.title }))}
          fetchItems={(id) => props.client.collectionItems(id)}
          feeds={feedLayers}
          fetchFeedItems={(id) => props.client.feedItems(id)}
          basemap={{ kind: "natural-earth", assetBase: assetBase() }}
          basemapStyleUrl={basemapStyleUrl()}
        />
      )}
    </div>
  );
}
