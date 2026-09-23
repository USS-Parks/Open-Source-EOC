import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { LifelineAssessmentReport, LifelineCurrentState, OperationalPeriod } from "@openeoc/shared";
import type { ApiClient, BoardListItem } from "../api/client.js";
import { usePolled } from "../data/hooks.js";
import { ConditionBadge, EmptyState, ErrorState, LoadingState } from "../../design/feedback.js";
import { LifelineIcon, type LifelineKey } from "../../design/icons/index.js";
import {
  LIFELINE_KEYS,
  projectLifeline,
  type LifelineCardView,
} from "./lifeline-view.js";
import { LifelineAssessmentForm } from "./LifelineAssessmentForm.js";
import { LifelineAssessmentHistory } from "./LifelineAssessmentHistory.js";
import { AssessmentRelationships } from "./AssessmentRelationships.js";
import { JurisdictionLifelines } from "./JurisdictionLifelines.js";
import "./LifelinesSurface.css";

const REFRESH_MS = 30_000;

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

function conditionLabel(condition: LifelineCardView["condition"]): string {
  return condition[0]!.toUpperCase() + condition.slice(1);
}

function freshnessState(freshness: LifelineCardView["freshness"]) {
  return freshness === "current" ? "normal" : freshness;
}

function unresolvedLabel(value: number | null): string {
  if (value === null) return "Not reported";
  if (value === 0) return "Zero open actions";
  return `${value} open action${value === 1 ? "" : "s"}`;
}

function LifelineCard(props: {
  readonly item: LifelineCardView;
  readonly selected: boolean;
  readonly buttonRef: (node: HTMLButtonElement | null) => void;
  readonly onOpen: () => void;
}) {
  const { item } = props;
  return (
    <article
      className="eoc-lifeline-card"
      data-condition={item.condition}
      data-freshness={item.freshness}
      data-lifeline={item.key}
      data-selected={props.selected || undefined}
    >
      <header>
        <span className="eoc-lifeline-icon" aria-hidden="true">
          <LifelineIcon decorative lifeline={item.key} size={40} selected={props.selected} />
        </span>
        <div>
          <h3>{item.label}</h3>
          <div className="eoc-lifeline-badges">
            <ConditionBadge state={item.conditionState} label={conditionLabel(item.condition)} />
            <ConditionBadge state={freshnessState(item.freshness)} label={item.freshnessLabel} />
          </div>
        </div>
      </header>
      <p className="eoc-lifeline-impact">{item.impact}</p>
      <dl>
        <div><dt>Components</dt><dd>{item.components}</dd></div>
        <div><dt>Source</dt><dd>{item.source}</dd></div>
        <div><dt>Assessed</dt><dd>{item.assessedLabel}</dd></div>
        <div><dt>Outlook</dt><dd>{item.outlook}</dd></div>
      </dl>
      {item.conflict ? (
        <p className="eoc-lifeline-conflict">
          {item.conflictResolved ? "Conflicting reports resolved by an attributed decision." : "Conflicting reports remain unresolved."}
        </p>
      ) : null}
      <button
        ref={props.buttonRef}
        type="button"
        className="eoc-lifeline-open"
        aria-pressed={props.selected}
        onClick={props.onOpen}
      >
        Open {item.label} details
      </button>
    </article>
  );
}

type LifelineDetailMode = "overview" | "update" | "history";

