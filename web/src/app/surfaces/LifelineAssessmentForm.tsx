import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  IMPACT_CATEGORIES,
  type CreateLifelineAssessment,
  type IncidentParticipantGrant,
  type LifelineAssessmentReport,
  type OperationalPeriod,
} from "@openeoc/shared";
import type {
  ApiClient,
  PositionRef,
  ResourceRequestSummary,
} from "../api/client.js";
import { useIncident } from "../incident/context.js";
import type { LifelineKey } from "../../design/icons/index.js";

interface ComponentDraft {
  readonly id: number;
  readonly key: string;
  label: string;
  condition: "stable" | "stabilizing" | "unstable" | "unknown";
  impactStatement: string;
  affectedGeography: string;
  causes: string;
  dependencies: string;
}

interface EvidenceDraft {
  readonly id: number;
  description: string;
  sourceOrganizationId: string;
  sourceReference: string;
  observedAt: string;
}

interface ActionDraft {
  readonly id: number;
  readonly key: string;
  title: string;
  status: "planned" | "in_progress" | "blocked" | "complete";
  dueAt: string;
  responsibleOrganizationId: string;
  assignment: string;
  linkedResourceRequestId: string;
  linkedBoardRecordId: string;
}

interface ReferenceOptions {
  readonly positions: readonly PositionRef[];
  readonly participants: readonly IncidentParticipantGrant[];
  readonly resources: readonly ResourceRequestSummary[];
  readonly unavailable: boolean;
}

export interface LifelineAssessmentFormProps {
  readonly client: ApiClient;
  readonly incidentId: string;
  readonly lifeline: LifelineKey;
  readonly period: OperationalPeriod | null;
  readonly currentReport: LifelineAssessmentReport | null;
  readonly onSaved: (report: LifelineAssessmentReport) => void;
  readonly onCancel: () => void;
}

