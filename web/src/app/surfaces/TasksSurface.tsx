import { useEffect, useMemo, useState } from "react";
import type {
  IncidentTask,
  IncidentParticipantGrant,
  TaskListQuery,
  TaskListResponse,
  TaskStatus,
} from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge } from "../../design/components.js";
import { CountBadge, EmptyState } from "../../design/feedback.js";
import { Tabs } from "../../design/controls.js";
import {
  OperationalTable,
  createOperationalTableViewState,
  type OperationalTableColumn,
  type OperationalTableViewState,
} from "../../design/table.js";
import { readAllPages, type ApiClient, type Me, type PositionRef } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { MyWork } from "./MyWork.js";
import { useTaskContinuity } from "./task-continuity.js";
import "./tasks-surface.css";

type TaskView = "mine" | "team";
type TaskDraft = {
  readonly taskId: string;
  readonly expectedRevision: number;
  item: string;
  category: string;
  dueAt: string;
  assignment: string;
  dependencyIds: readonly string[];
};

const EMPTY_RESPONSE: TaskListResponse = {
  tasks: [],
  analytics: { total: 0, byStatus: { open: 0, in_progress: 0, completed: 0 }, byCategory: {}, overdue: 0, dueNext24Hours: 0, upcoming: 0, withoutDue: 0 },
  filters: {},
};
const STATUS_VALUES = ["all", "open", "in_progress", "completed"] as const;
const DUE_VALUES = ["all", "overdue", "next_24_hours", "upcoming", "none"] as const;

function statusTone(status: TaskStatus): "info" | "warning" | "success" {
  return status === "completed" ? "success" : status === "in_progress" ? "warning" : "info";
}
function statusLabel(status: TaskStatus): string {
  return status === "in_progress" ? "In progress" : status[0]!.toUpperCase() + status.slice(1);
}
function dueLabel(value: string | null): string {
  if (!value) return "No due date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Due date unavailable" : date.toLocaleString();
}
function completionEvidence(task: IncidentTask): string {
  if (!task.completedAt || !task.completedBy) return "No completion evidence";
  const date = new Date(task.completedAt);
  return `${task.completedBy.title} completed ${Number.isNaN(date.getTime()) ? task.completedAt : date.toLocaleString()}`;
}
function taskDraft(task: IncidentTask): TaskDraft {
  return {
    taskId: task.id,
    expectedRevision: task.revision,
    item: task.item,
    category: task.category,
    dueAt: task.dueAt ? localDateTime(task.dueAt) : "",
    assignment: task.assignment ? `${task.assignment.kind === "position" ? "position" : "participant"}:${task.assignment.id}` : "",
    dependencyIds: task.dependencies.map((dependency) => dependency.id),
  };
}
/** The editor's marker for a task not yet created. */
const NEW_TASK = "new";
function newTaskDraft(): TaskDraft {
  return { taskId: NEW_TASK, expectedRevision: 0, item: "", category: "general", dueAt: "", assignment: "", dependencyIds: [] };
}
function localDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function TaskMetric(props: { label: string; value: number }) {
  return <div className="eoc-tasks-metric"><span>{props.label}</span><CountBadge value={props.value} label={props.label} /></div>;
}

