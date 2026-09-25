import { useState } from "react";
import {
  RESOURCE_REQUEST_DELIVERY_STEPS,
  RESOURCE_REQUEST_REASON_REQUIRED,
  RESOURCE_REQUEST_TRANSITIONS,
  sectionForPosition,
  type IncidentTask,
  type ResourceRequestSummary,
} from "@openeoc/shared";
import { Button, StatusBadge, TextField } from "../../design/components.js";
import { nextAction, ownerLabel, requestStage, stageTone, when } from "../../resources/request-view.js";
import { readAllPages, type ApiClient, type Me } from "../api/client.js";
import { useAsync } from "../data/hooks.js";

/** What each quick step is called; decline, cancel and assignment stay on the Resources screen. */
const STEP_VERBS: Readonly<Record<string, string>> = {
  accepted: "Accept", sourcing: "Start sourcing", deployed: "Mark deployed", fulfilled: "Mark fulfilled",
  demobilizing: "Start demobilizing", closed: "Close",
};

interface WorkRow {
  readonly key: string;
  readonly number: string;
  readonly title: string;
  readonly stage: string;
  readonly tone: "info" | "warning" | "success" | "unknown";
  readonly due: string | null;
  readonly owner: string;
  readonly next: string | null;
  readonly steps: readonly { readonly label: string; readonly run: (note: string) => Promise<unknown> }[];
  readonly open: () => void;
}

const overdue = (row: WorkRow) => row.due !== null && new Date(row.due).getTime() < Date.now();

/** Most pressing first: overdue, then by due time, then by number. */
function byUrgency(left: WorkRow, right: WorkRow): number {
  return Number(overdue(right)) - Number(overdue(left))
    || (left.due ? new Date(left.due).getTime() : Infinity) - (right.due ? new Date(right.due).getTime() : Infinity)
    || left.number.localeCompare(right.number);
}

