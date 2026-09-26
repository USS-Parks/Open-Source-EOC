import { useState, type CSSProperties } from "react";
import { choiceLabel, type IncidentTask, type TaskStatus } from "@openeoc/shared";
import {
  ChartCard,
  DashboardGrid,
  DonutChart,
  ProgressBar,
  StatusChips,
  statusPalette,
  type ChartDatum,
} from "../../design/charts/index.js";
import { when } from "../../resources/request-view.js";
import "./boards.css";

/**
 * The Checklist dashboard on the Tasks screen, after WebEOC's: lists and
 * tasks by status, pace and category, beside a list that every chip, slice
 * and legend row filters.
 *
 * A checklist is the set of tasks one position or incident participant
 * holds. Activating a template writes each of its checklists as tasks
 * assigned to that checklist's position, and a task added later joins the
 * list of whoever it is assigned to; tasks with no assignee are one list.
 */

export type ListStatus = "not_started" | "in_progress" | "completed";

export interface Checklist {
  /** The assignment its tasks share, as the task list filters by it: an id, or "unassigned". */
  readonly key: string;
  readonly name: string;
  /** Who holds the list and for which organization. */
  readonly holder: string;
  readonly tasks: readonly IncidentTask[];
  readonly completed: number;
  readonly status: ListStatus;
  readonly pastDue: boolean;
  readonly categories: readonly string[];
  /** The earliest due time of its unfinished tasks. */
  readonly nextDue: string | null;
}

/** Past due as the task list's "overdue" filter reads it: unfinished and due before now. */
export function isPastDue(task: IncidentTask, now: number): boolean {
  return task.status !== "completed" && task.dueAt !== null && new Date(task.dueAt).getTime() < now;
}

const time = (iso: string) => new Date(iso).getTime();

/** Group tasks into checklists, soonest due first. */
export function checklists(tasks: readonly IncidentTask[], now: number): Checklist[] {
  const groups = new Map<string, IncidentTask[]>();
  for (const task of tasks) {
    const key = task.assignment?.id ?? "unassigned";
    const group = groups.get(key);
    if (group) group.push(task);
    else groups.set(key, [task]);
  }
  const lists = [...groups].map(([key, items]): Checklist => {
    const assignment = items[0]!.assignment;
    const completed = items.filter((task) => task.status === "completed").length;
    const started = items.some((task) => task.status !== "open");
    const due = items.filter((task) => task.status !== "completed" && task.dueAt).map((task) => task.dueAt!)
      .sort((a, b) => time(a) - time(b));
    return {
      key,
      name: assignment?.title ?? "Unassigned tasks",
      holder: assignment
        ? [assignment.personName ?? "Vacant", assignment.organizationName].filter(Boolean).join(" · ")
        : "No position or participant",
      tasks: items,
      completed,
      status: completed === items.length ? "completed" : started ? "in_progress" : "not_started",
      pastDue: items.some((task) => isPastDue(task, now)),
      categories: [...new Set(items.map((task) => task.category))].sort(),
      nextDue: due[0] ?? null,
    };
  });
  return lists.sort((a, b) =>
    (a.nextDue === null ? Infinity : time(a.nextDue)) - (b.nextDue === null ? Infinity : time(b.nextDue))
    || a.name.localeCompare(b.name));
}

const LIST_STATUS: readonly { readonly key: ListStatus; readonly label: string; readonly color: string }[] = [
  { key: "not_started", label: "Not started", color: statusPalette.notStarted },
  { key: "in_progress", label: "In progress", color: statusPalette.inProgress },
  { key: "completed", label: "Completed", color: statusPalette.complete },
];

// The task list's own words for a task's status, so VIEW lands on what the chart said.
const TASK_STATUS: readonly { readonly key: TaskStatus; readonly label: string; readonly color: string }[] = [
  { key: "open", label: "Open", color: statusPalette.notStarted },
  { key: "in_progress", label: "In progress", color: statusPalette.inProgress },
  { key: "completed", label: "Completed", color: statusPalette.complete },
];

const CATEGORY_COLORS = [
  statusPalette.approved, statusPalette.complete, statusPalette.inProgress,
  statusPalette.inApproval, statusPalette.notStarted, statusPalette.pastDue,
];

