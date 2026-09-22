import { useEffect, useMemo, useState } from "react";
import {
  CALIFORNIA_ESFS,
  CALIFORNIA_ESF_MERGED_INTO,
  CALIFORNIA_ESF_TITLES,
  EMERGENCY_SUPPORT_FUNCTIONS,
  type AssessmentDecisionInput,
  type CreateEsfAssessment,
  type EsfAssessmentReport,
  type EsfCurrentState,
} from "@openeoc/shared";
import type { ApiClient, BoardListItem, EsfAssessmentOverviewResponse } from "../api/client.js";
import { useAsync, usePolled } from "../data/hooks.js";
import { ActionButton } from "../../design/controls.js";
import { ConditionBadge, EmptyState, ErrorState, LoadingState } from "../../design/feedback.js";
import { Icon, type IconName } from "../../design/icons/index.js";
import type { OperationalState } from "../../design/tokens.js";
import { EsfAssessmentForm, type EsfOrganizationOption } from "./EsfAssessmentForm.js";
import { AssessmentRelationships } from "./AssessmentRelationships.js";
import "./EsfSurface.css";

const REFRESH_MS = 30_000;
const CA_KEYS = CALIFORNIA_ESFS.values;
const FEDERAL_KEYS = EMERGENCY_SUPPORT_FUNCTIONS.values;
const ESF_ICONS: readonly IconName[] = [
  "transportation", "communications", "boardCustomization", "alerts", "incidentSetup", "foodHydrationShelter",
  "resources", "healthMedical", "search", "hazardousMaterials", "source", "energy", "safetySecurity",
  "aar", "jic", "tracking", "participants", "datasets",
];

type Framework = "california" | "federal";

export interface EsfSurfaceProps {
  readonly client: ApiClient;
  readonly incidentId: string | null;
  readonly incidentJurisdictionId: string | null;
  readonly relationshipBoards?: readonly Pick<BoardListItem, "id" | "title">[];
  readonly selectedEsf: string | null;
  readonly operationalPeriod: string | null;
  readonly onOpen: (id: string) => void;
  readonly onOpenLifelines: () => void;
  readonly onOpenLifeline?: (id: string) => void;
  readonly onOpenTask?: (id: string) => void;
  readonly onOpenResourceRequest?: (id: string) => void;
  readonly onOpenIap?: (id: string) => void;
  readonly onOpenBoardRecord?: (boardId: string, recordId: string) => void;
  readonly onOpenMapFeature?: (datasetId: string, featureId: string) => void;
  readonly onClose: () => void;
}

export function esfFramework(key: string | null): Framework | null {
  if (key && (CA_KEYS as readonly string[]).includes(key)) return "california";
  if (key && (FEDERAL_KEYS as readonly string[]).includes(key)) return "federal";
  return null;
}

export function esfLabel(framework: Framework, key: string): string {
  if (framework === "california") {
    const californiaKey = key as keyof typeof CALIFORNIA_ESF_TITLES;
    const title = CALIFORNIA_ESF_TITLES[californiaKey];
    return `California ESF ${Number(key.replace("ca_esf_", ""))}${title ? `: ${title}` : ""}`;
  }
  const match = /^esf_(\d+)_(.+)$/.exec(key);
  return match ? `Federal ESF ${match[1]}: ${match[2]!.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase())}` : key;
}

function californiaMergerNote(key: string): string | null {
  const targets = CALIFORNIA_ESF_MERGED_INTO[key as keyof typeof CALIFORNIA_ESF_MERGED_INTO];
  if (!targets) return null;
  const labels = targets.map((target) => `California ESF ${functionNumber(target)}`);
  return `Merged into ${labels.join(" and ")}`;
}

function activationLabel(value: string | null): string {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase()) : "Not assessed";
}

function capacityState(value: string | null): OperationalState {
  return value === "adequate" ? "normal" : value === "constrained" ? "watch" : value === "critical" ? "critical" : "unknown";
}

