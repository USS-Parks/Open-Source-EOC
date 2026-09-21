import { useState } from "react";
import type { CatalogEntryStatus, DatasetStatus } from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField, type Status } from "../../design/components.js";
import type { ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { EmptyState, ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

const AVAILABILITY_TONE: Record<DatasetStatus["availability"], Status> = {
  available: "success",
  stale: "warning",
  awaiting: "info",
  unavailable: "critical",
};
const AVAILABILITY_LABEL: Record<DatasetStatus["availability"], string> = {
  available: "Available",
  stale: "Stale",
  awaiting: "Awaiting first load",
  unavailable: "Unavailable",
};

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
  const [kind, setKind] = useState("geojson");
  const [url, setUrl] = useState("");
  const [titlePath, setTitlePath] = useState("properties.name");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  if (!active)
    return (
      <EmptyState
        label="No incident selected."
        hint="Choose an incident in the command bar to see the datasets its participants have onboarded."
      />
    );
  if (datasets.error && !datasets.data) return <ErrorNote message={datasets.error} />;

  const rows = datasets.data ?? [];
  const register = () => {
    setBusy(true);
    setError(null);
    setNotice("");
    props.client
      .registerDataPack(active, {
        name: name.trim(),
        organizationSlug: organizationSlug.trim(),
        datasets: [
          {
            key: key.trim(),
            name: datasetName.trim(),
            kind: kind as "geojson" | "cap" | "georss" | "cot" | "table",
            url: url.trim() || undefined,
            fieldMapping: { title: titlePath.trim() },
            staleAfterSeconds: 3600,
          },
        ],
      })
      .then(() => {
        setName("");
        setKey("");
        setDatasetName("");
        setUrl("");
        setNotice("Data pack onboarded. Its datasets appear below as they load.");
        datasets.reload();
      })
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
      <SurfaceHeader title="Incident datasets" />
      <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
        {props.canManage ? (
          <Panel title="Onboard a data pack">
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
              <TextField label="Pack name" value={name} onChange={setName} />
              <TextField label="Owning organization code" value={organizationSlug} onChange={setOrganizationSlug} />
              <TextField label="Dataset key" value={key} onChange={setKey} />
              <TextField label="Dataset name" value={datasetName} onChange={setDatasetName} />
              <EnumSelect
                label="Kind"
                values={["geojson", "cap", "georss", "cot", "table"]}
                value={kind}
                onChange={setKind}
              />
              <TextField label="Source URL (optional)" value={url} onChange={setUrl} />
              <TextField label="Title field path" value={titlePath} onChange={setTitlePath} />
            </div>
            <p style={{ margin: "8px 0 0", color: "var(--eoc-text-muted)" }}>
              The owning organization is the source. A dataset stays available even if the source is
              missing; it reads as unavailable, never as zero.
            </p>
            <div style={{ marginTop: 12 }}>
              <Button kind="primary" onClick={register} disabled={busy}>
                Onboard data pack
              </Button>
            </div>
            {notice ? <p role="status">{notice}</p> : null}
            {error ? (
              <p role="alert" style={{ color: "var(--eoc-status-critical)", margin: "8px 0 0" }}>
                {error}
              </p>
            ) : null}
          </Panel>
        ) : null}

        <Panel title="California data catalog">
          <p style={{ margin: "0 0 8px", color: "var(--eoc-text-muted)" }}>
            Documented California sources. An available source that covers this
            incident's area onboards without a code change; an uncovered area or a
            source without an open feed is shown as such, never as data.
          </p>
          {catalog.loading && !catalog.data ? <Loading label="Loading catalog…" /> : null}
          {catalog.error ? <ErrorNote message={catalog.error} /> : null}
          {catalog.data && catalog.data.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
              {catalog.data.map((s) => (
                <li
                  key={s.id}
                  style={{ border: "1px solid var(--eoc-border)", borderRadius: 4, padding: 12 }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <strong>{s.name}</strong>
                    <span style={{ color: "var(--eoc-text-muted)" }}>{s.owner}</span>
                    {s.onboarded ? <StatusBadge status="success">Onboarded</StatusBadge> : null}
                    {!s.available ? (
                      <StatusBadge status="critical">Named gap</StatusBadge>
                    ) : s.coversIncident ? (
                      <StatusBadge status="info">Covers area</StatusBadge>
                    ) : (
                      <StatusBadge status="warning">Outside area</StatusBadge>
                    )}
                  </div>
                  <p style={{ margin: "6px 0 0", color: "var(--eoc-text-muted)" }}>
                    {s.category.replace(/_/g, " ")} · {s.coverage.label} · {s.license}
                    {s.notes ? ` · ${s.notes}` : ""}
                  </p>
                  {props.canManage && s.available && !s.onboarded ? (
                    <div style={{ marginTop: 8 }}>
                      <Button
                        onClick={() => onboardSource(s.id)}
                        disabled={onboarding === s.id || !s.coversIncident}
                      >
                        {!s.coversIncident
                          ? "Not available here"
                          : onboarding === s.id
                            ? "Adding…"
                            : "Add to incident"}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel title="Onboarded datasets">
          {datasets.loading && !datasets.data ? <Loading label="Loading datasets…" /> : null}
          {datasets.data && rows.length === 0 ? (
            <p style={{ margin: 0, color: "var(--eoc-text-muted)" }}>
              No datasets onboarded yet. A participating organization's coordinator adds them here.
            </p>
          ) : null}
          {rows.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
              {rows.map((d) => (
                <li
                  key={`${d.organizationSlug}:${d.key}`}
                  style={{ border: "1px solid var(--eoc-border)", borderRadius: 4, padding: 12 }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <strong>{d.name}</strong>
                    <span style={{ color: "var(--eoc-text-muted)" }}>{d.organizationName}</span>
                    <StatusBadge status={AVAILABILITY_TONE[d.availability]}>
                      {AVAILABILITY_LABEL[d.availability]}
                    </StatusBadge>
                  </div>
                  <p style={{ margin: "6px 0 0", color: "var(--eoc-text-muted)" }}>
                    {d.kind} · items: {d.itemCount === null ? "—" : d.itemCount} ·{" "}
                    coverage: {d.coverageArea === null ? "unset" : "defined"}
                    {d.reason ? ` · ${d.reason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          <div style={{ marginTop: 12 }}>
            <Button onClick={() => datasets.reload()} disabled={datasets.loading}>
              Refresh
            </Button>
          </div>
        </Panel>
      </div>
    </Scroll>
  );
}
