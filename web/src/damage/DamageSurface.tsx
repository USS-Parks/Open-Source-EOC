import { useCallback, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  DAMAGE_DEGREES,
  IA_OWNERSHIP,
  IA_STRUCTURE_TYPES,
  PA_CATEGORIES,
  PA_CATEGORY_LABELS,
  PA_ITEM_STATUSES,
  type DamageSummary,
  type DeclarationThresholds,
} from "@openeoc/shared";
import { CopMap } from "../cop/CopMap.js";
import type { SymbolStatus } from "../cop/symbology.js";
import { KpiCard } from "../design/cards.js";
import { EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import { ActionButton, Tabs } from "../design/controls.js";
import { Icon } from "../design/icons/index.js";
import {
  OperationalTable,
  createOperationalTableViewState,
  type OperationalTableColumn,
  type OperationalTableViewState,
} from "../design/table.js";
import type { ThemeName } from "../design/tokens.js";
import type { ApiClient } from "../app/api/client.js";
import { assetBase, basemapStyleUrl, jurisdictionMapBounds, streetBasemap } from "../app/config.js";
import { useAsync, type AsyncState } from "../app/data/hooks.js";
import { Scroll, SurfaceHeader } from "../app/screens/parts.js";
import { saveFile } from "../admin/labels.js";
import "../datasets/datasets.css";
import "./damage.css";
import { ForceAccountPanel } from "./ForceAccountPanel.js";
import {
  DEFAULT_DRAFT,
  DEGREE_LABELS,
  DEGREE_ORDER,
  DEGREE_STATUS,
  EMPTY_PA_DRAFT,
  OWNERSHIP_LABELS,
  PA_STATUS_LABELS,
  SOURCE_LABELS,
  STRUCTURE_LABELS,
  declarationFileName,
  declarationIndicators,
  degreeLabel,
  dollars,
  insuredLabel,
  paDraftOf,
  parseBaseline,
  parsePaDraft,
  parseThresholds,
  reportBounds,
  reportFeatures,
  structureLabel,
  type DamageReport,
  type DamageReportPage,
  type DamageReportStatus,
  type Indicator,
  type PaDraft,
  type PaItem,
  type PaItemPage,
  type ThresholdDraft,
} from "./model.js";

/**
 * Preliminary damage assessment for one jurisdiction: the public intake
 * queue and its moderation, field assessments, the loss summary and the
 * declaration indicators, the declaration support download and the counted
 * reports on the map. The server decides what counts; this screen shows it.
 */
export function DamageSurface(props: {
  client: ApiClient;
  jurisdictionId: string;
  theme: ThemeName;
  canWrite: boolean;
  isAdmin: boolean;
  incidentName: string | null;
  /** The selected incident, whose force account is shown; none shows none. */
  incidentId?: string | null;
}) {
  // Every change bumps the revision so the summary, map and lists read again.
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision((n) => n + 1), []);
  const [tab, setTab] = useState<string>("submitted");
  const common = { client: props.client, jurisdictionId: props.jurisdictionId, revision };
  const figures = useFigures(props.client, props.jurisdictionId, revision);
  return (
    <Scroll>
      <SurfaceHeader title="Damage assessment" />
      <div className="d21-workspace">
        <div className="d21-workspace-intro">
          <Icon name="fieldReports" size={32} decorative />
          <div>
            <strong>Preliminary damage assessment</strong>
            <span>Public reports wait in the intake queue until a moderator accepts or rejects them. Only accepted reports and field assessments count toward the loss summary, the declaration indicators, the download and the map. Public Assistance line items count once submitted.</span>
          </div>
        </div>
        <SummaryPanel figures={figures} client={props.client} jurisdictionId={props.jurisdictionId} incidentName={props.incidentName} />
        <MapPanel {...common} theme={props.theme} />
        <Panel title="Reports and Public Assistance">
          <Tabs id="damage" label="Report lists and Public Assistance" tabs={TABS} value={tab} onChange={setTab} />
          <div role="tabpanel" id={`damage-${tab}-panel`} aria-labelledby={`damage-${tab}-tab`} className="damage-tabpanel">
            {tab === "pa"
              ? <PublicAssistanceTab {...common} summary={figures.summary.data} canWrite={props.canWrite} onChanged={changed} />
              : <ReportTable key={tab} {...common} status={tab as DamageReportStatus} canModerate={props.canWrite} onChanged={changed} />}
          </div>
        </Panel>
        {props.canWrite && props.incidentId ? (
          <ForceAccountPanel client={props.client} jurisdictionId={props.jurisdictionId} incidentId={props.incidentId}
            incidentName={props.incidentName ?? "The incident"} isAdmin={props.isAdmin} onChanged={changed} />
        ) : null}
        {props.canWrite ? <FieldAssessmentPanel client={props.client} jurisdictionId={props.jurisdictionId} onChanged={changed} /> : null}
        {props.isAdmin ? <IntakePanel client={props.client} jurisdictionId={props.jurisdictionId} /> : null}
        {props.isAdmin ? <BaselinePanel client={props.client} jurisdictionId={props.jurisdictionId} onChanged={changed} /> : null}
      </div>
    </Scroll>
  );
}

