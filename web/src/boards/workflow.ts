import {
  workflowEscalationAt,
  type BoardWorkflow,
  type WorkflowAssignmentRequest,
  type WorkflowTransition,
} from "@openeoc/shared";

/**
 * Wire shapes of the board workflow runtime routes and the pure logic the
 * record detail uses to present them. The server decides every command; this
 * module only reads its answers against the pinned workflow definition.
 */

export type WorkflowEventKind =
  | "transition_requested"
  | "approval_recorded"
  | "transition_completed"
  | "escalation";

export interface WorkflowHistoryEvent {
  readonly id: string;
  readonly sequence: number;
  readonly stateRevision: number;
  readonly eventKind: WorkflowEventKind;
  readonly eventKey: string;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly actorPersonId: string;
  readonly actorPositionId: string | null;
  readonly actorParticipationId: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

/** The resolved assignee the server stores; only the fields shown are typed. */
export type WorkflowAssignee =
  | { readonly kind: "position"; readonly positionId: string; readonly positionTitle: string }
  | {
      readonly kind: "incident_participant";
      readonly participantId: string;
      readonly personId: string;
      readonly incidentPositionTitle: string;
    };

export interface WorkflowCommandResult {
  readonly recordId: string;
  readonly state: string;
  readonly stateRevision: number;
  readonly pendingTransition: string | null;
  readonly dueAt: string | null;
  readonly dueStatus: "none" | "scheduled" | "missing";
  readonly assignment: WorkflowAssignee | null;
}

export interface RecordWorkflow extends WorkflowCommandResult {
  readonly pinnedTemplateVersion: number;
  readonly history: readonly WorkflowHistoryEvent[];
}

export interface WorkflowTransitionCommand {
  readonly transitionKey: string;
  readonly assignment?: WorkflowAssignmentRequest;
  readonly idempotencyKey: string;
}

export interface WorkflowApprovalCommand {
  readonly transitionKey: string;
  readonly ruleKey: string;
  readonly idempotencyKey: string;
}

export interface WorkflowEscalationCommand {
  readonly ruleKey: string;
  readonly occurrence: number;
  readonly assignment?: WorkflowAssignmentRequest;
  readonly idempotencyKey: string;
}

type ApprovalRule = WorkflowTransition["approvals"][number];
type EscalationRule = WorkflowTransition["escalations"][number];

export interface WorkflowApprovalProgress {
  readonly rule: ApprovalRule;
  /** Distinct people who approved this rule for the pending request. */
  readonly approvedBy: readonly string[];
}

export interface WorkflowEscalationStep {
  readonly rule: EscalationRule;
  readonly occurrence: number;
  readonly scheduledAt: string;
  readonly escalated: boolean;
  readonly due: boolean;
}

export type WorkflowDue =
  | { readonly kind: "none" }
  | { readonly kind: "missing" }
  | { readonly kind: "scheduled"; readonly at: string; readonly overdue: boolean };

export interface WorkflowPanelModel {
  readonly stateLabel: string;
  readonly terminal: boolean;
  readonly pending: {
    readonly transition: WorkflowTransition;
    readonly requestedBy: string | null;
    readonly approvals: readonly WorkflowApprovalProgress[];
  } | null;
  /** Transitions leaving the current state. The server still decides who may run them. */
  readonly transitions: readonly WorkflowTransition[];
  readonly due: WorkflowDue;
  readonly escalations: readonly WorkflowEscalationStep[];
}

export function humanKey(key: string): string {
  const words = key.replaceAll("_", " ");
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

export function stateLabel(definition: BoardWorkflow, key: string | null): string {
  if (!key) return "Unavailable";
  return definition.states.find((state) => state.key === key)?.label ?? humanKey(key);
}

export function transitionLabel(definition: BoardWorkflow, key: string): string {
  return definition.transitions.find((transition) => transition.key === key)?.label ?? humanKey(key);
}

export function approverLabel(approver: ApprovalRule["approver"]): string {
  if (approver.kind === "jurisdiction_admin") return "Organization administrator";
  if (approver.kind === "incident_coordinator") return "Incident coordinator";
  return `Position: ${humanKey(approver.positionKey)}`;
}

/** Read the server's workflow answer against its pinned definition at `now`. */
export function workflowPanelModel(
  definition: BoardWorkflow,
  runtime: RecordWorkflow,
  now: Date,
): WorkflowPanelModel {
  const state = definition.states.find((candidate) => candidate.key === runtime.state);
  const pendingRevision = runtime.stateRevision + 1;
  const pendingTransition = runtime.pendingTransition
    ? definition.transitions.find((transition) => transition.key === runtime.pendingTransition) ?? null
    : null;
  const pending = pendingTransition ? {
    transition: pendingTransition,
    requestedBy: lastEvent(runtime.history, (event) => event.eventKind === "transition_requested"
      && event.stateRevision === pendingRevision && event.eventKey === pendingTransition.key)?.actorPersonId ?? null,
    approvals: pendingTransition.approvals.map((rule) => ({
      rule,
      approvedBy: [...new Set(runtime.history.filter((event) => event.eventKind === "approval_recorded"
        && event.stateRevision === pendingRevision && event.eventKey === rule.key
        && event.detail["transitionKey"] === pendingTransition.key).map((event) => event.actorPersonId))],
    })),
  } : null;
  const due: WorkflowDue = runtime.dueStatus === "scheduled" && runtime.dueAt
    ? { kind: "scheduled", at: runtime.dueAt, overdue: Date.parse(runtime.dueAt) <= now.getTime() }
    : runtime.dueStatus === "missing" ? { kind: "missing" } : { kind: "none" };
  return {
    stateLabel: state?.label ?? humanKey(runtime.state),
    terminal: state?.terminal ?? false,
    pending,
    transitions: runtime.pendingTransition ? []
      : definition.transitions.filter((transition) => transition.from === runtime.state),
    due,
    escalations: escalationSteps(definition, runtime, now),
  };
}

/**
 * Escalations belong to the transition that produced the current state and
 * run from the moment it completed; the completion event records that moment.
 * Each rule lists its escalated and due occurrences and the next scheduled one.
 */
function escalationSteps(
  definition: BoardWorkflow,
  runtime: RecordWorkflow,
  now: Date,
): WorkflowEscalationStep[] {
  const completed = lastEvent(runtime.history, (event) => event.eventKind === "transition_completed"
    && event.stateRevision === runtime.stateRevision);
  const transition = completed
    ? definition.transitions.find((candidate) => candidate.key === completed.eventKey)
    : undefined;
  if (!completed || !transition) return [];
  const escalated = new Set(runtime.history.filter((event) => event.eventKind === "escalation"
    && event.stateRevision === runtime.stateRevision).map((event) => event.eventKey));
  const steps: WorkflowEscalationStep[] = [];
  for (const rule of transition.escalations) {
    for (let occurrence = 0; occurrence < rule.maxOccurrences; occurrence += 1) {
      const scheduledAt = workflowEscalationAt(rule, completed.createdAt, occurrence);
      const due = Date.parse(scheduledAt) <= now.getTime();
      steps.push({ rule, occurrence, scheduledAt, escalated: escalated.has(`${rule.key}:${occurrence}`), due });
      if (!due) break;
    }
  }
  return steps;
}

function lastEvent(
  history: readonly WorkflowHistoryEvent[],
  match: (event: WorkflowHistoryEvent) => boolean,
): WorkflowHistoryEvent | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) if (match(history[index]!)) return history[index];
  return undefined;
}