export function TasksSurface(props: {
  readonly client: ApiClient;
  readonly incidentId: string | null;
  readonly personId: string | null;
  readonly jurisdictionId: string | null;
  readonly canManage: boolean;
  readonly closed?: boolean;
  readonly onOpenTemplates: () => void;
  /** The signed-in person, for My work across tasks and requests; without it only the task table shows. */
  readonly me?: Me | null;
  readonly onOpenRequest?: (id: string) => void;
  readonly onActAs?: (positionId: string) => Promise<unknown>;
}) {
  const [view, setView] = useState<TaskView>("mine");
  const [status, setStatus] = useState<(typeof STATUS_VALUES)[number]>("all");
  const [due, setDue] = useState<(typeof DUE_VALUES)[number]>("all");
  const [category, setCategory] = useState("all");
  const [tableState, setTableState] = useState<OperationalTableViewState>(() => createOperationalTableViewState([
    { id: "task", width: 270 }, { id: "status", width: 145 }, { id: "category", width: 150 },
    { id: "due", width: 185 }, { id: "assigned", width: 190 }, { id: "dependencies", width: 240 }, { id: "evidence", width: 260 }, { id: "actions", width: 210 },
  ], { pageSize: 25 }));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const continuity = useTaskContinuity(props.client, props.incidentId, props.personId);

  const query = useMemo<TaskListQuery>(() => ({
    ...(view === "mine" ? { assignment: "mine" } : {}),
    ...(status === "all" ? {} : { status }),
    ...(due === "all" ? {} : { due }),
    ...(category === "all" ? {} : { category }),
  }), [category, due, status, view]);
  const response = useAsync(
    () => props.incidentId ? props.client.listIncidentTasks(props.incidentId, query) : Promise.resolve(EMPTY_RESPONSE),
    [props.incidentId, query],
  );
  // Every task, for the editor's lookup and its prerequisite picker.
  const allTasks = useAsync(
    () => props.incidentId
      ? readAllPages(async (page) => {
        const result = await props.client.listIncidentTasks(props.incidentId!, {}, page);
        return { items: result.tasks, nextCursor: result.nextCursor };
      })
      : Promise.resolve([] as IncidentTask[]),
    [props.incidentId],
  );
  // Pages added with "Load more" extend the first page they were read after,
  // so a reload or a filter change starts again from the first page.
  const [more, setMore] = useState<{ base: TaskListResponse; tasks: readonly IncidentTask[]; nextCursor: string | null } | null>(null);
  const loaded = response.data && more?.base === response.data ? more
    : response.data ? { base: response.data, tasks: response.data.tasks, nextCursor: response.data.nextCursor ?? null } : null;
  const loadMore = loaded?.nextCursor && props.incidentId ? async () => {
    const next = await props.client.listIncidentTasks(props.incidentId!, query, { cursor: loaded.nextCursor! });
    setMore({ base: loaded.base, tasks: [...loaded.tasks, ...next.tasks], nextCursor: next.nextCursor ?? null });
  } : undefined;
  const positions = useAsync(
    () => props.canManage && props.jurisdictionId ? props.client.listPositions(props.jurisdictionId) : Promise.resolve([] as PositionRef[]),
    [props.canManage, props.jurisdictionId],
  );
  const participants = useAsync(
    () => props.canManage && props.incidentId ? props.client.listIncidentParticipants(props.incidentId) : Promise.resolve([] as IncidentParticipantGrant[]),
    [props.canManage, props.incidentId],
  );

  const data = response.data ?? EMPTY_RESPONSE;
  const categories = ["all", ...Object.keys(data.analytics.byCategory).sort()];
  const creating = editingTaskId === NEW_TASK;
  const editing = (allTasks.data ?? data.tasks).find((task) => task.id === editingTaskId) ?? null;
  const [workRevision, setWorkRevision] = useState(0);
  const refresh = () => { response.reload(); allTasks.reload(); setWorkRevision((value) => value + 1); };
  useEffect(() => {
    if (!continuity.reconciled.length) return;
    setNotice(`${continuity.reconciled.length} queued completion${continuity.reconciled.length === 1 ? "" : "s"} reconciled.`);
    response.reload(); allTasks.reload();
  }, [allTasks.reload, continuity.reconciled, response.reload]);
  const action = async (task: IncidentTask, perform: () => Promise<IncidentTask>) => {
    setBusyTaskId(task.id); setActionError(null); setNotice(null);
    try {
      const result = await perform();
      setNotice(`Updated ${result.item} to ${statusLabel(result.status)}.`);
      refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally { setBusyTaskId(null); }
  };
  const complete = async (task: IncidentTask) => {
    setBusyTaskId(task.id); setActionError(null); setNotice(null);
    try {
      const result = await continuity.complete(task.id);
      if (result.receipt) {
        setNotice(`Completion reconciled: ${result.receipt.completedBy.title} at ${new Date(result.receipt.completedAt).toLocaleString()}.`);
        refresh();
      } else setNotice("Completion queued locally; server confirmation is still pending.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally { setBusyTaskId(null); }
  };
  const saveDraft = async () => {
    if ((!editing && !creating) || !draft || !props.incidentId) return;
    setBusyTaskId(draft.taskId); setActionError(null); setNotice(null);
    const assignment = draft.assignment === ""
      ? null
      : draft.assignment.startsWith("position:")
        ? { kind: "position" as const, positionId: draft.assignment.slice("position:".length) }
        : { kind: "incident_participant" as const, incidentId: props.incidentId, participantId: draft.assignment.slice("participant:".length) };
    try {
      if (creating) {
        const created = await props.client.createIncidentTask(props.incidentId, {
          item: draft.item,
          category: draft.category,
          dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
          assignment,
        });
        if (draft.dependencyIds.length) {
          await props.client.updateIncidentTask(props.incidentId, created.id, { expectedRevision: created.revision, dependencyIds: [...draft.dependencyIds] });
        }
        setEditingTaskId(null); setDraft(null); setNotice(`Added TASK-${created.number}: ${created.item}.`); refresh();
        return;
      }
      await props.client.updateIncidentTask(props.incidentId, editing!.id, {
        expectedRevision: draft.expectedRevision,
        item: draft.item,
        category: draft.category,
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
        assignment,
        dependencyIds: [...draft.dependencyIds],
      });
      setEditingTaskId(null); setDraft(null); setNotice("Task details saved."); refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally { setBusyTaskId(null); }
  };
  const taskActionsEnabled = view === "mine" && !props.closed;
  const taskEditingEnabled = props.canManage && !props.closed;
  const columns = useMemo<readonly OperationalTableColumn<IncidentTask>[]>(() => [
    { id: "task", header: "Task", value: (task) => `TASK-${task.number} ${task.item}`, sortable: true, filterable: true, width: 270, render: (task) => <><span className="eoc-tasks-number">TASK-{task.number}</span> <strong>{task.item}</strong></> },
    { id: "status", header: "Status", value: (task) => statusLabel(task.status), sortable: true, filterable: true, width: 145, render: (task) => <StatusBadge status={statusTone(task.status)}>{statusLabel(task.status)}</StatusBadge> },
    { id: "category", header: "Category", value: (task) => task.category, sortable: true, filterable: true, width: 150 },
    { id: "due", header: "Due", value: (task) => task.dueAt ?? "", sortable: true, width: 185, missingLabel: "No due date", render: (task) => <span data-overdue={task.dueAt && new Date(task.dueAt).getTime() < Date.now() ? true : undefined}>{dueLabel(task.dueAt)}</span> },
    { id: "assigned", header: "Assigned to", value: (task) => task.assignment?.title ?? "", sortable: true, filterable: true, width: 190, missingLabel: "Unassigned", render: (task) => <span>{task.assignment?.title ?? "Unassigned"}</span> },
    { id: "dependencies", header: "Prerequisites", value: (task) => task.dependencies.map((dependency) => dependency.item).join(" "), width: 240, missingLabel: "None", render: (task) => task.dependencies.length ? <ul className="eoc-tasks-dependencies">{task.dependencies.map((dependency) => <li key={dependency.id}>{dependency.status === "completed" ? "Complete" : "Pending"} · {dependency.item}</li>)}</ul> : <span>None</span> },
    { id: "evidence", header: "Completion evidence", value: completionEvidence, width: 260, missingLabel: "No completion evidence" },
    { id: "actions", header: "Action", value: () => "Available actions", width: 210, render: (task) => {
      if (task.status === "completed") return <span className="eoc-tasks-complete">Complete</span>;
      if (!taskActionsEnabled && !taskEditingEnabled) return <span>{props.closed ? "Incident closed" : "Available in My Tasks"}</span>;
      const blocked = task.dependencies.some((dependency) => dependency.status !== "completed");
      return <div className="eoc-tasks-actions">{taskActionsEnabled && task.status === "open" ? <Button disabled={busyTaskId === task.id} onClick={() => void action(task, () => props.client.updateIncidentTask(props.incidentId!, task.id, { expectedRevision: task.revision, status: "in_progress" }))}>Start</Button> : null}{taskActionsEnabled ? <Button kind="primary" disabled={busyTaskId === task.id || blocked || !continuity.ready} onClick={() => void complete(task)}>{blocked ? "Prerequisite pending" : busyTaskId === task.id ? "Reconciling..." : "Complete"}</Button> : null}{taskEditingEnabled ? <Button disabled={busyTaskId === task.id} onClick={() => { setEditingTaskId(task.id); setDraft(taskDraft(task)); }}>Edit</Button> : null}</div>;
    } },
  ], [busyTaskId, continuity.ready, props.closed, props.client, props.incidentId, taskActionsEnabled, taskEditingEnabled]);
  const tableStatus = response.loading && !response.data ? "loading" : response.error && !response.data ? "error" : data.tasks.length === 0 ? "empty" : "ready";

  if (!props.incidentId) return <EmptyState title="No incident selected" description="Choose an incident to see its authorized task assignments and completion evidence." />;

  return <main className="eoc-tasks-surface">
    <header className="eoc-tasks-header"><div><p className="eoc-tasks-eyebrow">Incident task coordination</p><h2 className="eoc-visually-hidden">Tasks</h2><p>Assigned work, due actions, and authoritative completion receipts for the active incident.</p></div><div className="eoc-tasks-template-note"><strong>Incident templates</strong><p>Activate a template to create its assigned checklist work.</p><Button onClick={props.onOpenTemplates}>Open incident templates</Button>{taskEditingEnabled ? <Button kind="primary" onClick={() => { setEditingTaskId(NEW_TASK); setDraft(newTaskDraft()); }}>New task</Button> : null}</div></header>
    <section className="eoc-tasks-summary" aria-label="Task analytics"><Panel title="Current view">{response.data ? <div className="eoc-tasks-counts"><TaskMetric label="Tasks" value={data.analytics.total} /><TaskMetric label="Overdue" value={data.analytics.overdue} /><TaskMetric label="Due next 24 hours" value={data.analytics.dueNext24Hours} /><TaskMetric label="Without due date" value={data.analytics.withoutDue} /></div> : <p className="eoc-tasks-analytics-state" role={response.error ? "alert" : "status"}>{response.error ? "Task analytics are unavailable." : "Loading task analytics…"}</p>}</Panel></section>
    <section className="eoc-tasks-controls" aria-label="Task views and filters"><Tabs id="task-view" label="Task view" value={view} onChange={(next) => { setView(next as TaskView); setSelected(new Set()); }} tabs={[{ id: "mine", label: "My Tasks" }, { id: "team", label: "Team Tasks" }]} /><div className="eoc-tasks-filters"><EnumSelect label="Status" values={STATUS_VALUES} value={status} onChange={(value) => setStatus(value as typeof status)} labels={{ all: "All statuses", in_progress: "In progress" }} /><EnumSelect label="Due" values={DUE_VALUES} value={due} onChange={(value) => setDue(value as typeof due)} labels={{ all: "All due dates", next_24_hours: "Next 24 hours", none: "No due date" }} /><EnumSelect label="Category" values={categories} value={categories.includes(category) ? category : "all"} onChange={setCategory} labels={{ all: "All categories" }} /></div></section>
    {continuity.pendingCount ? <p className="eoc-tasks-notice" role="status">{continuity.pendingCount} completion{continuity.pendingCount === 1 ? "" : "s"} queued locally. <button type="button" onClick={() => void continuity.reconcile()}>Reconcile queued work</button></p> : null}
    {notice ? <p className="eoc-tasks-notice" role="status">{notice}</p> : null}{actionError || continuity.error ? <p className="eoc-tasks-notice is-error" role="alert">{actionError ?? continuity.error}</p> : null}
    {(editing || creating) && draft ? <Panel title={creating ? "New task" : "Task details"}><form className="eoc-tasks-editor" onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}><label>Task name<input required maxLength={500} value={draft.item} onChange={(event) => setDraft({ ...draft, item: event.target.value })} /></label><label>Category<input required pattern="[a-z][a-z0-9_]*" maxLength={80} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label><label>Due date<input type="datetime-local" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label><label>Assigned to<select value={draft.assignment} onChange={(event) => setDraft({ ...draft, assignment: event.target.value })}><option value="">Unassigned</option><optgroup label="Positions">{(positions.data ?? []).map((position) => <option key={position.id} value={`position:${position.id}`}>{position.title}</option>)}</optgroup><optgroup label="Incident participants">{(participants.data ?? []).filter((participant) => !participant.revokedAt).map((participant) => <option key={participant.id} value={`participant:${participant.id}`}>{participant.personName} · {participant.incidentPositionTitle}</option>)}</optgroup></select></label><label>Prerequisites<select multiple value={draft.dependencyIds as string[]} onChange={(event) => setDraft({ ...draft, dependencyIds: [...event.currentTarget.selectedOptions].map((option) => option.value) })}>{(allTasks.data ?? data.tasks).filter((candidate) => candidate.id !== editing?.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.status === "completed" ? "Complete" : "Open"} · {candidate.item}</option>)}</select><small>Completion stays blocked until every selected prerequisite has an authoritative receipt.</small></label><div className="eoc-tasks-editor-actions"><Button type="submit" kind="primary" disabled={busyTaskId === draft.taskId}>{busyTaskId === draft.taskId ? "Saving…" : creating ? "Add task" : "Save task details"}</Button><Button disabled={busyTaskId === draft.taskId} onClick={() => { setEditingTaskId(null); setDraft(null); }}>Cancel</Button></div></form></Panel> : null}
    <div role="tabpanel" id={`task-view-${view}-panel`} aria-labelledby={`task-view-${view}-tab`} className="eoc-tasks-panel">{props.me && props.jurisdictionId ? <MyWork client={props.client} incidentId={props.incidentId} jurisdictionId={props.jurisdictionId} me={props.me} closed={Boolean(props.closed)} team={view === "team"} revision={workRevision}
      onStartTask={(task) => action(task, () => props.client.updateIncidentTask(props.incidentId!, task.id, { expectedRevision: task.revision, status: "in_progress" }))}
      onCompleteTask={complete}
      onOpenTask={(task) => { setCategory("all"); setStatus("all"); setDue("all"); setNotice(`TASK-${task.number} ${task.item} is in the table below.`); }}
      onOpenRequest={(id) => props.onOpenRequest?.(id)}
      onActAs={async (positionId) => { await props.onActAs?.(positionId); refresh(); }} /> : null}<OperationalTable tableId="incident-tasks" caption={view === "mine" ? "My incident tasks" : "Incident team tasks"} columns={columns} rows={loaded?.tasks ?? data.tasks} rowId={(task) => task.id} datasetKey={`${props.incidentId}:${JSON.stringify(query)}`} status={tableStatus} errorMessage={response.error ?? "Tasks could not be loaded."} onRetry={response.reload} emptyTitle={view === "mine" ? "No assigned tasks match these filters" : "No team tasks match these filters"} emptyDescription="Adjust a filter or confirm the selected incident template includes checklist tasks." viewState={tableState} onViewStateChange={setTableState} totalRows={data.analytics.total} hasPreviousPage={false} hasNextPage={false} selectedIds={selected} onSelectionChange={setSelected} toolbar={<span className="eoc-tasks-table-scope">{view === "mine" ? "Current position and participant assignments" : "Authorized incident task list"}</span>} {...(loadMore ? { onLoadMore: loadMore } : {})} /></div>
  </main>;
}
