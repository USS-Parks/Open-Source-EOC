import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { EsfCurrentState, LifelineAssessmentReport, LifelineCurrentState } from "@openeoc/shared";
import type { ApiClient, BoardListItem } from "../api/client.js";
import { useAsync, usePolled } from "../data/hooks.js";
import { EmptyState, ErrorState, LoadingState } from "../../design/feedback.js";
import { Icon, LifelineIcon, type LifelineKey } from "../../design/icons/index.js";
import { PageActions } from "../layout/page-chrome.js";
import { periodLabel, type OperationalPeriodChoice } from "../layout/context.js";
import {
  LIFELINE_KEYS,
  LIFELINE_LABELS,
  componentItems,
  conditionLabel,
  conditionTrend,
  formatAssessmentTime,
  linkedActions,
  projectLifeline,
  reportInPeriod,
  shortImpact,
  stateOf,
  timeOfDay,
  updateOverdue,
  type LifelineCardView,
  type LifelineCondition,
} from "./lifeline-view.js";
import { LifelineAssessmentForm } from "./LifelineAssessmentForm.js";
import { LifelineAssessmentHistory } from "./LifelineAssessmentHistory.js";
import { AssessmentRelationships } from "./AssessmentRelationships.js";
import { JurisdictionLifelines } from "./JurisdictionLifelines.js";
import { LifelineTabs, type LifelineTab } from "./lifeline-tabs.js";
import { esfLabel } from "./EsfSurface.js";
import "./LifelinesSurface.css";

const REFRESH_MS = 30_000;
const CONDITIONS: readonly LifelineCondition[] = ["stable", "stabilizing", "unstable", "unknown"];

export interface LifelinesSurfaceProps {
  readonly client: ApiClient;
  readonly incidentId: string | null;
  readonly selectedLifeline: string | null;
  readonly incidentJurisdictionId?: string | null;
  /** The console's jurisdiction, for its standing lifeline status outside any incident. */
  readonly jurisdictionId?: string;
  /** Whether the signed-in person may record standing status (admin or member). */
  readonly canWrite?: boolean;
  readonly relationshipBoards?: readonly Pick<BoardListItem, "id" | "title">[];
  /** The workspace view other than the lifeline cards. */
  readonly view?: "dependencies" | "history" | null;
  /** The incident's operational periods and the shell's selected one. */
  readonly periods?: readonly OperationalPeriodChoice[];
  readonly selectedPeriodRevision?: number | null;
  readonly onSelectPeriod?: (revision: number | null) => void;
  readonly onView?: (tab: LifelineTab) => void;
  readonly onOpen: (id: string) => void;
  readonly onClose: () => void;
  readonly onOpenEsfs?: () => void;
  readonly onOpenEsf?: (id: string) => void;
  readonly onOpenTask?: (id: string) => void;
  readonly onOpenResourceRequest?: (id: string) => void;
  readonly onOpenIap?: (id: string) => void;
  readonly onOpenBoardRecord?: (boardId: string, recordId: string) => void;
  readonly onOpenMapFeature?: (datasetId: string, featureId: string) => void;
}

function isLifelineKey(value: string | null): value is LifelineKey {
  return value !== null && (LIFELINE_KEYS as readonly string[]).includes(value);
}

function ConditionPill(props: { readonly condition: LifelineCondition }) {
  return (
    <span className="eoc-lw-pill" data-condition={props.condition}>
      <span aria-hidden="true" />{conditionLabel(props.condition)}
    </span>
  );
}

function Meta(props: { readonly icon: "participants" | "clock"; readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="eoc-lw-meta">
      <Icon name={props.icon} size={16} decorative />
      <span><strong>{props.label}</strong><span>{props.children}</span></span>
    </div>
  );
}

interface Comparison {
  readonly label: string;
  readonly condition: LifelineCondition | null;
}

const TREND_TEXT = { worse: "worsened", better: "improved", same: "unchanged", unknown: "not comparable" } as const;

