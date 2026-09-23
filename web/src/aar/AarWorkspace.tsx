import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AAR_ACTION_PRIORITIES,
  AAR_ACTION_STATUSES,
  CAPABILITY_ELEMENT,
  CAPABILITY_ELEMENT_LABELS,
  CORE_CAPABILITIES,
  CORE_CAPABILITY_LABELS,
  type AarActionPriority,
  type AarActionStatus,
  type AarObservation,
  type WorkflowAssignmentRequest,
} from "@openeoc/shared";
import type { AarAnalyticsResponse, ApiClient, CorrectiveAction } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ActionButton } from "../design/controls.js";
import { ConditionBadge, EmptyState, ErrorState, LoadingState } from "../design/feedback.js";
import { Icon } from "../design/icons/index.js";
import type { OperationalState } from "../design/tokens.js";
import {
  assignmentValue,
  capabilityLabel,
  elementLabel,
  filterLabel,
  humanLabel,
  ownerOptions,
  periodLabel,
  recordIds,
  type AarFilter,
  type AarOwnerOption,
} from "./model.js";
import "./aar-workspace.css";

const CAPABILITIES = CORE_CAPABILITIES.values;
const ELEMENTS = CAPABILITY_ELEMENT.values;
const EMPTY_FILTER: AarFilter = { dimension: "all", key: "" };

interface AarWorkspaceProps {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly incidentId: string;
}

function selectAssignment(options: readonly AarOwnerOption[], value: string): WorkflowAssignmentRequest | undefined {
  return options.find((option) => option.value === value)?.assignment;
}

function AnalyticsPanel(props: {
  readonly data: AarAnalyticsResponse;
  readonly filter: AarFilter;
  readonly onFilter: (filter: AarFilter) => void;
}) {
  const analytics = props.data.analytics;
  const button = (dimension: AarFilter["dimension"], key: string, label: string, count: number) => (
    <button key={`${dimension}:${key}`} type="button" className="eoc-aar-metric" aria-label={`${count} ${label} Drill into records`} data-selected={(props.filter.dimension === dimension && props.filter.key === key) || undefined}
      onClick={() => props.onFilter({ dimension, key })} aria-pressed={props.filter.dimension === dimension && props.filter.key === key}>
      <strong>{count}</strong><span>{label}</span><small>Drill into records</small>
    </button>
  );
  return (
    <section className="eoc-aar-analytics" aria-labelledby="eoc-aar-analytics-title">
      <header><div><span className="eoc-aar-eyebrow">Server analytics</span><h2 id="eoc-aar-analytics-title">Review coverage and progress</h2></div>
        <button type="button" className="eoc-aar-clear-filter" onClick={() => props.onFilter(EMPTY_FILTER)}>All records</button></header>
      <div className="eoc-aar-totals">
        {button("all", "", "Total records", analytics.totals.records)}
        <div className="eoc-aar-total"><strong>{analytics.totals.observations}</strong><span>Observations</span></div>
        <div className="eoc-aar-total"><strong>{analytics.totals.correctiveActions}</strong><span>Corrective actions</span></div>
      </div>
      <div className="eoc-aar-bucket-groups">
        <section><h3>Priority</h3><div>{analytics.byPriority.map((item) => button("priority", item.key, humanLabel(item.key), item.count))}</div></section>
        <section><h3>Status</h3><div>{analytics.byStatus.map((item) => button("status", item.key, humanLabel(item.key), item.count))}</div></section>
        <section><h3>Capability</h3><div>{analytics.byCapability.map((item) => button("capability", item.key, capabilityLabel(item.key), item.count))}</div></section>
      </div>
    </section>
  );
}