function LifelineDrawer(props: {
  readonly client: ApiClient;
  readonly incidentId: string;
  readonly item: LifelineCardView;
  readonly currentState: LifelineCurrentState | undefined;
  readonly currentReport: LifelineAssessmentReport | null;
  readonly period: OperationalPeriod | null;
  readonly mode: LifelineDetailMode;
  readonly refreshToken: number;
  readonly savedNotice: string | null;
  readonly drawerRef: RefObject<HTMLElement | null>;
  readonly onMode: (mode: LifelineDetailMode) => void;
  readonly onSaved: (report: LifelineAssessmentReport) => void;
  readonly onDecision: () => void;
  readonly onClose: () => void;
  readonly incidentJurisdictionId?: string | null;
  readonly relationshipBoards?: readonly Pick<BoardListItem, "id" | "title">[];
  readonly onOpenTask?: (id: string) => void;
  readonly onOpenResourceRequest?: (id: string) => void;
  readonly onOpenIap?: (id: string) => void;
  readonly onOpenBoardRecord?: (boardId: string, recordId: string) => void;
  readonly onOpenMapFeature?: (datasetId: string, featureId: string) => void;
  readonly onOpenEsf?: (id: string) => void;
}) {
  const { item } = props;
  return (
    <aside
      ref={props.drawerRef}
      className="eoc-lifeline-drawer"
      aria-labelledby="eoc-lifeline-detail-title"
      tabIndex={-1}
    >
      <header>
        <div>
          <span className="eoc-lifeline-eyebrow">Community Lifeline</span>
          <h2 id="eoc-lifeline-detail-title">{item.label}</h2>
        </div>
        <button type="button" className="eoc-lifeline-close" aria-label={`Close ${item.label} details`} onClick={props.onClose}>×</button>
      </header>
      <nav className="eoc-lifeline-detail-tabs" aria-label={`${item.label} assessment views`}>
        <button type="button" aria-current={props.mode === "overview" ? "page" : undefined} onClick={() => props.onMode("overview")}>Overview</button>
        <button type="button" aria-current={props.mode === "update" ? "page" : undefined} onClick={() => props.onMode("update")}>Update assessment</button>
        <button type="button" aria-current={props.mode === "history" ? "page" : undefined} onClick={() => props.onMode("history")}>History</button>
      </nav>
      {props.savedNotice ? <p className="eoc-lifeline-form-success" role="status">{props.savedNotice}</p> : null}
      {props.mode === "update" ? (
        <LifelineAssessmentForm
          client={props.client}
          incidentId={props.incidentId}
          lifeline={item.key}
          period={props.period}
          currentReport={props.currentReport}
          onSaved={props.onSaved}
          onCancel={() => props.onMode("overview")}
        />
      ) : props.mode === "history" ? (
        <LifelineAssessmentHistory
          client={props.client}
          incidentId={props.incidentId}
          lifeline={item.key}
          currentState={props.currentState}
          refreshToken={props.refreshToken}
          onDecision={props.onDecision}
        />
      ) : (
        <div className="eoc-lifeline-overview-detail">
          <div className="eoc-lifeline-drawer-condition">
            <LifelineIcon decorative lifeline={item.key} size={40} />
            <ConditionBadge state={item.conditionState} label={conditionLabel(item.condition)} />
            <ConditionBadge state={freshnessState(item.freshness)} label={item.freshnessLabel} />
          </div>
          <p className="eoc-lifeline-drawer-impact">{item.impact}</p>
          <dl>
            <div><dt>Affected components</dt><dd>{item.components}</dd></div>
            <div><dt>Affected geography</dt><dd>{item.geography}</dd></div>
            <div><dt>Reporting organization</dt><dd>{item.source}</dd></div>
            <div><dt>Assessed</dt><dd>{item.assessedLabel}</dd></div>
            <div><dt>Confidence and evidence</dt><dd>{item.evidence}</dd></div>
            <div><dt>Stabilization outlook</dt><dd>{item.outlook}</dd></div>
            <div><dt>Unresolved actions</dt><dd>{unresolvedLabel(item.unresolvedActions)}</dd></div>
          </dl>
          {item.conflict ? (
            <p className="eoc-lifeline-callout">
              {item.conflictResolved
                ? "The displayed condition follows an attributed assessment decision; conflicting reports remain in history."
                : "No report is presented as authoritative until the conflict is resolved."}
            </p>
          ) : null}
          <p className="eoc-lifeline-callout">
            Exposure and ESF activation do not determine this assessed condition.
          </p>
          <AssessmentRelationships client={props.client} incidentId={props.incidentId}
            {...(props.incidentJurisdictionId !== undefined ? { jurisdictionId: props.incidentJurisdictionId } : {})}
            {...(props.relationshipBoards ? { boards: props.relationshipBoards } : {})}
            source={{ domain: "lifeline", framework: "fema_community_lifelines", definitionKey: item.key }}
            {...(props.onOpenTask ? { onOpenTask: props.onOpenTask } : {})}
            {...(props.onOpenResourceRequest ? { onOpenResourceRequest: props.onOpenResourceRequest } : {})}
            {...(props.onOpenIap ? { onOpenIap: props.onOpenIap } : {})}
            {...(props.onOpenBoardRecord ? { onOpenBoardRecord: props.onOpenBoardRecord } : {})}
            {...(props.onOpenMapFeature ? { onOpenMapFeature: props.onOpenMapFeature } : {})}
            {...(props.onOpenEsf ? { onOpenEsf: props.onOpenEsf } : {})} />
        </div>
      )}
    </aside>
  );
}


