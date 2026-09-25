import type { HandoffChange, IncidentTask, ResourceRequestSummary } from "@openeoc/shared";
import { RESOURCE_REQUEST_ENDED, choiceLabel } from "@openeoc/shared";
import { nextAction, ownerLabel, requestStage, when } from "../../resources/request-view.js";
import { readAllPages, type ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";

const BASIS: Readonly<Record<string, string>> = {
  "sign-out": "your last sign-out",
  position: "when you last left a position",
  period: "the start of this operational period",
  activation: "the incident's activation",
};

/**
 * The shift handoff at the top of the briefing: the period being reported and
 * when the reader's last shift ended; what changed since then; requests still
 * open and work that is overdue, each with its owner; and lifelines and ESFs
 * whose conflicting reports await a decision. Every line opens its source
 * record, where the full history stays.
 */
export function ShiftHandoff(props: {
  readonly client: ApiClient;
  readonly incidentId: string;
  readonly jurisdictionId: string;
  readonly onOpenRequest: (id: string) => void;
  readonly onOpenTasks: () => void;
  readonly onOpenRecord: (boardId: string, recordId: string) => void;
  readonly onOpenLifeline: (key: string) => void;
  readonly onOpenEsf: () => void;
}) {
  const { client, incidentId } = props;
  const handoff = useAsync(() => client.shiftHandoff(incidentId), [incidentId]);
  const requests = useAsync(() => client.listResourceRequests(props.jurisdictionId, incidentId, { status: "open" }), [props.jurisdictionId, incidentId]);
  const tasks = useAsync(() => readAllPages(async (page) => {
    const result = await client.listIncidentTasks(incidentId, { due: "overdue" }, page);
    return { items: result.tasks, nextCursor: result.nextCursor };
  }), [incidentId]);
  const lifelines = useAsync(() => client.listIncidentLifelineAssessments(incidentId), [incidentId]);
  const esfs = useAsync(() => client.listIncidentEsfAssessments(incidentId), [incidentId]);

  const data = handoff.data;
  const now = Date.now();
  const unresolved = (requests.data ?? []).filter((request) => !RESOURCE_REQUEST_ENDED.includes(request.state) && request.state !== "fulfilled");
  const overdueRequests = unresolved.filter((request) => request.neededBy && new Date(request.neededBy).getTime() < now);
  const overdueTasks: readonly IncidentTask[] = tasks.data ?? [];
  const decisions = [
    ...(lifelines.data?.states ?? []).filter((state) => state.conflict && !state.decision)
      .map((state) => ({ key: `lifeline:${state.lifeline}`, label: `${choiceLabel(state.lifeline)} lifeline: reports disagree and no decision is recorded`, open: () => props.onOpenLifeline(state.lifeline) })),
    ...(esfs.data?.states ?? []).filter((state) => state.conflict && !state.decision)
      .map((state) => ({ key: `esf:${state.framework}:${state.esf}`, label: `${state.framework === "california" ? "California" : "Federal"} ${choiceLabel(state.esf)}: reports disagree and no decision is recorded`, open: props.onOpenEsf })),
  ];

  const openChange = (change: HandoffChange) => {
    if (change.subject.kind === "request") props.onOpenRequest(change.subject.id);
    else if (change.subject.kind === "task") props.onOpenTasks();
    else if (change.subject.kind === "record") props.onOpenRecord(change.subject.boardId, change.subject.id);
  };
  const requestLine = (request: ResourceRequestSummary) => (
    <li key={request.id}>
      <button type="button" onClick={() => props.onOpenRequest(request.id)}>
        <strong>REQ-{request.number} {request.item}</strong>
        <span>{requestStage(request.state)} · Owner: {ownerLabel(request)}{request.neededBy ? ` · Needed by ${when(request.neededBy)}` : ""}</span>
        {nextAction(request.state) ? <span>Next: {nextAction(request.state)}</span> : null}
      </button>
    </li>
  );

  return (
    <section className="eoc-handoff" aria-labelledby="eoc-handoff-title">
      <header>
        <h2 id="eoc-handoff-title">Shift handoff</h2>
        {data ? (
          <p>
            {data.period ? <>Reporting period <strong>{data.period.label}</strong>, {when(data.period.startsAt)} to {when(data.period.endsAt)}. </> : "No operational period is set. "}
            Changes since {when(data.since)}, {BASIS[data.basis]}.
          </p>
        ) : handoff.error ? <p role="alert">The handoff could not be loaded: {handoff.error}</p> : <p>Loading the handoff…</p>}
      </header>
      <div className="eoc-handoff-grid">
        <section aria-label="Changes since your last shift">
          <h3>Changes since your last shift{data?.changes ? ` (${data.total})` : ""}</h3>
          {data && data.changes === null ? <p className="eoc-handoff-empty">Changes are kept by the organization that owns the incident and are not shared with participating organizations.</p>
            : data?.changes?.length === 0 ? <p className="eoc-handoff-empty">Nothing has changed since then.</p> : (
              <ol>
                {(data?.changes ?? []).map((change) => (
                  <li key={change.id}>
                    <button type="button" disabled={change.subject.kind === "incident"} onClick={() => openChange(change)}>
                      <span className="eoc-handoff-time">{when(change.at)}</span>
                      <strong>{change.summary}</strong>
                      <span>{change.person}{change.position ? `, ${change.position}` : ""}{change.organization ? ` · ${change.organization}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          {data && data.changes && data.total > data.changes.length ? <p className="eoc-handoff-empty">Showing the newest {data.changes.length} of {data.total}; the chronology holds every one.</p> : null}
        </section>
        <section aria-label="Unresolved requests">
          <h3>Unresolved requests ({unresolved.length})</h3>
          {requests.error ? <p role="alert">Requests could not be loaded: {requests.error}</p>
            : unresolved.length === 0 ? <p className="eoc-handoff-empty">{requests.data ? "No request is waiting on anyone." : "Loading requests…"}</p>
              : <ul>{unresolved.map(requestLine)}</ul>}
        </section>
        <section aria-label="Overdue work">
          <h3>Overdue work ({overdueTasks.length + overdueRequests.length})</h3>
          {overdueTasks.length + overdueRequests.length === 0 ? <p className="eoc-handoff-empty">{tasks.data && requests.data ? "Nothing is overdue." : "Loading work…"}</p> : (
            <ul>
              {overdueRequests.map(requestLine)}
              {overdueTasks.map((task) => (
                <li key={task.id}>
                  <button type="button" onClick={props.onOpenTasks}>
                    <strong>TASK-{task.number} {task.item}</strong>
                    <span>Due {task.dueAt ? when(task.dueAt) : "unknown"} · Owner: {task.assignment ? `${task.assignment.title}${task.assignment.personName ? ` (${task.assignment.personName})` : ""}` : "No one yet"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Decisions awaiting action">
          <h3>Decisions awaiting action ({decisions.length})</h3>
          {decisions.length === 0 ? <p className="eoc-handoff-empty">{lifelines.data && esfs.data ? "No lifeline or ESF report conflict is waiting for a decision." : "Loading assessments…"}</p> : (
            <ul>{decisions.map((decision) => <li key={decision.key}><button type="button" onClick={decision.open}><strong>{decision.label}</strong></button></li>)}</ul>
          )}
        </section>
      </div>
    </section>
  );
}