function BaselinePanel(props: { client: ApiClient; jurisdictionId: string; onChanged: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const { busy, run, feedback } = useRun();
  const upload = () => run(async () => {
    if (!file) throw new Error("Choose a CSV or JSON baseline file.");
    const rows = parseBaseline(await file.text(), file.name);
    if (rows.length === 0) throw new Error("The baseline file holds no parcels.");
    const result = await props.client.importDamageBaseline(props.jurisdictionId, rows);
    props.onChanged();
    return `${result.imported} ${result.imported === 1 ? "parcel" : "parcels"} imported into the baseline.`;
  });
  return (
    <Panel title="Parcel baseline">
      <p className="d21-muted">
        The parcels field assessments are matched against. A CSV file needs a header row with parcelId, address, structureType
        and replacementValue, and may add lon and lat. A JSON file is an array of objects with those fields and an optional
        location of lon and lat. A parcel ID already in the baseline is replaced.
      </p>
      <label className="damage-field">Baseline file (CSV or JSON)
        <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>
      <div className="damage-actions">
        <ActionButton kind="primary" loading={busy} loadingLabel="Importing…" onClick={() => void upload()}>Import baseline</ActionButton>
      </div>
      {feedback}
    </Panel>
  );
}

const TABS = [
  { id: "submitted", label: "Intake queue" },
  { id: "approved", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
  { id: "pa", label: "Public Assistance" },
] as const;

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
    {notice ? <p className="damage-notice" role="status">{notice}</p> : null}
  </>;
  return { busy, run, feedback };
}

function NumberField(props: { id: string; label: string; value: string; onChange: (value: string) => void; step?: string; min?: number; hint?: string }) {
  return (
    <div className="damage-field">
      <label htmlFor={props.id}>{props.label}</label>
      <input id={props.id} type="number" min={props.min ?? 0} step={props.step ?? "1"} inputMode="decimal" value={props.value}
        onChange={(event) => props.onChange(event.target.value)} />
      {props.hint ? <span className="d21-muted">{props.hint}</span> : null}
    </div>
  );
}

function readDraft(key: string): ThresholdDraft {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<ThresholdDraft> | null;
    return saved ? { ...DEFAULT_DRAFT, ...saved } : DEFAULT_DRAFT;
  } catch {
    return DEFAULT_DRAFT;
  }
}

interface Figures {
  readonly draft: ThresholdDraft;
  readonly update: (patch: Partial<ThresholdDraft>) => void;
  readonly thresholds: DeclarationThresholds | null;
  readonly summary: AsyncState<DamageSummary | null>;
}

/** The operator-entered figures and the summary computed from them, shared by the summary and the PA tab. */
function useFigures(client: ApiClient, jurisdictionId: string, revision: number): Figures {
  // The inputs are remembered per jurisdiction on this browser only.
  const storageKey = `openeoc.damage.thresholds.${jurisdictionId}`;
  const [draft, setDraft] = useState<ThresholdDraft>(() => readDraft(storageKey));
  const update = (patch: Partial<ThresholdDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage is a convenience */ }
  };
  const thresholds = parseThresholds(draft);
  const summary = useAsync(
    () => thresholds ? client.damageSummary(jurisdictionId, thresholds) : Promise.resolve(null),
    [jurisdictionId, JSON.stringify(thresholds), revision],
  );
  return { draft, update, thresholds, summary };
}