/** One plain sentence for a workflow history event. */
export function historyAction(definition: BoardWorkflow, event: WorkflowHistoryEvent): string {
  const from = stateLabel(definition, event.fromState);
  const to = stateLabel(definition, event.toState);
  if (event.eventKind === "transition_requested")
    return `Requested ${transitionLabel(definition, event.eventKey)}: ${from} to ${to}`;
  if (event.eventKind === "transition_completed")
    return `Moved ${from} to ${to} by ${transitionLabel(definition, event.eventKey)}`;
  if (event.eventKind === "approval_recorded") {
    const transitionKey = typeof event.detail["transitionKey"] === "string" ? event.detail["transitionKey"] : "";
    const rule = definition.transitions.find((transition) => transition.key === transitionKey)
      ?.approvals.find((candidate) => candidate.key === event.eventKey);
    return `Approved ${rule?.label ?? humanKey(event.eventKey)} for ${transitionLabel(definition, transitionKey)}`;
  }
  const [ruleKey = event.eventKey, occurrence = "0"] = event.eventKey.split(":");
  return `Escalated ${humanKey(ruleKey)}, occurrence ${Number(occurrence) + 1}`;
}

/** Assignment, due time and schedule details the server recorded with an event. */
export function historyNote(event: WorkflowHistoryEvent, formatTime: (iso: string) => string): string | null {
  const notes: string[] = [];
  const assignee = event.detail["assignment"] as WorkflowAssignee | null | undefined;
  if (assignee) notes.push(`Assigned to ${assigneeLabel(assignee)}`);
  if (typeof event.detail["dueAt"] === "string") notes.push(`Due ${formatTime(event.detail["dueAt"])}`);
  else if (event.detail["dueStatus"] === "missing") notes.push("Due time missing");
  if (typeof event.detail["scheduledAt"] === "string") notes.push(`Scheduled ${formatTime(event.detail["scheduledAt"])}`);
  return notes.length ? notes.join(". ") : null;
}

export function assigneeLabel(assignee: WorkflowAssignee): string {
  return assignee.kind === "position" ? assignee.positionTitle : assignee.incidentPositionTitle;
}
