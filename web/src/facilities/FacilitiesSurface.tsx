import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { EMS_TRAFFIC_STATUS, FACILITY_KINDS, FACILITY_OPERATING_STATUS } from "@openeoc/shared";
import { CopMap } from "../cop/CopMap.js";
import { EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import { ActionButton } from "../design/controls.js";
import { Icon } from "../design/icons/index.js";
import { BoardTable } from "../design/layout.js";
import type { ThemeName } from "../design/tokens.js";
import type { ApiClient } from "../app/api/client.js";
import { assetBase, basemapStyleUrl, jurisdictionMapBounds, streetBasemap } from "../app/config.js";
import { useAsync } from "../app/data/hooks.js";
import { Scroll, SurfaceHeader } from "../app/screens/parts.js";
import { saveFile } from "../admin/labels.js";
import "../datasets/datasets.css";
import "./facilities.css";
import {
  EMS_LABELS,
  KIND_LABELS,
  OPERATING_BADGE,
  OPERATING_LABELS,
  bedLabel,
  bedTypesFor,
  facilityBounds,
  facilityFeatures,
  freshness,
  kindLabel,
  operatingLabel,
  parseBeds,
  shelterCounts,
  windowLabel,
  type BedDraft,
  type FacilityBoardRow,
} from "./model.js";

/**
 * Facilities and shelters for one jurisdiction: the registry, the status
 * board with each facility's freshness, hospital bed availability as
 * EDXL-HAVE carries it, shelter capacity and the facilities on the map.
 * The facilities integration must be on; the console hides this screen
 * otherwise.
 */
export function FacilitiesSurface(props: {
  client: ApiClient;
  jurisdictionId: string;
  theme: ThemeName;
  canWrite: boolean;
}) {
  // Every change bumps the revision so the board, map and tables read again.
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision((n) => n + 1), []);
  const board = useAsync(() => props.client.facilityBoard(props.jurisdictionId), [props.jurisdictionId, revision]);
  // The last answer stays on screen while the board reloads, so forms and the map keep their state.
  const loaded = useRef<{ jurisdictionId: string; rows: readonly FacilityBoardRow[] } | null>(null);
  if (board.data) loaded.current = { jurisdictionId: props.jurisdictionId, rows: board.data };
  const current = loaded.current?.jurisdictionId === props.jurisdictionId ? loaded.current.rows : null;
  const rows = current ?? [];
  const common = { client: props.client, jurisdictionId: props.jurisdictionId, rows, onChanged: changed };
  return (
    <Scroll>
      <SurfaceHeader title="Facilities and shelters" />
      <div className="d21-workspace facilities-workspace">
        <div className="d21-workspace-intro">
          <Icon name="lifelines" size={32} decorative />
          <div>
            <strong>Facility status network</strong>
            <span>Each facility reports its operating status, EMS traffic and bed or shelter counts. A facility turns stale when no report arrives within its reporting window.</span>
          </div>
        </div>
        <Panel title="Status board">
          <div className="facilities-toolbar">
            <span className="d21-muted" role="status">
              {current ? `${rows.length} ${rows.length === 1 ? "facility" : "facilities"}, ${rows.filter((r) => freshness(r).label !== "Current").length} stale or not yet reported.`
                : board.error ?? "Loading the status board…"}
            </span>
            <ActionButton kind="quiet" onClick={changed}>Refresh</ActionButton>
          </div>
          {board.error ? <p className="d21-error" role="alert">{board.error}</p> : null}
          {current && rows.length === 0 ? <p className="d21-callout">No facilities are registered yet. Register one under Registry.</p> : null}
          {rows.length ? <StatusTable rows={rows} /> : null}
        </Panel>
        {/* The panels wait for the first answer so an empty list never stands in for one not yet read. */}
        {current ? <>
          {props.canWrite && rows.length ? <ReportPanel {...common} /> : null}
          {props.canWrite && rows.length ? <StatusRequestPanel {...common} revision={revision} /> : null}
          <HavePanel {...common} />
          <ShelterPanel rows={rows} />
        </> : null}
        <MapPanel rows={rows} ready={Boolean(current || board.error)} theme={props.theme} />
        {current ? <RegistryPanel {...common} canWrite={props.canWrite} /> : null}
      </div>
    </Scroll>
  );
}

