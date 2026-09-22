import { useEffect, useMemo, useRef, useState } from "react";
import type {
  IapDisplayState,
  Ics204Assignment,
  IncidentParticipantGrant,
  WorkflowAssignmentRequest,
} from "@openeoc/shared";
import { Button, TextField } from "../design/components.js";
import type { Ics204AssignmentInput, PositionRef } from "../app/api/client.js";

interface ResourceDraft {
  readonly key: string;
  name: string;
  identifier: string;
  leader: string;
  quantity: string;
  notes: string;
}

interface AssignmentDraft {
  readonly key: string;
  readonly id?: string;
  name: string;
  supervisor: string;
  tactics: string;
  resources: ResourceDraft[];
}

let draftSequence = 0;
function draftKey(prefix: string): string {
  draftSequence += 1;
  return `${prefix}-${draftSequence}`;
}

function blankResource(): ResourceDraft {
  return { key: draftKey("resource"), name: "", identifier: "", leader: "", quantity: "", notes: "" };
}

function blankAssignment(): AssignmentDraft {
  return { key: draftKey("assignment"), name: "", supervisor: "", tactics: "", resources: [] };
}

function assignmentDraft(assignment: Ics204Assignment): AssignmentDraft {
  const supervisor = assignment.supervisor.kind === "position"
    ? `position:${assignment.supervisor.positionId}`
    : `participant:${assignment.supervisor.participantId}`;
  return {
    key: assignment.id || draftKey("assignment"),
    id: assignment.id,
    name: assignment.name,
    supervisor,
    tactics: assignment.tactics.join("\n"),
    resources: assignment.resources.map((resource) => ({
      key: draftKey("resource"),
      name: resource.name,
      identifier: resource.identifier,
      leader: resource.leader,
      quantity: resource.quantity,
      notes: resource.notes,
    })),
  };
}

function participantIsCurrent(participant: IncidentParticipantGrant, now: number): boolean {
  return participant.revokedAt === null
    && participant.role !== "viewer"
    && Date.parse(participant.expiresAt) > now;
}

function inputFor(
  incidentId: string,
  draft: AssignmentDraft,
): Ics204AssignmentInput | string {
  const name = draft.name.trim();
  if (!name) return "Each assignment needs a name.";
  const [kind, id] = draft.supervisor.split(":", 2);
  if (!id || (kind !== "position" && kind !== "participant")) {
    return `${name} needs a named supervisor authority.`;
  }
  const tactics = draft.tactics.split("\n").map((line) => line.trim()).filter(Boolean);
  if (tactics.length === 0) return `${name} needs at least one tactic.`;
  const resources: Ics204AssignmentInput["resources"][number][] = [];
  for (const resource of draft.resources) {
    if (!resource.name.trim() || !resource.quantity.trim()) {
      return `Every resource in ${name} needs a name and quantity.`;
    }
    resources.push({
      name: resource.name.trim(),
      identifier: resource.identifier.trim(),
      leader: resource.leader.trim(),
      quantity: resource.quantity.trim(),
      notes: resource.notes.trim(),
    });
  }
  const supervisor: WorkflowAssignmentRequest = kind === "position"
    ? { kind: "position", positionId: id }
    : { kind: "incident_participant", incidentId, participantId: id };
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name,
    supervisor,
    tactics,
    resources,
  };
}