function ObservationForm(props: {
  readonly periodRevision: number | undefined;
  readonly busy: boolean;
  readonly onSave: (input: {
    capability: string;
    capabilityElement: string;
    kind: "strength" | "improvement";
    observation: string;
    recommendation?: string;
    periodRevision?: number;
  }) => Promise<boolean>;
}) {
  const [capability, setCapability] = useState(CAPABILITIES[0] ?? "");
  const [element, setElement] = useState("none");
  const [kind, setKind] = useState<"strength" | "improvement">("improvement");
  const [observation, setObservation] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!capability || !observation.trim()) return;
    void props.onSave({
      capability,
      capabilityElement: element,
      kind,
      observation: observation.trim(),
      ...(recommendation.trim() ? { recommendation: recommendation.trim() } : {}),
      ...(props.periodRevision !== undefined ? { periodRevision: props.periodRevision } : {}),
    }).then((saved) => {
      if (saved) {
        setObservation("");
        setRecommendation("");
      }
    });
  };
  return (
    <form className="eoc-aar-form" aria-label="Record an observation" onSubmit={submit}>
      <header><Icon name="report" decorative size={24} /><div><span className="eoc-aar-eyebrow">Evidence capture</span><h2>Record an observation</h2></div></header>
      <div className="eoc-aar-form-grid">
        <label>Core capability<select value={capability} onChange={(event) => setCapability(event.target.value)}>
          {CAPABILITIES.map((value) => <option key={value} value={value}>{CORE_CAPABILITY_LABELS[value] ?? value}</option>)}</select></label>
        <label>Capability element<select value={element} onChange={(event) => setElement(event.target.value)}>
          {ELEMENTS.map((value) => <option key={value} value={value}>{CAPABILITY_ELEMENT_LABELS[value] ?? value}</option>)}</select></label>
        <label>Finding type<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="improvement">Area for improvement</option><option value="strength">Strength</option></select></label>
      </div>
      <label>Observation<textarea required rows={4} value={observation} onChange={(event) => setObservation(event.target.value)} /></label>
      <label>Recommendation<textarea rows={3} value={recommendation} onChange={(event) => setRecommendation(event.target.value)} /></label>
      <ActionButton kind="primary" type="submit" loading={props.busy} loadingLabel="Recording observation…">Record observation</ActionButton>
    </form>
  );
}

function ActionForm(props: {
  readonly source: AarObservation | null;
  readonly owners: readonly AarOwnerOption[];
  readonly periodRevision: number | undefined;
  readonly busy: boolean;
  readonly onCancelSource: () => void;
  readonly onSave: (input: {
    capability: string;
    capabilityElement: string;
    recommendation: string;
    priority: AarActionPriority;
    dueDate?: string;
    assignment?: WorkflowAssignmentRequest;
    periodRevision?: number;
  }) => Promise<boolean>;
}) {
  const [capability, setCapability] = useState(props.source?.capability ?? CAPABILITIES[0] ?? "");
  const [element, setElement] = useState(props.source?.capabilityElement ?? "none");
  const [recommendation, setRecommendation] = useState(props.source?.recommendation ?? "");
  const [priority, setPriority] = useState<AarActionPriority>("unspecified");
  const [dueDate, setDueDate] = useState("");
  const [owner, setOwner] = useState("");
  useEffect(() => {
    if (!props.source) return;
    setCapability(props.source.capability);
    setElement(props.source.capabilityElement);
    setRecommendation(props.source.recommendation ?? "");
  }, [props.source]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!capability || !recommendation.trim()) return;
    const assignment = selectAssignment(props.owners, owner);
    void props.onSave({
      capability,
      capabilityElement: element,
      recommendation: recommendation.trim(),
      priority,
      ...(dueDate ? { dueDate } : {}),
      ...(assignment ? { assignment } : {}),
      ...(props.periodRevision !== undefined ? { periodRevision: props.periodRevision } : {}),
    }).then((saved) => {
      if (saved) {
        setRecommendation("");
        setDueDate("");
        setOwner("");
        setPriority("unspecified");
        props.onCancelSource();
      }
    });
  };
  return (
    <form className="eoc-aar-form" aria-label="Create a corrective action" onSubmit={submit}>
      <header><Icon name="tasks" decorative size={24} /><div><span className="eoc-aar-eyebrow">Accountable follow-through</span><h2>Create corrective action</h2></div></header>
      {props.source ? <div className="eoc-aar-source" role="status"><strong>Source observation retained</strong>
        <span>Observation {props.source.id}</span><p>{props.source.observation}</p>
        <button type="button" onClick={props.onCancelSource}>Clear source</button></div> : null}
      <div className="eoc-aar-form-grid">
        <label>Action capability<select value={capability} onChange={(event) => setCapability(event.target.value)}>
          {CAPABILITIES.map((value) => <option key={value} value={value}>{CORE_CAPABILITY_LABELS[value] ?? value}</option>)}</select></label>
        <label>Action element<select value={element} onChange={(event) => setElement(event.target.value)}>
          {ELEMENTS.map((value) => <option key={value} value={value}>{CAPABILITY_ELEMENT_LABELS[value] ?? value}</option>)}</select></label>
        <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as AarActionPriority)}>
          {AAR_ACTION_PRIORITIES.map((value) => <option key={value} value={value}>{humanLabel(value)}</option>)}</select></label>
        <label>Owner<select value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">Unassigned</option>
          {props.owners.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
      </div>
      <label>Corrective action<textarea required rows={4} value={recommendation} onChange={(event) => setRecommendation(event.target.value)} /></label>
      <ActionButton kind="primary" type="submit" loading={props.busy} loadingLabel="Creating action…">Create corrective action</ActionButton>
    </form>
  );
}