type PanelProps = { client: ApiClient; jurisdictionId: string; rows: readonly FacilityBoardRow[]; onChanged: () => void };

/** Busy flag, one notice or error, and a runner that sets them. */
function useRun(): { busy: boolean; run: (operation: () => Promise<string>) => Promise<void>; feedback: ReactNode } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const run = async (operation: () => Promise<string>) => {
    setBusy(true); setError(null); setNotice("");
    try { setNotice(await operation()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The request failed."); }
    finally { setBusy(false); }
  };
  const feedback = <>
    {error ? <p className="d21-error" role="alert">{error}</p> : null}
    {notice ? <p className="facilities-notice" role="status">{notice}</p> : null}
  </>;
  return { busy, run, feedback };
}

const reported = (row: FacilityBoardRow): string => row.lastUpdate ? new Date(row.lastUpdate).toLocaleString() : "Never";

function StatusCell(props: { status: string }) {
  return <StatusBadge status={OPERATING_BADGE[props.status] ?? "unknown"}>{operatingLabel(props.status)}</StatusBadge>;
}

function FreshnessCell(props: { row: FacilityBoardRow }) {
  const f = freshness(props.row);
  return <StatusBadge status={f.status}>{f.label}</StatusBadge>;
}

function StatusTable(props: { rows: readonly FacilityBoardRow[] }) {
  return (
    <div className="facilities-table">
      <BoardTable caption="Current status by facility"
        columns={["Facility", "Type", "Operating status", "EMS traffic", "Last report", "Freshness"]}
        rows={props.rows.map((row) => [
          row.organizationName, kindLabel(row.facilityKind), <StatusCell status={row.operatingStatus} />,
          EMS_LABELS[row.emsTraffic ?? ""] ?? row.emsTraffic, reported(row), <FreshnessCell row={row} />,
        ])} />
    </div>
  );
}

function ReportPanel(props: PanelProps) {
  const [facilityId, setFacilityId] = useState("");
  const [operatingStatus, setOperatingStatus] = useState("normal");
  const [emsTraffic, setEmsTraffic] = useState("");
  const [beds, setBeds] = useState<BedDraft>({});
  const [note, setNote] = useState("");
  const { busy, run, feedback } = useRun();
  const facility = props.rows.find((row) => row.organizationId === facilityId);
  const shelter = facility?.facilityKind === "shelter";
  const setBed = (bedType: string, field: "available" | "baseline", value: string) =>
    setBeds((current) => ({ ...current, [bedType]: { available: "", baseline: "", ...current[bedType], [field]: value } }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!facility) throw new Error("Choose the facility you are reporting for.");
      const reportBeds = parseBeds(beds);
      await props.client.reportFacilityStatus(facility.organizationId, {
        operatingStatus,
        ...(emsTraffic ? { emsTraffic } : {}),
        ...(reportBeds.length ? { beds: reportBeds } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setBeds({});
      setNote("");
      props.onChanged();
      return `Status for ${facility.organizationName} reported as ${operatingLabel(operatingStatus).toLowerCase()}.`;
    });
  };
  return (
    <Panel title="Report status">
      <p className="d21-muted">A report replaces the facility's current status and answers any open status request for it. Bed counts left blank are not reported.</p>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="d21-form-grid facilities-fieldset">
          <EnumSelect label="Facility" values={["", ...props.rows.map((row) => row.organizationId)]}
            labels={{ "": "Choose a facility", ...Object.fromEntries(props.rows.map((row) => [row.organizationId, row.organizationName])) }}
            value={facilityId} onChange={(id) => { setFacilityId(id); setBeds({}); }} />
          <EnumSelect label="Operating status" values={FACILITY_OPERATING_STATUS.values} labels={OPERATING_LABELS}
            value={operatingStatus} onChange={setOperatingStatus} />
          <EnumSelect label="EMS traffic" values={["", ...EMS_TRAFFIC_STATUS.values]} labels={EMS_LABELS}
            value={emsTraffic} onChange={setEmsTraffic} />
          <TextField label="Note" value={note} onChange={setNote} />
          {facility ? (
            <div className="d21-form-grid-wide facilities-beds" role="group" aria-label={shelter ? "Shelter spaces" : "Bed availability"}>
              <span>{shelter ? "Shelter spaces" : "Bed type"}</span><span>{shelter ? "Open" : "Available"}</span><span>{shelter ? "Capacity" : "Baseline"}</span>
              {bedTypesFor(facility.facilityKind).map((bedType) => {
                const label = shelter ? "Shelter spaces" : bedLabel(bedType);
                return [
                  <span key={`${bedType}-label`}>{label}</span>,
                  <input key={`${bedType}-available`} type="number" min={0} step={1} inputMode="numeric" aria-label={`${label} ${shelter ? "open" : "available"}`}
                    value={beds[bedType]?.available ?? ""} onChange={(event) => setBed(bedType, "available", event.target.value)} />,
                  <input key={`${bedType}-baseline`} type="number" min={0} step={1} inputMode="numeric" aria-label={`${label} ${shelter ? "capacity" : "baseline"}`}
                    value={beds[bedType]?.baseline ?? ""} onChange={(event) => setBed(bedType, "baseline", event.target.value)} />,
                ];
              })}
            </div>
          ) : null}
          <div className="d21-form-grid-wide facilities-actions">
            <ActionButton kind="primary" type="submit" loading={busy} loadingLabel="Reporting…">Report status</ActionButton>
          </div>
        </fieldset>
      </form>
      {feedback}
    </Panel>
  );
}

const RECENT_REQUESTS = 20;

/**
 * Ask facilities to report now and follow who has answered: the recent
 * requests of the jurisdiction, whoever sent them. A status report from a
 * facility answers every open request for it.
 */
function StatusRequestPanel(props: PanelProps & { revision: number }) {
  const [prompt, setPrompt] = useState("Report your current status");
  const [kind, setKind] = useState("");
  const { busy, run, feedback } = useRun();
  const results = useAsync(() => props.client.listStatusQueries(props.jurisdictionId, { limit: RECENT_REQUESTS }),
    [props.client, props.jurisdictionId]);
  const { reload } = results;
  // A report or a Refresh bumps the revision; the answers read again with the board.
  useEffect(() => reload(), [props.revision, reload]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!prompt.trim()) throw new Error("Enter what the facilities should report.");
      const query = await props.client.launchStatusQuery(props.jurisdictionId, { prompt: prompt.trim(), ...(kind ? { kind } : {}) });
      reload();
      return `Request sent to ${query.targets} ${query.targets === 1 ? "facility" : "facilities"}.`;
    });
  };
  return (
    <Panel title="Status requests">
      <p className="d21-muted is-lead">Ask every facility, or every facility of one type, to report now. Each facility's next status report answers the request.</p>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="d21-form-grid facilities-fieldset">
          <TextField label="Request" value={prompt} onChange={setPrompt} required />
          <EnumSelect label="Ask" values={["", ...FACILITY_KINDS.values]} value={kind} onChange={setKind}
            labels={{ "": "Every facility", ...Object.fromEntries(FACILITY_KINDS.values.map((k) => [k, `Every ${kindLabel(k).toLowerCase()}`])) }} />
          <div className="d21-form-grid-wide facilities-actions">
            <ActionButton kind="primary" type="submit" loading={busy} loadingLabel="Sending…">Send status request</ActionButton>
          </div>
        </fieldset>
      </form>
      {feedback}
      {results.error ? <p className="d21-error" role="alert">{results.error}</p> : null}
      {results.data?.queries.length ? (
        <ul className="facilities-requests" aria-label="Recent status requests">
          {results.data.queries.map((query) => (
            <li key={query.id} aria-label={query.prompt}>
              <strong>{query.prompt}</strong>{" "}
              <span className="d21-muted">sent {new Date(query.createdAt).toLocaleString()}</span>{" "}
              <StatusBadge status={query.complete ? "success" : "warning"}>
                {query.complete ? "All reported" : `${query.responded} of ${query.total} reported`}
              </StatusBadge>
              {query.outstanding.length ? <span className="d21-muted"> Waiting for {query.outstanding.map((f) => f.name).join(", ")}.</span> : null}
            </li>
          ))}
        </ul>
      ) : results.data ? <p className="d21-muted">No status requests have been sent.</p> : null}
      {results.data?.nextCursor ? <p className="d21-muted">Showing the {RECENT_REQUESTS} most recent requests.</p> : null}
    </Panel>
  );
}

