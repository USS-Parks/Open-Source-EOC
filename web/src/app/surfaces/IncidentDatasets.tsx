import { useState } from "react";
import type { CatalogEntryStatus, DataPackDataset, DatasetStatus, FieldMapping } from "@openeoc/shared";
import { Button, EnumSelect, Panel, TextField } from "../../design/components.js";
import { Icon } from "../../design/icons/index.js";
import { DatasetCatalog } from "../../datasets/DatasetCatalog.js";
import { DatasetReadiness } from "../../datasets/DatasetReadiness.js";
import { MappingPreview } from "../../datasets/MappingPreview.js";
import "../../datasets/datasets.css";
import type { ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { EmptyState, ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

const KINDS = ["geojson", "cap", "georss", "cot", "table"] as const;
const FRESHNESS = ["900", "3600", "21600", "86400", "604800"] as const;
const FRESHNESS_LABELS = { "900": "15 minutes", "3600": "1 hour", "21600": "6 hours", "86400": "1 day", "604800": "7 days" };
type MappingDraft = Record<keyof FieldMapping, string>;
const EMPTY_MAPPING: MappingDraft = { title: "properties.name", category: "", severity: "", occurredAt: "", status: "", note: "", sourceId: "properties.id", geometry: "geometry" };

/**
 * Datasets a participating organization has onboarded into the selected
 * incident (VEOC-79C). Each row shows its source owner, availability and
 * coverage. A source that has not loaded or has failed reads as awaiting or
 * unavailable with a dash for its count, never as zero.
 */
export function IncidentDatasets(props: {
  client: ApiClient;
  incidentId: string | null;
  canManage: boolean;
}) {
  const active = props.incidentId;
  const datasets = useAsync(
    () => (active ? props.client.listIncidentDatasets(active) : Promise.resolve([] as DatasetStatus[])),
    [active],
  );
  const catalog = useAsync(
    () => (active ? props.client.incidentCatalog(active) : Promise.resolve([] as CatalogEntryStatus[])),
    [active],
  );
  const [onboarding, setOnboarding] = useState<string | null>(null);
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("geojson");
  const [url, setUrl] = useState("");
  const [freshness, setFreshness] = useState("3600");
  const [coverageMode, setCoverageMode] = useState("unknown");
  const [bounds, setBounds] = useState({ west: "", south: "", east: "", north: "" });
  const [mapping, setMapping] = useState<MappingDraft>(EMPTY_MAPPING);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [loadTarget, setLoadTarget] = useState("");
  const [loadFile, setLoadFile] = useState<File | null>(null);

  if (!active)
    return (
      <EmptyState
        label="No incident selected."
        hint="Choose an incident in the command bar to inspect its source readiness."
      />
    );
  if (datasets.error && !datasets.data) return <ErrorNote message={datasets.error} />;

  const fieldMapping = mappingValue(mapping);
  const register = () => {
    setBusy(true);
    setError(null);
    setNotice("");
    let coverage: Record<string, unknown> | undefined;
    try {
      if (!name.trim() || !organizationSlug.trim() || !key.trim() || !datasetName.trim()) throw new Error("Complete the pack, owner, key and dataset name.");
      if (!fieldMapping.title && !fieldMapping.category && !fieldMapping.severity && !fieldMapping.occurredAt && !fieldMapping.status && !fieldMapping.note) throw new Error("Map at least one operational field.");
      coverage = coverageMode === "bbox" ? coverageValue(bounds) : undefined;
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    const dataset: DataPackDataset = {
      key: key.trim(), name: datasetName.trim(), kind,
      ...(url.trim() ? { url: url.trim() } : {}), fieldMapping,
      ...(coverage ? { coverage } : {}), staleAfterSeconds: Number(freshness),
    };
    props.client
      .registerDataPack(active, {
        name: name.trim(),
        organizationSlug: organizationSlug.trim(),
        datasets: [
          {
            ...dataset,
          },
        ],
      })
      .then(() => {
        setName("");
        setKey("");
        setDatasetName("");
        setUrl("");
        setNotice("Source registered. It remains awaiting ingestion until a successful update is accepted.");
        datasets.reload();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const loadable = datasets.data ?? [];
  const target = loadable.some((d) => d.id === loadTarget) ? loadTarget : loadable[0]?.id ?? "";
  const loadRecords = () => {
    setBusy(true);
    setError(null);
    setNotice("");
    (async () => {
      if (!target || !loadFile) throw new Error("Choose a dataset and a records file.");
      const result = await props.client.loadDataset(target, recordsFromJson(await loadFile.text()));
      setNotice(`${result.accepted} of ${result.received} records accepted, ${result.rejected} rejected.`);
      datasets.reload();
    })()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const onboardSource = (sourceId: string) => {
    if (!active) return;
    setOnboarding(sourceId);
    setError(null);
    props.client
      .onboardCatalogSource(active, sourceId)
      .then(() => {
        catalog.reload();
        datasets.reload();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setOnboarding(null));
  };

  return (
    <Scroll>
      <SurfaceHeader title="Datasets" />
      <div className="d21-workspace">
        <div className="d21-workspace-intro">
          <Icon name="datasets" size={32} decorative />
          <div><strong>Incident source readiness</strong><span>Registration, successful ingestion and current usability are separate states. Stale or failed updates retain and label the last-good data.</span></div>
        </div>
        {error ? <p className="d21-error" role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {props.canManage ? (
          <Panel title="Register a source">
            <div className="d21-form-grid">
              <TextField label="Pack name" value={name} onChange={setName} required />
              <TextField label="Owning organization code" value={organizationSlug} onChange={setOrganizationSlug} required />
              <TextField label="Dataset key" value={key} onChange={setKey} required />
              <TextField label="Dataset name" value={datasetName} onChange={setDatasetName} required />
              <EnumSelect label="Format" values={KINDS} value={kind} onChange={(value) => setKind(value as (typeof KINDS)[number])} />
              <EnumSelect label="Freshness window" values={FRESHNESS} labels={FRESHNESS_LABELS} value={freshness} onChange={setFreshness} />
              <div className="d21-form-grid-wide"><TextField label="Source URL (optional)" value={url} onChange={setUrl} /></div>
              <fieldset className="d21-form-section">
                <legend>Coverage</legend>
                <EnumSelect label="Coverage definition" values={["unknown", "bbox"]} labels={{ unknown: "Not supplied", bbox: "WGS84 bounding box" }} value={coverageMode} onChange={setCoverageMode} />
                {coverageMode === "bbox" ? <div className="d21-form-section-grid">
                  {(["west", "south", "east", "north"] as const).map((direction) => (
                    <TextField key={direction} label={direction[0]!.toUpperCase() + direction.slice(1)} value={bounds[direction]} onChange={(value) => setBounds((current) => ({ ...current, [direction]: value }))} />
                  ))}
                </div> : <p className="d21-muted">Coverage will remain explicitly unknown.</p>}
              </fieldset>
              <fieldset className="d21-form-section">
                <legend>Field mapping</legend>
                <div className="d21-form-section-grid">
                  {(Object.keys(EMPTY_MAPPING) as Array<keyof FieldMapping>).map((field) => (
                    <TextField key={field} label={mappingLabel(field)} value={mapping[field]} onChange={(value) => setMapping((current) => ({ ...current, [field]: value }))} />
                  ))}
                </div>
                <MappingPreview mapping={fieldMapping} emptyLabel="Enter a source path for at least one operational field." />
              </fieldset>
            </div>
            <div className="d21-toolbar">
              <span className="d21-muted">This registers the source and mapping. It does not claim that ingestion succeeded.</span>
              <Button kind="primary" onClick={register} disabled={busy}>{busy ? "Registering…" : "Register source"}</Button>
            </div>
          </Panel>
        ) : null}

        <Panel title="California data catalog">
          <p className="d21-muted">Coverage and adapter availability determine whether a registry entry can be added. Registered entries still await a successful ingest.</p>
          {catalog.loading && !catalog.data ? <Loading label="Loading source catalog…" /> : null}
          {catalog.error ? <ErrorNote message={catalog.error} /> : null}
          <DatasetCatalog sources={catalog.data ?? []} canManage={props.canManage} onboarding={onboarding} onOnboard={onboardSource} />
        </Panel>

        {props.canManage && loadable.length > 0 ? (
          <Panel title="Load records">
            <div className="d21-form-grid">
              <EnumSelect label="Dataset to load" values={loadable.map((d) => d.id)} value={target} onChange={setLoadTarget}
                labels={Object.fromEntries(loadable.map((d) => [d.id, `${d.name} (${d.organizationName})`]))} />
              <label className="d21-field">Records file
                <input type="file" accept=".json,.geojson,application/json,application/geo+json"
                  onChange={(event) => setLoadFile(event.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="d21-toolbar">
              <span className="d21-muted">A GeoJSON FeatureCollection or a list of source records. A load replaces the dataset's items with the file's records, mapped by its field mapping; at most 10,000 records per load.</span>
              <Button kind="primary" onClick={loadRecords} disabled={busy}>Load records</Button>
            </div>
          </Panel>
        ) : null}

        <Panel title="Ingestion readiness">
          {datasets.loading && !datasets.data ? <Loading label="Loading dataset readiness…" /> : null}
          {datasets.error && datasets.data ? <ErrorNote message={datasets.error} /> : null}
          <DatasetReadiness datasets={datasets.data ?? []} loading={datasets.loading} onRefresh={datasets.reload} />
        </Panel>
      </div>
    </Scroll>
  );
}

/** Records from a JSON file: an array, a GeoJSON FeatureCollection's features, or a `records` array. */
export function recordsFromJson(text: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The records file is not valid JSON.");
  }
  if (Array.isArray(value)) return value;
  const holder = value && typeof value === "object" ? value as { features?: unknown; records?: unknown } : {};
  if (Array.isArray(holder.features)) return holder.features;
  if (Array.isArray(holder.records)) return holder.records;
  throw new Error("The records file must hold an array of records, a GeoJSON FeatureCollection or a records array.");
}

function mappingValue(draft: MappingDraft): FieldMapping {
  return Object.fromEntries(
    Object.entries(draft).flatMap(([field, value]) => value.trim() ? [[field, value.trim()]] : []),
  ) as FieldMapping;
}

function mappingLabel(field: keyof FieldMapping): string {
  return ({
    title: "Title path",
    category: "Category path",
    severity: "Severity path",
    occurredAt: "Occurred-at path",
    status: "Status path",
    note: "Note path",
    sourceId: "Source ID path",
    geometry: "Geometry path",
  })[field];
}

function coverageValue(value: {
  west: string;
  south: string;
  east: string;
  north: string;
}): Record<string, unknown> {
  if ([value.west, value.south, value.east, value.north].some((coordinate) => coordinate.trim() === "")) {
    throw new Error("Enter all four coverage coordinates.");
  }
  const west = Number(value.west);
  const south = Number(value.south);
  const east = Number(value.east);
  const north = Number(value.north);
  if (
    ![west, south, east, north].every(Number.isFinite) || west < -180 || east > 180 ||
    south < -90 || north > 90 || west >= east || south >= north
  ) {
    throw new Error("Coverage must be ordered west, south, east and north WGS84 coordinates.");
  }
  return {
    type: "Polygon",
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  };
}