function ActionRow(props: {
  readonly action: CorrectiveAction;
  readonly owners: readonly AarOwnerOption[];
  readonly busy: boolean;
  readonly onSave: (id: string, body: {
    expectedRevision: number;
    priority?: AarActionPriority;
    assignment?: WorkflowAssignmentRequest | null;
    dueDate?: string | null;
    status?: AarActionStatus;
  }) => Promise<void>;
  readonly onRefresh: (id: string) => void;
}) {
  const [status, setStatus] = useState<AarActionStatus>(props.action.status);
  const [priority, setPriority] = useState<AarActionPriority>(props.action.priority);
  const [dueDate, setDueDate] = useState(props.action.dueDate ?? "");
  const [owner, setOwner] = useState(() => assignmentValue(props.action.assignment));
  const actionAtRevision = useRef(props.action);
  const baselineRevision = useRef(props.action.revision);
  const baselineOwner = useRef(assignmentValue(props.action.assignment));
  actionAtRevision.current = props.action;
  useEffect(() => {
    const action = actionAtRevision.current;
    // State already starts from this revision; resetting it again on mount
    // would race a change made before the effect runs.
    if (action.revision === baselineRevision.current) return;
    const nextOwner = assignmentValue(action.assignment);
    baselineRevision.current = action.revision;
    baselineOwner.current = nextOwner;
    setStatus(action.status);
    setPriority(action.priority);
    setDueDate(action.dueDate ?? "");
    setOwner(nextOwner);
  }, [props.action.id, props.action.revision]);
  const save = () => {
    const body: Parameters<typeof props.onSave>[1] = {
      expectedRevision: baselineRevision.current,
      status,
      priority,
      dueDate: dueDate || null,
      ...(owner !== baselineOwner.current ? { assignment: selectAssignment(props.owners, owner) ?? null } : {}),
    };
    void props.onSave(props.action.id, body);
  };
  const state: OperationalState = status === "complete" ? "normal" : status === "in_progress" ? "watch" : "unknown";
  return (
    <article className="eoc-aar-action" data-record-id={props.action.id}>
      <header><div><ConditionBadge state={state} label={humanLabel(status)} /><h3>{capabilityLabel(props.action.capability)}</h3></div>
        <span>Revision {props.action.revision}</span></header>
      <p>{props.action.recommendation}</p>
      <dl><div><dt>Element</dt><dd>{elementLabel(props.action.capabilityElement)}</dd></div>
        <div><dt>Owner</dt><dd>{props.action.owner ?? "Unassigned"}</dd></div>
        <div><dt>Due</dt><dd>{props.action.dueDate ?? "No due date"}</dd></div>
        <div><dt>Progress evidence</dt><dd>{props.action.completedAt
          ? `First completed ${new Date(props.action.completedAt).toLocaleString()} by ${props.action.completedBy ?? "unknown"}`
          : "No completion recorded"}</dd></div></dl>
      <div className="eoc-aar-action-controls">
        <label>Status<select disabled={props.busy} value={status} onChange={(event) => setStatus(event.target.value as AarActionStatus)}>
          {AAR_ACTION_STATUSES.map((value) => <option key={value} value={value}>{humanLabel(value)}</option>)}</select></label>
        <label>Priority<select disabled={props.busy} value={priority} onChange={(event) => setPriority(event.target.value as AarActionPriority)}>
          {AAR_ACTION_PRIORITIES.map((value) => <option key={value} value={value}>{humanLabel(value)}</option>)}</select></label>
        <label>Owner<select disabled={props.busy} value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">Unassigned</option>
          {props.owners.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Due date<input disabled={props.busy} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
        <ActionButton kind="secondary" loading={props.busy} loadingLabel="Saving…" onClick={save}>Save progress</ActionButton>
        <ActionButton kind="quiet" disabled={props.busy} onClick={() => props.onRefresh(props.action.id)}>Load latest revision</ActionButton>
      </div>
    </article>
  );
}

function PdfPanel(props: {
  readonly busy: boolean;
  readonly onCompose: (overview: string, objectives: readonly string[]) => Promise<void>;
}) {
  const [overview, setOverview] = useState("");
  const [objectives, setObjectives] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!overview.trim()) return;
    void props.onCompose(overview.trim(), objectives.split("\n").map((item) => item.trim()).filter(Boolean));
  };
  return (
    <form className="eoc-aar-pdf" aria-label="Compile the after-action report" onSubmit={submit}>
      <header><Icon name="files" decorative size={24} /><div><span className="eoc-aar-eyebrow">Immutable export</span><h2>Compile exact PDF snapshot</h2></div></header>
      <label>Incident overview<textarea required rows={4} value={overview} onChange={(event) => setOverview(event.target.value)} /></label>
      <label>Objectives, one per line<textarea rows={3} value={objectives} onChange={(event) => setObjectives(event.target.value)} /></label>
      <p>The PDF freezes the selected period, included records, analytics, chronology evidence, owners, due dates, and progress fields.</p>
      <ActionButton kind="primary" type="submit" loading={props.busy} loadingLabel="Compiling PDF…">Compile and download PDF</ActionButton>
    </form>
  );
}