export function LifelinesSurface(props: LifelinesSurfaceProps) {
  const [detailMode, setDetailMode] = useState<LifelineDetailMode>("overview");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const overview = usePolled(
    () => props.incidentId
      ? props.client.listIncidentLifelineAssessments(props.incidentId)
      : Promise.resolve(null),
    REFRESH_MS,
    [props.incidentId],
  );
  const area = usePolled(
    () => props.incidentId ? props.client.getIncidentArea(props.incidentId) : Promise.resolve(null),
    REFRESH_MS,
    [props.incidentId],
  );
  const cardButtons = useRef(new Map<LifelineKey, HTMLButtonElement>());
  const drawerRef = useRef<HTMLElement>(null);
  const priorSelection = useRef<LifelineKey | null>(null);
  const selectedKey = isLifelineKey(props.selectedLifeline) ? props.selectedLifeline : null;
  const refreshError = overview.error ?? area.error;
  const cards = useMemo(() => {
    const states = overview.data?.states ?? [];
    const period = area.data?.operationalPeriod ?? null;
    return LIFELINE_KEYS.map((key) => projectLifeline(
      states.find((state) => state.lifeline === key),
      key,
      period,
      new Date(),
      Boolean(refreshError && overview.data),
    ));
  }, [overview.data, area.data, refreshError]);
  const selected = selectedKey ? cards.find((item) => item.key === selectedKey) ?? null : null;
  const selectedState = selectedKey
    ? overview.data?.states.find((state) => state.lifeline === selectedKey)
    : undefined;
  const currentReport = selectedState?.decision
    ? selectedState.reports.find((report) => report.id === selectedState.decision?.selectedAssessmentId) ?? null
    : selectedState && !selectedState.conflict ? selectedState.reports[0] ?? null : null;

  useEffect(() => {
    const previous = priorSelection.current;
    priorSelection.current = selectedKey;
    setDetailMode("overview");
    setSavedNotice(null);
    if (selectedKey) drawerRef.current?.focus();
    else if (previous) cardButtons.current.get(previous)?.focus();
  }, [selectedKey, props.incidentId]);

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

  const standing = props.jurisdictionId
    ? <JurisdictionLifelines client={props.client} jurisdictionId={props.jurisdictionId} canWrite={props.canWrite ?? false} />
    : null;
  if (!props.incidentId) {
    return <>
      <EmptyState title="Select an incident" description="Community Lifeline conditions are scoped to an incident." />
      {standing}
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

  return (
    <section className="eoc-lifelines" aria-labelledby="eoc-lifelines-title">
      <header className="eoc-lifelines-heading">
        <div>
          <span className="eoc-lifeline-eyebrow">Situation</span>
          <h2 id="eoc-lifelines-title">Community Lifelines</h2>
          <p>Essential service conditions from attributed incident assessments.</p>
        </div>
        <span className="eoc-lifelines-definition">FEMA framework · definition v{overview.data.definition.version}</span>
        {props.onOpenEsfs ? <button type="button" className="eoc-lifeline-retry" onClick={props.onOpenEsfs}>ESF coordination</button> : null}
      </header>
      {refreshError ? (
        <div className="eoc-lifeline-refresh-warning" role="status">
          Update failed. Showing the last received assessments with stale freshness.
        </div>
      ) : null}
      {props.selectedLifeline && !selectedKey ? (
        <div className="eoc-lifeline-refresh-warning" role="alert">That Lifeline identifier is not recognized.</div>
      ) : null}
      <div className={`eoc-lifeline-layout${selected ? " has-drawer" : ""}`}>
        <div className="eoc-lifeline-grid" aria-label="Community Lifeline conditions">
          {cards.map((item) => (
            <LifelineCard
              key={item.key}
              item={item}
              selected={selectedKey === item.key}
              buttonRef={(node) => {
                if (node) cardButtons.current.set(item.key, node);
                else cardButtons.current.delete(item.key);
              }}
              onOpen={() => props.onOpen(item.key)}
            />
          ))}
        </div>
        {selected ? (
          <LifelineDrawer
            client={props.client}
            incidentId={props.incidentId}
            item={selected}
            currentState={selectedState}
            currentReport={currentReport}
            period={area.data.operationalPeriod}
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
      {standing}
    </section>
  );
}