function IndicatorList(props: { indicators: readonly Indicator[] }) {
  return (
    <ul className="damage-indicators">
      {props.indicators.map((indicator) => (
        <li key={indicator.key} aria-label={indicator.title}>
          <div className="damage-indicator-head">
            <strong>{indicator.title}</strong>
            <StatusBadge status={indicator.met ? "warning" : "info"}>{indicator.met ? "Threshold met" : "Threshold not met"}</StatusBadge>
          </div>
          <dl className="d21-facts">
            <div><dt>Measured</dt><dd>{indicator.measured}</dd></div>
            <div><dt>Threshold</dt><dd>{indicator.threshold}</dd></div>
          </dl>
          <p className="d21-muted">Basis: {indicator.basis}</p>
        </li>
      ))}
    </ul>
  );
}

function SummaryPanel(props: { figures: Figures; client: ApiClient; jurisdictionId: string; incidentName: string | null }) {
  const { draft, update, thresholds, summary } = props.figures;
  const s = summary.data;
  const [incident, setIncident] = useState(props.incidentName ?? "");
  const { busy, run, feedback } = useRun();
  const download = () => run(async () => {
    if (!thresholds) throw new Error("Enter the county population and both thresholds first.");
    const result = await props.client.damageDeclaration(props.jurisdictionId, { ...thresholds, incident: incident.trim() });
    const name = declarationFileName(new Date());
    saveFile(new Blob([result.document], { type: "text/markdown" }), name);
    const items = result.summary.publicAssistance.items;
    return `Declaration summary downloaded as ${name}, built from ${result.summary.totalStructures} counted structures and ${items} counted Public Assistance ${items === 1 ? "line item" : "line items"}.`;
  });

  return (
    <Panel title="Loss summary and declaration indicators">
      <div className="damage-thresholds">
        <NumberField id="damage-population" label="County population" value={draft.population}
          onChange={(population) => update({ population })} hint="Divides the counted cost for the county per-capita figure." />
        <NumberField id="damage-pa-indicator" label="County PA per-capita indicator (USD)" step="0.01" value={draft.paPerCapitaIndicator}
          onChange={(paPerCapitaIndicator) => update({ paPerCapitaIndicator })} hint="FEMA publishes this figure each fiscal year." />
        <NumberField id="damage-ia-threshold" label="IA residence threshold" value={draft.iaResidenceThreshold}
          onChange={(iaResidenceThreshold) => update({ iaResidenceThreshold })} hint="Destroyed or major residences that support an IA request." />
        <NumberField id="damage-state-population" label="State population" value={draft.statePopulation ?? ""}
          onChange={(statePopulation) => update({ statePopulation })} hint="Optional; with the statewide indicator it adds the statewide figure." />
        <NumberField id="damage-statewide-indicator" label="Statewide PA per-capita indicator (USD)" step="0.01" value={draft.statewidePerCapitaIndicator ?? ""}
          onChange={(statewidePerCapitaIndicator) => update({ statewidePerCapitaIndicator })} hint="Optional; FEMA publishes this figure each fiscal year." />
      </div>
      {!thresholds ? <p className="d21-callout">Enter the county population and both thresholds to compute the loss summary and the declaration indicators. The state population and statewide indicator are optional and go together.</p> : null}
      {summary.error ? <p className="d21-error" role="alert">{summary.error}</p> : null}
      {thresholds && !s && !summary.error ? <p className="d21-muted" role="status">Computing the loss summary…</p> : null}
      {s ? <>
        <h3 className="damage-subhead">Counted structures by degree of damage</h3>
        <div className="damage-kpis" aria-label="Loss summary">
          {DEGREE_ORDER.map((degree) => (
            <KpiCard key={degree} label={degreeLabel(degree)}
              value={{ kind: "value", value: s.byDegree[degree] ?? 0, unit: s.byDegree[degree] === 1 ? "structure" : "structures" }} />
          ))}
          <KpiCard label="Estimated loss" value={{ kind: "value", value: dollars(s.totalEstimatedLoss) }}
            detail={`${s.totalStructures} counted ${s.totalStructures === 1 ? "structure" : "structures"}`} />
          <KpiCard label="Uninsured loss" value={{ kind: "value", value: dollars(s.uninsuredLoss) }}
            detail="Structures recorded as uninsured" />
        </div>
        <h3 className="damage-subhead">Declaration indicators</h3>
        <IndicatorList indicators={declarationIndicators(s)} />
      </> : null}
      <p className="d21-callout">The per-capita figures divide the counted Public Assistance cost (categories A to G) once any submitted or reviewed line item exists, and the estimated loss of counted structures until then; each indicator names its basis. The populations and thresholds are entered by the operator. FEMA validates the figures and makes the determination.</p>
      <div className="damage-export">
        <TextField label="Incident name for the download" value={incident} onChange={setIncident} />
        <ActionButton kind="primary" loading={busy} loadingLabel="Preparing…" disabled={!thresholds || !incident.trim()}
          onClick={() => void download()}>Download declaration summary</ActionButton>
      </div>
      {feedback}
    </Panel>
  );
}