export function AarWorkspace(props: AarWorkspaceProps) {
  const [period, setPeriod] = useState("");
  const [filter, setFilter] = useState<AarFilter>(EMPTY_FILTER);
  const [source, setSource] = useState<AarObservation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Single actions read fresh from the server, newer than the analytics response.
  const [latest, setLatest] = useState<Readonly<Record<string, CorrectiveAction>>>({});
  const periodRevision = period ? Number(period) : undefined;
  const analytics = useAsync(
    () => props.client.getAarAnalytics(props.incidentId, periodRevision),
    [props.incidentId, periodRevision],
  );
  const periods = useAsync(() => props.client.incidentAreaHistory(props.incidentId), [props.incidentId]);
  const positions = useAsync(() => props.client.listPositions(props.jurisdictionId), [props.jurisdictionId]);
  const participants = useAsync(() => props.client.listIncidentParticipants(props.incidentId), [props.incidentId]);
  const owners = useMemo(() => ownerOptions(
    props.incidentId,
    positions.data ?? [],
    participants.data ?? [],
  ), [participants.data, positions.data, props.incidentId]);
  useEffect(() => setFilter(EMPTY_FILTER), [period]);

  const execute = async (key: string, work: () => Promise<void>): Promise<boolean> => {
    setBusy(key); setError(null); setMessage(null);
    try {
      await work();
      analytics.reload();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveObservation = (input: Parameters<ApiClient["recordAarObservation"]>[1]) => execute("observation", async () => {
    await props.client.recordAarObservation(props.incidentId, input);
    setMessage("Observation recorded with incident and period provenance.");
  });
  const saveAction = (input: Parameters<ApiClient["createCorrectiveAction"]>[1]) => execute("action", async () => {
    await props.client.createCorrectiveAction(props.jurisdictionId, { ...input, incidentId: props.incidentId });
    setMessage(source ? `Corrective action created; source observation ${source.id} remains in evidence.` : "Corrective action created.");
  });
  const updateAction = (id: string, body: Parameters<ApiClient["updateCorrectiveAction"]>[1]) => execute(`action:${id}`, async () => {
    await props.client.updateCorrectiveAction(id, body);
    setMessage("Corrective action progress saved.");
  });
  const refreshAction = (id: string) => {
    setBusy(`action:${id}`); setError(null); setMessage(null);
    props.client.getCorrectiveAction(id).then((action) => {
      setLatest((current) => ({ ...current, [id]: action }));
      setMessage(`Corrective action revision ${action.revision} loaded.`);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(null));
  };
  const compose = (overview: string, objectives: readonly string[]) => execute("pdf", async () => {
    const result = await props.client.composeAar(props.incidentId, {
      overview,
      objectives,
      ...(periodRevision !== undefined ? { periodRevision } : {}),
    });
    const blob = await props.client.downloadAarPdf(result.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "after-action-review.pdf";
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    setMessage("AAR snapshot compiled and downloaded.");
  });

  if (analytics.loading && !analytics.data) return <LoadingState label="Loading after-action records" lines={6} />;
  if (analytics.error && !analytics.data) return <ErrorState title="After-action workspace unavailable" message={analytics.error}
    action={<ActionButton onClick={() => analytics.reload()}>Try again</ActionButton>} />;
  if (!analytics.data) return <EmptyState title="After-action workspace unavailable" description="No analytics response was returned." />;
  const ids = recordIds(analytics.data, filter);
  const observations = analytics.data.observations.filter((item) => ids.observationIds.has(item.id));
  const actions = analytics.data.correctiveActions.filter((item) => ids.actionIds.has(item.id))
    .map((item) => (latest[item.id]?.revision ?? 0) > item.revision ? latest[item.id]! : item);
  const revisions = (periods.data ?? []).filter((item) => item.operationalPeriod !== null)
    .sort((left, right) => right.revision - left.revision);

  return (
    <section className="eoc-aar" aria-labelledby="eoc-aar-title">
      <header className="eoc-aar-heading"><div><span className="eoc-aar-eyebrow">Learning and accountability</span>
        <h1 id="eoc-aar-title">After-action review</h1><p>Connect attributed observations to owned, time-bound improvement work.</p></div>
        <label>Operational period<select value={period} onChange={(event) => setPeriod(event.target.value)}>
          <option value="">All periods</option>{revisions.map((revision) => <option key={revision.revision} value={revision.revision}>{periodLabel(revision)}</option>)}</select></label>
      </header>
      {analytics.error ? <p className="eoc-aar-warning" role="status">Refresh failed. Showing the last authoritative response.</p> : null}
      {error ? <p className="eoc-aar-error" role="alert">{error}</p> : null}
      {message ? <p className="eoc-aar-message" role="status">{message}</p> : null}
      <AnalyticsPanel data={analytics.data} filter={filter} onFilter={setFilter} />
      <div className="eoc-aar-entry-grid">
        <ObservationForm periodRevision={periodRevision} busy={busy === "observation"} onSave={saveObservation} />
        <ActionForm source={source} owners={owners} periodRevision={periodRevision} busy={busy === "action"}
          onCancelSource={() => setSource(null)} onSave={saveAction} />
      </div>
      <section className="eoc-aar-drill" aria-labelledby="eoc-aar-drill-title">
        <header><div><span className="eoc-aar-eyebrow">Aggregate drilldown</span><h2 id="eoc-aar-drill-title">{filterLabel(filter)}</h2></div>
          <strong>{ids.count} record{ids.count === 1 ? "" : "s"}</strong></header>
        <div className="eoc-aar-record-columns">
          <section aria-labelledby="eoc-aar-observations-title"><h3 id="eoc-aar-observations-title">Evidence and observations</h3>
            {observations.length ? <ol className="eoc-aar-observations">{observations.map((item) => <li key={item.id} data-record-id={item.id}>
              <header><ConditionBadge state={item.kind === "strength" ? "normal" : "watch"} label={item.kind === "strength" ? "Strength" : "Improvement"} />
                <code>{item.id}</code></header><strong>{capabilityLabel(item.capability)}</strong>
              <span>{elementLabel(item.capabilityElement)} · {item.operationalPeriodRevision ? `Period revision ${item.operationalPeriodRevision}` : "All-period evidence"}</span>
              <p>{item.observation}</p>{item.recommendation ? <blockquote>{item.recommendation}</blockquote> : null}
              <small>Recorded {new Date(item.createdAt).toLocaleString()}</small>
              {item.kind === "improvement" ? <ActionButton kind="quiet" onClick={() => setSource(item)}>Create action from this observation</ActionButton> : null}
            </li>)}</ol> : <p className="eoc-aar-empty">No observations belong to this aggregate.</p>}
          </section>
          <section aria-labelledby="eoc-aar-actions-title"><h3 id="eoc-aar-actions-title">Corrective actions and progress</h3>
            {actions.length ? <div className="eoc-aar-actions">{actions.map((action) => <ActionRow key={action.id} action={action}
              owners={owners} busy={busy === `action:${action.id}`} onSave={async (id, body) => { await updateAction(id, body); }}
              onRefresh={refreshAction} />)}</div>
              : <p className="eoc-aar-empty">No corrective actions belong to this aggregate.</p>}
          </section>
        </div>
      </section>
      <PdfPanel busy={busy === "pdf"} onCompose={async (overview, objectives) => { await compose(overview, objectives); }} />
    </section>
  );
}
