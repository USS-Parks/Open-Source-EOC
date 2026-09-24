import { useState } from "react";
import type { BoardWorkflow, IncidentParticipantGrant, WorkflowAssignmentRequest } from "@openeoc/shared";
import { ownerOptions, type AarOwnerOption } from "../aar/model.js";
import type { ApiClient, PositionRef } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ActionButton } from "../design/controls.js";
import { ConditionBadge } from "../design/feedback.js";
import "../design/forms.css";
import "./board-parts.css";
import {
  approverLabel,
  assigneeLabel,
  historyAction,
  historyNote,
  humanKey,
  stateLabel,
  workflowPanelModel,
  type RecordWorkflow,
  type WorkflowHistoryEvent,
} from "./workflow.js";

/** What the record detail knows about the selected record's workflow. */
export interface RecordWorkflowSource {
  readonly client: ApiClient;
  readonly boardId: string;
  readonly recordId: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly jurisdictionId: string | null;
  readonly incidentId: string | null;
  /** Board write access. Commands still go to the server, which decides each one. */
  readonly canAct: boolean;
  /** Display names the shell already holds, keyed by person id. */
  readonly people: Readonly<Record<string, string>>;
}

interface WorkflowData {
  readonly definition: BoardWorkflow;
  readonly runtime: RecordWorkflow;
  readonly positions: readonly PositionRef[];
  readonly participants: readonly IncidentParticipantGrant[];
}

interface AssignmentRule {
  readonly required: boolean;
  readonly allowedTargets: readonly ("position" | "incident_participant")[];
}

async function loadWorkflow(source: RecordWorkflowSource): Promise<WorkflowData | null> {
  const { client } = source;
  const current = await client.getTemplateVersion(source.templateKey, source.templateVersion);
  // A board whose current template has no workflow shows none, so a record
  // pinned to an earlier workflow version of such a board is not presented.
  if (!current.workflow) return null;
  const runtime = await client.recordWorkflow(source.boardId, source.recordId);
  const pinned = runtime.pinnedTemplateVersion === source.templateVersion
    ? current
    : await client.getTemplateVersion(source.templateKey, runtime.pinnedTemplateVersion);
  if (!pinned.workflow) return null;
  // Positions and participants only name people and offer assignees. A reader
  // who may not list them still sees the workflow.
  const [positions, participants] = await Promise.all([
    source.jurisdictionId ? client.listPositions(source.jurisdictionId).catch(() => []) : [],
    source.incidentId ? client.listIncidentParticipants(source.incidentId).catch(() => []) : [],
  ]);
  return { definition: pinned.workflow, runtime, positions, participants };
}

/**
 * The workflow runtime of one board record: current state, the transitions
 * leaving it, pending approvals, due time, escalations and the append-only
 * history. Actions are offered to writers and every refusal is the server's.
 */