/** Every count the dashboard draws, from the same lists and tasks its list shows. */
export function checklistCharts(tasks: readonly IncidentTask[], lists: readonly Checklist[]) {
  const count = <T,>(items: readonly T[], match: (item: T) => boolean) => items.filter(match).length;
  const categories = new Map<string, number>();
  for (const task of tasks) categories.set(task.category, (categories.get(task.category) ?? 0) + 1);
  return {
    lists: LIST_STATUS.map((status): ChartDatum => ({ ...status, value: count(lists, (list) => list.status === status.key) })),
    pace: [
      { key: "past_due", label: "Past due", value: count(lists, (list) => list.pastDue), color: statusPalette.pastDue },
      { key: "on_time", label: "On time", value: count(lists, (list) => !list.pastDue), color: statusPalette.notStarted },
    ] satisfies ChartDatum[],
    tasks: TASK_STATUS.map((status): ChartDatum => ({ ...status, value: count(tasks, (task) => task.status === status.key) })),
    categories: [...categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, value], index): ChartDatum => ({ key, label: choiceLabel(key), value, color: CATEGORY_COLORS[index % CATEGORY_COLORS.length] })),
  };
}

/** The one filter on: which chart it came from and the category chosen. */
type Filter = { readonly by: "list" | "pace" | "task" | "category"; readonly key: string };

/** Where VIEW takes the task list: a status, a category or one list. */
export interface TaskListView {
  readonly status?: TaskStatus;
  readonly category?: string;
  readonly assignment?: { readonly key: string; readonly name: string };
}

const barColor = (color: string) => ({ "--eoc-board-color": color }) as CSSProperties;

function Due(props: { readonly at: string | null; readonly pastDue: boolean }) {
  return (
    <span className="eoc-board-due">
      <span>{props.at ? when(props.at) : "No due date"}</span>
      {props.pastDue ? <span className="eoc-board-pill">Past due</span> : null}
    </span>
  );
}