function HavePanel(props: PanelProps) {
  const hospitals = props.rows.filter((row) => row.facilityKind === "hospital");
  const { busy, run, feedback } = useRun();
  const download = () => run(async () => {
    const xml = await props.client.facilityHave(props.jurisdictionId, "hospital");
    const name = `have-hospitals-${new Date().toISOString().slice(0, 10)}.xml`;
    saveFile(new Blob([xml], { type: "application/xml" }), name);
    return `EDXL-HAVE document downloaded as ${name}.`;
  });
  return (
    <Panel title="Hospital bed availability (HAVE)">
      {hospitals.length === 0 ? <p className="d21-muted">No hospitals are registered.</p> : (
        <ul className="facilities-hospitals">
          {hospitals.map((row) => (
            <li key={row.organizationId} aria-label={row.organizationName}>
              <div className="facilities-hospital-head">
                <strong>{row.organizationName}</strong>
                <span><StatusCell status={row.operatingStatus} /> <FreshnessCell row={row} /></span>
              </div>
              <dl className="d21-facts">
                <div><dt>EMS traffic</dt><dd>{EMS_LABELS[row.emsTraffic ?? ""] ?? row.emsTraffic}</dd></div>
                <div><dt>Last report</dt><dd>{reported(row)}</dd></div>
                {row.capabilities?.length ? <div><dt>Services</dt><dd>{row.capabilities.join(", ")}</dd></div> : null}
              </dl>
              {row.beds.length ? (
                <div className="facilities-table">
                  <BoardTable caption={`Beds at ${row.organizationName}`} columns={["Bed type", "Available", "Baseline"]}
                    rows={row.beds.map((bed) => [bedLabel(bed.bedType), bed.available, bed.baseline])} />
                </div>
              ) : <p className="d21-muted">No bed counts in the latest report.</p>}
            </li>
          ))}
        </ul>
      )}
      <div className="facilities-actions">
        <ActionButton kind="secondary" loading={busy} loadingLabel="Preparing…" disabled={hospitals.length === 0}
          onClick={() => void download()}>Download EDXL-HAVE</ActionButton>
      </div>
      {feedback}
    </Panel>
  );
}