let rowSequence = 0;
const nextRowId = () => ++rowSequence;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function splitList(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function keyFor(prefix: string, label: string, index: number): string {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const start = /^[a-z]/.test(normalized) ? normalized : `${prefix}_${normalized}`;
  return `${start || prefix}_${index + 1}`.slice(0, 80);
}

function localDateTime(value: string | null, fallbackToNow = false): string {
  if (!value && !fallbackToNow) return "";
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function isoDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function componentDrafts(report: LifelineAssessmentReport | null): ComponentDraft[] {
  const payload = record(report?.payload);
  const values = Array.isArray(payload?.components) ? payload.components : [];
  return values.flatMap((value) => {
    const item = record(value);
    const label = stringValue(item?.label);
    if (!label) return [];
    const condition = stringValue(item?.condition);
    return [{
      id: nextRowId(),
      key: stringValue(item?.key),
      label,
      condition: (["stable", "stabilizing", "unstable", "unknown"].includes(condition)
        ? condition : "unknown") as ComponentDraft["condition"],
      impactStatement: stringValue(item?.impactStatement),
      affectedGeography: stringValue(item?.affectedGeography),
      causes: Array.isArray(item?.causes) ? item.causes.filter((entry): entry is string => typeof entry === "string").join("\n") : "",
      dependencies: Array.isArray(item?.dependencies) ? item.dependencies.filter((entry): entry is string => typeof entry === "string").join("\n") : "",
    }];
  });
}

function evidenceDrafts(report: LifelineAssessmentReport | null): EvidenceDraft[] {
  const payload = record(report?.payload);
  const values = Array.isArray(payload?.evidence) ? payload.evidence : [];
  return values.flatMap((value) => {
    const item = record(value);
    if (item?.kind !== "reported") return [];
    const description = stringValue(item.description);
    if (!description) return [];
    return [{
      id: nextRowId(),
      description,
      sourceOrganizationId: stringValue(item.sourceOrganizationId),
      sourceReference: stringValue(item.sourceReference),
      observedAt: localDateTime(stringValue(item.observedAt) || null),
    }];
  });
}

function actionDrafts(report: LifelineAssessmentReport | null): ActionDraft[] {
  const payload = record(report?.payload);
  const values = Array.isArray(payload?.actions) ? payload.actions : [];
  return values.flatMap((value) => {
    const item = record(value);
    const title = stringValue(item?.title);
    if (!title) return [];
    const status = stringValue(item?.status);
    const assignment = record(item?.assignmentRequest);
    const assignmentValue = assignment?.kind === "position"
      ? `position:${stringValue(assignment.positionId)}`
      : assignment?.kind === "incident_participant"
        ? `participant:${stringValue(assignment.participantId)}`
        : "";
    return [{
      id: nextRowId(),
      key: stringValue(item?.key),
      title,
      status: (["planned", "in_progress", "blocked", "complete"].includes(status)
        ? status : "planned") as ActionDraft["status"],
      dueAt: localDateTime(stringValue(item?.dueAt) || null),
      responsibleOrganizationId: stringValue(item?.responsibleOrganizationId),
      assignment: assignmentValue,
      linkedResourceRequestId: stringValue(item?.linkedResourceRequestId),
      linkedBoardRecordId: stringValue(item?.linkedBoardRecordId),
    }];
  });
}

function preservedImpactEvidence(report: LifelineAssessmentReport | null): CreateLifelineAssessment["evidence"] {
  const payload = record(report?.payload);
  const values = Array.isArray(payload?.evidence) ? payload.evidence : [];
  return values.flatMap((value) => {
    const item = record(value);
    const category = stringValue(item?.category);
    if (item?.kind !== "impact" || !(IMPACT_CATEGORIES as readonly string[]).includes(category)) return [];
    const areaRevision = typeof item.areaRevision === "number" && Number.isInteger(item.areaRevision) && item.areaRevision > 0
      ? item.areaRevision : undefined;
    const datasetId = stringValue(item.datasetId) || undefined;
    return [{
      kind: "impact" as const,
      category: category as (typeof IMPACT_CATEGORIES)[number],
      ...(areaRevision ? { areaRevision } : {}),
      ...(datasetId ? { datasetId } : {}),
    }];
  });
}

function initialOrganizations(report: LifelineAssessmentReport | null): string[] {
  const values = record(report?.payload)?.responsibleOrganizationIds;
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
}

function initialText(report: LifelineAssessmentReport | null, key: string): string {
  return stringValue(record(report?.payload)?.[key]);
}

export function LifelineAssessmentForm(props: LifelineAssessmentFormProps) {
  const incident = useIncident();
  const baselineReport = useRef(props.currentReport).current;
  const reportCondition = baselineReport?.condition;
  const initialConfidence = initialText(baselineReport, "confidence");
  const [condition, setCondition] = useState<CreateLifelineAssessment["condition"]>(() =>
    (["stable", "stabilizing", "unstable", "unknown"].includes(reportCondition ?? "")
      ? reportCondition : "unknown") as CreateLifelineAssessment["condition"]);
  const [confidence, setConfidence] = useState<CreateLifelineAssessment["confidence"]>(() =>
    (["confirmed", "estimated", "unknown"].includes(initialConfidence)
      ? initialConfidence : "unknown") as CreateLifelineAssessment["confidence"]);
  const [assessedAt, setAssessedAt] = useState(() => localDateTime(baselineReport?.assessedAt ?? null, true));
  const [impactStatement, setImpactStatement] = useState(() => initialText(baselineReport, "impactStatement"));
  const [outlook, setOutlook] = useState(() => initialText(baselineReport, "stabilizationOutlook"));
  const [objective, setObjective] = useState(() => baselineReport?.stabilizationObjective ?? "");
  // Each assessment commits to its own next update; the last one's time has usually passed.
  const [nextUpdate, setNextUpdate] = useState("");
  const [components, setComponents] = useState<ComponentDraft[]>(() => componentDrafts(baselineReport));
  const [evidence, setEvidence] = useState<EvidenceDraft[]>(() => evidenceDrafts(baselineReport));
  const [actions, setActions] = useState<ActionDraft[]>(() => actionDrafts(baselineReport));
  const [references, setReferences] = useState<ReferenceOptions>({ positions: [], participants: [], resources: [], unavailable: false });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const hostJurisdictionId = incident.selectedIncident?.jurisdictionId ?? null;

  useEffect(() => {
    let active = true;
    if (!hostJurisdictionId) return () => { active = false; };
    void Promise.allSettled([
      props.client.listPositions(hostJurisdictionId),
      props.client.listIncidentParticipants(props.incidentId),
      props.client.listResourceRequests(hostJurisdictionId, props.incidentId),
    ]).then(([positions, participants, resources]) => {
      if (!active) return;
      setReferences({
        positions: positions.status === "fulfilled" ? positions.value : [],
        participants: participants.status === "fulfilled"
          ? participants.value.filter((item) => !item.revokedAt && Date.parse(item.expiresAt) > Date.now())
          : [],
        resources: resources.status === "fulfilled" ? resources.value : [],
        unavailable: [positions, participants, resources].some((item) => item.status === "rejected"),
      });
    });
    return () => { active = false; };
  }, [hostJurisdictionId, props.client, props.incidentId]);

  const organizations = useMemo(() => {
    const values = new Map<string, string>();
    if (incident.selectedIncident) values.set(incident.selectedIncident.jurisdictionId, "Incident owner organization");
    for (const participant of references.participants) values.set(participant.organizationId, participant.organizationName);
    return [...values].map(([id, label]) => ({ id, label }));
  }, [incident.selectedIncident, references.participants]);

  function updateComponent(id: number, patch: Partial<ComponentDraft>) {
    setComponents((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
  function updateEvidence(id: number, patch: Partial<EvidenceDraft>) {
    setEvidence((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
  function updateAction(id: number, patch: Partial<ActionDraft>) {
    setActions((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const assessed = isoDateTime(assessedAt);
    if (!assessed) {
      setError("Enter a valid assessment time.");
      return;
    }
    const nextUpdateAt = isoDateTime(nextUpdate);
    if (nextUpdateAt && Date.parse(nextUpdateAt) <= Date.parse(assessed)) {
      setError("The next update must come after the assessment time.");
      return;
    }
    setSubmitting(true);
    try {
      const responsibleOrganizationIds = [...new Set([
        ...initialOrganizations(baselineReport),
        ...actions.flatMap((action) => action.responsibleOrganizationId ? [action.responsibleOrganizationId] : []),
      ])];
      const input: CreateLifelineAssessment = {
        lifeline: props.lifeline,
        definitionVersion: 1,
        condition,
        assessedAt: assessed,
        confidence,
        impactStatement: impactStatement.trim(),
        ...(props.period ? { operationalPeriod: props.period.label } : {}),
        ...(outlook.trim() ? { stabilizationOutlook: outlook.trim() } : {}),
        ...(objective.trim() ? { stabilizationObjective: objective.trim() } : {}),
        ...(nextUpdateAt ? { nextUpdateAt } : {}),
        components: components.map((component, index) => ({
          key: component.key || keyFor("component", component.label, index),
          label: component.label.trim(),
          condition: component.condition,
          ...(component.impactStatement.trim() ? { impactStatement: component.impactStatement.trim() } : {}),
          ...(component.affectedGeography.trim() ? { affectedGeography: component.affectedGeography.trim() } : {}),
          causes: splitList(component.causes),
          dependencies: splitList(component.dependencies),
        })),
        evidence: [
          ...preservedImpactEvidence(baselineReport),
          ...evidence.map((item) => ({
            kind: "reported" as const,
            description: item.description.trim(),
            ...(item.sourceOrganizationId ? { sourceOrganizationId: item.sourceOrganizationId } : {}),
            ...(item.sourceReference.trim() ? { sourceReference: item.sourceReference.trim() } : {}),
            ...(isoDateTime(item.observedAt) ? { observedAt: isoDateTime(item.observedAt)! } : {}),
          })),
        ],
        responsibleOrganizationIds,
        actions: actions.map((action, index) => {
          const [assignmentKind, assignmentId] = action.assignment.split(":", 2);
          const assignment = assignmentKind === "position" && assignmentId
            ? { kind: "position" as const, positionId: assignmentId }
            : assignmentKind === "participant" && assignmentId
              ? { kind: "incident_participant" as const, incidentId: props.incidentId, participantId: assignmentId }
              : undefined;
          return {
            key: action.key || keyFor("action", action.title, index),
            title: action.title.trim(),
            status: action.status,
            ...(isoDateTime(action.dueAt) ? { dueAt: isoDateTime(action.dueAt)! } : {}),
            ...(action.responsibleOrganizationId ? { responsibleOrganizationId: action.responsibleOrganizationId } : {}),
            ...(assignment ? { assignment } : {}),
            ...(action.linkedResourceRequestId ? { linkedResourceRequestId: action.linkedResourceRequestId } : {}),
            ...(action.linkedBoardRecordId ? { linkedBoardRecordId: action.linkedBoardRecordId } : {}),
          };
        }),
        ...(baselineReport ? { supersedesAssessmentId: baselineReport.id } : {}),
      };
      const created = await props.client.createLifelineAssessment(props.incidentId, input);
      setSuccess("Assessment saved with attribution.");
      props.onSaved(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The assessment could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="eoc-lifeline-assessment-form" onSubmit={submit}>
      <div className="eoc-lifeline-form-grid">
        <label>Condition<select value={condition} onChange={(event) => setCondition(event.target.value as typeof condition)}><option value="stable">Stable</option><option value="stabilizing">Stabilizing</option><option value="unstable">Disrupted</option><option value="unknown">Unknown</option></select></label>
        <label>Confidence<select value={confidence} onChange={(event) => setConfidence(event.target.value as typeof confidence)}><option value="confirmed">Confirmed</option><option value="estimated">Estimated</option><option value="unknown">Unknown</option></select></label>
        <label>Assessed at<input type="datetime-local" required value={assessedAt} onChange={(event) => setAssessedAt(event.target.value)} /></label>
        <label>Operational period<input value={props.period?.label ?? "Not set"} readOnly /></label>
      </div>
      <label>Impact explanation<textarea required maxLength={4000} rows={4} value={impactStatement} onChange={(event) => setImpactStatement(event.target.value)} /></label>
      <label>Stabilization objective<textarea maxLength={4000} rows={2} value={objective} onChange={(event) => setObjective(event.target.value)} /></label>
      <label>Stabilization outlook<textarea maxLength={4000} rows={3} value={outlook} onChange={(event) => setOutlook(event.target.value)} /></label>
      <label>Next update<input type="datetime-local" value={nextUpdate} onChange={(event) => setNextUpdate(event.target.value)} /></label>

      <fieldset><legend>Component assessments</legend>
        {components.map((component) => <div className="eoc-lifeline-repeat" key={component.id}>
          <label>Component name<input required maxLength={160} value={component.label} onChange={(event) => updateComponent(component.id, { label: event.target.value })} /></label>
          <label>Condition<select value={component.condition} onChange={(event) => updateComponent(component.id, { condition: event.target.value as ComponentDraft["condition"] })}><option value="stable">Stable</option><option value="stabilizing">Stabilizing</option><option value="unstable">Disrupted</option><option value="unknown">Unknown</option></select></label>
          <label>Affected geography<input maxLength={1000} value={component.affectedGeography} onChange={(event) => updateComponent(component.id, { affectedGeography: event.target.value })} /></label>
          <label>Component impact<textarea rows={2} maxLength={4000} value={component.impactStatement} onChange={(event) => updateComponent(component.id, { impactStatement: event.target.value })} /></label>
          <label>Causes, one per line<textarea rows={2} value={component.causes} onChange={(event) => updateComponent(component.id, { causes: event.target.value })} /></label>
          <label>Dependencies, one per line<textarea rows={2} value={component.dependencies} onChange={(event) => updateComponent(component.id, { dependencies: event.target.value })} /></label>
          <button type="button" onClick={() => setComponents((items) => items.filter((item) => item.id !== component.id))}>Remove component</button>
        </div>)}
        <button type="button" onClick={() => setComponents((items) => [...items, { id: nextRowId(), key: "", label: "", condition: "unknown", impactStatement: "", affectedGeography: "", causes: "", dependencies: "" }])}>Add component</button>
      </fieldset>

      <fieldset><legend>Reported evidence</legend>
        {evidence.map((item) => <div className="eoc-lifeline-repeat" key={item.id}>
          <label>Description<textarea required rows={2} maxLength={4000} value={item.description} onChange={(event) => updateEvidence(item.id, { description: event.target.value })} /></label>
          <label>Source reference<input maxLength={500} value={item.sourceReference} onChange={(event) => updateEvidence(item.id, { sourceReference: event.target.value })} /></label>
          <label>Observed at<input type="datetime-local" value={item.observedAt} onChange={(event) => updateEvidence(item.id, { observedAt: event.target.value })} /></label>
          <button type="button" onClick={() => setEvidence((items) => items.filter((entry) => entry.id !== item.id))}>Remove evidence</button>
        </div>)}
        <button type="button" onClick={() => setEvidence((items) => [...items, { id: nextRowId(), description: "", sourceOrganizationId: "", sourceReference: "", observedAt: "" }])}>Add evidence</button>
      </fieldset>

      <fieldset><legend>Stabilization actions</legend>
        {references.unavailable ? <p className="eoc-lifeline-option-note">Some owner or resource options are unavailable to this session. The assessment can still be submitted without them.</p> : null}
        {actions.map((action) => <div className="eoc-lifeline-repeat" key={action.id}>
          <label>Action title<input required maxLength={240} value={action.title} onChange={(event) => updateAction(action.id, { title: event.target.value })} /></label>
          <label>Status<select value={action.status} onChange={(event) => updateAction(action.id, { status: event.target.value as ActionDraft["status"] })}><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="complete">Complete</option></select></label>
          <label>Estimated completion<input type="datetime-local" value={action.dueAt} onChange={(event) => updateAction(action.id, { dueAt: event.target.value })} /></label>
          <label>Responsible organization<select value={action.responsibleOrganizationId} onChange={(event) => updateAction(action.id, { responsibleOrganizationId: event.target.value })}><option value="">Not assigned</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.label}</option>)}</select></label>
          <label>Assigned owner<select value={action.assignment} onChange={(event) => updateAction(action.id, { assignment: event.target.value })}><option value="">Not assigned</option><optgroup label="Positions">{references.positions.map((position) => <option key={position.id} value={`position:${position.id}`}>{position.title}</option>)}</optgroup><optgroup label="Incident participants">{references.participants.map((participant) => <option key={participant.id} value={`participant:${participant.id}`}>{participant.personName} · {participant.incidentPositionTitle}</option>)}</optgroup></select></label>
          <label>Linked resource request<select value={action.linkedResourceRequestId} onChange={(event) => updateAction(action.id, { linkedResourceRequestId: event.target.value })}><option value="">None</option>{references.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.item} · {resource.state}</option>)}</select></label>
          <button type="button" onClick={() => setActions((items) => items.filter((item) => item.id !== action.id))}>Remove action</button>
        </div>)}
        <button type="button" onClick={() => setActions((items) => [...items, { id: nextRowId(), key: "", title: "", status: "planned", dueAt: "", responsibleOrganizationId: "", assignment: "", linkedResourceRequestId: "", linkedBoardRecordId: "" }])}>Add action</button>
      </fieldset>

      {error ? <p className="eoc-lifeline-form-error" role="alert">{error} Draft values are retained.</p> : null}
      {success ? <p className="eoc-lifeline-form-success" role="status">{success}</p> : null}
      <div className="eoc-lifeline-form-actions"><button type="button" onClick={props.onCancel}>Cancel</button><button type="submit" disabled={submitting}>{submitting ? "Saving assessment…" : baselineReport ? "Save revised assessment" : "Save assessment"}</button></div>
    </form>
  );
}
