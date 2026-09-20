import { useState, type CSSProperties } from "react";
import { geometryFieldKey } from "@openeoc/shared";
import { CopMap } from "../../cop/CopMap.js";
import { RecordForm } from "../../boards/RecordForm.js";
import { Button, Panel } from "../../design/components.js";
import type { ThemeName } from "../../design/tokens.js";
import type { ApiClient, CollectionRef, FeedHealth } from "../api/client.js";
import {
  assetBase,
  basemapStyleUrl,
  imageryAttribution,
  imageryTileUrl,
  streetBasemap,
} from "../config.js";
import { useAsync } from "../data/hooks.js";
import { uploadPickedFile } from "../data/files.js";
import { EmptyState, Loading } from "../screens/parts.js";

const selectStyle: CSSProperties = {
  fontFamily: "inherit",
  fontSize: "1em",
  padding: 6,
  minHeight: 44,
  borderRadius: 4,
  border: "1px solid var(--eoc-border)",
  background: "var(--eoc-surface)",
  color: "var(--eoc-text)",
};

const overlayStyle: CSSProperties = {
  position: "absolute",
  top: 64,
  right: 24,
  width: 360,
  maxHeight: "78%",
  overflow: "auto",
  zIndex: 5,
};

/**
 * The COP surface, plus field capture: an operator can drop a point on the
 * map (the Field Maps gesture), which opens the board's record form with the
 * location prefilled from the tap, so a closure, hazard, or resource is
 * placed and attributed without leaving the map.
 */
export function MapSurface(props: {
  client: ApiClient;
  theme: ThemeName;
  jurisdictionId: string;
  collections: readonly CollectionRef[];
  feeds: readonly FeedHealth[];
}) {
  const [adding, setAdding] = useState(false);
  const [boardId, setBoardId] = useState("");
  const [point, setPoint] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const geoBoards = props.collections;
  const activeBoard = boardId || geoBoards[0]?.id || "";
  const board = useAsync(
    () => (adding && activeBoard ? props.client.getBoard(activeBoard) : Promise.resolve(null)),
    [adding, activeBoard],
  );

  const feedLayers = props.feeds.filter((f) => f.enabled).map((f) => ({ id: f.id, title: f.name }));
  const empty = geoBoards.length === 0 && feedLayers.length === 0;

  const reset = () => {
    setAdding(false);
    setPoint(null);
    setError(null);
  };

  const save = (data: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    props.client
      .createRecord(activeBoard, data)
      .then(() => reset())
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  if (empty) {
    return (
      <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
        <EmptyState
          label="No map layers yet"
          hint="Boards with a location field and live feeds appear here as COP layers."
        />
      </div>
    );
  }

  const fields = board.data?.fields ?? [];
  const geomKey = fields.length ? geometryFieldKey(fields) : null;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        padding: 12,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {geoBoards.length > 0 ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button
            kind={adding ? "primary" : "quiet"}
            onClick={() => (adding ? reset() : setAdding(true))}
          >
            {adding ? "Cancel" : "Add point"}
          </Button>
          {adding ? (
            <>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ color: "var(--eoc-text-muted)" }}>Board</span>
                <select
                  value={activeBoard}
                  onChange={(e) => {
                    setBoardId(e.target.value);
                    setPoint(null);
                  }}
                  style={selectStyle}
                >
                  {geoBoards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </label>
              <span style={{ color: "var(--eoc-text-muted)" }}>
                {point ? "Point placed. Fill the form, then save." : "Click the map to place the point."}
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0 }}>
        <CopMap
          theme={props.theme}
          boards={geoBoards.map((c) => ({ id: c.id, title: c.title }))}
          fetchItems={(id) => props.client.collectionItems(id)}
          feeds={feedLayers}
          fetchFeedItems={(id) => props.client.feedItems(id)}
          basemap={{ kind: "natural-earth", assetBase: assetBase() }}
          basemapStyleUrl={basemapStyleUrl()}
          streetBasemap={streetBasemap()}
          imageryUrl={imageryTileUrl()}
          imageryAttribution={imageryAttribution()}
          picking={adding && !point}
          onPickPoint={(p) => setPoint(p)}
        />
      </div>

      {adding && point ? (
        <div style={overlayStyle}>
          <Panel title="New map record">
            {board.loading && !board.data ? <Loading label="Loading form…" /> : null}
            {board.data ? (
              geomKey ? (
                <RecordForm
                  fields={fields}
                  initial={{ [geomKey]: { type: "Point", coordinates: point } }}
                  onSubmit={save}
                  onUpload={(file) => uploadPickedFile(props.client, props.jurisdictionId, file)}
                />
              ) : (
                <p style={{ color: "var(--eoc-text-muted)" }}>This board has no location field.</p>
              )
            ) : null}
            {error ? (
              <p role="alert" style={{ color: "var(--eoc-status-critical)", margin: "8px 0 0" }}>
                {error}
              </p>
            ) : null}
            <div style={{ marginTop: 8 }}>
              <Button onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