function LifelineCard(props: {
  readonly item: LifelineCardView;
  readonly selected: boolean;
  readonly current: boolean;
  readonly overdue: boolean;
  readonly compare: Comparison | null;
  readonly buttonRef: (node: HTMLButtonElement | null) => void;
  readonly onOpen: () => void;
}) {
  const { item } = props;
  const trend = props.compare ? conditionTrend(props.compare.condition, item.condition) : null;
  return (
    <article className="eoc-lifeline-card" data-condition={item.condition} data-lifeline={item.key}
      data-freshness={item.freshness} data-selected={props.selected || undefined}>
      <header>
        <span className="eoc-lw-card-icon" aria-hidden="true">
          <LifelineIcon decorative lifeline={item.key} size={40} selected={props.selected} />
        </span>
        <div>
          <h3>{item.label}</h3>
          <ConditionPill condition={item.condition} />
        </div>
      </header>
      <p className="eoc-lw-card-impact">{item.report ? shortImpact(item.impact) : item.impact}</p>
      {item.conflict ? (
        <p className="eoc-lw-card-note">
          {item.conflictResolved ? "Conflicting reports resolved by an attributed decision." : "Conflicting reports remain unresolved."}
        </p>
      ) : null}
      {props.current && item.report && item.freshness !== "current" ? <p className="eoc-lw-card-note">{item.freshnessLabel}</p> : null}
      {props.compare && trend ? (
        <p className="eoc-lw-card-compare" data-trend={trend}>
          {props.compare.label}: {props.compare.condition
            ? `${conditionLabel(props.compare.condition)} · ${TREND_TEXT[trend]}`
            : "Not assessed"}
        </p>
      ) : null}
      <div className="eoc-lw-card-meta">
        <Meta icon="participants" label="Source">{item.source}</Meta>
        <Meta icon="clock" label="Assessed">
          {timeOfDay(item.assessedAt)}
          {props.overdue ? <span className="eoc-lw-overdue"> · update overdue</span> : null}
        </Meta>
      </div>
      <button ref={props.buttonRef} type="button" className="eoc-lifeline-open" aria-pressed={props.selected}
        aria-label={`Open ${item.label} details`} onClick={props.onOpen} />
    </article>
  );
}

/** A linked action's glyph: an inspection or survey reads as a search, other work as its request. */
function actionGlyph(action: { readonly title: string; readonly resourceRequestId?: string | null }): "search" | "report" {
  if (/inspect|survey|assess|check/i.test(action.title)) return "search";
  return action.resourceRequestId || /request/i.test(action.title) ? "report" : "search";
}

function componentIcon(label: string, lifeline: LifelineKey): ReactNode {
  const name = label.toLowerCase();
  if (/electric|power|grid/.test(name)) return <Icon name="power" size={20} decorative />;
  if (/fuel|gas/.test(name)) return <Icon name="fuel" size={20} decorative />;
  return <LifelineIcon decorative lifeline={lifeline} size={20} />;
}

type DetailMode = "overview" | "update" | "history";

interface DrawerRelations {
  readonly incidentJurisdictionId?: string | null;
  readonly relationshipBoards?: readonly Pick<BoardListItem, "id" | "title">[];
  readonly onOpenTask?: (id: string) => void;
  readonly onOpenResourceRequest?: (id: string) => void;
  readonly onOpenIap?: (id: string) => void;
  readonly onOpenBoardRecord?: (boardId: string, recordId: string) => void;
  readonly onOpenMapFeature?: (datasetId: string, featureId: string) => void;
  readonly onOpenEsf?: (id: string) => void;
}

function relationProps(props: DrawerRelations) {
  return {
    ...(props.incidentJurisdictionId !== undefined ? { jurisdictionId: props.incidentJurisdictionId } : {}),
    ...(props.relationshipBoards ? { boards: props.relationshipBoards } : {}),
    ...(props.onOpenTask ? { onOpenTask: props.onOpenTask } : {}),
    ...(props.onOpenResourceRequest ? { onOpenResourceRequest: props.onOpenResourceRequest } : {}),
    ...(props.onOpenIap ? { onOpenIap: props.onOpenIap } : {}),
    ...(props.onOpenBoardRecord ? { onOpenBoardRecord: props.onOpenBoardRecord } : {}),
    ...(props.onOpenMapFeature ? { onOpenMapFeature: props.onOpenMapFeature } : {}),
    ...(props.onOpenEsf ? { onOpenEsf: props.onOpenEsf } : {}),
  };
}