function ShelterPanel(props: { rows: readonly FacilityBoardRow[] }) {
  const shelters = props.rows.filter((row) => row.facilityKind === "shelter");
  return (
    <Panel title="Shelters">
      {shelters.length === 0 ? <p className="d21-muted">No shelters are registered.</p> : (
        <div className="facilities-table">
          <BoardTable caption="Shelter capacity and occupancy"
            columns={["Shelter", "Status", "Capacity", "Occupied", "Open spaces", "Last report", "Freshness"]}
            rows={shelters.map((row) => {
              const counts = shelterCounts(row.beds);
              const counted = row.beds.length > 0;
              return [row.organizationName, <StatusCell status={row.operatingStatus} />,
                counted ? counts.capacity : "Not reported", counted ? counts.occupied : "Not reported",
                counted ? counts.open : "Not reported", reported(row), <FreshnessCell row={row} />];
            })} />
        </div>
      )}
      <p className="d21-muted">Occupied is capacity minus open spaces, from the shelter's latest report.</p>
    </Panel>
  );
}

const LEGEND: ReadonlyArray<readonly [string, string]> = [
  ["Normal", "var(--eoc-status-success)"],
  ["Compromised", "var(--eoc-status-warning)"],
  ["Evacuating or closed", "var(--eoc-status-critical)"],
  ["No report", "var(--eoc-status-unknown)"],
];

