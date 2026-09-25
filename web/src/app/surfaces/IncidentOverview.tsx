import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  IncidentActivityEntry,
  IncidentOverviewSummary,
  IncidentTask,
  LifelineCurrentState,
  ResourceRequestSummary,
} from "@openeoc/shared";
import { RESOURCE_REQUEST_ENDED } from "@openeoc/shared";
import { Icon, type IconName } from "../../design/icons/index.js";
import type { ThemeName } from "../../design/tokens.js";
import type { ApiClient, CollectionRef } from "../api/client.js";
import { usePolled } from "../data/hooks.js";
import { PageActions, PageSubtitle } from "../layout/page-chrome.js";
import { LIFELINE_KEYS, LIFELINE_SCOPES, conditionLabel, projectLifeline, type LifelineCondition } from "./lifeline-view.js";
import { IncidentCop } from "./IncidentCop.js";
import "./incident-overview.css";

/**
 * The incident overview: the selected incident at a glance for the selected
 * operational period. Four counts, the common operating picture, the eight
 * Community Lifelines, the priority work and the recent activity, each read
 * from its own engine and each opening the screen that owns it. The same
 * composition runs read-only and full screen as the briefing view.
 */

export interface IncidentOverviewProps {
  readonly client: ApiClient;
  readonly theme: ThemeName;
  readonly jurisdictionId: string;
  readonly incidentId: string | null;
  readonly incidentName: string | null;
  readonly periodRevision: number | null;
  readonly operationalPeriod: string | null;
  /** The incident's map layers, for the common operating picture. */
  readonly collections: readonly CollectionRef[];
  /** Owner members read requests, tasks and the record of events; participants read what their grant allows. */
  readonly member: boolean;
  readonly briefing?: boolean;
  readonly onBriefing: () => void;
  readonly onExitBriefing: () => void;
  readonly onOpenSitrep: (id: string) => void;
  readonly onOpenRequests: (requestId?: string) => void;
  readonly onOpenShelters: () => void;
  readonly onOpenFieldReports: () => void;
  readonly onOpenTasks: () => void;
  readonly onOpenLifeline: (key: string) => void;
  readonly onOpenLifelines: () => void;
  readonly onOpenChronology: () => void;
}

const REFRESH_MS = 30_000;

function clock(value: Date, zone = false): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(zone ? { timeZoneName: "short" } : {}),
  }).format(value);
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

/** "Today", "Tomorrow", "Yesterday" or a short date, against the viewer's clock. */
export function dayLabel(value: Date, now = new Date()): string {
  const day = 24 * 60 * 60 * 1000;
  if (sameDay(value, now)) return "Today";
  if (sameDay(value, new Date(now.getTime() + day))) return "Tomorrow";
  if (sameDay(value, new Date(now.getTime() - day))) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(value);
}

function Kpi(props: {
  readonly theme: ThemeName;
  readonly tone: "critical" | "success" | "info" | "done";
  readonly icon: IconName;
  readonly label: string;
  readonly value: number | null;
  readonly detail: string;
  readonly detailTone?: "critical" | "warning" | "muted";
  readonly onOpen: () => void;
}) {
  return (
    <button type="button" className="eoc-overview-kpi" data-tone={props.tone} onClick={props.onOpen}
      aria-label={`${props.label}: ${props.value ?? "unavailable"}, ${props.detail}`}>
      <span className="eoc-overview-kpi-icon"><Icon name={props.icon} size={24} decorative /></span>
      <span className="eoc-overview-kpi-text">
        <span className="eoc-overview-kpi-label">{props.label}</span>
        <span className="eoc-overview-kpi-figures">
          <strong>{props.value ?? "—"}</strong>
          <span data-tone={props.detailTone ?? "muted"}>{props.detail}</span>
        </span>
      </span>
      <Icon name="chevronRight" size={20} decorative className="eoc-overview-kpi-chevron" />
    </button>
  );
}

function Card(props: { readonly title: string; readonly className: string; readonly action?: ReactNode; readonly children: ReactNode }) {
  const id = `eoc-overview-${props.className}`;
  return (
    <section className={`eoc-overview-card is-${props.className}`} aria-labelledby={id}>
      <header><h2 id={id}>{props.title}</h2>{props.action}</header>
      {props.children}
    </section>
  );
}

function Unavailable(props: { readonly children: ReactNode }) {
  return <p className="eoc-overview-unavailable" role="status">{props.children}</p>;
}