function LifelineDrawer(props: DrawerRelations & {
  readonly client: ApiClient;
  readonly incidentId: string;
  readonly item: LifelineCardView;
  readonly currentState: LifelineCurrentState | undefined;
  readonly currentReport: LifelineAssessmentReport | null;
  readonly period: { readonly label: string; readonly startsAt: string; readonly endsAt: string } | null;
  readonly periodNote: string | null;
  readonly organizationNames: ReadonlyMap<string, string>;
  readonly mode: DetailMode;
  readonly refreshToken: number;
  readonly savedNotice: string | null;
  readonly drawerRef: RefObject<HTMLElement | null>;
  readonly onMode: (mode: DetailMode) => void;
  readonly onSaved: (report: LifelineAssessmentReport) => void;
  readonly onDecision: () => void;
  readonly onClose: () => void;
}) {
  const { item } = props;
  const report = item.report;
  const components = componentItems(report);
  const actions = linkedActions(report, props.organizationNames);
  const outlook = report ? item.outlook : null;
  const overdue = updateOverdue(report, new Date());
  const assessor = report ? report.attribution.positionTitle ?? report.attribution.personName : null;
  return (
    <aside ref={props.drawerRef} className="eoc-lifeline-drawer" data-condition={item.condition}
      aria-labelledby="eoc-lifeline-detail-title" tabIndex={-1}>
      <header>
        <span className="eoc-lw-drawer-icon" aria-hidden="true"><LifelineIcon decorative lifeline={item.key} size={32} /></span>
        <div>
          <h2 id="eoc-lifeline-detail-title">{item.label}</h2>
          <span>Community Lifeline</span>
        </div>
        <button type="button" className="eoc-lw-close" aria-label={`Close ${item.label} details`} onClick={props.onClose}>
          <Icon name="close" size={20} decorative />
        </button>
      </header>
      {props.savedNotice ? <p className="eoc-lifeline-form-success" role="status">{props.savedNotice}</p> : null}
      {props.mode === "update" ? (
        <div className="eoc-lw-drawer-body">
          <button type="button" className="eoc-lw-back" onClick={() => props.onMode("overview")}>Back to {item.label}</button>
          <h3 className="eoc-lw-drawer-heading">Update assessment</h3>
          <LifelineAssessmentForm client={props.client} incidentId={props.incidentId} lifeline={item.key}
            period={props.period} currentReport={props.currentReport} onSaved={props.onSaved}
            onCancel={() => props.onMode("overview")} />
        </div>
      ) : props.mode === "history" ? (
        <div className="eoc-lw-drawer-body">
          <button type="button" className="eoc-lw-back" onClick={() => props.onMode("overview")}>Back to {item.label}</button>
          <h3 className="eoc-lw-drawer-heading">Assessment history</h3>
          {/* The standing report's particulars and its recorded links sit with its history. */}
          <details className="eoc-lw-details">
            <summary>Assessment details</summary>
            <dl>
              <div><dt>Reporting organization</dt><dd>{item.source}</dd></div>
              <div><dt>Assessed</dt><dd>{item.assessedLabel}</dd></div>
              <div><dt>Confidence and evidence</dt><dd>{item.evidence}</dd></div>
              <div><dt>Freshness</dt><dd>{item.freshnessLabel}</dd></div>
              {outlook && outlook !== "Outlook not reported" ? <div><dt>Outlook</dt><dd>{outlook}</dd></div> : null}
            </dl>
            <p className="eoc-lifeline-callout">Exposure and ESF activation do not determine this assessed condition.</p>
          </details>
          <AssessmentRelationships client={props.client} incidentId={props.incidentId}
            source={{ domain: "lifeline", framework: "fema_community_lifelines", definitionKey: item.key }}
            {...relationProps(props)} />
          <LifelineAssessmentHistory client={props.client} incidentId={props.incidentId} lifeline={item.key}
            currentState={props.currentState} refreshToken={props.refreshToken} onDecision={props.onDecision} />
        </div>
      ) : (
        <>
          <div className="eoc-lw-drawer-body">
            <ConditionPill condition={item.condition} />
            <p className="eoc-lw-drawer-assessed">
              {report ? `Assessed ${timeOfDay(report.assessedAt)} · ${assessor}` : "No assessment in this period"}
            </p>
            {props.periodNote ? <p className="eoc-lw-drawer-note">{props.periodNote}</p> : null}
            <p className="eoc-lw-drawer-impact">{item.impact}</p>
            {item.conflict ? (
              <p className="eoc-lifeline-callout">
                {item.conflictResolved
                  ? "The displayed condition follows an attributed assessment decision; conflicting reports remain in history."
                  : "No report is presented as authoritative until the conflict is resolved. Open the history to decide."}
              </p>
            ) : null}
            <section className="eoc-lw-fact">
              <Icon name="datasets" size={20} decorative />
              <div>
                <h3>Affected components</h3>
                {components.length === 0 ? <p>Not reported</p> : (
                  <ul className="eoc-lw-components">
                    {components.map((component) => (
                      <li key={component.label}
                        title={[component.condition && component.condition !== item.condition ? conditionLabel(component.condition as LifelineCondition) : null, component.geography].filter(Boolean).join(" · ") || undefined}>
                        {componentIcon(component.label, item.key)}
                        {component.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
            <section className="eoc-lw-fact">
              <Icon name="target" size={20} decorative />
              <div>
                <h3>Stabilization objective</h3>
                <p>{report?.stabilizationObjective ?? "Not set"}</p>
              </div>
            </section>
            <section className="eoc-lw-fact">
              <Icon name="clock" size={20} decorative />
              <div>
                <h3>Next update</h3>
                <p>
                  {report?.nextUpdateAt ? timeOfDay(report.nextUpdateAt) : "Not scheduled"}
                  {overdue ? <span className="eoc-lw-overdue"> · overdue</span> : null}
                </p>
              </div>
            </section>
            <section className="eoc-lw-actions" aria-labelledby="eoc-lw-actions-title">
              <h3 id="eoc-lw-actions-title">Linked actions ({actions.length})</h3>
              {actions.length === 0 ? <p className="eoc-lw-muted">No stabilization actions recorded.</p> : (
                <ul>
                  {actions.map((action) => {
                    const body = (
                      <>
                        <Icon name={actionGlyph(action)} size={20} decorative />
                        <span><strong>{action.title}</strong><span>{action.owner}</span></span>
                        <span className="eoc-lw-status" data-status={action.status}>{action.statusLabel}</span>
                      </>
                    );
                    return (
                      <li key={action.key}>
                        {action.resourceRequestId && props.onOpenResourceRequest ? (
                          <button type="button" onClick={() => props.onOpenResourceRequest!(action.resourceRequestId!)}>
                            {body}<Icon name="chevronRight" size={16} decorative />
                          </button>
                        ) : <div>{body}</div>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
          <footer className="eoc-lw-drawer-foot">
            <button type="button" className="eoc-lw-button is-primary" onClick={() => props.onMode("update")}>
              <Icon name="edit" size={20} decorative />Update assessment
            </button>
            <button type="button" className="eoc-lw-button" onClick={() => props.onMode("history")}>
              <Icon name="clock" size={20} decorative />View history
            </button>
          </footer>
        </>
      )}
    </aside>
  );
}

function NewAssessmentDrawer(props: {
  readonly client: ApiClient;
  readonly incidentId: string;
  readonly states: readonly LifelineCurrentState[];
  readonly period: { readonly label: string; readonly startsAt: string; readonly endsAt: string } | null;
  readonly initial: LifelineKey;
  readonly drawerRef: RefObject<HTMLElement | null>;
  readonly onSaved: (report: LifelineAssessmentReport) => void;
  readonly onClose: () => void;
}) {
  const [lifeline, setLifeline] = useState<LifelineKey>(props.initial);
  const state = props.states.find((candidate) => candidate.lifeline === lifeline);
  // A new assessment supersedes the one that stands, unless reports conflict.
  const current = state?.decision
    ? state.reports.find((report) => report.id === state.decision?.selectedAssessmentId) ?? null
    : state && !state.conflict ? state.reports[0] ?? null : null;
  return (
    <aside ref={props.drawerRef} className="eoc-lifeline-drawer" aria-labelledby="eoc-lw-new-title" tabIndex={-1}>
      <header>
        <div>
          <h2 id="eoc-lw-new-title">New assessment</h2>
          <span>Community Lifeline</span>
        </div>
        <button type="button" className="eoc-lw-close" aria-label="Close new assessment" onClick={props.onClose}>
          <Icon name="close" size={20} decorative />
        </button>
      </header>
      <div className="eoc-lw-drawer-body">
        <label className="eoc-lw-field">Lifeline
          <select value={lifeline} onChange={(event) => setLifeline(event.target.value as LifelineKey)}>
            {LIFELINE_KEYS.map((key) => <option key={key} value={key}>{LIFELINE_LABELS[key]}</option>)}
          </select>
        </label>
        <LifelineAssessmentForm key={lifeline} client={props.client} incidentId={props.incidentId} lifeline={lifeline}
          period={props.period} currentReport={current} onSaved={props.onSaved} onCancel={props.onClose} />
      </div>
    </aside>
  );
}

function currentEsfReport(state: EsfCurrentState) {
  if (state.decision) return state.reports.find((report) => report.id === state.decision?.selectedAssessmentId) ?? null;
  return state.conflict ? null : state.reports[0] ?? null;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** "CA ESF 12 · Utilities" from "California ESF 12: Utilities". */
function shortEsfLabel(state: EsfCurrentState): string {
  return esfLabel(state.framework, state.esf).replace(/^California /, "CA ").replace(/^Federal /, "").replace(": ", " · ");
}

function RelatedEsfCoordination(props: {
  readonly states: readonly EsfCurrentState[];
  readonly organizationNames: ReadonlyMap<string, string>;
  /** The open lifeline, whose supporting functions list first. */
  readonly focus: LifelineKey | null;
  readonly onOpenEsf?: (id: string) => void;
}) {
  const rows = props.states.flatMap((state) => {
    const report = currentEsfReport(state);
    const related = strings(report?.payload.relatedLifelines);
    return report && state.activation && state.activation !== "not_activated" && related.length > 0 ? [{ state, report }] : [];
  });
  const california = rows.some((row) => row.state.framework === "california");
  const number = (key: string) => Number(/\d+/.exec(key)?.[0] ?? 0);
  const supports = (row: (typeof rows)[number]) => props.focus !== null && strings(row.report.payload.relatedLifelines).includes(props.focus);
  const shown = rows.filter((row) => row.state.framework === (california ? "california" : "federal"))
    .sort((a, b) => Number(supports(b)) - Number(supports(a)) || number(a.state.esf) - number(b.state.esf));
  return (
    <section className="eoc-lw-esf" aria-labelledby="eoc-lw-esf-title">
      <header>
        <h3 id="eoc-lw-esf-title">Related ESF coordination</h3>
        <span>{california ? "California framework" : "Federal framework"}</span>
      </header>
      {shown.length === 0 ? <p className="eoc-lw-muted">No activated function reports a related lifeline in this incident.</p> : (
        <table>
          <thead><tr><th scope="col">Function</th><th scope="col">Activation</th><th scope="col">Coordinator</th><th scope="col">Open missions</th></tr></thead>
          <tbody>
            {shown.map(({ state, report }) => {
              // The coordinating liaison, by the title it reports under, as the frame names it.
              const organization = typeof report.payload.coordinatorOrganizationId === "string"
                ? props.organizationNames.get(report.payload.coordinatorOrganizationId) ?? report.attribution.homeOrganizationName
                : report.attribution.homeOrganizationName;
              const coordinator = report.attribution.positionTitle ?? organization;
              return (
                <tr key={`${state.framework}:${state.esf}`}>
                  <th scope="row">
                    {props.onOpenEsf
                      ? <button type="button" onClick={() => props.onOpenEsf!(state.esf)}>{shortEsfLabel(state)}</button>
                      : shortEsfLabel(state)}
                  </th>
                  <td><span className="eoc-lw-status" data-status={state.activation}>{state.activation === "activated" ? "Active" : conditionCase(state.activation)}</span></td>
                  <td title={organization}>{coordinator}</td>
                  <td>{strings(report.payload.missions).length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function conditionCase(value: string | null): string {
  return value ? value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase()) : "Not assessed";
}

function DependenciesView(props: {
  readonly cards: readonly LifelineCardView[];
  readonly esfStates: readonly EsfCurrentState[];
  readonly onOpen: (key: LifelineKey) => void;
}) {
  const rows = props.cards.flatMap((card) => componentItems(card.report)
    .filter((component) => component.dependencies.length > 0 || component.causes.length > 0)
    .map((component) => ({ card, component })));
  const supporting = LIFELINE_KEYS.map((key) => ({
    key,
    functions: props.esfStates.flatMap((state) => {
      const report = currentEsfReport(state);
      return report && strings(report.payload.relatedLifelines).includes(key) ? [shortEsfLabel(state)] : [];
    }),
  })).filter((row) => row.functions.length > 0);
  return (
    <div className="eoc-lw-panel">
      <section aria-labelledby="eoc-lw-deps-title">
        <h3 id="eoc-lw-deps-title">Component dependencies</h3>
        <p className="eoc-lw-muted">What each assessed component depends on and what is driving its condition, from the standing assessments.</p>
        {rows.length === 0 ? <p>No dependencies are reported. Record them under Component assessments when updating an assessment.</p> : (
          <table>
            <thead><tr><th scope="col">Lifeline</th><th scope="col">Component</th><th scope="col">Depends on</th><th scope="col">Causes</th></tr></thead>
            <tbody>
              {rows.map(({ card, component }) => (
                <tr key={`${card.key}:${component.label}`}>
                  <th scope="row"><button type="button" onClick={() => props.onOpen(card.key)}>{card.label}</button></th>
                  <td>{component.label}</td>
                  <td>{component.dependencies.join("; ") || "None reported"}</td>
                  <td>{component.causes.join("; ") || "None reported"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section aria-labelledby="eoc-lw-support-title">
        <h3 id="eoc-lw-support-title">Functions supporting each lifeline</h3>
        {supporting.length === 0 ? <p>No emergency support function reports a related lifeline.</p> : (
          <table>
            <thead><tr><th scope="col">Lifeline</th><th scope="col">Emergency support functions</th></tr></thead>
            <tbody>
              {supporting.map((row) => (
                <tr key={row.key}><th scope="row">{LIFELINE_LABELS[row.key]}</th><td>{row.functions.join("; ")}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function HistoryView(props: {
  readonly history: Readonly<Record<string, readonly LifelineAssessmentReport[]>> | null;
  readonly standing: ReadonlySet<string>;
  readonly error: string | null;
  readonly onOpen: (key: LifelineKey) => void;
}) {
  if (!props.history) return props.error ? <ErrorState title="Assessment history unavailable" message={props.error} /> : <LoadingState label="Loading assessment history" lines={4} />;
  const rows = LIFELINE_KEYS.flatMap((key) => (props.history![key] ?? []).map((report) => ({ key, report })))
    .sort((a, b) => Date.parse(b.report.assessedAt) - Date.parse(a.report.assessedAt));
  return (
    <div className="eoc-lw-panel">
      <section aria-labelledby="eoc-lw-history-title">
        <h3 id="eoc-lw-history-title">Assessment history</h3>
        {rows.length === 0 ? <p>No lifeline has been assessed in this incident.</p> : (
          <table>
            <thead><tr><th scope="col">Assessed</th><th scope="col">Lifeline</th><th scope="col">Condition</th><th scope="col">Period</th><th scope="col">Assessed by</th><th scope="col">Standing</th></tr></thead>
            <tbody>
              {rows.map(({ key, report }) => {
                const condition = (CONDITIONS as readonly string[]).includes(report.condition) ? report.condition as LifelineCondition : "unknown";
                const period = typeof report.payload.operationalPeriod === "string" ? report.payload.operationalPeriod : "Not recorded";
                return (
                  <tr key={report.id}>
                    <td>{formatAssessmentTime(report.assessedAt)}</td>
                    <th scope="row"><button type="button" onClick={() => props.onOpen(key)}>{LIFELINE_LABELS[key]}</button></th>
                    <td><ConditionPill condition={condition} /></td>
                    <td>{period}</td>
                    <td>{report.attribution.personName}{report.attribution.positionTitle ? ` · ${report.attribution.positionTitle}` : ""} · {report.attribution.homeOrganizationName}</td>
                    <td>{props.standing.has(report.id) ? "Current" : "Superseded"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export function LifelinesSurface(props: LifelinesSurfaceProps) {
  const [detailMode, setDetailMode] = useState<DetailMode>("overview");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [compare, setCompare] = useState(false);
  const [areaFilter, setAreaFilter] = useState("");
  const [conditionFilter, setConditionFilter] = useState<"" | LifelineCondition>("");
  const overview = usePolled(
    () => props.incidentId ? props.client.listIncidentLifelineAssessments(props.incidentId) : Promise.resolve(null),
    REFRESH_MS,
    [props.incidentId],
  );
  const area = usePolled(
    () => props.incidentId ? props.client.getIncidentArea(props.incidentId) : Promise.resolve(null),
    REFRESH_MS,
    [props.incidentId],
  );
  const history = useAsync(
    async () => {
      if (!props.incidentId) return null;
      const incidentId = props.incidentId;
      const entries = await Promise.all(LIFELINE_KEYS.map(async (key) =>
        [key, (await props.client.lifelineAssessmentHistory(incidentId, key)).reports] as const));
      return Object.fromEntries(entries) as Record<string, readonly LifelineAssessmentReport[]>;
    },
    [props.incidentId, historyVersion],
  );
  const esf = useAsync(
    () => props.incidentId ? props.client.listIncidentEsfAssessments(props.incidentId).catch(() => null) : Promise.resolve(null),
    [props.incidentId],
  );
  const participants = useAsync(
    () => props.incidentId ? props.client.listIncidentParticipants(props.incidentId).catch(() => []) : Promise.resolve([]),
    [props.incidentId],
  );
  const cardButtons = useRef(new Map<LifelineKey, HTMLButtonElement>());
  const drawerRef = useRef<HTMLElement>(null);
  const priorSelection = useRef<LifelineKey | null>(null);
  const selectedKey = isLifelineKey(props.selectedLifeline) ? props.selectedLifeline : null;
  const refreshError = overview.error ?? area.error;
  const periods = [...(props.periods ?? [])].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const selectedPeriod = periods.find((period) => period.revision === props.selectedPeriodRevision) ?? null;
  const incidentPeriod = area.data?.operationalPeriod ?? null;
  // The incident's own period shows the standing assessments; an earlier one, the reports that stood then.
  const current = !selectedPeriod || !incidentPeriod || selectedPeriod.label === incidentPeriod.label;
  const shownPeriod = current ? incidentPeriod : selectedPeriod;
  const previousPeriod = selectedPeriod
    ? periods[periods.indexOf(selectedPeriod) - 1] ?? null
    : incidentPeriod ? periods.filter((period) => Date.parse(period.startsAt) < Date.parse(incidentPeriod.startsAt)).at(-1) ?? null : null;

  const states = useMemo(() => LIFELINE_KEYS.map((key) => current
    ? overview.data?.states.find((state) => state.lifeline === key)
    : stateOf(key, selectedPeriod ? reportInPeriod(history.data?.[key] ?? [], selectedPeriod) : null)),
  [current, overview.data, history.data, selectedPeriod]);
  const cards = useMemo(() => LIFELINE_KEYS.map((key, index) => projectLifeline(
    states[index], key, shownPeriod, new Date(), Boolean(current && refreshError && overview.data),
  )), [states, shownPeriod, current, refreshError, overview.data]);

  const organizationNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const participant of participants.data ?? []) names.set(participant.organizationId, participant.organizationName);
    for (const reports of Object.values(history.data ?? {})) {
      for (const report of reports) names.set(report.attribution.homeOrganizationId, report.attribution.homeOrganizationName);
    }
    for (const state of esf.data?.states ?? []) {
      for (const report of state.reports) names.set(report.attribution.homeOrganizationId, report.attribution.homeOrganizationName);
    }
    return names;
  }, [participants.data, history.data, esf.data]);

  const geographies = [...new Set(cards.flatMap((card) => componentItems(card.report).flatMap((item) => item.geography ? [item.geography] : [])))];
  const shownCards = cards.filter((card) =>
    (!conditionFilter || card.condition === conditionFilter) &&
    (!areaFilter || componentItems(card.report).some((item) => item.geography === areaFilter)));
  const comparisons = new Map<LifelineKey, Comparison>(compare && previousPeriod
    ? LIFELINE_KEYS.map((key) => {
        const earlier = reportInPeriod(history.data?.[key] ?? [], previousPeriod);
        const condition = earlier && (CONDITIONS as readonly string[]).includes(earlier.condition) ? earlier.condition as LifelineCondition : null;
        return [key, { label: previousPeriod.label, condition }];
      })
    : []);

  const selected = selectedKey ? cards.find((item) => item.key === selectedKey) ?? null : null;
  const selectedState = selectedKey ? overview.data?.states.find((state) => state.lifeline === selectedKey) : undefined;
  const currentReport = selectedState?.decision
    ? selectedState.reports.find((report) => report.id === selectedState.decision?.selectedAssessmentId) ?? null
    : selectedState && !selectedState.conflict ? selectedState.reports[0] ?? null : null;
  const standing = new Set((overview.data?.states ?? []).flatMap((state) => state.reports.map((report) => report.id)));

  useEffect(() => {
    const previous = priorSelection.current;
    priorSelection.current = selectedKey;
    setDetailMode("overview");
    setSavedNotice(null);
    if (selectedKey) {
      setCreating(false);
      drawerRef.current?.focus();
    } else if (previous) cardButtons.current.get(previous)?.focus();
  }, [selectedKey, props.incidentId]);
  useEffect(() => { if (creating) drawerRef.current?.focus(); }, [creating]);

  function assessmentSaved(report: LifelineAssessmentReport) {
    setHistoryVersion((value) => value + 1);
    setSavedNotice(`Assessment recorded at ${new Date(report.attribution.recordedAt).toLocaleString()}.`);
    setDetailMode("overview");
    overview.reload();
  }

  function decisionSaved() {
    setHistoryVersion((value) => value + 1);
    setSavedNotice("Assessment decision recorded with attribution.");
    overview.reload();
  }

  const standingStatus = props.jurisdictionId
    ? <JurisdictionLifelines client={props.client} jurisdictionId={props.jurisdictionId} canWrite={props.canWrite ?? false} />
    : null;
  if (!props.incidentId) {
    return <>
      <EmptyState title="Select an incident" description="Community Lifeline conditions are scoped to an incident." />
      {standingStatus}
    </>;
  }
  if ((overview.loading && !overview.data) || (area.loading && !area.data)) {
    return <LoadingState label="Loading Community Lifelines" lines={6} />;
  }
  if ((!overview.data || !area.data) && refreshError) {
    return (
      <ErrorState
        title="Community Lifelines unavailable"
        message={refreshError}
        action={<button type="button" className="eoc-lifeline-retry" onClick={() => { overview.reload(); area.reload(); }}>Try again</button>}
      />
    );
  }
  if (!overview.data || !area.data) {
    return <EmptyState title="Community Lifelines unavailable" description="No incident assessment response was returned." />;
  }

  const view = props.view ?? null;
  const tab: LifelineTab = view ?? "lifelines";
  const openTab = (next: LifelineTab) => {
    if (next === "esf") props.onOpenEsfs?.();
    else props.onView?.(next);
  };
  const drawerOpen = creating || selected !== null;
  const periodNote = !current && shownPeriod ? `As assessed in ${shownPeriod.label}. Updating records a new assessment for ${incidentPeriod?.label ?? "the current period"}.` : null;

  return (
    <section className="eoc-lw" aria-label="ESFs and Lifelines">
      <PageActions>
        <button type="button" className="eoc-page-action" aria-pressed={compare} onClick={() => setCompare((on) => !on)}>
          <Icon name="compare" size={20} decorative />Compare periods
        </button>
        <button type="button" className="eoc-page-action is-primary" onClick={() => { setCreating(true); setSavedNotice(null); }}>
          <Icon name="add" size={20} decorative />New assessment
        </button>
      </PageActions>
      <div className={`eoc-lw-layout${drawerOpen ? " has-drawer" : ""}`}>
        <div className="eoc-lw-main">
          <LifelineTabs active={tab} onSelect={openTab} />
          {refreshError ? (
            <div className="eoc-lifeline-refresh-warning" role="status">Update failed. Showing the last received assessments with stale freshness.</div>
          ) : null}
          {props.selectedLifeline && !selectedKey ? (
            <div className="eoc-lifeline-refresh-warning" role="alert">That Lifeline identifier is not recognized.</div>
          ) : null}
          {compare && !previousPeriod ? (
            <p className="eoc-lifeline-refresh-warning" role="status">There is no earlier operational period to compare with.</p>
          ) : null}
          {view === "dependencies" ? (
            <DependenciesView cards={cards} esfStates={esf.data?.states ?? []} onOpen={props.onOpen} />
          ) : view === "history" ? (
            <HistoryView history={history.data ?? null} standing={standing} error={history.error} onOpen={props.onOpen} />
          ) : (
            <>
              <div className="eoc-lw-filters">
                <label>Incident area
                  <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
                    <option value="">Entire incident area</option>
                    {geographies.map((geography) => <option key={geography} value={geography}>{geography}</option>)}
                  </select>
                </label>
                <label>{current ? "Current period" : "Operational period"}
                  <select value={props.selectedPeriodRevision ?? ""} disabled={periods.length === 0 || !props.onSelectPeriod}
                    onChange={(event) => props.onSelectPeriod?.(event.target.value ? Number(event.target.value) : null)}>
                    {periods.length === 0 ? <option value="">Not set</option> : null}
                    {periods.map((period) => <option key={period.revision} value={period.revision}>{periodLabel(period)}</option>)}
                  </select>
                </label>
                <label>All conditions
                  <select value={conditionFilter} onChange={(event) => setConditionFilter(event.target.value as "" | LifelineCondition)}>
                    <option value="">All conditions</option>
                    {CONDITIONS.map((condition) => <option key={condition} value={condition}>{conditionLabel(condition)}</option>)}
                  </select>
                </label>
              </div>
              {compare && previousPeriod ? (
                <p className="eoc-lw-muted eoc-lw-compare-note" role="status">Compared with {periodLabel(previousPeriod)}.</p>
              ) : null}
              {shownCards.length === 0 ? (
                <div className="eoc-lw-empty">
                  <p>No lifeline matches these filters.</p>
                  <button type="button" className="eoc-lw-button" onClick={() => { setAreaFilter(""); setConditionFilter(""); }}>Clear filters</button>
                </div>
              ) : (
                <div className="eoc-lifeline-grid" aria-label="Community Lifeline conditions">
                  {shownCards.map((item) => (
                    <LifelineCard key={item.key} item={item} selected={selectedKey === item.key} current={current}
                      overdue={current && updateOverdue(item.report, new Date())}
                      compare={comparisons.get(item.key) ?? null}
                      buttonRef={(node) => {
                        if (node) cardButtons.current.set(item.key, node);
                        else cardButtons.current.delete(item.key);
                      }}
                      onOpen={() => props.onOpen(item.key)} />
                  ))}
                </div>
              )}
              <RelatedEsfCoordination states={esf.data?.states ?? []} organizationNames={organizationNames} focus={selectedKey}
                {...(props.onOpenEsf ? { onOpenEsf: props.onOpenEsf } : {})} />
            </>
          )}
        </div>
        {creating ? (
          <NewAssessmentDrawer client={props.client} incidentId={props.incidentId} states={overview.data.states}
            period={incidentPeriod} initial={selectedKey ?? "safety_security"} drawerRef={drawerRef}
            onSaved={(report) => {
              setCreating(false);
              assessmentSaved(report);
              props.onOpen(report.lifeline);
            }}
            onClose={() => setCreating(false)} />
        ) : selected ? (
          <LifelineDrawer
            client={props.client}
            incidentId={props.incidentId}
            item={selected}
            currentState={selectedState}
            currentReport={currentReport}
            period={incidentPeriod}
            periodNote={periodNote}
            organizationNames={organizationNames}
            mode={detailMode}
            refreshToken={historyVersion}
            savedNotice={savedNotice}
            drawerRef={drawerRef}
            onMode={(mode) => { setDetailMode(mode); setSavedNotice(null); }}
            onSaved={assessmentSaved}
            onDecision={decisionSaved}
            onClose={props.onClose}
            {...(props.incidentJurisdictionId !== undefined ? { incidentJurisdictionId: props.incidentJurisdictionId } : {})}
            {...(props.relationshipBoards ? { relationshipBoards: props.relationshipBoards } : {})}
            {...(props.onOpenTask ? { onOpenTask: props.onOpenTask } : {})}
            {...(props.onOpenResourceRequest ? { onOpenResourceRequest: props.onOpenResourceRequest } : {})}
            {...(props.onOpenIap ? { onOpenIap: props.onOpenIap } : {})}
            {...(props.onOpenBoardRecord ? { onOpenBoardRecord: props.onOpenBoardRecord } : {})}
            {...(props.onOpenMapFeature ? { onOpenMapFeature: props.onOpenMapFeature } : {})}
            {...(props.onOpenEsf ? { onOpenEsf: props.onOpenEsf } : {})}
          />
        ) : null}
      </div>
      {/* With an incident open, the jurisdiction's standing status sits with the assessment history. */}
      {view === "history" ? standingStatus : null}
    </section>
  );
}
