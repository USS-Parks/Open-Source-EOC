import { CopMap } from "../../cop/CopMap.js";
import type { ThemeName } from "../../design/tokens.js";
import type { ApiClient, CollectionRef } from "../api/client.js";
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
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
      {props.collections.length === 0 ? (
        <EmptyState
          label="No map layers yet"
          hint="Boards with a location field appear here as live COP layers."
        />
      ) : (
        <CopMap
          theme={props.theme}
          boards={props.collections.map((c) => ({ id: c.id, title: c.title }))}
          fetchItems={(id) => props.client.collectionItems(id)}
        />
      )}
    </div>
  );
}