export function Ics204Editor(props: {
  readonly revisionKey: string;
  readonly contentRevision: number;
  readonly incidentId: string;
  readonly status: IapDisplayState;
  readonly assignments: readonly Ics204Assignment[];
  readonly positions: readonly PositionRef[];
  readonly participants: readonly IncidentParticipantGrant[];
  readonly busy: boolean;
  readonly onSave: (
    assignments: readonly Ics204AssignmentInput[],
    expectedContentRevision: number,
  ) => Promise<void>;
  readonly onCreateRevision: (assignments: readonly Ics204AssignmentInput[]) => Promise<void>;
  readonly onDirtyChange?: (dirty: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<AssignmentDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const baselineRevision = useRef(props.contentRevision);
  const assignmentsAtRevision = useRef(props.assignments);
  const canEditDraft = props.status === "not_started" || props.status === "in_progress";
  const canDraftSuccessor = props.status === "approved";
  const editable = canEditDraft || canDraftSuccessor;
  const editableAtRevision = useRef(editable);
  assignmentsAtRevision.current = props.assignments;
  editableAtRevision.current = editable;

  useEffect(() => {
    const assignments = assignmentsAtRevision.current;
    baselineRevision.current = props.contentRevision;
    setDrafts(assignments.length > 0
      ? assignments.map(assignmentDraft)
      : editableAtRevision.current ? [blankAssignment()] : []);
    setError(null);
    setDirty(false);
  }, [props.revisionKey, props.contentRevision]);

  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty, props.onDirtyChange]);

  const supervisorOptions = useMemo(() => {
    const now = Date.now();
    return [
      ...props.positions.map((position) => ({
        value: `position:${position.id}`,
        label: `${position.title} (${position.key})`,
      })),
      ...props.participants.filter((participant) => participantIsCurrent(participant, now)).map((participant) => ({
        value: `participant:${participant.id}`,
        label: `${participant.personName} · ${participant.incidentPositionTitle} · ${participant.organizationName}`,
      })),
    ];
  }, [props.positions, props.participants]);

  function updateAssignment(index: number, patch: Partial<AssignmentDraft>) {
    setDirty(true);
    setDrafts((current) => current.map((draft, at) => at === index ? { ...draft, ...patch } : draft));
  }

  function updateResource(assignmentIndex: number, resourceIndex: number, patch: Partial<ResourceDraft>) {
    setDirty(true);
    setDrafts((current) => current.map((draft, at) => at !== assignmentIndex ? draft : {
      ...draft,
      resources: draft.resources.map((resource, resourceAt) =>
        resourceAt === resourceIndex ? { ...resource, ...patch } : resource),
    }));
  }

  async function commit() {
    const assignments: Ics204AssignmentInput[] = [];
    for (const draft of drafts) {
      const input = inputFor(props.incidentId, draft);
      if (typeof input === "string") {
        setError(input);
        return;
      }
      assignments.push(input);
    }
    if (assignments.length === 0) {
      setError("Add at least one assignment before saving.");
      return;
    }
    setError(null);
    if (canDraftSuccessor) await props.onCreateRevision(assignments);
    else await props.onSave(assignments, baselineRevision.current);
  }

  if (!editable) {
    return (
      <section className="iap-editor" aria-label="ICS-204 assignments">
        <p className="iap-muted">
          {props.status === "in_approval"
            ? "Assignments are read-only while this revision is in approval."
            : "This completed revision is read-only."}
        </p>
        {props.assignments.length === 0 ? <p>No ICS-204 assignments recorded.</p> : (
          <ol className="iap-readonly-assignments">
            {props.assignments.map((assignment) => (
              <li key={assignment.id}>
                <strong>{assignment.name}</strong>
                <span>{assignment.supervisor.personName} · {assignment.supervisor.organizationName}</span>
                <span>{assignment.tactics.join("; ")}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  }

  return (
    <section className="iap-editor" aria-label="ICS-204 assignment editor">
      {canDraftSuccessor ? (
        <p className="iap-callout">Changes below create a new draft revision. The approved revision remains unchanged.</p>
      ) : null}
      <div className="iap-assignment-stack">
        {drafts.map((draft, assignmentIndex) => (
          <fieldset key={draft.key} className="iap-assignment-card">
            <legend>Assignment {assignmentIndex + 1}</legend>
            <TextField
              label={`Assignment ${assignmentIndex + 1} name`}
              value={draft.name}
              onChange={(name) => updateAssignment(assignmentIndex, { name })}
              required
            />
            <label className="iap-field">
              <span>Named supervisor authority</span>
              <select
                value={draft.supervisor}
                onChange={(event) => updateAssignment(assignmentIndex, { supervisor: event.target.value })}
                required
              >
                <option value="">Select a current position or incident participant</option>
                {supervisorOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="iap-field">
              <span>Tactics, one per line</span>
              <textarea
                value={draft.tactics}
                onChange={(event) => updateAssignment(assignmentIndex, { tactics: event.target.value })}
                rows={4}
                required
              />
            </label>
            <div className="iap-resource-heading">
              <strong>Assigned resources</strong>
              <Button onClick={() => {
                setDirty(true);
                updateAssignment(assignmentIndex, { resources: [...draft.resources, blankResource()] });
              }}>Add resource</Button>
            </div>
            {draft.resources.map((resource, resourceIndex) => (
              <div key={resource.key} className="iap-resource-grid">
                <TextField label="Resource name" value={resource.name}
                  onChange={(name) => updateResource(assignmentIndex, resourceIndex, { name })} required />
                <TextField label="Quantity" value={resource.quantity}
                  onChange={(quantity) => updateResource(assignmentIndex, resourceIndex, { quantity })} required />
                <TextField label="Identifier" value={resource.identifier}
                  onChange={(identifier) => updateResource(assignmentIndex, resourceIndex, { identifier })} />
                <TextField label="Leader" value={resource.leader}
                  onChange={(leader) => updateResource(assignmentIndex, resourceIndex, { leader })} />
                <TextField label="Resource notes" value={resource.notes}
                  onChange={(notes) => updateResource(assignmentIndex, resourceIndex, { notes })} />
                <Button kind="danger" onClick={() => {
                  setDirty(true);
                  updateAssignment(assignmentIndex, {
                    resources: draft.resources.filter((_, at) => at !== resourceIndex),
                  });
                }}>Remove resource</Button>
              </div>
            ))}
            <Button kind="danger" onClick={() => {
              setDirty(true);
              setDrafts((current) => current.filter((_, at) => at !== assignmentIndex));
            }}>
              Remove assignment
            </Button>
          </fieldset>
        ))}
      </div>
      <div className="iap-actions">
        <Button onClick={() => {
          setDirty(true);
          setDrafts((current) => [...current, blankAssignment()]);
        }}>Add assignment</Button>
        <Button kind="primary" onClick={() => void commit()} disabled={props.busy}>
          {canDraftSuccessor ? "Create draft revision" : "Save ICS-204 assignments"}
        </Button>
      </div>
      {error ? <p role="alert" className="iap-error">{error}</p> : null}
    </section>
  );
}
