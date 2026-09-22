import { useRef, useState, type FormEvent } from "react";
import {
  AssessmentConfidenceSchema,
  CreateEsfAssessmentSchema,
  ESF_ACTIVATION,
  ESF_CAPACITY,
  LIFELINE_DEFINITION,
  ReportedEvidenceSchema,
  StabilizationActionInputSchema,
  type CreateEsfAssessment,
  type EsfAssessmentReport,
  type StabilizationActionInput,
} from "@openeoc/shared";
import { ActionButton } from "../../design/controls.js";
import { ErrorState } from "../../design/feedback.js";

export interface EsfOrganizationOption {
  readonly id: string;
  readonly label: string;
}

export interface EsfAssessmentFormProps {
  readonly framework: "federal" | "california";
  readonly esf: string;
  readonly baseline: EsfAssessmentReport | null;
  readonly operationalPeriod: string | null;
  readonly organizations: readonly EsfOrganizationOption[];
  readonly saving: boolean;
  readonly error: string | null;
  readonly onSubmit: (input: CreateEsfAssessment) => void;
  readonly onCancel: () => void;
}

const CONFIDENCE = AssessmentConfidenceSchema.options;
const ACTION_STATUS = ["planned", "in_progress", "blocked", "complete"] as const;

function localDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function isoDateTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function actionInputs(payload: Record<string, unknown>): StabilizationActionInput[] {
  if (!Array.isArray(payload.actions)) return [];
  return payload.actions.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const source = raw as Record<string, unknown>;
    const candidate = {
      key: source.key,
      title: source.title,
      status: source.status,
      ...(source.dueAt ? { dueAt: source.dueAt } : {}),
      ...(source.responsibleOrganizationId ? { responsibleOrganizationId: source.responsibleOrganizationId } : {}),
      ...(source.assignmentRequest ? { assignment: source.assignmentRequest } : {}),
      ...(source.linkedResourceRequestId ? { linkedResourceRequestId: source.linkedResourceRequestId } : {}),
      ...(source.linkedBoardRecordId ? { linkedBoardRecordId: source.linkedBoardRecordId } : {}),
    };
    const parsed = StabilizationActionInputSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

function reportedEvidence(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.evidence)) return [];
  return payload.evidence.flatMap((item) => {
    const parsed = ReportedEvidenceSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function actionKey(title: string, existing: readonly StabilizationActionInput[]): string {
  const base = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "action";
  const used = new Set(existing.map((item) => item.key));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

export function EsfAssessmentForm(props: EsfAssessmentFormProps) {
  const baselineReport = useRef(props.baseline).current;
  const baselinePayload = baselineReport?.payload ?? {};
  const baselineEvidence = useRef(reportedEvidence(baselinePayload)).current;
  const [actions, setActions] = useState<StabilizationActionInput[]>(() => actionInputs(baselinePayload));
  const [activation, setActivation] = useState(baselineReport?.activation ?? "unknown");
  const [capacity, setCapacity] = useState(baselineReport?.capacity ?? "unknown");
  const [confidence, setConfidence] = useState(stringValue(baselinePayload.confidence) || "unknown");
  const [assessedAt, setAssessedAt] = useState(() => localDateTime(baselineReport?.assessedAt ?? new Date().toISOString()));
  const [situation, setSituation] = useState(stringValue(baselinePayload.situation));
  const [period, setPeriod] = useState(stringValue(baselinePayload.operationalPeriod) || props.operationalPeriod || "");
  const [coordinator, setCoordinator] = useState(stringValue(baselinePayload.coordinatorOrganizationId));
  const [supporting, setSupporting] = useState<ReadonlySet<string>>(() => new Set(textList(baselinePayload.supportingOrganizationIds)));
  const [missions, setMissions] = useState(() => textList(baselinePayload.missions).join("\n"));
  const [priorities, setPriorities] = useState(() => textList(baselinePayload.priorities).join("\n"));
  const [related, setRelated] = useState<ReadonlySet<string>>(() => new Set(textList(baselinePayload.relatedLifelines)));
  const [evidenceDescription, setEvidenceDescription] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [actionTitle, setActionTitle] = useState("");
  const [actionStatus, setActionStatus] = useState<(typeof ACTION_STATUS)[number]>("planned");
  const [actionDue, setActionDue] = useState("");
  const [actionOwner, setActionOwner] = useState("");
  const [resourceRequestId, setResourceRequestId] = useState("");
  const [validation, setValidation] = useState<string | null>(null);

  const toggle = (current: ReadonlySet<string>, value: string, checked: boolean, apply: (next: ReadonlySet<string>) => void) => {
    const next = new Set(current);
    if (checked) next.add(value); else next.delete(value);
    apply(next);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const submittedActions = [...actions];
    if (actionTitle.trim()) {
      submittedActions.push({
        key: actionKey(actionTitle, submittedActions),
        title: actionTitle.trim(),
        status: actionStatus,
        ...(actionDue ? { dueAt: isoDateTime(actionDue) } : {}),
        ...(actionOwner ? { responsibleOrganizationId: actionOwner } : {}),
        ...(resourceRequestId.trim() ? { linkedResourceRequestId: resourceRequestId.trim() } : {}),
      });
    }
    const evidence = [...baselineEvidence];
    if (evidenceDescription.trim()) evidence.push({
      kind: "reported",
      description: evidenceDescription.trim(),
      ...(evidenceReference.trim() ? { sourceReference: evidenceReference.trim() } : {}),
    });
    const parsed = CreateEsfAssessmentSchema.safeParse({
      identity: { framework: props.framework, esf: props.esf, definitionVersion: 1 },
      activation,
      capacity,
      assessedAt: isoDateTime(assessedAt),
      confidence,
      situation: situation.trim(),
      ...(period.trim() ? { operationalPeriod: period.trim() } : {}),
      ...(coordinator ? { coordinatorOrganizationId: coordinator } : {}),
      supportingOrganizationIds: [...supporting],
      missions: missions.split("\n").map((item) => item.trim()).filter(Boolean),
      priorities: priorities.split("\n").map((item) => item.trim()).filter(Boolean),
      evidence,
      relatedLifelines: [...related],
      actions: submittedActions,
      ...(baselineReport ? { supersedesAssessmentId: baselineReport.id } : {}),
    });
    if (!parsed.success) {
      setValidation(parsed.error.issues[0]?.message ?? "The assessment is invalid.");
      return;
    }
    setValidation(null);
    props.onSubmit(parsed.data);
  };

  return (
    <form className="eoc-esf-assessment-form" aria-label={`Assess ${props.esf}`} onSubmit={submit}>
      <header><div><span className="eoc-esf-eyebrow">Attributed assessment</span><h3>{baselineReport ? "Revise assessment" : "New assessment"}</h3></div>
        <ActionButton kind="quiet" onClick={props.onCancel}>Cancel</ActionButton></header>
      <div className="eoc-esf-form-grid">
        <label>Activation<select value={activation} onChange={(event) => setActivation(event.target.value)}>
          {ESF_ACTIVATION.values.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
        </select></label>
        <label>Capacity<select value={capacity} onChange={(event) => setCapacity(event.target.value)}>
          {ESF_CAPACITY.values.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
        </select></label>
        <label>Confidence<select value={confidence} onChange={(event) => setConfidence(event.target.value)}>
          {CONFIDENCE.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Assessed at<input required type="datetime-local" value={assessedAt} onChange={(event) => setAssessedAt(event.target.value)} /></label>
        <label>Operational period<input value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
        <label>Coordinator organization<select value={coordinator} onChange={(event) => setCoordinator(event.target.value)}>
          <option value="">Not assigned</option>{props.organizations.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
      </div>
      <label>Staffing, capacity, and coordination situation<textarea required rows={4} value={situation} onChange={(event) => setSituation(event.target.value)} /></label>
      <div className="eoc-esf-form-columns">
        <label>Missions, one per line<textarea rows={5} value={missions} onChange={(event) => setMissions(event.target.value)} /></label>
        <label>Priorities and outstanding decisions, one per line<textarea rows={5} value={priorities} onChange={(event) => setPriorities(event.target.value)} /></label>
      </div>
      <fieldset><legend>Supporting organizations</legend><div className="eoc-esf-check-grid">
        {props.organizations.map((item) => <label key={item.id}><input type="checkbox" checked={supporting.has(item.id)}
          onChange={(event) => toggle(supporting, item.id, event.target.checked, setSupporting)} />{item.label}</label>)}
      </div></fieldset>
      <fieldset><legend>Related Community Lifelines</legend><div className="eoc-esf-check-grid">
        {LIFELINE_DEFINITION.lifelines.map((key) => <label key={key}><input type="checkbox" checked={related.has(key)}
          onChange={(event) => toggle(related, key, event.target.checked, setRelated)} />{key.replaceAll("_", " ")}</label>)}
      </div></fieldset>
      <fieldset><legend>Add reported evidence</legend><div className="eoc-esf-form-grid">
        <label>Evidence description<input value={evidenceDescription} onChange={(event) => setEvidenceDescription(event.target.value)} /></label>
        <label>Source reference<input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} /></label>
      </div>{baselineEvidence.length ? <p>{baselineEvidence.length} prior evidence item{baselineEvidence.length === 1 ? "" : "s"} will be preserved.</p> : null}</fieldset>
      <fieldset><legend>Add stabilization action or resource link</legend><div className="eoc-esf-form-grid">
        <label>Action title<input value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} /></label>
        <label>Action status<select value={actionStatus} onChange={(event) => setActionStatus(event.target.value as typeof actionStatus)}>
          {ACTION_STATUS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label>Due at<input type="datetime-local" value={actionDue} onChange={(event) => setActionDue(event.target.value)} /></label>
        <label>Responsible organization<select value={actionOwner} onChange={(event) => setActionOwner(event.target.value)}><option value="">Not assigned</option>
          {props.organizations.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Linked resource request ID<input value={resourceRequestId} onChange={(event) => setResourceRequestId(event.target.value)} /></label>
      </div>{actions.length ? <div className="eoc-esf-existing-actions" aria-label="Existing stabilization actions">
        {actions.map((action, index) => <div key={action.key}><div><strong>{action.title}</strong>
          {action.linkedResourceRequestId ? <span>Request {action.linkedResourceRequestId}</span> : null}
          {action.assignment ? <span>Validated assignment retained</span> : null}</div>
          <label>{`Status for ${action.title}`}<select value={action.status}
            onChange={(event) => setActions((current) => current.map((item, itemIndex) => itemIndex === index
              ? { ...item, status: event.target.value as StabilizationActionInput["status"] } : item))}>
            {ACTION_STATUS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        </div>)}
        <p>{actions.length} prior action{actions.length === 1 ? "" : "s"}; validated assignments and links remain attached.</p>
      </div> : null}</fieldset>
      {validation ? <p role="alert" className="eoc-esf-form-error">{validation}</p> : null}
      {props.error ? <ErrorState title="Assessment could not be saved" message={props.error} /> : null}
      <div className="eoc-esf-form-actions"><ActionButton kind="primary" loading={props.saving} loadingLabel="Saving assessment…" type="submit">Save assessment</ActionButton>
        <ActionButton kind="quiet" onClick={props.onCancel}>Cancel</ActionButton></div>
    </form>
  );
}