const STATUS_COLOR: Readonly<Record<SymbolStatus, string>> = {
  critical: "var(--eoc-status-critical)",
  warning: "var(--eoc-status-warning)",
  normal: "var(--eoc-status-success)",
  unknown: "var(--eoc-status-unknown)",
};

// ponytail: the map shows the newest 500 accepted reports; page the layer if a jurisdiction exceeds that.
const MAP_LIMIT = 500;

function MapPanel(props: { client: ApiClient; jurisdictionId: string; revision: number; theme: ThemeName }) {
  const accepted = useAsync(
    () => props.client.listDamageReports(props.jurisdictionId, { status: "approved", limit: MAP_LIMIT }),
    [props.jurisdictionId, props.revision],
  );
  const rows = accepted.data?.assessments ?? [];
  const features = reportFeatures(rows);
  // CopMap polls fetchItems; a stable function reading the latest loaded layer keeps the
  // map mounted and never blanks it while the list reloads.
  const layer = useRef(features);
  if (accepted.data) layer.current = features;
  const fetchItems = useCallback(() => Promise.resolve(layer.current), []);
  // The map mounts once the first answer arrives, framed on the reports; its Home tool and
  // a theme change return to the reports then loaded.
  const [ready, setReady] = useState(false);
  if (!ready && (accepted.data || accepted.error)) setReady(true);
  const bounds = reportBounds(rows);
  const unplaced = rows.length - features.features.length;

  return (
    <Panel title="Counted reports on the map">
      <p className="d21-muted damage-map-status" role="status">
        {accepted.data
          ? `${features.features.length} accepted ${features.features.length === 1 ? "report is" : "reports are"} on the map${unplaced ? `; ${unplaced} without a position` : ""}.${accepted.data.nextCursor ? ` The newest ${MAP_LIMIT} are shown.` : ""}`
          : accepted.error ?? "Loading accepted reports…"}
      </p>
      <ul className="damage-legend" aria-label="Map colors by degree of damage">
        {DEGREE_ORDER.map((degree) => (
          <li key={degree}><span aria-hidden="true" style={{ background: STATUS_COLOR[DEGREE_STATUS[degree] ?? "unknown"] }} />{DEGREE_LABELS[degree]}</li>
        ))}
      </ul>
      {ready ? (
        <div className="damage-map-canvas">
          <CopMap key={props.theme} theme={props.theme}
            boards={[{ id: "damage-reports", title: "Accepted damage reports" }]} fetchItems={fetchItems}
            bundledBasemap={{ assetBase: assetBase() }} basemapStyleUrl={basemapStyleUrl()} streetBasemap={streetBasemap()}
            initialBounds={bounds ?? jurisdictionMapBounds()} />
        </div>
      ) : null}
    </Panel>
  );
}

const COLUMN_WIDTHS = [
  { id: "address", width: 200 }, { id: "degree", width: 140 }, { id: "structure", width: 170 },
  { id: "loss", width: 130 }, { id: "insured", width: 110 }, { id: "source", width: 140 },
  { id: "contact", width: 190 }, { id: "received", width: 180 }, { id: "decision", width: 190 },
];