// ---------------------------------------------------------------- lifelines

/** The overview's solid lifeline glyphs, as each theme's canonical frame draws them. */
const LIFELINE_GLYPHS: Readonly<Record<ThemeName, Readonly<Record<(typeof LIFELINE_KEYS)[number], IconName>>>> = {
  light: {
    safety_security: "shieldPlate", food_hydration_shelter: "restaurant", health_medical: "plusSolid", energy: "boltSolid",
    communications: "communications", transportation: "roadSolid", hazardous_materials: "hazardousMaterials", water_systems: "waterDrop",
  },
  dark: {
    safety_security: "shieldQuarters", food_hydration_shelter: "homeSolid", health_medical: "plusSolid", energy: "boltSolid",
    communications: "communications", transportation: "roadSolid", hazardous_materials: "warningSolid", water_systems: "waterDrop",
  },
};

function LifelinesCard(props: {
  readonly theme: ThemeName;
  readonly states: readonly LifelineCurrentState[] | null;
  readonly error: string | null;
  readonly period: IncidentOverviewSummary["period"];
  readonly onOpen: (key: string) => void;
  readonly onOpenAll: () => void;
}) {
  const period = props.period ? { label: props.period.label, startsAt: props.period.startsAt, endsAt: props.period.endsAt } : null;
  const action = props.theme === "light"
    ? <button type="button" className="eoc-overview-link" onClick={props.onOpenAll}>Open workspace<Icon name="arrowForward" size={16} decorative /></button>
    : <button type="button" className="eoc-overview-chevron" aria-label="Open the ESFs & Lifelines workspace" onClick={props.onOpenAll}><Icon name="chevronRight" size={20} decorative /></button>;
  return (
    <Card title="Community Lifelines" className="lifelines" action={action}>
      {props.error ? <Unavailable>Lifeline assessments are unavailable: {props.error}</Unavailable> : (
        <ul className="eoc-overview-lifelines">
          {LIFELINE_KEYS.map((key) => {
            const view = projectLifeline(props.states?.find((state) => state.lifeline === key), key, period);
            const condition: LifelineCondition = props.states ? view.condition : "unknown";
            const headline = view.report ? view.impact : props.states ? "Assessment pending." : "Loading…";
            return (
              <li key={key}>
                <button type="button" onClick={() => props.onOpen(key)} data-condition={condition}
                  aria-label={`${view.label}: ${conditionLabel(condition)}. Open details`}>
                  <Icon name={LIFELINE_GLYPHS[props.theme][key]} size={32} decorative />
                  <span className="eoc-overview-lifeline-name">
                    <strong>{view.label}</strong>
                    {props.theme === "light" ? <small>{LIFELINE_SCOPES[key]}</small> : null}
                  </span>
                  <span className="eoc-overview-lifeline-status">
                    <span className="eoc-overview-dot" data-condition={condition} aria-hidden="true" />
                    <span className="eoc-overview-status-label" data-condition={condition}>{conditionLabel(condition)}</span>
                    {props.theme === "dark" ? <small>{headline}</small> : null}
                  </span>
                  {props.theme === "light" ? <Icon name="chevronRight" size={16} decorative className="eoc-overview-row-chevron" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- priority work

interface WorkItem {
  readonly key: string;
  readonly kind: "request" | "task";
  readonly number: string;
  readonly title: string;
  readonly detail: string;
  readonly status: "urgent" | "in_progress" | "not_started";
  readonly statusDetail: string;
  readonly owner: string;
  readonly ownerPerson: string;
  readonly due: Date | null;
  readonly open: () => void;
}

const STATUS_LABEL: Readonly<Record<WorkItem["status"], string>> = {
  urgent: "Urgent", in_progress: "In progress", not_started: "Not started",
};

/** Work is under way once resources are deployed; before that it has not started. */
const REQUEST_IN_PROGRESS = new Set(["deployed", "fulfilled", "demobilizing"]);
const requestOpen = (state: string) => state !== "draft" && !RESOURCE_REQUEST_ENDED.includes(state);

const STATE_DETAIL: Readonly<Record<string, string>> = {
  submitted: "Received, awaiting acceptance", accepted: "Accepted", sourcing: "Sourcing resources", assigned: "Resources assigned",
  deployed: "Resources deployed", fulfilled: "Fulfilled", demobilizing: "Demobilizing",
};

/** Open requests and tasks, most pressing first: urgent, then in progress, then by due time. */
export function priorityWork(
  requests: readonly ResourceRequestSummary[],
  tasks: readonly IncidentTask[],
  onRequest: (id: string) => void,
  onTask: () => void,
): WorkItem[] {
  const items: WorkItem[] = [
    ...requests.filter((request) => requestOpen(request.state)).map((request): WorkItem => ({
      key: `request:${request.id}`,
      kind: "request",
      number: `REQ-${request.number}`,
      title: request.item,
      detail: `${request.notes ? `${request.notes} ` : ""}(ID REQ-${request.number})`,
      status: request.priority === "immediate" ? "urgent" : REQUEST_IN_PROGRESS.has(request.state) ? "in_progress" : "not_started",
      statusDetail: STATE_DETAIL[request.state] ?? request.state,
      owner: request.assignment?.organization.name ?? request.supplyingOrganization?.name ?? request.receivingOrganization.name,
      ownerPerson: request.assignment?.kind === "incident_participant" ? request.assignment.personName
        : request.assignment?.positionTitle ?? request.acceptance?.personName ?? "Not yet accepted",
      due: request.neededBy ? new Date(request.neededBy) : null,
      open: () => onRequest(request.id),
    })),
    ...tasks.filter((task) => task.status !== "completed").map((task): WorkItem => ({
      key: `task:${task.id}`,
      kind: "task",
      number: `TASK-${task.number}`,
      title: task.item,
      detail: `${task.assignment?.title ?? "Unassigned"} (ID TASK-${task.number})`,
      status: task.status === "in_progress" ? "in_progress" : "not_started",
      statusDetail: task.status === "in_progress" ? "Under way" : "Not started",
      owner: task.assignment?.organizationName ?? "Unassigned",
      ownerPerson: task.assignment?.personName ?? task.assignment?.title ?? "",
      due: task.dueAt ? new Date(task.dueAt) : null,
      open: onTask,
    })),
  ];
  const rank = { urgent: 0, in_progress: 1, not_started: 2 } as const;
  return items.sort((left, right) => rank[left.status] - rank[right.status]
    || (left.due?.getTime() ?? Infinity) - (right.due?.getTime() ?? Infinity)
    || left.title.localeCompare(right.title));
}

/** The light frame marks only urgent work with "!"; the dark frame marks work in progress too. */
function statusIcon(status: WorkItem["status"], theme: ThemeName) {
  const mark = status === "urgent" || (status === "in_progress" && theme === "dark") ? "!" : "";
  return <span className="eoc-overview-status-icon" data-status={status} aria-hidden="true">{mark}</span>;
}

/** The kind of work a request is, by what it asks for, for the light frame's row glyph. */
export function workGlyph(item: Pick<WorkItem, "kind" | "title">): IconName {
  if (item.kind === "task") return "tasks";
  if (/road|route|access|debris|traffic|bridge|highway|closure/i.test(item.title)) return "roadSolid";
  if (/generator|power|electric|substation|fuel/i.test(item.title)) return "briefcase";
  return "package";
}

function PriorityWork(props: {
  readonly theme: ThemeName;
  /** Work due before this instant, the end of the period, shows its due time as pressing. */
  readonly periodEnds: Date | null;
  readonly items: readonly WorkItem[] | null;
  readonly error: string | null;
  readonly onViewAll: () => void;
}) {
  const now = new Date();
  const action = <button type="button" className="eoc-overview-link" onClick={props.onViewAll}>View all{props.theme === "light" ? <Icon name="arrowForward" size={16} decorative /> : null}</button>;
  const shown = (props.items ?? []).slice(0, 3);
  return (
    <Card title="Priority work" className="work" action={props.theme === "light" ? action : null}>
      {props.error ? <Unavailable>Priority work is unavailable: {props.error}</Unavailable>
        : props.items === null ? <Unavailable>Loading priority work…</Unavailable>
          : shown.length === 0 ? <Unavailable>No open requests or tasks for this incident.</Unavailable>
            : props.theme === "dark" ? (
              <table className="eoc-overview-work is-dark">
                <thead><tr><th scope="col">#</th><th scope="col">Request / Task</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Due (PDT)</th></tr></thead>
                <tbody>
                  {shown.map((item) => (
                    <tr key={item.key} onClick={item.open}>
                      <td><button type="button" className="eoc-overview-row-open" onClick={item.open}>{item.number}</button></td>
                      <td>{item.title}</td>
                      <td><span className="eoc-overview-work-status" data-status={item.status}>{statusIcon(item.status, "dark")}{STATUS_LABEL[item.status]}</span></td>
                      <td>{item.owner}</td>
                      <td data-pressing={item.due !== null && props.periodEnds !== null && item.due <= props.periodEnds || undefined}>
                        {item.due ? `${dayLabel(item.due, now)} ${clock(item.due)}` : "No due time"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="eoc-overview-work is-light">
                <thead><tr><th scope="col">Request</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Due</th></tr></thead>
                <tbody>
                  {shown.map((item) => (
                    <tr key={item.key} onClick={item.open}>
                      <td>
                        <span className="eoc-overview-work-request">
                          <Icon name={workGlyph(item)} size={24} decorative />
                          <span><button type="button" className="eoc-overview-row-open" onClick={item.open}>{item.title}</button><small>{item.detail}</small></span>
                        </span>
                      </td>
                      <td><strong>{item.owner}</strong><small>{item.ownerPerson}</small></td>
                      <td><span className="eoc-overview-work-status" data-status={item.status}>{statusIcon(item.status, "light")}<span><strong>{STATUS_LABEL[item.status]}</strong><small>{item.statusDetail}</small></span></span></td>
                      <td>{item.due ? <><strong>{dayLabel(item.due, now)}</strong><strong>{clock(item.due)}</strong></> : "No due time"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
    </Card>
  );
}

// ---------------------------------------------------------------- recent activity

interface ActivityItem {
  readonly id: string;
  readonly at: Date;
  readonly icon: IconName;
  readonly title: string;
  readonly text: string;
  readonly person: string;
  readonly organization: string;
}

function field(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** One line of recent activity from a record of events entry, in the words an operator would use. */
export function activityItem(entry: IncidentActivityEntry): ActivityItem {
  const board = typeof entry.payload.board === "string" ? entry.payload.board : null;
  const created = entry.category === "board.record.created";
  const data = entry.record ?? (entry.payload.data as Record<string, unknown> | undefined) ?? null;
  const base = { id: entry.id, at: new Date(entry.at), person: entry.person, organization: entry.organization ?? "" };
  if (entry.category === "message.sent") {
    return { ...base, icon: "messages", title: "Message",
      text: entry.message ? sentence(entry.message.body) : "Message posted to an incident thread." };
  }
  if (entry.category === "rr.submitted") {
    return { ...base, icon: "resources", title: "Resource request submitted", text: sentence(String(entry.payload.item ?? "Request")) };
  }
  if (board === "field_reports") {
    return { ...base, icon: "fieldReports", title: created ? "Field report submitted" : "Field report updated", text: sentence(field(data, "summary") ?? "Field report") };
  }
  if (board === "shelters") {
    const name = field(data, "name") ?? "Shelter";
    const occupancy = Number(data?.occupancy);
    const capacity = Number(data?.capacity);
    const load = Number.isFinite(occupancy) && Number.isFinite(capacity) && capacity > 0
      ? ` now at ${occupancy} occupants (${Math.round((occupancy / capacity) * 100)}% capacity)`
      : Number.isFinite(occupancy) ? ` now at ${occupancy} occupants` : "";
    return { ...base, icon: "overview", title: created ? "Shelter opened" : "Shelter update", text: `${name}${load}.` };
  }
  if (board === "road_closures") {
    const road = field(data, "road") ?? "Road";
    const status = field(data, "status");
    const reason = field(data, "reason");
    const state = status === "closed" ? "closed" : status === "one_lane" ? "down to one lane" : status === "reopened" ? "reopened" : "reported";
    return { ...base, icon: "transportation", title: created ? "Road closure reported" : "Road closure updated", text: `${road} ${state}${reason ? `: ${reason.toLowerCase()}` : ""}.` };
  }
  return { ...base, icon: "boards", title: created ? "Record added" : "Record updated", text: sentence(field(data, "summary") ?? field(data, "name") ?? field(data, "entry") ?? "Board record") };
}

/** The light frame draws a shelter and a road as solid glyphs. */
const LIGHT_ACTIVITY_GLYPH: Partial<Record<IconName, IconName>> = { overview: "homeSolid", transportation: "roadSolid" };

function RecentActivity(props: {
  readonly theme: ThemeName;
  readonly items: readonly ActivityItem[] | null;
  readonly error: string | null;
  readonly onViewAll: () => void;
}) {
  const action = <button type="button" className="eoc-overview-link" onClick={props.onViewAll}>View all{props.theme === "light" ? <Icon name="arrowForward" size={16} decorative /> : null}</button>;
  const shown = (props.items ?? []).slice(0, 2);
  return (
    <Card title="Recent activity" className="activity" action={action}>
      {props.error ? <Unavailable>{props.error}</Unavailable>
        : props.items === null ? <Unavailable>Loading recent activity…</Unavailable>
          : shown.length === 0 ? <Unavailable>No activity recorded for this incident yet.</Unavailable>
            : (
              <ol className={`eoc-overview-activity is-${props.theme}`}>
                {shown.map((item) => props.theme === "dark" ? (
                  <li key={item.id}>
                    <span className="eoc-overview-activity-icon"><Icon name={item.icon} size={20} decorative /></span>
                    <span className="eoc-overview-activity-body">
                      <span><strong>{item.title}</strong><time dateTime={item.at.toISOString()}> · {clock(item.at)}</time></span>
                      <span>{item.text}</span>
                    </span>
                    <span className="eoc-overview-activity-author"><strong>{item.person}</strong><small>{item.organization}</small></span>
                  </li>
                ) : (
                  <li key={item.id}>
                    <time dateTime={item.at.toISOString()}>{clock(item.at)}</time>
                    <span className="eoc-overview-activity-icon" data-icon={item.icon}><Icon name={LIGHT_ACTIVITY_GLYPH[item.icon] ?? item.icon} size={20} decorative /></span>
                    <span className="eoc-overview-activity-body">
                      <strong>{item.title}</strong>
                      <span>{item.text}</span>
                      <small>{item.person}{item.organization ? ` · ${item.organization}` : ""}</small>
                    </span>
                  </li>
                ))}
              </ol>
            )}
    </Card>
  );
}

// ---------------------------------------------------------------- the overview

async function allRequests(client: ApiClient, jurisdictionId: string, incidentId: string) {
  return client.listResourceRequests(jurisdictionId, incidentId);
}

async function allTasks(client: ApiClient, incidentId: string): Promise<IncidentTask[]> {
  const tasks: IncidentTask[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listIncidentTasks(incidentId, {}, { ...(cursor ? { cursor } : {}), limit: 500 });
    tasks.push(...page.tasks);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return tasks;
}

function message(error: string | null, fallback: string): string | null {
  return error ? `${fallback}: ${error}` : null;
}

export function IncidentOverview(props: IncidentOverviewProps) {
  const { client, incidentId } = props;
  const summary = usePolled(() => incidentId ? client.getIncidentSummary(incidentId, props.periodRevision) : Promise.resolve(null),
    REFRESH_MS, [incidentId, props.periodRevision]);
  const lifelines = usePolled(() => incidentId ? client.listIncidentLifelineAssessments(incidentId) : Promise.resolve(null),
    REFRESH_MS, [incidentId]);
  const work = usePolled(async () => {
    if (!incidentId || !props.member) return null;
    const [requests, tasks] = await Promise.all([allRequests(client, props.jurisdictionId, incidentId), allTasks(client, incidentId)]);
    return { requests, tasks };
  }, REFRESH_MS, [incidentId, props.member, props.jurisdictionId]);
  const activity = usePolled(() => incidentId && props.member ? client.listIncidentActivity(incidentId, 6) : Promise.resolve(null),
    REFRESH_MS, [incidentId, props.member]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  useEffect(() => { if (summary.data) setUpdatedAt(new Date()); }, [summary.data]);

  useEffect(() => {
    if (!props.briefing) return;
    const exit = (event: KeyboardEvent) => { if (event.key === "Escape") props.onExitBriefing(); };
    window.addEventListener("keydown", exit);
    return () => window.removeEventListener("keydown", exit);
  }, [props.briefing, props.onExitBriefing]);

  const items = useMemo(() => work.data
    ? priorityWork(work.data.requests, work.data.tasks, (id) => props.onOpenRequests(id), props.onOpenTasks)
    : null, [work.data]);
  const activityItems = useMemo(() => activity.data ? activity.data.map(activityItem) : null, [activity.data]);

  if (!incidentId) {
    return <div className="eoc-overview-empty"><h2>No incident selected</h2><p>Choose an incident in the command bar to see its overview.</p></div>;
  }

  const counts = summary.data;
  const period = counts?.period ?? null;
  async function createReport() {
    if (!period) return;
    setComposing(true);
    setComposeError(null);
    try {
      const sitrep = await client.composeSitrep(props.jurisdictionId, { incidentId: incidentId!, period: period.label });
      props.onOpenSitrep(sitrep.id);
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : "The report could not be composed.");
    } finally {
      setComposing(false);
    }
  }

  const subtitle = [
    "Incident area",
    counts ? `${counts.participatingOrganizations} participating organization${counts.participatingOrganizations === 1 ? "" : "s"}` : null,
    updatedAt ? `Updated ${clock(updatedAt, true)}` : null,
  ].filter(Boolean).join(" · ");

  const body = (
    <div className="eoc-overview" data-theme-variant={props.theme} data-briefing={props.briefing || undefined}>
      {summary.error ? <p className="eoc-overview-alert" role="alert">The incident counts could not be loaded: {summary.error}</p> : null}
      {composeError ? <p className="eoc-overview-alert" role="alert">{composeError}</p> : null}
      <div className="eoc-overview-kpis">
        <Kpi theme={props.theme} tone="critical" icon="alertSolid" label="Open requests" value={counts?.openRequests ?? null}
          detail={`${counts?.urgentRequests ?? 0} urgent`} detailTone={counts?.urgentRequests ? "critical" : "muted"} onOpen={() => props.onOpenRequests()} />
        <Kpi theme={props.theme} tone="success" icon={props.theme === "light" ? "homeSolid" : "overview"} label="Active shelters" value={counts?.activeShelters ?? null}
          detail={`${counts?.shelterOccupants ?? 0} occupants`} onOpen={props.onOpenShelters} />
        <Kpi theme={props.theme} tone="info" icon="sitrep" label="Field reports" value={counts?.fieldReports ?? null}
          detail={`${counts?.unverifiedFieldReports ?? 0} unverified`} detailTone={counts?.unverifiedFieldReports ? "warning" : "muted"} onOpen={props.onOpenFieldReports} />
        <Kpi theme={props.theme} tone="done" icon={props.theme === "light" ? "checkCircleSolid" : "tasks"} label="Tasks due" value={counts ? counts.tasksDue ?? 0 : null}
          detail={period ? "This operational period" : "No operational period set"} onOpen={props.onOpenTasks} />
      </div>
      <div className="eoc-overview-middle">
        <Card title="Common operating picture" className="cop">
          <IncidentCop client={client} theme={props.theme} incidentId={incidentId} collections={props.collections} />
        </Card>
        <LifelinesCard theme={props.theme} states={lifelines.data?.states ?? null}
          error={lifelines.error} period={period} onOpen={props.onOpenLifeline} onOpenAll={props.onOpenLifelines} />
      </div>
      <div className="eoc-overview-bottom">
        <PriorityWork theme={props.theme} periodEnds={period ? new Date(period.endsAt) : null} items={props.member ? items : []} error={props.member ? message(work.error, "Requests and tasks could not be loaded") : null}
          onViewAll={() => props.onOpenRequests()} />
        <RecentActivity theme={props.theme} items={props.member ? activityItems : null}
          error={props.member ? message(activity.error, "Recent activity could not be loaded")
            : "Recent activity is kept by the owning organization and is not shared with participating organizations."}
          onViewAll={props.onOpenChronology} />
      </div>
    </div>
  );

  if (props.briefing) {
    return (
      <div className="eoc-overview-briefing" role="dialog" aria-modal="true" aria-labelledby="eoc-overview-briefing-title">
        <header>
          <div><h1 id="eoc-overview-briefing-title">{props.incidentName ?? "Incident"} briefing</h1><p>{props.operationalPeriod ?? "No operational period"} · {subtitle}</p></div>
          <button type="button" className="eoc-page-action" onClick={props.onExitBriefing} autoFocus>Exit briefing</button>
        </header>
        {body}
      </div>
    );
  }

  return (
    <>
      <PageSubtitle>{subtitle}</PageSubtitle>
      <PageActions>
        <button type="button" className="eoc-page-action is-primary" disabled={!period || composing || !props.member} onClick={() => void createReport()}
          title={!period ? "Set an operational period to compose a report" : undefined}>
          <Icon name="report" size={20} decorative />{composing ? "Creating report…" : "Create report"}
        </button>
        <button type="button" className="eoc-page-action" onClick={props.onBriefing}>
          <Icon name="briefing" size={20} decorative />Briefing view
        </button>
      </PageActions>
      {body}
    </>
  );
}