export function RecordWorkflowPanel(props: { readonly source: RecordWorkflowSource }) {
  const { source } = props;
  const loaded = useAsync(
    () => loadWorkflow(source),
    [source.client, source.boardId, source.recordId, source.templateKey, source.templateVersion,
      source.jurisdictionId, source.incidentId],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Readonly<Record<string, string>>>({});

  if (!loaded.data) {
    return loaded.error ? (
      <section aria-labelledby="record-workflow-title">
        <h3 id="record-workflow-title" className="board-record-heading">Workflow</h3>
        <p role="alert">Workflow unavailable: {loaded.error}</p>
      </section>
    ) : null;
  }

  const { definition, runtime, positions, participants } = loaded.data;
  const model = workflowPanelModel(definition, runtime, new Date());
  const pending = model.pending;
  const names = new Map(participants.map((participant) => [participant.personId, participant.personName]));
  for (const [personId, name] of Object.entries(source.people)) names.set(personId, name);
  const positionTitles = new Map(positions.map((position) => [position.id, position.title]));
  const participationTitles = new Map(participants.map((participant) =>
    [participant.id, `${participant.incidentPositionTitle}, ${participant.organizationName}`]));
  const who = (personId: string) => names.get(personId) ?? `Person ${personId.slice(0, 8)}`;
  const actor = (event: WorkflowHistoryEvent) => {
    const role = (event.actorPositionId && positionTitles.get(event.actorPositionId))
      || (event.actorParticipationId && participationTitles.get(event.actorParticipationId));
    return role ? `${who(event.actorPersonId)} (${role})` : who(event.actorPersonId);
  };
  const options = ownerOptions(source.incidentId ?? "", positions, participants);

  async function run(key: string, command: (idempotencyKey: string) => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await command(crypto.randomUUID());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The workflow command was not accepted.");
    } finally {
      setBusy(null);
      loaded.reload();
    }
  }

  function chosen(key: string, rule: AssignmentRule | undefined): WorkflowAssignmentRequest | undefined {
    if (!rule) return undefined;
    return options.find((option) => option.value === choices[key])?.assignment;
  }

  function assigneePicker(key: string, label: string, rule: AssignmentRule | undefined) {
    if (!rule) return null;
    const allowed: readonly AarOwnerOption[] = options.filter((option) =>
      rule.allowedTargets.includes(option.assignment.kind));
    return (
      <div className="eoc-form-field board-workflow-picker">
        <label>
          {`Assign ${label} to${rule.required ? "" : " (optional)"}`}
          <select value={choices[key] ?? ""} disabled={busy !== null}
            onChange={(event) => setChoices({ ...choices, [key]: event.target.value })}>
            <option value="">{allowed.length ? "Choose an assignee" : "No assignee available"}</option>
            {allowed.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
    );
  }

  return (
    <section aria-labelledby="record-workflow-title" className="board-workflow">
      <h3 id="record-workflow-title" className="board-record-heading">Workflow</h3>
      <dl className="eoc-shell-record-context">
        <div>
          <dt>State</dt>
          <dd>{model.stateLabel}{model.terminal ? " (final)" : ""}</dd>
        </div>
        {runtime.assignment ? (
          <div><dt>Assigned to</dt><dd>{assigneeLabel(runtime.assignment)}</dd></div>
        ) : null}
        {model.due.kind === "scheduled" ? (
          <div>
            <dt>Due</dt>
            <dd className="board-workflow-due">
              <span>{formatTime(model.due.at)}</span>
              <ConditionBadge state={model.due.overdue ? "critical" : "normal"}
                label={model.due.overdue ? "Overdue" : "On time"} />
            </dd>
          </div>
        ) : model.due.kind === "missing" ? (
          <div>
            <dt>Due</dt>
            <dd><ConditionBadge state="unknown" label="Due time missing" /></dd>
          </div>
        ) : null}
      </dl>

      {pending ? (
        <div role="group" aria-label="Awaiting approval" className="board-workflow-group">
          <p className="eoc-flush">
            <strong>{pending.transition.label}</strong> to {stateLabel(definition, pending.transition.to)} is
            awaiting approval{pending.requestedBy ? `, requested by ${who(pending.requestedBy)}` : ""}.
          </p>
          <ul className="board-workflow-list">
            {pending.approvals.map(({ rule, approvedBy }) => (
              <li key={rule.key} className="board-workflow-action">
                <span>
                  {rule.label}: {approvedBy.length} of {rule.count} from {approverLabel(rule.approver)}
                  {approvedBy.length ? `, approved by ${approvedBy.map(who).join(", ")}` : ""}
                </span>
                {source.canAct && approvedBy.length < rule.count ? (
                  <ActionButton kind="primary" loading={busy === `approve:${rule.key}`} disabled={busy !== null}
                    onClick={() => void run(`approve:${rule.key}`, (idempotencyKey) =>
                      source.client.approveWorkflowTransition(source.boardId, source.recordId, {
                        transitionKey: pending.transition.key, ruleKey: rule.key, idempotencyKey,
                      }))}>
                    Approve {rule.label}
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {source.canAct && model.transitions.length ? (
        <div role="group" aria-label="Available transitions" className="board-workflow-transitions">
          {model.transitions.map((transition) => {
            const key = `transition:${transition.key}`;
            const assignment = chosen(key, transition.assignment);
            return (
              <div key={transition.key} className="board-workflow-action">
                {assigneePicker(key, transition.label, transition.assignment)}
                <ActionButton kind="secondary" loading={busy === key}
                  disabled={busy !== null || Boolean(transition.assignment?.required && !assignment)}
                  onClick={() => void run(key, (idempotencyKey) =>
                    source.client.requestWorkflowTransition(source.boardId, source.recordId, {
                      transitionKey: transition.key, ...(assignment ? { assignment } : {}), idempotencyKey,
                    }))}>
                  {transition.label}
                </ActionButton>
                <small>
                  To {stateLabel(definition, transition.to)}
                  {transition.approvals.length
                    ? `. Needs approval: ${transition.approvals.map((rule) => rule.label).join(", ")}`
                    : ""}
                </small>
              </div>
            );
          })}
        </div>
      ) : null}
      {!pending && !model.transitions.length ? (
        <p className="eoc-flush">No transitions leave this state.</p>
      ) : null}

      {model.escalations.length ? (
        <div role="group" aria-labelledby="record-workflow-escalations-title">
          <h4 id="record-workflow-escalations-title" className="board-workflow-subtitle">Escalations</h4>
          <ul className="board-workflow-list">
            {model.escalations.map((step) => {
              const key = `escalation:${step.rule.key}:${step.occurrence}`;
              const name = humanKey(step.rule.key);
              const assignment = chosen(key, step.rule.assignment);
              return (
                <li key={key} className="board-workflow-action">
                  <span>
                    {name}, occurrence {step.occurrence + 1}:{" "}
                    {step.escalated ? "escalated" : step.due ? `due since ${formatTime(step.scheduledAt)}`
                      : `scheduled for ${formatTime(step.scheduledAt)}`}
                  </span>
                  {source.canAct && step.due && !step.escalated ? (
                    <>
                      {assigneePicker(key, `${name} escalation`, step.rule.assignment)}
                      <ActionButton kind="danger" loading={busy === key}
                        disabled={busy !== null || Boolean(step.rule.assignment?.required && !assignment)}
                        onClick={() => void run(key, (idempotencyKey) =>
                          source.client.escalateWorkflow(source.boardId, source.recordId, {
                            ruleKey: step.rule.key, occurrence: step.occurrence,
                            ...(assignment ? { assignment } : {}), idempotencyKey,
                          }))}>
                        Escalate {name}
                      </ActionButton>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {error ? <p className="eoc-form-submit-error" role="alert">{error}</p> : null}

      <div>
        <h4 id="record-workflow-history-title" className="board-workflow-subtitle">Workflow history</h4>
        {runtime.history.length ? (
          <ol aria-labelledby="record-workflow-history-title" className="board-workflow-history">
            {runtime.history.map((event) => {
              const note = historyNote(event, formatTime);
              return (
                <li key={event.id}>
                  {formatTime(event.createdAt)} · {actor(event)} · {historyAction(definition, event)}
                  {note ? ` · ${note}` : ""}
                </li>
              );
            })}
          </ol>
        ) : <p className="eoc-flush">No workflow activity yet.</p>}
      </div>
    </section>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}