function ReportTable(props: {
  client: ApiClient; jurisdictionId: string; revision: number; status: DamageReportStatus;
  canModerate: boolean; onChanged: () => void;
}) {
  const first = useAsync(
    () => props.client.listDamageReports(props.jurisdictionId, { status: props.status }),
    [props.jurisdictionId, props.status, props.revision],
  );
  // Pages added with "Load more" extend the first page they were read after.
  const [more, setMore] = useState<{ base: DamageReportPage; rows: readonly DamageReport[]; nextCursor: string | null } | null>(null);
  const loaded = first.data && more?.base === first.data ? more
    : first.data ? { base: first.data, rows: first.data.assessments, nextCursor: first.data.nextCursor } : null;
  const nextCursor = loaded?.nextCursor ?? null;
  const loadMore = loaded && nextCursor ? async () => {
    const next = await props.client.listDamageReports(props.jurisdictionId, { status: props.status, cursor: nextCursor });
    setMore({ base: loaded.base, rows: [...loaded.rows, ...next.assessments], nextCursor: next.nextCursor });
  } : undefined;
  const reports = loaded?.rows ?? [];
  const [tableState, setTableState] = useState<OperationalTableViewState>(() => createOperationalTableViewState(COLUMN_WIDTHS, { pageSize: 25 }));
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const { busy, run, feedback } = useRun();
  const decide = (report: DamageReport, decision: "approved" | "rejected") => run(async () => {
    await props.client.moderateDamageReport(report.id, decision);
    props.onChanged();
    return decision === "approved"
      ? `Accepted the report for ${report.address}. It now counts toward the summary and the map.`
      : `Rejected the report for ${report.address}. It will not count.`;
  });

  const queue = props.status === "submitted";
  const columns: OperationalTableColumn<DamageReport>[] = [
    { id: "address", header: "Address", value: (r) => r.address },
    { id: "degree", header: queue ? "Reported degree" : "Degree", value: (r) => degreeLabel(r.degree) },
    { id: "structure", header: "Structure", value: (r) => structureLabel(r.structure_type) },
    { id: "loss", header: "Estimated loss", value: (r) => dollars(r.estimated_loss), align: "end" },
    { id: "insured", header: "Insurance", value: (r) => insuredLabel(r.insured) },
    { id: "source", header: "Source", value: (r) => SOURCE_LABELS[r.source] },
    { id: "contact", header: "Reporter contact", value: (r) => r.reporter_contact, missingLabel: "None given" },
    { id: "received", header: "Received", value: (r) => new Date(r.created_at).toLocaleString() },
  ];
  if (queue && props.canModerate) columns.push({
    id: "decision", header: "Decision", value: () => "Awaiting decision",
    render: (r) => (
      <span className="damage-decision">
        <ActionButton kind="secondary" disabled={busy} aria-label={`Accept report for ${r.address}`} onClick={() => void decide(r, "approved")}>Accept</ActionButton>
        <ActionButton kind="danger" disabled={busy} aria-label={`Reject report for ${r.address}`} onClick={() => void decide(r, "rejected")}>Reject</ActionButton>
      </span>
    ),
  });
  const start = tableState.page * tableState.pageSize;
  const label = TABS.find((t) => t.id === props.status)?.label ?? "Reports";

  return (
    <div className="damage-table">
      {feedback}
      <OperationalTable
        tableId={`damage-${props.status}`}
        caption={label}
        columns={columns}
        rows={reports.slice(start, start + tableState.pageSize)}
        rowId={(r) => r.id}
        datasetKey={`${props.jurisdictionId}:${props.status}`}
        status={first.error && !loaded ? "error" : !loaded ? "loading" : reports.length === 0 ? "empty" : "ready"}
        errorMessage={first.error ?? "Reports could not be loaded."}
        onRetry={first.reload}
        emptyTitle={queue ? "No reports waiting" : "No reports in this list"}
        emptyDescription={queue ? "Public reports appear here as they arrive." : "Moderated reports and field assessments appear here."}
        viewState={tableState}
        onViewStateChange={setTableState}
        totalRows={nextCursor ? null : reports.length}
        hasPreviousPage={tableState.page > 0}
        hasNextPage={start + tableState.pageSize < reports.length}
        selectedIds={checked}
        onSelectionChange={setChecked}
        toolbar={<ActionButton kind="quiet" onClick={first.reload}>Refresh</ActionButton>}
        {...(loadMore ? { onLoadMore: loadMore } : {})}
      />
    </div>
  );
}

const PA_COLUMN_WIDTHS = [
  { id: "applicant", width: 220 }, { id: "category", width: 270 }, { id: "site", width: 200 },
  { id: "description", width: 240 }, { id: "cost", width: 150 }, { id: "insured", width: 110 },
  { id: "complete", width: 110 }, { id: "status", width: 170 }, { id: "edit", width: 110 },
];

/**
 * Public Assistance line items: the counted cost by work category, the
 * per-capita indicators with their basis, the paged list and, for writers,
 * the form that records or edits an item.
 */
