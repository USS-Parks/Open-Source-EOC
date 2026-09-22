import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { LifelineAssessmentReport, LifelineCurrentState } from "@openeoc/shared";
import type { ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { ConditionBadge, ErrorState, LoadingState } from "../../design/feedback.js";
import { conditionState, formatAssessmentTime, type LifelineCondition } from "./lifeline-view.js";

export interface LifelineAssessmentHistoryProps {
  readonly client: ApiClient;
  readonly incidentId: string;
  readonly lifeline: string;
  readonly currentState: LifelineCurrentState | undefined;
  readonly refreshToken: number;
  readonly onDecision: () => void;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function values(payload: Record<string, unknown>, key: string): readonly unknown[] {
  return Array.isArray(payload[key]) ? payload[key] as readonly unknown[] : [];
}

function condition(report: LifelineAssessmentReport): LifelineCondition {
  return (["stable", "stabilizing", "unstable", "unknown"].includes(report.condition)
    ? report.condition : "unknown") as LifelineCondition;
}

function assignmentLabel(value: unknown): string {
  const assignment = record(value);
  if (!assignment) return "Unassigned";
  if (assignment.kind === "position") {
    return text(assignment.positionTitle) ?? text(assignment.positionId) ?? "Assigned position";
  }
  if (assignment.kind === "incident_participant") {
    return text(assignment.personName) ?? text(assignment.participantId) ?? "Incident participant";
  }
  return "Unassigned";
}

function DetailList(props: { readonly title: string; readonly values: readonly unknown[]; readonly render: (item: Record<string, unknown>, index: number) => ReactNode }) {
  if (props.values.length === 0) return <p className="eoc-lifeline-history-empty">No {props.title.toLowerCase()} recorded.</p>;
  return <section className="eoc-lifeline-history-details"><h4>{props.title}</h4><ul>{props.values.map((value, index) => {
    const item = record(value);
    return item ? <li key={`${props.title}-${index}`}>{props.render(item, index)}</li> : null;
  })}</ul></section>;
}

function HistoryEntry(props: { readonly report: LifelineAssessmentReport; readonly selected: boolean }) {
  const payload = record(props.report.payload) ?? {};
  const components = values(payload, "components");
  const evidence = values(payload, "evidence");
  const actions = values(payload, "actions");
  return (
    <article className="eoc-lifeline-history-entry" data-selected={props.selected || undefined}>
      <header>
        <div><ConditionBadge state={conditionState(condition(props.report))} label={props.report.condition} /><strong>{formatAssessmentTime(props.report.assessedAt)}</strong></div>
        {props.selected ? <span>Selected decision</span> : null}
      </header>
      <p>{text(payload.impactStatement) ?? "Impact not reported"}</p>
      <dl>
        <div><dt>Reported by</dt><dd>{props.report.attribution.personName} · {props.report.attribution.positionTitle ?? "No acting position"}</dd></div>
        <div><dt>Organization</dt><dd>{props.report.attribution.homeOrganizationName}</dd></div>
        <div><dt>Recorded</dt><dd>{formatAssessmentTime(props.report.attribution.recordedAt)}</dd></div>
        <div><dt>Confidence</dt><dd>{text(payload.confidence) ?? "Unknown"}</dd></div>
        <div><dt>Operational period</dt><dd>{text(payload.operationalPeriod) ?? "Not recorded"}</dd></div>
        <div><dt>Outlook</dt><dd>{text(payload.stabilizationOutlook) ?? "Not reported"}</dd></div>
      </dl>
      <DetailList title="Components" values={components} render={(item) => <><strong>{text(item.label) ?? "Unnamed component"}</strong><span>{text(item.condition) ?? "unknown"} · {text(item.affectedGeography) ?? "geography not reported"}</span><span>{text(item.impactStatement) ?? "Impact not reported"}</span></>} />
      <DetailList title="Evidence" values={evidence} render={(item) => item.kind === "impact"
        ? <><strong>{text(item.category) ?? "Impact source"}</strong><span>Coverage: {text(item.coverage) ?? "unknown"}</span><span>{text(item.reason) ?? "No limitation recorded"}</span><span>Exposure evidence does not determine condition.</span></>
        : <><strong>Reported evidence</strong><span>{text(item.description) ?? "Description unavailable"}</span><span>{text(item.sourceReference) ?? "Source reference not supplied"}</span></>} />
      <DetailList title="Stabilization actions" values={actions} render={(item) => <><strong>{text(item.title) ?? "Untitled action"}</strong><span>{text(item.status) ?? "status unknown"} · Estimate: {text(item.dueAt) ? formatAssessmentTime(text(item.dueAt)) : "not set"}</span><span>Owner: {assignmentLabel(item.assignment)}</span><span>Resource: {text(item.linkedResourceRequestId) ?? "not linked"}</span></>} />
      {props.report.supersedesAssessmentId ? <p className="eoc-lifeline-lineage">Revises assessment {props.report.supersedesAssessmentId}</p> : null}
    </article>
  );
}

export function LifelineAssessmentHistory(props: LifelineAssessmentHistoryProps) {
  const history = useAsync(
    () => props.client.lifelineAssessmentHistory(props.incidentId, props.lifeline),
    [props.incidentId, props.lifeline, props.refreshToken],
  );
  const [selectedAssessmentId, setSelectedAssessmentId] = useState("");
  const [rationale, setRationale] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    const preferred = props.currentState?.decision?.selectedAssessmentId ?? props.currentState?.reports[0]?.id ?? "";
    setSelectedAssessmentId(preferred);
    setRationale(props.currentState?.decision?.rationale ?? "");
    setDecisionError(null);
  }, [props.currentState?.decision?.id, props.lifeline]);

  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDecisionError(null);
    if (!selectedAssessmentId || !rationale.trim()) {
      setDecisionError("Choose a current report and explain the decision.");
      return;
    }
    setDeciding(true);
    try {
      await props.client.decideLifelineAssessment(props.incidentId, props.lifeline, {
        selectedAssessmentId,
        rationale: rationale.trim(),
      });
      props.onDecision();
    } catch (cause) {
      setDecisionError(cause instanceof Error ? cause.message : "The assessment decision could not be recorded.");
    } finally {
      setDeciding(false);
    }
  }

  return (
    <div className="eoc-lifeline-history">
      {props.currentState?.conflict ? (
        <form className="eoc-lifeline-decision" aria-labelledby="eoc-lifeline-decision-title" onSubmit={decide}>
          <h3 id="eoc-lifeline-decision-title">Resolve current conflict</h3>
          <p>Choose one current attributed report. Other reports remain in history.</p>
          <fieldset><legend>Current reports</legend>{props.currentState.reports.map((report) => <label key={report.id}><input type="radio" name="assessment-decision" value={report.id} checked={selectedAssessmentId === report.id} onChange={() => setSelectedAssessmentId(report.id)} /><span><strong>{report.condition}</strong> · {report.attribution.homeOrganizationName} · {formatAssessmentTime(report.assessedAt)}</span></label>)}</fieldset>
          <label>Decision rationale<textarea required rows={3} maxLength={4000} value={rationale} onChange={(event) => setRationale(event.target.value)} /></label>
          {decisionError ? <p role="alert" className="eoc-lifeline-form-error">{decisionError} Your selection and rationale are retained.</p> : null}
          <button type="submit" disabled={deciding}>{deciding ? "Recording decision…" : "Record assessment decision"}</button>
        </form>
      ) : null}
      {history.loading && !history.data ? <LoadingState label="Loading assessment history" lines={4} /> : null}
      {history.error && !history.data ? <ErrorState title="Assessment history unavailable" message={history.error} /> : null}
      {history.error && history.data ? <p className="eoc-lifeline-refresh-warning" role="status">History refresh failed. Showing the last received history.</p> : null}
      {history.data?.reports.length === 0 ? <p className="eoc-lifeline-history-empty">No assessments have been recorded for this Lifeline.</p> : null}
      <div className="eoc-lifeline-history-list">
        {history.data?.reports.map((report) => <HistoryEntry key={report.id} report={report} selected={props.currentState?.decision?.selectedAssessmentId === report.id} />)}
      </div>
    </div>
  );
}
