import { useCallback, useState } from "react";
import {
  CALIFORNIA_CATALOG,
  CALIFORNIA_ESF_TITLES,
  LIFELINE_DEFINITION,
  geometryFieldKey,
  type OperationalRelationship,
  type OperationalRelationshipCreate,
} from "@openeoc/shared";
import {
  CopMap,
  type CopMapBounds,
  type CopSelectedDatasetFeature,
} from "../../cop/CopMap.js";
import { ImpactKpiPanel } from "../../cop/ImpactKpiPanel.js";
import { FEMA_NFHL_ATTRIBUTION, FEMA_NFHL_DATASET_KEY } from "../../cop/hazards.js";
import { geometryBounds } from "../../cop/tools.js";
import { RecordForm } from "../../boards/RecordForm.js";
import { FieldSubmissionQueue } from "../../field/field-submissions.js";
import { readKept } from "../../offline/kept-board.js";
import { noConnection } from "../../offline/outbox.js";
import { Button, Panel } from "../../design/components.js";
import { workStateText } from "../../design/work-state.js";
import { Icon } from "../../design/icons/index.js";
import type { ThemeName } from "../../design/tokens.js";
import type { ApiClient, CollectionRef, FeedHealth } from "../api/client.js";
import {
  assetBase,
  basemapStyleUrl,
  buildingsSource,
  jurisdictionOverlays,
  jurisdictionMapBounds,
  rasterBasemaps,
  streetBasemap,
  terrainSource,
} from "../config.js";
import { useAsync } from "../data/hooks.js";
import { uploadPickedFile } from "../data/files.js";
import { requestMapFocus, useMapFocus } from "../layout/map-focus.js";
import { PlaceSearch } from "../layout/PlaceSearch.js";
import { EmptyState, Loading } from "../screens/parts.js";
import { LIFELINE_LABELS } from "./lifeline-view.js";
import "./map-surface.css";

type AssessmentSource = OperationalRelationshipCreate["source"];

function sourceValue(source: AssessmentSource): string {
  return `${source.domain}|${source.framework}|${source.definitionKey}`;
}

function esfSourceLabel(framework: string, key: string): string {
  if (framework === "california") {
    const title = CALIFORNIA_ESF_TITLES[key as keyof typeof CALIFORNIA_ESF_TITLES];
    return `California ESF ${Number(key.replace("ca_esf_", ""))}${title ? `: ${title}` : ""}`;
  }
  return key.replace(/^esf_(\d+)_/, "ESF $1: ").replaceAll("_", " ");
}

function relationshipSourceLabel(link: OperationalRelationship): string {
  if (link.source.domain === "lifeline") {
    return `Lifeline: ${LIFELINE_LABELS[link.source.definitionKey as keyof typeof LIFELINE_LABELS]
      ?? link.source.definitionKey.replaceAll("_", " ")}`;
  }
  return esfSourceLabel(link.source.framework, link.source.definitionKey);
}

/** Seconds since a dataset's last successful load, for the feed-style age line. */
function ageSeconds(lastSuccessAt: string | null): number | null {
  return lastSuccessAt ? Math.floor((Date.now() - Date.parse(lastSuccessAt)) / 1000) : null;
}

function stableBounds(bounds: CopMapBounds): CopMapBounds {
  return [
    Number(bounds[0].toFixed(6)),
    Number(bounds[1].toFixed(6)),
    Number(bounds[2].toFixed(6)),
    Number(bounds[3].toFixed(6)),
  ];
}

function boundsKey(bounds: CopMapBounds | null): string {
  return bounds?.join(",") ?? "";
}

/**
 * The COP surface, plus field capture: an operator can drop a point on the
 * map (the Field Maps gesture), which opens the board's record form with the
 * location prefilled from the tap, so a closure, hazard, or resource is
 * placed and attributed without leaving the map. With no connection, a point
 * on one of the selected incident's boards is kept in the device's field
 * queue and sent when the connection returns (AG-07).
 */
