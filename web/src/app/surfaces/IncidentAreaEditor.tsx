import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import { IncidentAreaGeometrySchema, IncidentAreaUpdateSchema, type IncidentAreaGeometry, type IncidentAreaRevision } from "@openeoc/shared";
import { CopMap } from "../../cop/CopMap.js";
import { geometryBounds } from "../../cop/tools.js";
import { Button, Panel, TextField } from "../../design/components.js";
import type { ThemeName } from "../../design/tokens.js";
import { ApiError, type ApiClient } from "../api/client.js";
import { assetBase, basemapStyleUrl, jurisdictionMapBounds, streetBasemap } from "../config.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading } from "../screens/parts.js";

type Coordinate = [number, number];
const EMPTY = async () => ({ type: "FeatureCollection" as const, features: [] });
const SOURCE = "incident-area-preview";
function localTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function IncidentAreaEditor(props: {
  client: ApiClient; incidentId: string; incidentName: string; theme: ThemeName; canEdit: boolean;
}) {
  const current = useAsync(() => props.client.getIncidentArea(props.incidentId), [props.incidentId]);
  const history = useAsync(() => props.client.incidentAreaHistory(props.incidentId), [props.incidentId]);
  const [snapshot, setSnapshot] = useState<IncidentAreaRevision | null>(null);
  const [geometry, setGeometry] = useState<IncidentAreaGeometry | null>(null);
  const [points, setPoints] = useState<Coordinate[]>([]);
  const [coordinate, setCoordinate] = useState({ longitude: "", latitude: "" });
  const [drawing, setDrawing] = useState(false);
  const [period, setPeriod] = useState({ label: "", start: "", end: "" });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importName, setImportName] = useState("");
  const [busy, setBusy] = useState(false);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [preview, setPreview] = useState<IncidentAreaRevision | null>(null);
  const [older, setOlder] = useState<IncidentAreaRevision[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const adopt = (value: IncidentAreaRevision) => {
    setSnapshot(value); setGeometry(value.geometry); setPoints([]); setDrawing(false); setPreview(null);
    setPeriod({ label: value.operationalPeriod?.label ?? "", start: localTime(value.operationalPeriod?.startsAt), end: localTime(value.operationalPeriod?.endsAt) });
    setReason(""); setError(null); setImportName("");
  };
  useEffect(() => { if (current.data) adopt(current.data); }, [current.data]);
  const shown = preview ? preview.geometry : geometry;
  const features: unknown[] = shown ? [{ type: "Feature", geometry: shown, properties: {} }] : [];
  if (!preview && points.length > 1) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: {} });
  if (!preview) for (const point of points) features.push({ type: "Feature", geometry: { type: "Point", coordinates: point }, properties: {} });
  const data = useRef({ type: "FeatureCollection", features });
  data.current = { type: "FeatureCollection", features };
  useEffect(() => {
    if (!map) return;
    const attach = () => {
      if (map.getSource(SOURCE)) return;
      map.addSource(SOURCE, { type: "geojson", data: data.current as never });
      map.addLayer({ id: SOURCE + "-fill", type: "fill", source: SOURCE, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#658cac", "fill-opacity": 0.16 } });
      map.addLayer({ id: SOURCE + "-line", type: "line", source: SOURCE, filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": "#658cac", "line-width": 3 } });
      map.addLayer({ id: SOURCE + "-points", type: "circle", source: SOURCE, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": "#658cac", "circle-radius": 5, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 } });
    };
    if (map.isStyleLoaded()) attach(); else map.once("load", attach);
    return () => { map.off("load", attach); };
  }, [map]);
  useEffect(() => { (map?.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(data.current as never); }, [map, geometry, points, preview]);

  const fit = (value: IncidentAreaGeometry | null) => {
    const bounds = geometryBounds(value);
    if (bounds) map?.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 40, maxZoom: 15 });
  };
  const finish = () => {
    const result = IncidentAreaGeometrySchema.safeParse({ type: "Polygon", coordinates: [[...points, points[0]]] });
    if (!result.success) { setError("Draw at least three distinct boundary points."); return; }
    setGeometry(result.data); setPoints([]); setDrawing(false); setError(null);
  };
  const addCoordinate = () => {
    if (!coordinate.longitude.trim() || !coordinate.latitude.trim()) {
      setError("Enter both longitude and latitude.");
      return;
    }
    const longitude = Number(coordinate.longitude);
    const latitude = Number(coordinate.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      setError("Enter longitude from -180 to 180 and latitude from -90 to 90.");
      return;
    }
    setDrawing(true);
    setPoints((existing) => existing.length < 9999 ? [...existing, [longitude, latitude]] : existing);
    setCoordinate({ longitude: "", latitude: "" });
    setError(null);
  };
  const importArea = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error("Choose an area file smaller than 1 MB.");
      const raw = JSON.parse(await file.text()) as { type?: string; geometry?: unknown };
      const result = IncidentAreaGeometrySchema.safeParse(raw?.type === "Feature" ? raw.geometry : raw);
      if (!result.success) throw new Error("Choose a GeoJSON Polygon or MultiPolygon with closed boundary rings and at most 10,000 points.");
      setGeometry(result.data); setPoints([]); setDrawing(false); setPreview(null); setError(null); setImportName(file.name); fit(result.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Cannot read the area file."); }
  };
  const save = async () => {
    if (!snapshot) return;
    setBusy(true); setError(null);
    try {
      const hasPeriod = Boolean(period.label || period.start || period.end);
      if (hasPeriod && !(period.label && period.start && period.end)) throw new Error("Enter the period name, start and end, or leave all three blank.");
      const input = IncidentAreaUpdateSchema.safeParse({ expectedRevision: snapshot.revision, geometry,
        operationalPeriod: hasPeriod ? { label: period.label, startsAt: new Date(period.start).toISOString(), endsAt: new Date(period.end).toISOString() } : null, reason });
      if (!input.success) throw new Error(input.error.issues[0]?.message ?? "Check the area and operational period.");
      adopt(await props.client.updateIncidentArea(props.incidentId, input.data)); setOlder([]); history.reload();
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 409
        ? "This incident changed or closed. Your draft is retained. Reload the current revision before saving again."
        : cause instanceof Error ? cause.message : "The area could not be saved.");
    } finally { setBusy(false); }
  };
  const revisions = [...(history.data ?? []), ...older];
  const loadOlder = async () => {
    const before = revisions.at(-1)?.revision;
    if (!before) return;
    setBusy(true);
    try { const rows = await props.client.incidentAreaHistory(props.incidentId, before); setOlder((existing) => [...existing, ...rows]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Cannot load prior revisions."); }
    finally { setBusy(false); }
  };

  if (current.error && !snapshot) return <ErrorNote message={current.error} />;
  if (!snapshot) return <Loading label="Loading incident area…" />;
  return <Panel title={props.incidentName + ": operational area"}>
    <div style={{ display: "grid", gap: 12 }}>
      <p style={{ margin: 0 }}>Revision {snapshot.revision}. {snapshot.geometry ? "An operational area is recorded." : "The operational area is not yet defined."} Geographic boundaries do not grant access or select participating organizations.</p>
      {preview ? <div role="status">Viewing revision {preview.revision}: {preview.reason}
        <Button onClick={() => { setPreview(null); fit(geometry); }}>Return to current draft</Button></div> : null}
      <div style={{ height: 480, minHeight: 320 }}>
        <CopMap key={props.theme} theme={props.theme} boards={[]} fetchItems={EMPTY}
          bundledBasemap={{ assetBase: assetBase() }} basemapStyleUrl={basemapStyleUrl()} streetBasemap={streetBasemap()}
          initialBounds={geometryBounds(snapshot.geometry) ?? jurisdictionMapBounds()}
          picking={drawing && !busy && !preview} onPickPoint={(point) => setPoints((existing) => existing.length < 9999 ? [...existing, point] : existing)}
          onMap={(value) => { value.doubleClickZoom.disable(); setMap(value); }} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button onClick={() => fit(shown)} disabled={!shown}>Focus area</Button>
        {props.canEdit && !preview ? <>
          <Button onClick={() => { setDrawing(true); setPoints([]); setError(null); }} disabled={busy || drawing}>Draw replacement boundary</Button>
          {drawing ? <>
            <Button onClick={() => setPoints((existing) => existing.slice(0, -1))} disabled={!points.length || busy}>Undo point</Button>
            <Button onClick={finish} disabled={points.length < 3 || busy}>Close boundary</Button>
            <Button onClick={() => { setDrawing(false); setPoints([]); }} disabled={busy}>Cancel drawing</Button>
          </> : null}
          <Button onClick={() => fileInput.current?.click()} disabled={busy}>Import area</Button>
          <input ref={fileInput} type="file" accept=".geojson,.json,application/geo+json,application/json" aria-label="Import operational area" onChange={(event) => void importArea(event)} hidden />
          <Button onClick={() => { setGeometry(null); setPoints([]); setDrawing(false); }} disabled={busy}>Mark area undefined</Button>
        </> : null}
      </div>
      {props.canEdit && !preview ? <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", alignItems: "end" }}>
        <TextField label="Longitude" value={coordinate.longitude} onChange={(longitude) => setCoordinate((value) => ({ ...value, longitude }))} />
        <TextField label="Latitude" value={coordinate.latitude} onChange={(latitude) => setCoordinate((value) => ({ ...value, latitude }))} />
        <Button onClick={addCoordinate} disabled={busy}>Add coordinate</Button>
        <p style={{ margin: 0, color: "var(--eoc-text-muted)", gridColumn: "1 / -1" }}>Enter boundary points in order when map input is impractical, then close the boundary. Coordinates use longitude, latitude.</p>
      </div> : null}
      {importName && !preview ? <p role="status">Imported area: {importName}. Save a revision to record it.</p> : null}
      {drawing ? <p role="status">Click boundary points on the map, then close the boundary. {points.length} points placed. The recorded area stays unchanged until you save.</p> : null}
      {props.canEdit && !preview ? <fieldset disabled={busy || current.loading} style={{ border: 0, padding: 0, display: "grid", gap: 12 }}>
        <TextField label="Operational period" value={period.label} onChange={(label) => setPeriod((p) => ({ ...p, label }))} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <label>Period starts <input type="datetime-local" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} /></label>
          <label>Period ends <input type="datetime-local" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} /></label>
        </div>
        <p style={{ margin: 0 }}>Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Leave all period fields blank if not yet established.</p>
        <TextField label="Reason for revision" value={reason} onChange={setReason} />
        <div style={{ display: "flex", gap: 8 }}>
          <Button kind="primary" onClick={() => void save()} disabled={busy || drawing || !reason.trim()}>Save area revision</Button>
          <Button onClick={() => current.reload()} disabled={busy || current.loading}>Reload current revision</Button>
        </div>
      </fieldset> : <p>{(preview ?? snapshot).operationalPeriod
        ? `${(preview ?? snapshot).operationalPeriod!.label}: ${new Date((preview ?? snapshot).operationalPeriod!.startsAt).toLocaleString()} to ${new Date((preview ?? snapshot).operationalPeriod!.endsAt).toLocaleString()}`
        : "Operational period not yet established"}</p>}
      {error ? <p role="alert">{error}</p> : null}
      {current.error && snapshot ? <ErrorNote message={current.error} /> : null}
      <h3 style={{ marginBottom: 0 }}>Revision history</h3>
      {history.error ? <ErrorNote message={history.error} /> : null}
      {revisions.length === 0 ? <p>No area revisions yet.</p> : <ol style={{ paddingLeft: 24 }}>
        {revisions.map((revision) => <li key={revision.revision} style={{ marginBottom: 10 }}>
          <Button onClick={() => { setPreview(revision); setDrawing(false); setPoints([]); fit(revision.geometry); }}>View revision {revision.revision}</Button>
          {" "}{revision.reason} · {revision.createdByName ?? "Operator"}{revision.homeOrganizationName ? " / " + revision.homeOrganizationName : ""}
          {(revision.incidentPositionTitle ?? revision.positionTitle) ? " / " + (revision.incidentPositionTitle ?? revision.positionTitle) : ""}
          {revision.createdAt ? " · " + new Date(revision.createdAt).toLocaleString() : ""}
        </li>)}
      </ol>}
      {revisions.length >= 50 && (revisions.at(-1)?.revision ?? 0) > 1 ? <Button onClick={() => void loadOlder()} disabled={busy}>Load older revisions</Button> : null}
    </div>
  </Panel>;
}