export function ChecklistDashboard(props: {
  readonly tasks: readonly IncidentTask[] | null;
  readonly error?: string | null;
  /** The clock past due is read against; the current time when left out. */
  readonly now?: number;
  readonly onView: (view: TaskListView) => void;
}) {
  const [filter, setFilter] = useState<Filter | null>(null);
  if (!props.tasks) {
    return props.error
      ? <p role="alert" className="eoc-board-state is-error">Checklists could not be loaded: {props.error}</p>
      : <p role="status" className="eoc-board-state">Loading checklists…</p>;
  }
  const now = props.now ?? Date.now();
  const tasks = props.tasks;
  const lists = checklists(tasks, now);
  const charts = checklistCharts(tasks, lists);
  const choose = (by: Filter["by"], key: string) =>
    setFilter((current) => (current?.by === by && current.key === key ? null : { by, key }));
  const selected = (by: Filter["by"]) => (filter?.by === by ? filter.key : null);
  const label = (data: readonly ChartDatum[], key: string) => data.find((datum) => datum.key === key)?.label ?? key;

  const byTask = filter?.by === "task" || filter?.by === "category";
  const shownTasks = byTask
    ? tasks.filter((task) => (filter.by === "task" ? task.status === filter.key : task.category === filter.key))
      .sort((a, b) => (a.dueAt === null ? Infinity : time(a.dueAt)) - (b.dueAt === null ? Infinity : time(b.dueAt)))
    : [];
  const shownLists = !filter || byTask ? lists : lists.filter((list) =>
    filter.by === "pace" ? list.pastDue === (filter.key === "past_due") : list.status === filter.key);
  const description = !filter ? null
    : filter.by === "list" ? `${label(charts.lists, filter.key)} lists`
      : filter.by === "pace" ? `${label(charts.pace, filter.key)} lists`
        : filter.by === "task" ? `${label(charts.tasks, filter.key)} tasks`
          : `Tasks in ${label(charts.categories, filter.key)}`;
  // WebEOC's chips: past due lists, then lists by status.
  const chips = [charts.pace[0]!, ...charts.lists];
  const chipKeys = filter?.by === "pace" && filter.key === "past_due" ? ["past_due"] : filter?.by === "list" ? [filter.key] : [];
  const listName = new Map(lists.map((list) => [list.key, list.name]));

  return (
    <div className="eoc-board">
      <div className="eoc-board-toolbar">
        <StatusChips label="Filter lists by status" items={chips} selectedKeys={chipKeys}
          onToggle={(key) => (key === "past_due" ? choose("pace", key) : choose("list", key))} />
        <p className="eoc-board-filter" role="status">
          {description ? <>Showing {byTask ? shownTasks.length : shownLists.length} {description.toLocaleLowerCase()}.{" "}
            <button type="button" className="eoc-board-link" onClick={() => setFilter(null)}>Clear filter</button></>
            : `${lists.length} ${lists.length === 1 ? "list" : "lists"}, ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
        </p>
      </div>
      <div className="eoc-board-split">
        <section className="eoc-board-panel" aria-label={byTask ? "Tasks" : "Checklists"}>
          <div className="eoc-board-head eoc-board-checklist-grid" aria-hidden="true">
            <span>{byTask ? "Tasks" : "Lists"} ({byTask ? shownTasks.length : shownLists.length})</span>
            <span>Category</span>
            <span>{byTask ? "Due" : "Next due"}</span>
            <span />
          </div>
          {tasks.length === 0 ? (
            <p className="eoc-board-empty">No checklist tasks on this incident yet. Activating an incident template writes its position checklists here.</p>
          ) : (byTask ? shownTasks : shownLists).length === 0 ? (
            <p className="eoc-board-empty">None right now.</p>
          ) : byTask ? (
            <ul className="eoc-board-rows">
              {shownTasks.map((task) => (
                <li key={task.id} className="eoc-board-row eoc-board-checklist-grid"
                  style={barColor(TASK_STATUS.find((status) => status.key === task.status)!.color)}>
                  <span className="eoc-board-main">
                    <strong title={task.item}>TASK-{task.number} {task.item}</strong>
                    <span className="eoc-board-muted"><span className="eoc-board-status">{label(charts.tasks, task.status)}</span> · {listName.get(task.assignment?.id ?? "unassigned")}</span>
                  </span>
                  <span className="eoc-board-cell">{choiceLabel(task.category)}</span>
                  <Due at={task.dueAt} pastDue={isPastDue(task, now)} />
                  <span />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="eoc-board-rows">
              {shownLists.map((list) => {
                const status = LIST_STATUS.find((entry) => entry.key === list.status)!;
                return (
                  <li key={list.key} className="eoc-board-row eoc-board-checklist-grid" style={barColor(status.color)}>
                    <span className="eoc-board-main">
                      <strong title={list.name}>{list.name}</strong>
                      <span className="eoc-board-muted" title={list.holder}><span className="eoc-board-status">{status.label}</span> · {list.holder}</span>
                      <span className="eoc-board-progress">
                        <ProgressBar compact value={list.completed} max={list.tasks.length} label={`${list.name} tasks completed`} />
                        <span>{list.completed} of {list.tasks.length}</span>
                      </span>
                    </span>
                    <span className="eoc-board-cell" title={list.categories.map(choiceLabel).join(", ")}>
                      {list.categories.map(choiceLabel).join(", ")}
                    </span>
                    <Due at={list.nextDue} pastDue={list.pastDue} />
                    <button type="button" className="eoc-chart-view" aria-label={`View the ${list.name} tasks`}
                      onClick={() => props.onView({ assignment: { key: list.key, name: list.name } })}>View</button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <DashboardGrid label="Checklist charts">
          <ChartCard title="Lists by status">
            <DonutChart data={charts.lists} caption="Lists" emptyLabel="No lists yet"
              selectedKey={selected("list")} onSelect={(key) => choose("list", key)} />
          </ChartCard>
          <ChartCard title="Tasks by status">
            <DonutChart data={charts.tasks} caption="Tasks" emptyLabel="No tasks yet"
              selectedKey={selected("task")} onSelect={(key) => choose("task", key)}
              onView={(key) => props.onView({ status: key as TaskStatus })} />
          </ChartCard>
          <ChartCard title="Pace">
            <DonutChart data={charts.pace} caption="Lists" emptyLabel="No lists yet"
              selectedKey={selected("pace")} onSelect={(key) => choose("pace", key)} />
          </ChartCard>
          <ChartCard title="Tasks by category">
            <DonutChart data={charts.categories} caption="Tasks" emptyLabel="No tasks yet"
              selectedKey={selected("category")} onSelect={(key) => choose("category", key)}
              onView={(key) => props.onView({ category: key })} />
          </ChartCard>
        </DashboardGrid>
      </div>
    </div>
  );
}