function PublicAssistanceTab(props: {
  client: ApiClient; jurisdictionId: string; revision: number; summary: DamageSummary | null;
  canWrite: boolean; onChanged: () => void;
}) {
  const first = useAsync(() => props.client.listPaItems(props.jurisdictionId), [props.jurisdictionId, props.revision]);
  // Pages added with "Load more" extend the first page they were read after.
  const [more, setMore] = useState<{ base: PaItemPage; rows: readonly PaItem[]; nextCursor: string | null } | null>(null);
  const loaded = first.data && more?.base === first.data ? more
    : first.data ? { base: first.data, rows: first.data.items, nextCursor: first.data.nextCursor } : null;
  const nextCursor = loaded?.nextCursor ?? null;
  const loadMore = loaded && nextCursor ? async () => {
    const next = await props.client.listPaItems(props.jurisdictionId, { cursor: nextCursor });
    setMore({ base: loaded.base, rows: [...loaded.rows, ...next.items], nextCursor: next.nextCursor });
  } : undefined;
  const items = loaded?.rows ?? [];
  const totals = first.data?.totals ?? null;
  const [tableState, setTableState] = useState<OperationalTableViewState>(() => createOperationalTableViewState(PA_COLUMN_WIDTHS, { pageSize: 25 }));
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<PaItem | null>(null);
  const perCapita = props.summary ? declarationIndicators(props.summary).filter((indicator) => indicator.key !== "ia") : [];
  const categoryLabel = (category: string) => PA_CATEGORY_LABELS[category] ?? category;

  const columns: OperationalTableColumn<PaItem>[] = [
    { id: "applicant", header: "Applicant", value: (r) => r.applicant },
    { id: "category", header: "Work category", value: (r) => categoryLabel(r.category) },
    { id: "site", header: "Site", value: (r) => r.site, missingLabel: "Not given" },
    { id: "description", header: "Work", value: (r) => r.description, missingLabel: "Not given" },
    { id: "cost", header: "Estimated cost", value: (r) => dollars(r.estimated_cost_cents / 100), align: "end" },
    { id: "insured", header: "Insurance", value: (r) => insuredLabel(r.insured) },
    { id: "complete", header: "Complete", value: (r) => `${r.percent_complete}%`, align: "end" },
    { id: "status", header: "Status", value: (r) => PA_STATUS_LABELS[r.status] },
  ];
  if (props.canWrite) columns.push({
    id: "edit", header: "Edit", value: () => "Edit",
    render: (r) => (
      <ActionButton kind="secondary" aria-label={`Edit ${categoryLabel(r.category)} line item for ${r.applicant}`} onClick={() => setEditing(r)}>Edit</ActionButton>
    ),
  });
  const start = tableState.page * tableState.pageSize;

  return (
    <div className="damage-table">
      <h3 className="damage-subhead">Counted cost by work category</h3>
      {totals ? (
        <div className="damage-kpis" aria-label="Public Assistance totals">
          {PA_CATEGORIES.values.map((category) => (
            <KpiCard key={category} label={categoryLabel(category)} value={{ kind: "value", value: dollars(totals.byCategory[category] ?? 0) }} />
          ))}
          <KpiCard label="Total, categories A to G" value={{ kind: "value", value: dollars(totals.totalCost) }}
            detail={`${totals.items} counted ${totals.items === 1 ? "line item" : "line items"}`} />
        </div>
      ) : null}
      <p className="d21-muted">Submitted and reviewed line items count toward the totals, the indicators and the declaration summary. Drafts are listed but not counted.</p>
      <h3 className="damage-subhead">Per-capita indicators</h3>
      {perCapita.length > 0 ? <IndicatorList indicators={perCapita} />
        : <p className="d21-callout">Enter the county population and thresholds under the loss summary to compute the per-capita indicators.</p>}
      <OperationalTable
        tableId="damage-pa"
        caption="Public Assistance line items"
        columns={columns}
        rows={items.slice(start, start + tableState.pageSize)}
        rowId={(r) => r.id}
        datasetKey={`${props.jurisdictionId}:pa`}
        status={first.error && !loaded ? "error" : !loaded ? "loading" : items.length === 0 ? "empty" : "ready"}
        errorMessage={first.error ?? "Line items could not be loaded."}
        onRetry={first.reload}
        emptyTitle="No Public Assistance line items"
        emptyDescription={props.canWrite ? "Record the first line item below." : "Line items appear here as members record them."}
        viewState={tableState}
        onViewStateChange={setTableState}
        totalRows={nextCursor ? null : items.length}
        hasPreviousPage={tableState.page > 0}
        hasNextPage={start + tableState.pageSize < items.length}
        selectedIds={checked}
        onSelectionChange={setChecked}
        toolbar={<ActionButton kind="quiet" onClick={first.reload}>Refresh</ActionButton>}
        {...(loadMore ? { onLoadMore: loadMore } : {})}
      />
      {props.canWrite ? (
        <PaItemForm client={props.client} jurisdictionId={props.jurisdictionId} editing={editing}
          onSaved={() => { setEditing(null); props.onChanged(); }} onCancel={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function PaItemForm(props: {
  client: ApiClient; jurisdictionId: string; editing: PaItem | null; onSaved: () => void; onCancel: () => void;
}) {
  const [form, setForm] = useState<PaDraft>(EMPTY_PA_DRAFT);
  const set = (patch: Partial<PaDraft>) => setForm((current) => ({ ...current, ...patch }));
  // Choosing another item to edit, or leaving an edit, loads the form afresh.
  const [loadedFor, setLoadedFor] = useState<PaItem | null>(null);
  if (props.editing !== loadedFor) {
    setLoadedFor(props.editing);
    setForm(props.editing ? paDraftOf(props.editing) : EMPTY_PA_DRAFT);
  }
  const editing = props.editing;
  const { busy, run, feedback } = useRun();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const input = parsePaDraft(form);
      const label = PA_CATEGORY_LABELS[input.category] ?? input.category;
      // An edit keeps the item's incident, which this form does not show.
      if (editing) await props.client.updatePaItem(editing.id, { ...input, incidentId: editing.incident_id });
      else await props.client.createPaItem(props.jurisdictionId, input);
      setForm(EMPTY_PA_DRAFT);
      props.onSaved();
      return `${editing ? "Saved" : "Recorded"} the ${label} line item for ${input.applicant}.${input.status === "draft" ? " It is a draft and does not count yet." : ""}`;
    });
  };
  const title = editing ? "Edit a Public Assistance line item" : "Record a Public Assistance line item";
  return (
    <section aria-label={title} className="damage-pa-form">
      <h3 className="damage-subhead">{title}</h3>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="d21-form-grid damage-fieldset">
          <TextField label="Applicant" value={form.applicant} onChange={(applicant) => set({ applicant })} required />
          <EnumSelect label="Work category" values={PA_CATEGORIES.values} labels={PA_CATEGORY_LABELS} value={form.category}
            onChange={(category) => set({ category })} />
          <TextField label="Site" value={form.site} onChange={(site) => set({ site })} />
          <NumberField id="pa-cost" label="Estimated cost (USD)" step="0.01" value={form.cost} onChange={(cost) => set({ cost })} />
          <EnumSelect label="Insurance" values={["unknown", "insured", "uninsured"]} labels={{ unknown: "Not known", insured: "Insured", uninsured: "Uninsured" }}
            value={form.insured} onChange={(insured) => set({ insured: insured as PaDraft["insured"] })} />
          <NumberField id="pa-percent" label="Percent complete" value={form.percent} onChange={(percent) => set({ percent })} />
          <EnumSelect label="Status" values={PA_ITEM_STATUSES} labels={PA_STATUS_LABELS} value={form.status}
            onChange={(status) => set({ status: status as PaDraft["status"] })} />
          <NumberField id="pa-lon" label="Longitude" step="any" min={-180} value={form.lon} onChange={(lon) => set({ lon })} hint="Optional; the position of the site." />
          <NumberField id="pa-lat" label="Latitude" step="any" min={-90} value={form.lat} onChange={(lat) => set({ lat })} />
          <div className="d21-form-grid-wide"><TextField label="Description of work" value={form.description} onChange={(description) => set({ description })} /></div>
          <div className="d21-form-grid-wide damage-actions">
            <ActionButton kind="primary" type="submit" loading={busy} loadingLabel="Saving…">{editing ? "Save changes" : "Record line item"}</ActionButton>
            {editing ? <ActionButton kind="quiet" onClick={props.onCancel}>Cancel edit</ActionButton> : null}
          </div>
        </fieldset>
      </form>
      {feedback}
    </section>
  );
}

const EMPTY_ASSESSMENT = {
  address: "", structureType: "single_family", degree: "affected", ownership: "unknown", insured: "unknown",
  loss: "", lon: "", lat: "", notes: "",
};

function FieldAssessmentPanel(props: { client: ApiClient; jurisdictionId: string; onChanged: () => void }) {
  const [form, setForm] = useState(EMPTY_ASSESSMENT);
  const set = (patch: Partial<typeof EMPTY_ASSESSMENT>) => setForm((current) => ({ ...current, ...patch }));
  const { busy, run, feedback } = useRun();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const address = form.address.trim();
      const loss = Number(form.loss);
      if (!address) throw new Error("Enter the address of the structure.");
      if (form.loss.trim() === "" || !Number.isFinite(loss) || loss < 0) throw new Error("Enter the estimated loss in dollars, zero or more.");
      const placed = form.lon.trim() !== "" || form.lat.trim() !== "";
      const lon = Number(form.lon);
      const lat = Number(form.lat);
      if (placed && !(Math.abs(lon) <= 180 && Math.abs(lat) <= 90 && form.lon.trim() && form.lat.trim()))
        throw new Error("Enter both longitude and latitude in decimal degrees, or leave both empty.");
      await props.client.recordDamageAssessment(props.jurisdictionId, {
        address,
        structureType: form.structureType,
        degree: form.degree,
        ownership: form.ownership,
        insured: form.insured === "unknown" ? null : form.insured === "insured",
        estimatedLoss: loss,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        ...(placed ? { location: { lon, lat } } : {}),
      });
      setForm(EMPTY_ASSESSMENT);
      props.onChanged();
      return `Field assessment for ${address} recorded as ${degreeLabel(form.degree).toLowerCase()}. It counts now.`;
    });
  };
  return (
    <Panel title="Record a field assessment">
      <p className="d21-muted">A field assessment is authoritative and counts as soon as it is saved. When a public report names the wrong degree, reject it and record the verified degree here.</p>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="d21-form-grid damage-fieldset">
          <TextField label="Address" value={form.address} onChange={(address) => set({ address })} required />
          <EnumSelect label="Degree of damage" values={DAMAGE_DEGREES.values} labels={DEGREE_LABELS} value={form.degree} onChange={(degree) => set({ degree })} />
          <EnumSelect label="Structure type" values={IA_STRUCTURE_TYPES.values} labels={STRUCTURE_LABELS} value={form.structureType} onChange={(structureType) => set({ structureType })} />
          <EnumSelect label="Occupancy" values={IA_OWNERSHIP.values} labels={OWNERSHIP_LABELS} value={form.ownership} onChange={(ownership) => set({ ownership })} />
          <EnumSelect label="Insurance" values={["unknown", "insured", "uninsured"]} labels={{ unknown: "Not known", insured: "Insured", uninsured: "Uninsured" }}
            value={form.insured} onChange={(insured) => set({ insured })} />
          <NumberField id="damage-loss" label="Estimated loss (USD)" step="0.01" value={form.loss} onChange={(loss) => set({ loss })} />
          <NumberField id="damage-lon" label="Longitude" step="any" min={-180} value={form.lon} onChange={(lon) => set({ lon })} hint="Optional; places the structure on the map." />
          <NumberField id="damage-lat" label="Latitude" step="any" min={-90} value={form.lat} onChange={(lat) => set({ lat })} />
          <div className="d21-form-grid-wide"><TextField label="Notes" value={form.notes} onChange={(notes) => set({ notes })} /></div>
          <div className="d21-form-grid-wide damage-actions">
            <ActionButton kind="primary" type="submit" loading={busy} loadingLabel="Saving…">Record assessment</ActionButton>
          </div>
        </fieldset>
      </form>
      {feedback}
    </Panel>
  );
}