function WorkList(props: { readonly label: string; readonly rows: readonly WorkRow[]; readonly empty: string; readonly busy: boolean; readonly onStep: (run: () => Promise<unknown>) => void }) {
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  return (
    <section className="eoc-mywork-group" aria-label={props.label}>
      <h3>{props.label} <span className="eoc-mywork-count">{props.rows.length}</span></h3>
      {props.rows.length === 0 ? <p className="eoc-mywork-empty">{props.empty}</p> : (
        <ul className="eoc-mywork-list">
          {props.rows.map((row) => (
            <li key={row.key} aria-label={`${row.number} ${row.title}`} data-overdue={overdue(row) || undefined}>
              <div className="eoc-mywork-main">
                <div className="eoc-mywork-title"><StatusBadge status={row.tone}>{row.stage}</StatusBadge><strong>{row.number}</strong><span>{row.title}</span>{overdue(row) ? <span className="eoc-mywork-overdue">Overdue</span> : null}</div>
                <div className="eoc-mywork-facts">
                  <span>{row.due ? `Due ${when(row.due)}` : "No due time"}</span>
                  <span>Owner: {row.owner}</span>
                  {row.next ? <span>Next: {row.next}</span> : null}
                </div>
              </div>
              <div className="eoc-mywork-actions">
                {row.steps.length ? <TextField label="Note (optional)" value={notes[row.key] ?? ""} onChange={(value) => setNotes({ ...notes, [row.key]: value })} /> : null}
                {row.steps.map((step, index) => (
                  <Button key={step.label} kind={index === 0 ? "primary" : "quiet"} disabled={props.busy} label={`${step.label} ${row.number}`}
                    onClick={() => props.onStep(() => step.run((notes[row.key] ?? "").trim()).then(() => setNotes({ ...notes, [row.key]: "" })))}>{step.label}</Button>
                ))}
                <Button onClick={row.open} label={`Open ${row.number}`}>Open</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The acting person's work on the incident, across tasks and resource
 * requests: what is assigned to them or their position, or accepted by them
 * and not yet handed on; what their organization has received and nobody
 * owns yet; and, for a section chief, what the section's positions hold.
 * Routine steps take one click with an optional note; decline, cancel and
 * assignment stay on their own screens, which ask for a reason or a name.
 */
export function MyWork(props: {
  readonly client: ApiClient;
  readonly incidentId: string;
  readonly jurisdictionId: string;
  readonly me: Me;
  readonly closed: boolean;
  readonly team: boolean;
  readonly onStartTask: (task: IncidentTask) => Promise<unknown>;
  readonly onCompleteTask: (task: IncidentTask) => Promise<unknown>;
  readonly onOpenTask: (task: IncidentTask) => void;
  readonly onOpenRequest: (id: string) => void;
  readonly onActAs: (positionId: string) => Promise<unknown>;
  readonly revision: number;
}) {
  const { client, incidentId, jurisdictionId, me } = props;
  const tasks = useAsync(() => readAllPages(async (page) => {
    const result = await client.listIncidentTasks(incidentId, {}, page);
    return { items: result.tasks, nextCursor: result.nextCursor };
  }), [incidentId, props.revision]);
  const requests = useAsync(() => client.listResourceRequests(jurisdictionId, incidentId, { status: "open" }), [jurisdictionId, incidentId, props.revision]);
  const positions = useAsync(() => client.listPositions(jurisdictionId), [jurisdictionId]);
  const held = useAsync(() => me.position ? Promise.resolve([]) : client.listAssignedPositions(jurisdictionId), [jurisdictionId, me.position?.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void run().then(() => { tasks.reload(); requests.reload(); }, (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const positionKey = new Map((positions.data ?? []).map((position) => [position.id, position.key]));
  const section = me.position ? sectionForPosition(me.position.key) : null;
  const leads = Boolean(me.position && (me.position.key.endsWith("_section_chief") || section === "command"));
  const inSection = (positionId: string) => section !== null && sectionForPosition(positionKey.get(positionId) ?? "") === section;

  const taskRow = (task: IncidentTask, mine: boolean): WorkRow => ({
    key: `task:${task.id}`,
    number: `TASK-${task.number}`,
    title: task.item,
    stage: task.status === "in_progress" ? "In progress" : "Not started",
    tone: task.status === "in_progress" ? "info" : "warning",
    due: task.dueAt,
    owner: task.assignment?.title ?? "No one yet",
    next: task.status === "open" ? "Start it" : "Complete it",
    steps: !mine || props.closed ? [] : task.status === "open"
      ? [{ label: "Start", run: () => props.onStartTask(task) }]
      : task.dependencies.some((dependency) => dependency.status !== "completed") ? [] : [{ label: "Complete", run: () => props.onCompleteTask(task) }],
    open: () => props.onOpenTask(task),
  });
  const owns = (request: ResourceRequestSummary) => request.receivingOrganization.id === jurisdictionId;
  const requestRow = (request: ResourceRequestSummary, acting: boolean): WorkRow => {
    const assignee = !owns(request) && request.assignment?.kind === "incident_participant" && request.assignment.personId === me.person.id;
    const delivery = RESOURCE_REQUEST_DELIVERY_STEPS[request.state as keyof typeof RESOURCE_REQUEST_DELIVERY_STEPS];
    const moves = assignee ? (delivery ? [delivery] : []) : owns(request) ? RESOURCE_REQUEST_TRANSITIONS[request.state] ?? [] : [];
    return {
      key: `request:${request.id}`,
      number: `REQ-${request.number}`,
      title: request.item,
      stage: requestStage(request.state),
      tone: stageTone(request.state),
      due: request.neededBy,
      owner: ownerLabel(request),
      next: nextAction(request.state),
      steps: !acting || props.closed ? [] : moves
        .filter((state) => !RESOURCE_REQUEST_REASON_REQUIRED.includes(state) && STEP_VERBS[state])
        .map((state) => ({ label: STEP_VERBS[state]!, run: (note: string) => client.transitionResourceRequest(request.id, state, note) })),
      open: () => props.onOpenRequest(request.id),
    };
  };

  const openTasks = (tasks.data ?? []).filter((task) => task.status !== "completed");
  const openRequests = requests.data ?? [];
  const mineTask = (task: IncidentTask) => task.assignment?.kind === "position" ? task.assignment.id === me.position?.id : task.assignment?.personId === me.person.id;
  const mineRequest = (request: ResourceRequestSummary) =>
    request.assignment?.kind === "position" ? request.assignment.positionId === me.position?.id
      : request.assignment ? request.assignment.personId === me.person.id
        : request.acceptance?.personId === me.person.id;
  const mine = [
    ...openTasks.filter(mineTask).map((task) => taskRow(task, true)),
    ...openRequests.filter(mineRequest).map((request) => requestRow(request, true)),
  ].sort(byUrgency);
  const waiting = [
    ...openRequests.filter((request) => request.state === "submitted" && owns(request)).map((request) => requestRow(request, true)),
    ...openTasks.filter((task) => task.assignment === null).map((task) => taskRow(task, false)),
  ].sort(byUrgency);
  const team = leads ? [
    ...openTasks.filter((task) => task.assignment?.kind === "position" && task.assignment.id !== me.position?.id && inSection(task.assignment.id)).map((task) => taskRow(task, false)),
    ...openRequests.filter((request) => request.assignment?.kind === "position" && request.assignment.positionId !== me.position?.id && inSection(request.assignment.positionId)).map((request) => requestRow(request, false)),
  ].sort(byUrgency) : [];
  const late = [...mine, ...waiting].filter(overdue).length;
  const loading = (tasks.loading && !tasks.data) || (requests.loading && !requests.data);
  const failed = tasks.error ?? requests.error;

  return (
    <section className="eoc-mywork" aria-label={props.team ? "Your section's work" : "My work"}>
      {!me.position && (held.data ?? []).length ? (
        <p className="eoc-mywork-act" role="status">
          You hold {(held.data ?? []).map((position) => position.title).join(", ")}. Work assigned to a position shows once you act as it.
          {(held.data ?? []).map((position) => <Button key={position.id} kind="primary" disabled={busy} onClick={() => step(() => props.onActAs(position.id))}>Act as {position.title}</Button>)}
        </p>
      ) : null}
      <p className="eoc-mywork-summary" role="status">
        {loading ? "Loading your work…" : failed ? `Your work could not be loaded: ${failed}`
          : props.team ? `${team.length} open ${team.length === 1 ? "item" : "items"} held by ${section ? `the ${section} section's` : "your section's"} other positions.`
            : `${mine.length} assigned to you${me.position ? ` as ${me.position.title}` : ""} · ${waiting.length} waiting for an owner · ${late} overdue.`}
      </p>
      {error ? <p className="eoc-mywork-error" role="alert">{error}</p> : null}
      {props.team ? (
        leads ? <WorkList label="Your section's work" rows={team} empty="No open work is held by your section's other positions." busy={busy} onStep={step} />
          : <p className="eoc-mywork-empty">The section view is for a section chief or command staff acting in that position.</p>
      ) : (
        <>
          <WorkList label="Assigned to you" rows={mine} empty={me.position ? "Nothing is assigned to you or your position." : "Nothing is assigned to you by name."} busy={busy} onStep={step} />
          <WorkList label="Waiting for an owner" rows={waiting} empty="Nothing received is waiting for an owner." busy={busy} onStep={step} />
        </>
      )}
    </section>
  );
}