function payloadList(report: EsfAssessmentReport | null, key: string): string[] {
  const value = report?.payload[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function payloadText(report: EsfAssessmentReport | null, key: string): string | null {
  const value = report?.payload[key];
  return typeof value === "string" && value ? value : null;
}

function payloadActions(report: EsfAssessmentReport | null): readonly Record<string, unknown>[] {
  const value = report?.payload.actions;
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function selectedReport(state: EsfCurrentState | undefined): EsfAssessmentReport | null {
  if (!state) return null;
  const selectedId = state.decision?.selectedAssessmentId;
  if (selectedId) return state.reports.find((report) => report.id === selectedId) ?? null;
  return state.reports.length === 1 ? state.reports[0]! : null;
}

function functionNumber(key: string): number {
  const match = /^(?:ca_)?esf_(\d+)/.exec(key);
  return match ? Number(match[1]) : 1;
}

function EsfCard(props: {
  readonly framework: Framework;
  readonly esf: string;
  readonly state: EsfCurrentState | undefined;
  readonly selected: boolean;
  readonly organizationLabel: (id: string | null) => string;
  readonly onOpen: () => void;
}) {
  const report = selectedReport(props.state);
  const coordinator = payloadText(report, "coordinatorOrganizationId");
  const missions = payloadList(report, "missions");
  const priorities = payloadList(report, "priorities");
  const actions = payloadActions(report);
  const number = functionNumber(props.esf);
  const mergerNote = props.framework === "california" ? californiaMergerNote(props.esf) : null;
  return (
    <article className="eoc-esf-card" data-activation={props.state?.activation ?? "unknown"} data-esf={props.esf}
      data-selected={props.selected || undefined}>
      <header><Icon name={ESF_ICONS[(number - 1) % ESF_ICONS.length]!} decorative size={24} selected={props.selected} />
        <div><h3>{esfLabel(props.framework, props.esf)}</h3>
          {mergerNote ? <span>{mergerNote}</span> : null}</div></header>
      <div className="eoc-esf-card-badges">
        <span className="eoc-esf-activation">{activationLabel(props.state?.activation ?? null)}</span>
        <ConditionBadge state={capacityState(props.state?.capacity ?? null)} label={`Capacity: ${activationLabel(props.state?.capacity ?? null)}`} />
      </div>
      <dl>
        <div><dt>Coordinator</dt><dd>{props.organizationLabel(coordinator)}</dd></div>
        <div><dt>Workload</dt><dd>{missions.length} missions · {priorities.length} priorities · {actions.length} actions</dd></div>
        <div><dt>Reports</dt><dd>{props.state?.reports.length ?? 0}{props.state?.conflict ? " · conflict" : ""}</dd></div>
      </dl>
      <ActionButton kind="quiet" aria-pressed={props.selected} aria-label={`Open ${esfLabel(props.framework, props.esf)} workspace`}
        onClick={props.onOpen}>Open workspace</ActionButton>
    </article>
  );
}

function ReportHistory(props: { readonly reports: readonly EsfAssessmentReport[] }) {
  return (
    <ol className="eoc-esf-history">
      {props.reports.map((report) => <li key={report.id}>
        <div><strong>{activationLabel(report.activation)}</strong><ConditionBadge state={capacityState(report.capacity)} label={`Capacity: ${activationLabel(report.capacity)}`} /></div>
        <p>{payloadText(report, "situation") ?? "No readable situation narrative"}</p>
        <small>{new Date(report.assessedAt).toLocaleString()} · {report.attribution.personName}
          {report.attribution.positionTitle ? `, ${report.attribution.positionTitle}` : ""} · {report.attribution.homeOrganizationName}</small>
        {report.supersedesAssessmentId ? <span>Revises assessment {report.supersedesAssessmentId}</span> : null}
      </li>)}
    </ol>
  );
}

function CurrentWork(props: {
  readonly report: EsfAssessmentReport | null;
  readonly organizationLabel: (id: string | null) => string;
  readonly onOpenLifeline?: (id: string) => void;
}) {
  const missions = payloadList(props.report, "missions");
  const priorities = payloadList(props.report, "priorities");
  const related = payloadList(props.report, "relatedLifelines");
  const supporting = payloadList(props.report, "supportingOrganizationIds");
  const actions = payloadActions(props.report);
  return (
    <div className="eoc-esf-current-work">
      <section><h3>Coordination</h3><dl>
        <div><dt>Operational period</dt><dd>{payloadText(props.report, "operationalPeriod") ?? "Not reported"}</dd></div>
        <div><dt>Coordinator</dt><dd>{props.organizationLabel(payloadText(props.report, "coordinatorOrganizationId"))}</dd></div>
        <div><dt>Supporting organizations</dt><dd>{supporting.length ? supporting.map(props.organizationLabel).join(", ") : "None reported"}</dd></div>
        <div><dt>Related Lifelines</dt><dd>{related.length ? related.map((item) => props.onOpenLifeline ? <button type="button" key={item} onClick={() => props.onOpenLifeline!(item)}>{item.replaceAll("_", " ")}</button> : item.replaceAll("_", " ")) : "None reported"}</dd></div>
      </dl></section>
      <section><h3>Missions</h3>{missions.length ? <ul>{missions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No missions reported.</p>}</section>
      <section><h3>Priorities and decisions</h3>{priorities.length ? <ul>{priorities.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No priorities reported.</p>}</section>
      <section className="eoc-esf-actions"><h3>Actions and resource requests</h3>{actions.length ? <ul>{actions.map((action, index) => <li key={String(action.key ?? index)}>
        <strong>{String(action.title ?? "Untitled action")}</strong><span>{activationLabel(typeof action.status === "string" ? action.status : null)}</span>
        <span>Owner: {props.organizationLabel(typeof action.responsibleOrganizationId === "string" ? action.responsibleOrganizationId : null)}</span>
        {typeof action.dueAt === "string" ? <span>Due {new Date(action.dueAt).toLocaleString()}</span> : null}
        {typeof action.linkedResourceRequestId === "string" ? <code>Request {action.linkedResourceRequestId}</code> : null}
        {action.assignment ? <span>Validated assignment retained</span> : null}
      </li>)}</ul> : <p>No stabilization actions or resource requests reported.</p>}</section>
    </div>
  );
}

export function EsfSurface(props: EsfSurfaceProps) {
  const overview = usePolled<EsfAssessmentOverviewResponse | null>(
    () => props.incidentId ? props.client.listIncidentEsfAssessments(props.incidentId) : Promise.resolve(null),
    REFRESH_MS,
    [props.incidentId],
  );
  const participants = useAsync(
    () => props.incidentId ? props.client.listIncidentParticipants(props.incidentId) : Promise.resolve([]),
    [props.incidentId],
  );
  const selectedFramework = esfFramework(props.selectedEsf);
  const [framework, setFramework] = useState<Framework>(selectedFramework ?? "california");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [decisionReport, setDecisionReport] = useState("");
  const [decisionRationale, setDecisionRationale] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedFramework) setFramework(selectedFramework);
    setEditing(false);
    setSaveError(null);
    setDecisionError(null);
  }, [props.selectedEsf, selectedFramework]);

  const selectedState = overview.data?.states.find((state) => state.framework === selectedFramework && state.esf === props.selectedEsf);
  const current = selectedReport(selectedState);
  const history = useAsync(
    () => props.incidentId && props.selectedEsf && selectedFramework
      ? props.client.listEsfAssessmentHistory(props.incidentId, selectedFramework, props.selectedEsf)
      : Promise.resolve([]),
    [props.incidentId, props.selectedEsf, selectedFramework],
  );
  const organizations = useMemo<readonly EsfOrganizationOption[]>(() => {
    const labels = new Map<string, string>();
    if (props.incidentJurisdictionId) labels.set(props.incidentJurisdictionId, "Sponsoring organization");
    for (const participant of participants.data ?? []) {
      if (!participant.revokedAt && Date.parse(participant.expiresAt) > Date.now()) {
        labels.set(participant.organizationId, participant.organizationName);
      }
    }
    for (const state of overview.data?.states ?? []) for (const report of state.reports) {
      labels.set(report.attribution.homeOrganizationId, report.attribution.homeOrganizationName);
    }
    return [...labels].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label));
  }, [overview.data, participants.data, props.incidentJurisdictionId]);
  const organizationLabel = (id: string | null) => id ? organizations.find((item) => item.id === id)?.label ?? id : "Not assigned";
  const keys = framework === "california" ? CA_KEYS : FEDERAL_KEYS;
  const states = new Map((overview.data?.states ?? []).filter((state) => state.framework === framework).map((state) => [state.esf, state]));

  const save = (input: CreateEsfAssessment) => {
    if (!props.incidentId) return;
    setSaving(true); setSaveError(null);
    void props.client.createEsfAssessment(props.incidentId, input).then(() => {
      setEditing(false); overview.reload(); history.reload();
    }).catch((error: unknown) => setSaveError(error instanceof Error ? error.message : String(error)))
      .finally(() => setSaving(false));
  };
  const decide = () => {
    if (!props.incidentId || !props.selectedEsf || !selectedFramework) return;
    const body: AssessmentDecisionInput = { selectedAssessmentId: decisionReport, rationale: decisionRationale.trim() };
    setDecisionError(null);
    void props.client.decideEsfAssessment(props.incidentId, selectedFramework, props.selectedEsf, body).then(() => {
      setDecisionReport(""); setDecisionRationale(""); overview.reload(); history.reload();
    }).catch((error: unknown) => setDecisionError(error instanceof Error ? error.message : String(error)));
  };

  if (!props.incidentId) return <EmptyState title="Select an incident" description="ESF activation and workload are incident scoped." />;
  if (overview.loading && !overview.data) return <LoadingState label="Loading Emergency Support Functions" lines={8} />;
  if (overview.error && !overview.data) return <ErrorState title="ESF workspace unavailable" message={overview.error}
    action={<ActionButton onClick={() => overview.reload()}>Try again</ActionButton>} />;
  if (!overview.data) return <EmptyState title="ESF workspace unavailable" description="No ESF assessment response was returned." />;

  return (
    <section className="eoc-esf" aria-labelledby="eoc-esf-title">
      <header className="eoc-esf-heading"><div><span className="eoc-esf-eyebrow">Coordination</span><h2 id="eoc-esf-title">Emergency Support Functions</h2>
        <p>Activation, capacity, organizations, missions, priorities, actions, and period handoffs from attributed assessments.</p></div>
        <div className="eoc-esf-heading-actions"><span>{framework === "california" ? "California" : "Federal"} definition v{overview.data.definitions[framework].version}</span>
          <ActionButton kind="quiet" onClick={props.onOpenLifelines}>Community Lifelines</ActionButton></div></header>
      <div className="eoc-esf-framework-tabs" role="tablist" aria-label="ESF framework">
        <button type="button" role="tab" aria-selected={framework === "california"} onClick={() => { setFramework("california"); if (selectedFramework === "federal") props.onClose(); }}>California (18)</button>
        <button type="button" role="tab" aria-selected={framework === "federal"} onClick={() => { setFramework("federal"); if (selectedFramework === "california") props.onClose(); }}>Federal (15)</button>
      </div>
      <p className="eoc-esf-boundary">ESF activation is reported independently. Geography and Lifeline conditions do not activate a function.</p>
      {overview.error ? <p role="status" className="eoc-esf-warning">Refresh failed. Showing the last received assessment state.</p> : null}
      {props.selectedEsf && !selectedFramework ? <p role="alert" className="eoc-esf-warning">That ESF identifier is not recognized.</p> : null}
      <div className={`eoc-esf-layout${props.selectedEsf && selectedFramework ? " has-detail" : ""}`}>
        <div className="eoc-esf-grid" aria-label={`${framework === "california" ? "California" : "Federal"} Emergency Support Functions`}>
          {keys.map((key) => <EsfCard key={key} framework={framework} esf={key} state={states.get(key)}
            selected={props.selectedEsf === key} organizationLabel={organizationLabel} onOpen={() => props.onOpen(key)} />)}
        </div>
        {props.selectedEsf && selectedFramework ? <aside className="eoc-esf-detail" aria-labelledby="eoc-esf-detail-title">
          <header><div><span className="eoc-esf-eyebrow">{selectedFramework} workspace</span><h2 id="eoc-esf-detail-title">{esfLabel(selectedFramework, props.selectedEsf)}</h2></div>
            <ActionButton kind="quiet" aria-label="Close ESF workspace" onClick={props.onClose}>Close</ActionButton></header>
          <div className="eoc-esf-detail-badges"><span className="eoc-esf-activation">{activationLabel(selectedState?.activation ?? null)}</span>
            <ConditionBadge state={capacityState(selectedState?.capacity ?? null)} label={`Capacity: ${activationLabel(selectedState?.capacity ?? null)}`} />
            {selectedState?.conflict ? <ConditionBadge state="watch" label={selectedState.decision ? "Conflict decided" : "Unresolved conflict"} /> : null}</div>
          {selectedState?.conflict && !selectedState.decision ? <section className="eoc-esf-decision" aria-label="Resolve assessment conflict"><h3>Resolve conflicting reports</h3>
            <label>Selected report<select value={decisionReport} onChange={(event) => setDecisionReport(event.target.value)}><option value="">Choose report</option>
              {selectedState.reports.map((report) => <option key={report.id} value={report.id}>{activationLabel(report.activation)} / {activationLabel(report.capacity)} · {report.attribution.personName}</option>)}</select></label>
            <label>Decision rationale<textarea rows={3} value={decisionRationale} onChange={(event) => setDecisionRationale(event.target.value)} /></label>
            {decisionError ? <p role="alert">{decisionError}</p> : null}<ActionButton kind="primary" disabled={!decisionReport || !decisionRationale.trim()} onClick={decide}>Record attributed decision</ActionButton>
          </section> : null}
          {current ? <><p className="eoc-esf-situation">{payloadText(current, "situation") ?? "No readable situation narrative"}</p>
            <CurrentWork report={current} organizationLabel={organizationLabel}
              {...(props.onOpenLifeline ? { onOpenLifeline: props.onOpenLifeline } : {})} /><AssessmentRelationships client={props.client} incidentId={props.incidentId}
              jurisdictionId={props.incidentJurisdictionId} source={{ domain: "esf", framework: selectedFramework, definitionKey: props.selectedEsf }}
              {...(props.relationshipBoards ? { boards: props.relationshipBoards } : {})}
              {...(props.onOpenTask ? { onOpenTask: props.onOpenTask } : {})}
              {...(props.onOpenResourceRequest ? { onOpenResourceRequest: props.onOpenResourceRequest } : {})}
              {...(props.onOpenIap ? { onOpenIap: props.onOpenIap } : {})}
              {...(props.onOpenBoardRecord ? { onOpenBoardRecord: props.onOpenBoardRecord } : {})}
              {...(props.onOpenMapFeature ? { onOpenMapFeature: props.onOpenMapFeature } : {})} /></> : <EmptyState title={selectedState?.conflict ? "Conflicting assessments" : "No current assessment"}
              description={selectedState?.conflict ? "Choose an attributed report before presenting a current workload." : "Record activation, capacity, coordinator, and workload for this incident."} />}
          {!editing ? <ActionButton kind="primary" onClick={() => setEditing(true)}>{current ? "Revise assessment" : "Add assessment"}</ActionButton> : null}
          {editing ? <EsfAssessmentForm framework={selectedFramework} esf={props.selectedEsf} baseline={current}
            operationalPeriod={props.operationalPeriod} organizations={organizations} saving={saving} error={saveError}
            onSubmit={save} onCancel={() => { setEditing(false); setSaveError(null); }} /> : null}
          <section className="eoc-esf-history-panel"><h3>Attributed history and period handoffs</h3>
            {history.loading && !history.data ? <LoadingState label="Loading ESF history" lines={3} /> : null}
            {history.error ? <ErrorState title="History unavailable" message={history.error} /> : null}
            {history.data ? <ReportHistory reports={history.data} /> : null}</section>
        </aside> : null}
      </div>
      <details className="eoc-esf-doctrine"><summary>Definition and mapping notes</summary>
        <p>{overview.data.definitions[framework].source.authority}: {overview.data.definitions[framework].source.title}</p>
        <ul>{overview.data.doctrineGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
        {overview.data.crosswalk.map((item) => <p key={`${item.fromKey}:${item.toKey}`}>{item.fromKey} {item.relationship.replaceAll("_", " ")} {item.toKey}</p>)}
      </details>
    </section>
  );
}