function IntakePanel(props: { client: ApiClient; jurisdictionId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const { busy, run, feedback } = useRun();
  const issue = () => run(async () => {
    const result = await props.client.enableDamageIntake(props.jurisdictionId);
    setToken(result.token);
    setConfirming(false);
    return "Public intake is on. Copy the token now; it is not shown again.";
  });
  return (
    <Panel title="Public report intake">
      <p className="d21-muted">
        A public reporting form or 311 system sends reports to <code>{`POST /api/v1/jurisdictions/${props.jurisdictionId}/damage/report`}</code> with
        the token in the <code>x-intake-token</code> header. Reports wait in the intake queue and count only after a moderator accepts them.
      </p>
      {token ? <p className="d21-token" aria-label="Intake token">{token}</p> : null}
      {confirming ? (
        <div className="damage-actions">
          <span className="d21-muted">A new token replaces the current one; reports sent with the old token are refused.</span>
          <ActionButton kind="primary" loading={busy} onClick={() => void issue()}>Issue new token</ActionButton>
          <ActionButton kind="quiet" disabled={busy} onClick={() => setConfirming(false)}>Cancel</ActionButton>
        </div>
      ) : (
        <div className="damage-actions">
          <ActionButton kind="secondary" onClick={() => setConfirming(true)}>Issue intake token</ActionButton>
        </div>
      )}
      {feedback}
    </Panel>
  );
}