function MapPanel(props: { rows: readonly FacilityBoardRow[]; ready: boolean; theme: ThemeName }) {
  const features = facilityFeatures(props.rows);
  // CopMap polls fetchItems; a stable function reading the latest layer keeps the map
  // mounted and never blanks it while the board reloads.
  const layer = useRef(features);
  layer.current = features;
  const fetchItems = useCallback(() => Promise.resolve(layer.current), []);
  // The map mounts once the first answer arrives, framed on the facilities; its Home tool
  // and a theme change return to the facilities then loaded.
  const [mounted, setMounted] = useState(false);
  if (!mounted && props.ready) setMounted(true);
  const unplaced = props.rows.length - features.features.length;
  return (
    <Panel title="Facilities on the map">
      <p className="d21-muted facilities-map-status" role="status">
        {`${features.features.length} ${features.features.length === 1 ? "facility is" : "facilities are"} on the map${unplaced ? `; ${unplaced} without a position` : ""}. Hospitals and shelters show their NAPSG symbol.`}
      </p>
      <ul className="facilities-legend" aria-label="Map colors by operating status">
        {LEGEND.map(([label, color]) => <li key={label}><span aria-hidden="true" style={{ background: color }} />{label}</li>)}
      </ul>
      {mounted ? (
        <div className="facilities-map-canvas">
          <CopMap key={props.theme} theme={props.theme}
            boards={[{ id: "facilities", title: "Facilities" }]} fetchItems={fetchItems}
            bundledBasemap={{ assetBase: assetBase() }} basemapStyleUrl={basemapStyleUrl()} streetBasemap={streetBasemap()}
            initialBounds={facilityBounds(props.rows) ?? jurisdictionMapBounds()} />
        </div>
      ) : null}
    </Panel>
  );
}

const EMPTY_FACILITY = { name: "", kind: "hospital", contact: "", lon: "", lat: "", windowMinutes: "60" };