export function MapSurface(props: {
  client: ApiClient;
  theme: ThemeName;
  jurisdictionId: string;
  collections: readonly CollectionRef[];
  feeds: readonly FeedHealth[];
  incidentId?: string | null;
  incidentName?: string | null;
  operationalPeriod?: string | null;
  handlingMarking?: string | null;
  incidentBoardIds?: ReadonlySet<string>;
  /** The signed-in person, whose field queue holds points placed on the incident's boards. */
  personId?: string | null;
  focusDatasetId?: string | undefined;
  focusFeatureId?: string | undefined;
  /** A board record to show and inspect, from its "Show on map". */
  focusRecord?: { readonly boardId: string; readonly recordId: string } | null | undefined;
  /** Opens a board record beside its list, from the map's inspector. */
  onOpenRecord?: ((boardId: string, recordId: string) => void) | undefined;
  onOpenLifeline?: (id: string) => void;
  onOpenEsf?: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [boardId, setBoardId] = useState("");
  const [point, setPoint] = useState<[number, number] | null>(null);
  const [longitude, setLongitude] = useState("");
  const [latitude, setLatitude] = useState("");
  const [coordinateError, setCoordinateError] = useState<string | null>(null);
  const [impactBounds, setImpactBounds] = useState<CopMapBounds | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<CopSelectedDatasetFeature | null>(null);
  const [relationshipSource, setRelationshipSource] = useState("");
  const [relationshipBusy, setRelationshipBusy] = useState(false);
  const [relationshipNotice, setRelationshipNotice] = useState<string | null>(null);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const focusOnSearch = useMapFocus();
  // The impact indicators open over the map on request; the choice is kept on this computer.
  const [impactOpen, setImpactOpen] = useState(() => {
    try { return localStorage.getItem("openeoc.map.impactOpen") === "1"; } catch { return false; }
  });
  const openImpact = (open: boolean) => {
    setImpactOpen(open);
    try { localStorage.setItem("openeoc.map.impactOpen", open ? "1" : "0"); } catch { /* not kept */ }
  };

  const geoBoards = props.collections;
  const activeBoard = boardId || geoBoards[0]?.id || "";
  // A point dropped onto one of the selected incident's boards is contributed
  // to that incident; other boards stay jurisdiction-local. The form is read
  // in the same scope, so a partner who is not a member of the board's
  // jurisdiction gets it through the incident.
  const scopedIncident =
    props.incidentId && props.incidentBoardIds?.has(activeBoard) ? props.incidentId : undefined;
  const fieldScope = props.personId && scopedIncident ? { personId: props.personId, incidentId: scopedIncident } : null;
  // An incident board's form is read, and kept on the device, before a point
  // is placed, so it still opens once the connection is gone.
  const board = useAsync(
    () => ((adding || fieldScope) && activeBoard
      ? readKept(`board-shape:${props.personId ?? ""}:${activeBoard}:${scopedIncident ?? ""}`,
        () => props.client.getBoard(activeBoard, scopedIncident))
      : Promise.resolve(null)),
    [adding, activeBoard, scopedIncident, props.personId],
  );

  const feedLayers = props.feeds.filter((f) => f.enabled).map((f) => ({ id: f.id, title: f.name }));
  // Onboarded datasets (VEOC-79C2) ride the read-only feed-layer path: an
  // available or stale dataset renders as a COP layer whose features are its
  // persisted items, with the shared inspect popup and staleness treatment.
  // ponytail: reuse the feed layer path rather than a parallel dataset stack;
  // a dedicated dataset legend is a later styling refinement.
  const datasets = useAsync(
    () => (props.incidentId ? props.client.listIncidentDatasets(props.incidentId) : Promise.resolve([])),
    [props.incidentId],
  );
  const incidentArea = useAsync(
    () => (props.incidentId && typeof props.client.getIncidentArea === "function"
      ? props.client.getIncidentArea(props.incidentId)
      : Promise.resolve(null)),
    [props.incidentId],
  );
  const lifelineAssessments = useAsync(
    () => props.incidentId && typeof props.client.listIncidentLifelineAssessments === "function"
      ? props.client.listIncidentLifelineAssessments(props.incidentId)
      : Promise.resolve(null),
    [props.incidentId],
  );
  const esfAssessments = useAsync(
    () => props.incidentId && typeof props.client.listIncidentEsfAssessments === "function"
      ? props.client.listIncidentEsfAssessments(props.incidentId)
      : Promise.resolve(null),
    [props.incidentId],
  );
  const relationships = useAsync(
    () => props.incidentId && typeof props.client.listOperationalRelationships === "function"
      ? props.client.listOperationalRelationships(props.incidentId)
      : Promise.resolve([] as readonly OperationalRelationship[]),
    [props.client, props.incidentId],
  );
  const areaBbox = geometryBounds(incidentArea.data?.geometry ?? null);
  const mapDatasets = (datasets.data ?? []).filter(
    (d) => d.availability === "available" || d.availability === "stale",
  );
  const datasetLayers = mapDatasets.map((d) => ({
    id: d.id,
    title: d.name,
    kind: d.key === FEMA_NFHL_DATASET_KEY ? "fema-flood" as const : "standard" as const,
    coverage: d.coverageArea === null
      ? "Coverage unknown: mapped panel coverage was not supplied"
      : areaBbox
        ? "Configured source coverage; retrieval clipped to the selected incident area"
        : "Configured source coverage; no incident area is selected",
    attribution: d.key === FEMA_NFHL_DATASET_KEY ? FEMA_NFHL_ATTRIBUTION : undefined,
  }));
  const datasetIds = new Set(mapDatasets.map((d) => d.id));
  // A parcel layer is drawn from vector tiles at once: one page of items for
  // the layer panel, rather than tens of thousands of features first.
  const tilesFirst = new Set(mapDatasets.filter((d) => CALIFORNIA_CATALOG.some((source) =>
    source.category === "parcels_buildings" && source.id.replace(/-/g, "_") === d.key)).map((d) => d.id));
  const datasetById = new Map(mapDatasets.map((d) => [d.id, d]));
  const feedAndDatasetLayers = [...feedLayers, ...datasetLayers];
  const empty = geoBoards.length === 0 && feedAndDatasetLayers.length === 0;
  // A dataset with nothing to draw is named with its state, so a missing layer never reads as no data.
  const missing = datasets.error
    ? `Incident datasets could not be loaded: ${datasets.error}`
    : (datasets.data ?? []).filter((d) => d.availability === "awaiting" || d.availability === "unavailable")
      .map((d) => `${d.name} (${d.availability === "awaiting" ? "no data received yet" : d.reason ?? "source unavailable"})`).join("; ");
  const assessmentSources: ReadonlyArray<{ readonly value: string; readonly label: string; readonly source: AssessmentSource }> = [
    ...(lifelineAssessments.data?.states ?? []).filter((state) => state.reports.length > 0).map((state) => {
      const source: AssessmentSource = {
        domain: "lifeline",
        framework: LIFELINE_DEFINITION.framework,
        definitionKey: state.lifeline,
      };
      return {
        source,
        value: sourceValue(source),
        label: `Lifeline: ${LIFELINE_LABELS[state.lifeline as keyof typeof LIFELINE_LABELS] ?? state.lifeline.replaceAll("_", " ")}`,
      };
    }),
    ...(esfAssessments.data?.states ?? []).filter((state) => state.reports.length > 0).map((state) => {
      const source: AssessmentSource = {
        domain: "esf",
        framework: state.framework,
        definitionKey: state.esf,
      };
      return { source, value: sourceValue(source), label: esfSourceLabel(state.framework, state.esf) };
    }),
  ];
  const selectedFeatureLinks = selectedFeature ? (relationships.data ?? []).filter((link) =>
    link.target.kind === "map_feature"
    && link.target.datasetId === selectedFeature.datasetId
    && link.target.featureId === selectedFeature.featureId,
  ) : [];

  const reset = () => {
    setAdding(false);
    setPoint(null);
    setLongitude("");
    setLatitude("");
    setCoordinateError(null);
    setError(null);
  };

  const placePoint = (coordinates: [number, number]) => {
    setPoint(coordinates);
    setLongitude(String(coordinates[0]));
    setLatitude(String(coordinates[1]));
    setCoordinateError(null);
  };

  const useCoordinates = () => {
    const longitudeValue = Number(longitude);
    const latitudeValue = Number(latitude);
    if (
      longitude.trim() === ""
      || latitude.trim() === ""
      || !Number.isFinite(longitudeValue)
      || !Number.isFinite(latitudeValue)
      || longitudeValue < -180
      || longitudeValue > 180
      || latitudeValue < -90
      || latitudeValue > 90
    ) {
      setCoordinateError(
        "Enter finite WGS84 coordinates: longitude from -180 to 180 and latitude from -90 to 90.",
      );
      return;
    }
    placePoint([longitudeValue, latitudeValue]);
  };

  const updateImpactBounds = useCallback((bounds: CopMapBounds) => {
    const next = stableBounds(bounds);
    setImpactBounds((current) => boundsKey(current) === boundsKey(next) ? current : next);
  }, []);

  /** Keep the point in the device's field queue, and send it if the device is online. */
  const queuePoint = async (scope: { personId: string; incidentId: string }, data: Record<string, unknown>) => {
    const queue = await FieldSubmissionQueue.open();
    try {
      await queue.enqueue(scope, activeBoard, crypto.randomUUID(), data);
      const kept = workStateText({ kind: "queued", savedAt: new Date().toISOString() });
      if (!navigator.onLine) return kept;
      const result = await queue.sync(scope, props.client.fieldSyncToken());
      if (result.receipt?.late || result.phase === "conflict") return result.message;
      return result.phase === "synced" ? "Point saved." : kept;
    } finally {
      queue.close();
    }
  };

  const save = (data: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    // Connected, the point is written at once and the form hears any refusal;
    // with no connection it waits in the field queue instead.
    const saved = fieldScope && !navigator.onLine
      ? queuePoint(fieldScope, data)
      : props.client.createRecord(activeBoard, data, scopedIncident).then(() => "Point saved.", (reason: unknown) => {
        if (fieldScope && noConnection(reason)) return queuePoint(fieldScope, data);
        throw reason;
      });
    saved
      .then((message) => {
        reset();
        setNotice(message);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const linkSelectedFeature = () => {
    if (!props.incidentId || !selectedFeature || !relationshipSource) return;
    const source = assessmentSources.find((candidate) => candidate.value === relationshipSource)?.source;
    if (!source) return;
    setRelationshipBusy(true);
    setRelationshipError(null);
    setRelationshipNotice(null);
    void props.client.createOperationalRelationship(props.incidentId, {
      source,
      target: {
        kind: "map_feature",
        datasetId: selectedFeature.datasetId,
        featureId: selectedFeature.featureId,
      },
    }).then(() => {
      setRelationshipNotice(`Linked ${selectedFeature.title} to the selected assessment.`);
      relationships.reload();
    }).catch((cause: unknown) => {
      setRelationshipError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => setRelationshipBusy(false));
  };

  const fields = board.data?.fields ?? [];
  const geomKey = fields.length ? geometryFieldKey(fields) : null;

  // The map fills the screen; its tools and the new record form float over
  // its top left, and the impact indicators over its foot.
  const floating = (
    <div className="map-surface-float">
      {geoBoards.length > 0 ? (
        <div className="map-surface-tools">
          <Button kind={adding ? "primary" : "quiet"} onClick={() => { setNotice(null); if (adding) reset(); else setAdding(true); }}>
            <Icon name={adding ? "close" : "add"} size={16} decorative />
            {adding ? "Cancel" : "Add point"}
          </Button>
        </div>
      ) : null}
      {notice ? <p role="status" className="map-surface-card map-surface-notice">{notice}</p> : null}
      {adding ? (
        <div className="map-surface-card map-surface-adding">
          <label className="map-surface-pick">
            <span>Board</span>
            <select
              aria-label="Map record board"
              value={activeBoard}
              onChange={(e) => {
                setBoardId(e.target.value);
                setPoint(null);
                setCoordinateError(null);
              }}
              className="map-surface-select"
            >
              {geoBoards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
          <div className="map-surface-coordinates">
            <label className="map-surface-coordinate">
              <span>Longitude</span>
              <input
                aria-label="Longitude"
                inputMode="decimal"
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
                className="map-surface-select is-coordinate"
              />
            </label>
            <label className="map-surface-coordinate">
              <span>Latitude</span>
              <input
                aria-label="Latitude"
                inputMode="decimal"
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
                className="map-surface-select is-coordinate"
              />
            </label>
            <Button onClick={useCoordinates}>Use coordinates</Button>
          </div>
          <p className="map-surface-note">
            {point ? "Point placed. Fill the form, then save." : "Click the map or enter coordinates to place the point."}
          </p>
          {coordinateError ? (
            <p role="alert" className="eoc-text-critical map-surface-note">{coordinateError}</p>
          ) : null}
        </div>
      ) : null}
      {adding && point ? (
        <div className="map-surface-card">
          <Panel title="New map record">
            {board.loading && !board.data ? <Loading label="Loading form…" /> : null}
            {board.error ? (
              <p role="alert" className="map-surface-error">
                The form for {geoBoards.find((b) => b.id === activeBoard)?.title ?? "this board"} could not be loaded: {board.error}
              </p>
            ) : null}
            {board.data ? (
              geomKey ? (
                <RecordForm
                  fields={fields}
                  initial={{ [geomKey]: { type: "Point", coordinates: point } }}
                  onSubmit={save}
                  onUpload={(file) => uploadPickedFile(props.client, props.jurisdictionId, file)}
                />
              ) : (
                <p className="eoc-muted">This board has no location field.</p>
              )
            ) : null}
            {error ? (
              <p role="alert" className="map-surface-error">
                {error}
              </p>
            ) : null}
            <div className="map-surface-actions">
              <Button onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  );

  // Linking the selected dataset feature to an assessment sits in the feature's
  // own panel, which on a narrow map would otherwise cover it.
  const linking = selectedFeature && props.incidentId ? (
    <section className="map-surface-link-section" aria-labelledby="map-surface-link-title">
      <h3 id="map-surface-link-title">Link selected dataset feature</h3>
      <div className="map-surface-link">
        <p className="map-surface-note map-surface-feature">
          Dataset feature {selectedFeature.featureId}. The relationship records context only and does not change assessment status or command authority.
        </p>
        <label className="map-surface-source">
          Recorded assessment
          <select aria-label="Recorded assessment" value={relationshipSource}
            onChange={(event) => setRelationshipSource(event.target.value)} className="map-surface-select">
            <option value="">Choose a Lifeline or ESF assessment</option>
            {assessmentSources.map((candidate) => <option key={candidate.value} value={candidate.value}>{candidate.label}</option>)}
          </select>
        </label>
        <Button kind="primary" disabled={!relationshipSource || relationshipBusy || assessmentSources.length === 0}
          onClick={linkSelectedFeature}>{relationshipBusy ? "Linking…" : "Link selected feature"}</Button>
      </div>
      {assessmentSources.length === 0 ? <p role="status">No recorded Lifeline or ESF assessment is available to link.</p> : null}
      {relationshipNotice ? <p role="status" className="eoc-text-success">{relationshipNotice}</p> : null}
      {relationshipError ? <p role="alert" className="eoc-text-critical">{relationshipError}</p> : null}
      {relationships.error ? <p role="status">Existing assessment links are unavailable.</p> : (
        <section aria-label="Existing assessment links">
          <h3 className="map-surface-links-title">Existing assessment links</h3>
          {selectedFeatureLinks.length ? <ul className="map-surface-links">
            {selectedFeatureLinks.map((link) => <li key={link.id} className="map-surface-row">
              <span>{relationshipSourceLabel(link)}</span>
              {link.source.domain === "lifeline" && props.onOpenLifeline
                ? <Button onClick={() => props.onOpenLifeline!(link.source.definitionKey)}>Open linked Lifeline</Button>
                : link.source.domain === "esf" && props.onOpenEsf
                  ? <Button onClick={() => props.onOpenEsf!(link.source.definitionKey)}>Open linked ESF</Button>
                  : null}
            </li>)}
          </ul> : <p className="eoc-flush eoc-muted">No recorded assessment links for this feature.</p>}
        </section>
      )}
    </section>
  ) : null;

  const impact = props.incidentId ? (
    <div className="map-surface-impact" data-open={impactOpen || undefined}>
      <button type="button" className="map-surface-impact-toggle" aria-expanded={impactOpen} onClick={() => openImpact(!impactOpen)}>
        <Icon name="chevronRight" size={16} decorative />
        Impact in view
      </button>
      {impactOpen ? <ImpactKpiPanel client={props.client} incidentId={props.incidentId} bbox={impactBounds} /> : null}
    </div>
  ) : null;

  return (
    <div className="map-surface">
      {empty ? <EmptyState label={missing ? "No operational layer can be shown" : "No operational layers yet"}
        hint={missing ? `The basemap is available. Not on the map: ${missing}.` : "The basemap is available. Add a geo-enabled board or feed to show incident information."} /> : null}
      {!empty && missing ? <p className="map-surface-missing" role="status">Not on the map: {missing}.</p> : null}
      <div className="map-surface-map">
        <PlaceSearch client={props.client} onChoose={requestMapFocus} />
        <CopMap
          key={JSON.stringify([props.jurisdictionId, props.incidentId ?? null, props.theme, areaBbox, geoBoards.map((b) => b.id), feedAndDatasetLayers.map((f) => f.id), props.focusDatasetId ?? null, props.focusFeatureId ?? null, props.focusRecord?.recordId ?? null])}
          theme={props.theme}
          boards={geoBoards.map((c) => ({ id: c.id, title: c.title, templateKey: c.templateKey }))}
          incidentArea={incidentArea.data?.geometry ? { geometry: incidentArea.data.geometry } : null}
          fetchItems={(id) => props.client.collectionItems(id)}
          tileUrl={(kind, id) => kind === "board"
            ? `/api/v1/tiles/boards/${id}/{z}/{x}/{y}.mvt`
            : datasetIds.has(id) ? `/api/v1/tiles/datasets/${id}/{z}/{x}/{y}.mvt` : undefined}
          tileHeaders={() => ({ authorization: `Bearer ${props.client.fieldSyncToken()}` })}
          describePoint={(at) => props.client.reverseGeocode(at)}
          feeds={feedAndDatasetLayers}
          fetchFeedItems={(id) =>
            datasetIds.has(id)
              ? props.client.datasetItemsInArea(
                  id,
                  id === props.focusDatasetId ? undefined : areaBbox ?? undefined,
                  tilesFirst.has(id) ? { maxPages: 1 } : {},
                ).then((fc) => ({
                  ...fc,
                  feed: {
                    name: datasetById.get(id)!.name,
                    stale: datasetById.get(id)!.availability === "stale",
                    ageSeconds: ageSeconds(datasetById.get(id)!.lastSuccessAt),
                    incomplete: fc.incomplete,
                    tiled: tilesFirst.has(id),
                    coverage: datasetLayers.find((layer) => layer.id === id)?.coverage,
                    attribution: datasetLayers.find((layer) => layer.id === id)?.attribution,
                  },
                }))
              : props.client.feedItems(id)
          }
          basemap={{ kind: "natural-earth", assetBase: assetBase() }}
          bundledBasemap={{ assetBase: assetBase() }}
          basemapStyleUrl={basemapStyleUrl()}
          streetBasemap={streetBasemap()}
          rasterBasemaps={rasterBasemaps()}
          terrain={terrainSource()}
          buildings={buildingsSource()}
          jurisdictionOverlays={jurisdictionOverlays()}
          initialBounds={areaBbox ?? jurisdictionMapBounds()}
          inspectionMode="workspace"
          requestedFeature={props.focusDatasetId && props.focusFeatureId
            ? { datasetId: props.focusDatasetId, featureId: props.focusFeatureId }
            : null}
          requestedRecord={props.focusRecord ?? null}
          onOpenRecord={props.onOpenRecord}
          onInspectFeature={(feature) => {
            setRelationshipNotice(null);
            setRelationshipError(null);
            setSelectedFeature(feature && datasetIds.has(feature.datasetId) ? feature : null);
          }}
          exportContext={{
            incidentName: props.incidentName ?? null,
            operationalPeriod: props.operationalPeriod ?? null,
            handling: props.handlingMarking ?? null,
          }}
          onBoundsChange={updateImpactBounds}
          picking={adding && !point}
          onPickPoint={placePoint}
          onMap={focusOnSearch}
          overlay={<>{floating}{impact}</>}
          inspectorExtra={linking}
        />
      </div>
    </div>
  );
}