function RegistryPanel(props: PanelProps & { canWrite: boolean }) {
  const [form, setForm] = useState(EMPTY_FACILITY);
  const set = (patch: Partial<typeof EMPTY_FACILITY>) => setForm((current) => ({ ...current, ...patch }));
  const { busy, run, feedback } = useRun();
  // The facility being edited, or null while the form registers a new one.
  const [editing, setEditing] = useState<FacilityBoardRow | null>(null);
  const [removing, setRemoving] = useState<FacilityBoardRow | null>(null);
  const startEdit = (row: FacilityBoardRow) => {
    setRemoving(null);
    setEditing(row);
    setForm({
      name: row.organizationName, kind: row.facilityKind, contact: row.contact ?? "",
      lon: row.location ? String(row.location.lon) : "", lat: row.location ? String(row.location.lat) : "",
      windowMinutes: String(Math.max(1, Math.round(row.staleAfterSeconds / 60))),
    });
  };
  const stopEdit = () => { setEditing(null); setForm(EMPTY_FACILITY); };
  const remove = (row: FacilityBoardRow) => run(async () => {
    await props.client.retireFacility(row.organizationId);
    setRemoving(null);
    if (editing?.organizationId === row.organizationId) stopEdit();
    props.onChanged();
    return `${row.organizationName} removed from the registry. Its past reports stay in the record.`;
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const name = form.name.trim();
      if (!name) throw new Error("Enter the facility name.");
      const minutes = Number(form.windowMinutes);
      if (!Number.isInteger(minutes) || minutes < 1) throw new Error("Enter the reporting window in whole minutes, one or more.");
      const placed = form.lon.trim() !== "" || form.lat.trim() !== "";
      const lon = Number(form.lon);
      const lat = Number(form.lat);
      if (placed && !(form.lon.trim() && form.lat.trim() && Math.abs(lon) <= 180 && Math.abs(lat) <= 90))
        throw new Error("Enter both longitude and latitude in decimal degrees, or leave both empty.");
      if (editing) {
        await props.client.updateFacility(editing.organizationId, {
          name, kind: form.kind, staleAfterSeconds: minutes * 60,
          contact: form.contact.trim() || null, location: placed ? { lon, lat } : null,
        });
        stopEdit();
        props.onChanged();
        return `${name} updated.`;
      }
      await props.client.registerFacility(props.jurisdictionId, {
        name,
        kind: form.kind,
        staleAfterSeconds: minutes * 60,
        ...(form.contact.trim() ? { contact: form.contact.trim() } : {}),
        ...(placed ? { location: { lon, lat } } : {}),
      });
      setForm(EMPTY_FACILITY);
      props.onChanged();
      return `${name} registered as ${kindLabel(form.kind).toLowerCase()}. It shows as not yet reported until its first status report.`;
    });
  };
  return (
    <Panel title="Registry">
      {props.rows.length ? (
        <div className="facilities-table">
          <BoardTable caption="Registered facilities"
            columns={["Facility", "Type", "Contact", "Position", "Report expected", ...(props.canWrite ? ["Actions"] : [])]}
            rows={props.rows.map((row) => [
              row.organizationName, kindLabel(row.facilityKind), row.contact ?? "None given",
              row.location ? `${row.location.lat.toFixed(4)}, ${row.location.lon.toFixed(4)}` : "Not placed",
              windowLabel(row.staleAfterSeconds),
              ...(props.canWrite ? [<span className="facilities-row-actions">
                <ActionButton kind="quiet" disabled={busy} onClick={() => startEdit(row)}>Edit {row.organizationName}</ActionButton>
                <ActionButton kind="quiet" disabled={busy} onClick={() => { setRemoving(row); }}>Remove {row.organizationName}</ActionButton>
              </span>] : []),
            ])} />
        </div>
      ) : <p className="d21-muted">No facilities are registered yet.</p>}
      {removing ? (
        <div className="facilities-confirm" role="group" aria-label={`Remove ${removing.organizationName}`}>
          <p>Remove {removing.organizationName} from the registry? It leaves the board, the map and new status requests; its past reports stay in the record.</p>
          <div className="facilities-actions">
            <ActionButton kind="danger" loading={busy} loadingLabel="Removing…" onClick={() => void remove(removing)}>Remove facility</ActionButton>
            <ActionButton kind="quiet" disabled={busy} onClick={() => setRemoving(null)}>Keep it</ActionButton>
          </div>
        </div>
      ) : null}
      {props.canWrite ? (
        <form onSubmit={submit}>
          <h3 className="facilities-subhead">{editing ? `Edit ${editing.organizationName}` : "Register a facility"}</h3>
          <fieldset disabled={busy} className="d21-form-grid facilities-fieldset">
            <TextField label="Facility name" value={form.name} onChange={(name) => set({ name })} required />
            <EnumSelect label="Facility type" values={FACILITY_KINDS.values} labels={KIND_LABELS} value={form.kind} onChange={(kind) => set({ kind })} />
            <TextField label="Contact" value={form.contact} onChange={(contact) => set({ contact })} />
            <NumberField id="facility-window" label="Report expected every (minutes)" value={form.windowMinutes} min={1}
              onChange={(windowMinutes) => set({ windowMinutes })} hint="The facility turns stale after this long without a report." />
            <NumberField id="facility-lon" label="Longitude" value={form.lon} min={-180} step="any" onChange={(lon) => set({ lon })} hint="Optional; places the facility on the map." />
            <NumberField id="facility-lat" label="Latitude" value={form.lat} min={-90} step="any" onChange={(lat) => set({ lat })} />
            <div className="d21-form-grid-wide facilities-actions">
              <ActionButton kind="primary" type="submit" loading={busy} loadingLabel={editing ? "Saving…" : "Registering…"}>
                {editing ? "Save changes" : "Register facility"}
              </ActionButton>
              {editing ? <ActionButton kind="quiet" onClick={stopEdit}>Cancel edit</ActionButton> : null}
            </div>
          </fieldset>
        </form>
      ) : null}
      {feedback}
    </Panel>
  );
}

function NumberField(props: { id: string; label: string; value: string; onChange: (value: string) => void; min: number; step?: string; hint?: string }) {
  return (
    <div className="facilities-field">
      <label htmlFor={props.id}>{props.label}</label>
      <input id={props.id} type="number" min={props.min} step={props.step ?? "1"} inputMode="decimal" value={props.value}
        onChange={(event) => props.onChange(event.target.value)} />
      {props.hint ? <span className="d21-muted">{props.hint}</span> : null}
    </div>
  );
}
