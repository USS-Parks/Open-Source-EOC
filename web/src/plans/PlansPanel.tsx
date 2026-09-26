import { useEffect, useRef, useState } from "react";
import {
  CONTINUITY_PLAN_TEMPLATE,
  ICS_POSITION_TITLES,
  PlanDefinitionSchema,
  type PlanDefinitionInput,
  type PlanDetail,
  type PlanKind,
  type PlanSummary,
  type PlanVersion,
} from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import type { ApiClient, IncidentTemplateDefinition, IncidentTemplateOption } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";
import { formatTime } from "../datasets/format.js";
import {
  ContinuityEditor,
  ContinuityView,
  continuityDraftFrom,
  continuityFrom,
  emptyContinuity,
  type ContinuityDraft,
} from "./ContinuityParts.js";
import "./plans.css";

/**
 * Executable plans on screen (VC-09). A plan is the jurisdiction's emergency
 * plan as something it runs: sections to read, each naming the positions,
 * boards, contact groups and rules of its incident template that carry it
 * out; tasks released on a schedule; the notice activation sends; and how
 * often it is reviewed. Members read plans; administrators write, review and
 * activate them. Saving makes the next version; an incident keeps the
 * version it was activated from.
 */

type PlanClient = Pick<ApiClient,
  "listPlans" | "getPlan" | "listPlanVersions" | "savePlan" | "markPlanReviewed" | "activatePlan" |
  "getIncidentTemplate" | "listTemplates">;

const KIND_LABELS: Readonly<Record<PlanKind, string>> = {
  incident_response: "Incident response",
  recurring_event: "Recurring event",
  continuity: "Continuity of operations",
};
const INCIDENT_KINDS = ["", "incident", "planned_event", "exercise", "daily_ops"] as const;
const INCIDENT_KIND_LABELS: Readonly<Record<string, string>> = {
  "": "As the plan's kind", incident: "Incident", planned_event: "Planned event", exercise: "Exercise", daily_ops: "Daily operations",
};
const CHANNELS = ["email", "sms", "inapp"] as const;
const CHANNEL_LABELS: Readonly<Record<string, string>> = { email: "Email", sms: "Text message", inapp: "In the app" };

export interface SectionDraft {
  readonly title: string;
  readonly body: string;
  readonly positions: readonly string[];
  readonly boards: readonly string[];
  readonly contactGroups: readonly string[];
  readonly rules: readonly string[];
}

export interface TaskDraft {
  readonly position: string;
  readonly item: string;
  readonly category: string;
  /** Hours from activation, or from the event's start (negative before it). */
  readonly releaseHours: string;
  /** Hours after release it is due; blank for none. */
  readonly dueHours: string;
}

export interface PlanDraft {
  readonly planId: string | null;
  readonly expectedVersion: number;
  readonly title: string;
  readonly kind: PlanKind;
  readonly templateKey: string;
  readonly incidentKind: (typeof INCIDENT_KINDS)[number];
  readonly reviewEveryDays: string;
  readonly sections: readonly SectionDraft[];
  readonly tasks: readonly TaskDraft[];
  readonly notifying: boolean;
  readonly noticeGroups: readonly string[];
  readonly noticePositions: readonly string[];
  readonly noticeOnCall: readonly string[];
  readonly noticeChannels: readonly string[];
  readonly noticeMessage: string;
  /** A continuity plan's essential functions, locations, succession and delegations. */
  readonly continuity: ContinuityDraft | null;
}

const EMPTY_SECTION: SectionDraft = { title: "", body: "", positions: [], boards: [], contactGroups: [], rules: [] };
const EMPTY_TASK: TaskDraft = { position: "", item: "", category: "general", releaseHours: "0", dueHours: "" };

export function emptyDraft(templateKey: string): PlanDraft {
  return {
    planId: null, expectedVersion: 0, title: "", kind: "incident_response", templateKey, incidentKind: "",
    reviewEveryDays: "365", sections: [], tasks: [], notifying: false, noticeGroups: [], noticePositions: [],
    noticeOnCall: [], noticeChannels: ["email", "sms", "inapp"], noticeMessage: "", continuity: null,
  };
}

const hours = (minutes: number): string => String(Math.round((minutes / 60) * 100) / 100);

/** A saved plan, or one of its versions, in the editor over the current version. */
export function draftFrom(plan: { title: string; definition: PlanDetail["definition"] }, planId: string | null, expectedVersion: number): PlanDraft {
  const d = plan.definition;
  return {
    planId, expectedVersion, title: plan.title, kind: d.kind, templateKey: d.templateKey,
    incidentKind: d.incidentKind ?? "",
    reviewEveryDays: d.reviewEveryDays ? String(d.reviewEveryDays) : "",
    sections: d.sections.map((section) => ({ ...section })),
    tasks: d.tasks.map((task) => ({
      position: task.position, item: task.item, category: task.category,
      releaseHours: hours(task.releaseMinutes), dueHours: task.dueMinutes ? hours(task.dueMinutes) : "",
    })),
    notifying: Boolean(d.notice),
    noticeGroups: d.notice?.contactGroups ?? [],
    noticePositions: d.notice?.positions ?? [],
    noticeOnCall: d.notice?.onCallPositions ?? [],
    noticeChannels: d.notice?.channels ?? ["email", "sms", "inapp"],
    noticeMessage: d.notice?.message ?? "",
    continuity: d.continuity ? continuityDraftFrom(d.continuity) : null,
  };
}

/** The continuity plan to start from, in the editor as a new plan. */
export function continuityTemplateDraft(): PlanDraft {
  return draftFrom({ title: CONTINUITY_PLAN_TEMPLATE.title, definition: PlanDefinitionSchema.parse(CONTINUITY_PLAN_TEMPLATE.definition) }, null, 0);
}

function minutesOf(text: string, what: string): number {
  const value = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(value)) throw new Error(`${what}: enter a number of hours.`);
  return Math.round(value * 60);
}

/** The plan the draft describes, ready to save; throws with the reason when a field is not filled in. */
export function definitionFrom(draft: PlanDraft): PlanDefinitionInput {
  const tasks = draft.tasks.map((task, index) => {
    const n = index + 1;
    if (!task.position) throw new Error(`Task ${n}: choose the position it goes to.`);
    if (!task.item.trim()) throw new Error(`Task ${n}: enter what the task is.`);
    const releaseMinutes = minutesOf(task.releaseHours, `Task ${n} release`);
    const due = task.dueHours.trim() ? minutesOf(task.dueHours, `Task ${n} due`) : null;
    return {
      position: task.position, item: task.item.trim(), category: task.category || "general", releaseMinutes,
      ...(due ? { dueMinutes: due } : {}),
    };
  });
  const sections = draft.sections.map((section, index) => {
    if (!section.title.trim()) throw new Error(`Section ${index + 1}: enter its title.`);
    return {
      title: section.title.trim(), body: section.body, positions: [...section.positions], boards: [...section.boards],
      contactGroups: [...section.contactGroups], rules: [...section.rules],
    };
  });
  const review = draft.reviewEveryDays.trim();
  return {
    kind: draft.kind,
    templateKey: draft.templateKey,
    ...(draft.incidentKind ? { incidentKind: draft.incidentKind } : {}),
    sections,
    tasks,
    ...(draft.notifying ? {
      notice: {
        contactGroups: [...draft.noticeGroups], positions: [...draft.noticePositions],
        onCallPositions: [...draft.noticeOnCall],
        channels: CHANNELS.filter((channel) => draft.noticeChannels.includes(channel)),
        ...(draft.noticeMessage.trim() ? { message: draft.noticeMessage.trim() } : {}),
      },
    } : {}),
    ...(review ? { reviewEveryDays: Math.round(Number(review)) } : {}),
    ...(draft.kind === "continuity" ? { continuity: continuityFrom(draft.continuity ?? emptyContinuity()) } : {}),
  };
}

/** When a task releases, in words: "at activation", "6 hours after activation", "2 days before the event". */
export function releaseLabel(minutes: number, kind: PlanKind): string {
  const anchor = kind === "recurring_event" ? "the event starts" : "activation";
  if (minutes === 0) return kind === "recurring_event" ? "when the event starts" : "at activation";
  const size = Math.abs(minutes);
  const amount = size % 1440 === 0 ? `${size / 1440} day${size === 1440 ? "" : "s"}`
    : size % 60 === 0 ? `${size / 60} hour${size === 60 ? "" : "s"}` : `${size} minutes`;
  return `${amount} ${minutes < 0 ? "before" : "after"} ${anchor}`;
}

/**
 * The last activation's report, kept outside the component: activating the
 * first open incident makes the console select it, and switching to it
 * remounts this screen once or twice, possibly while the activation is still
 * waiting for its answer, and the report must survive that to be read. Every
 * panel of the jurisdiction mounted while it stands shows it and opens its
 * incident's setup. It stands for a minute at most, and goes as soon as the
 * operator dismisses it, activates again or opens another incident's setup,
 * so it never overrides a choice of theirs.
 */
interface ActivationReport { jurisdictionId: string; text: string; incidentId: string; name: string; at: number }
let lastActivation: ActivationReport | null = null;
const reportListeners = new Set<() => void>();

function publishActivation(report: ActivationReport): void {
  lastActivation = report;
  for (const listener of reportListeners) listener();
}

function recentActivation(jurisdictionId: string): ActivationReport | null {
  return lastActivation && lastActivation.jurisdictionId === jurisdictionId && Date.now() - lastActivation.at < 60_000
    ? lastActivation : null;
}

/** Let the last activation's report go: the operator chose something else. */
export function clearActivationReport(): void {
  lastActivation = null;
  for (const listener of reportListeners) listener();
}

const toggle = (list: readonly string[], value: string, on: boolean): string[] =>
  on ? [...list.filter((v) => v !== value), value] : list.filter((v) => v !== value);
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

export function PlansPanel(props: {
  readonly client: PlanClient;
  readonly jurisdictionId: string;
  readonly isAdmin: boolean;
  /** The incident templates a plan may activate from. */
  readonly templates: readonly IncidentTemplateOption[];
  /** Called with the incident a plan opened, so the screen can show its setup. */
  readonly onActivated?: (incidentId: string) => void;
  /**
   * Switch the workspace to an incident. The console remounts its center on a
   * switch, so activation reports what it did first and the switch waits for
   * the operator.
   */
  readonly onSwitch?: (incidentId: string) => Promise<void> | void;
}) {
  const [reload, setReload] = useState(0);
  const plans = useAsync(() => props.client.listPlans(props.jurisdictionId), [props.jurisdictionId, reload]);
  const boardTemplates = useAsync(() => props.client.listTemplates(), []);
  const [reading, setReading] = useState<PlanDetail | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [history, setHistory] = useState<{ plan: PlanSummary; versions: readonly PlanVersion[] } | null>(null);
  const [activating, setActivating] = useState<{ plan: PlanSummary; name: string; eventAt: string } | null>(null);
  const [opened, setOpened] = useState<{ incidentId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  // The activation report, from this panel's activation or one a remount cut off; it opens the new incident's setup.
  const onActivated = useRef(props.onActivated);
  onActivated.current = props.onActivated;
  useEffect(() => {
    let shown: string | null = null;
    const show = () => {
      const report = recentActivation(props.jurisdictionId);
      if (!report) {
        // A report this panel showed and the operator let go is taken down.
        if (shown) { shown = null; setNotice(""); setOpened(null); }
        return;
      }
      shown = report.text;
      setNotice(report.text);
      setOpened({ incidentId: report.incidentId, name: report.name });
      onActivated.current?.(report.incidentId);
    };
    show();
    reportListeners.add(show);
    return () => { reportListeners.delete(show); };
  }, [props.jurisdictionId]);
  const templateKey = draft?.templateKey ?? reading?.definition.templateKey ?? "";
  const template = useAsync<IncidentTemplateDefinition | null>(
    () => (templateKey ? props.client.getIncidentTemplate(templateKey).then((t) => t.template) : Promise.resolve(null)),
    [templateKey],
  );

  const act = async (fn: () => Promise<string | void>) => {
    // Another action here is the operator moving on from the last activation's report.
    clearActivationReport();
    setBusy(true); setError(null); setNotice(""); setOpened(null);
    try {
      const done = await fn();
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => { setReading(null); setDraft(null); setHistory(null); setActivating(null); };
  const update = (change: Partial<PlanDraft>) => setDraft((current) => (current ? { ...current, ...change } : current));
  const setSection = (index: number, change: Partial<SectionDraft>) =>
    update({ sections: draft!.sections.map((s, i) => (i === index ? { ...s, ...change } : s)) });
  const setTask = (index: number, change: Partial<TaskDraft>) =>
    update({ tasks: draft!.tasks.map((t, i) => (i === index ? { ...t, ...change } : t)) });

  const t = template.data;
  const positionTitle = (key: string): string => t?.positionTitles?.[key] ?? ICS_POSITION_TITLES[key] ?? key;
  const boardTitle = (key: string): string => boardTemplates.data?.find((b) => b.key === key)?.title ?? key;
  const groups = (t?.contactGroups ?? []).map((group) => group.name);
  const templateTitle = (key: string): string => props.templates.find((option) => option.key === key)?.title ?? key;

  const open = (plan: PlanSummary) => act(async () => { close(); setReading(await props.client.getPlan(plan.id)); });
  const edit = (plan: PlanSummary) => act(async () => {
    const current = await props.client.getPlan(plan.id);
    close();
    setDraft(draftFrom(current, current.id, current.version));
  });
  const showHistory = (plan: PlanSummary) => act(async () => {
    close();
    setHistory({ plan, versions: await props.client.listPlanVersions(plan.id) });
  });
  const loadVersion = (plan: PlanSummary, entry: PlanVersion) => act(async () => {
    const current = await props.client.getPlan(plan.id);
    close();
    setDraft(draftFrom(entry, plan.id, current.version));
    return `Version ${entry.version} is in the editor. Save it to make it version ${current.version + 1}.`;
  });
  const save = () => act(async () => {
    if (!draft) return;
    if (!draft.title.trim()) throw new Error("Enter the plan's title.");
    if (!draft.templateKey) throw new Error("Choose the incident template the plan activates.");
    const saved = await props.client.savePlan(props.jurisdictionId, draft.planId, {
      title: draft.title.trim(), definition: definitionFrom(draft), expectedVersion: draft.expectedVersion,
    });
    setDraft(null);
    setReload((n) => n + 1);
    return `Saved ${saved.title} as version ${saved.version}.`;
  });
  const review = (plan: PlanSummary) => act(async () => {
    const saved = await props.client.markPlanReviewed(plan.id);
    setReload((n) => n + 1);
    return `${plan.title} is marked reviewed.${saved.reviewDueAt ? ` The next review is due ${formatTime(saved.reviewDueAt)}.` : ""}`;
  });
  const activate = () => act(async () => {
    if (!activating) return;
    const { plan, name, eventAt } = activating;
    if (!name.trim()) throw new Error("Enter the incident's name.");
    if (plan.kind === "recurring_event" && !eventAt) throw new Error("Enter when this occurrence of the event starts.");
    const result = await props.client.activatePlan(plan.id, {
      name: name.trim(), ...(plan.kind === "recurring_event" ? { eventAt: new Date(eventAt).toISOString() } : {}),
    });
    const text = `${name.trim()} is activated from ${plan.title}, version ${result.planVersion}: ${count(result.tasksReleased, "task")} released now, `
      + `${count(result.tasksScheduled, "task")} waiting for their time${result.notice ? `; the notice reached ${count(result.notice.recipients, "person")}` : ""}.`;
    setActivating(null);
    publishActivation({ jurisdictionId: props.jurisdictionId, text, incidentId: result.incidentId, name: name.trim(), at: Date.now() });
  });

  const list = plans.data ?? [];
  const now = Date.now();

  return (
    <Panel title="Plans">
      <p className="eoc-muted">
        A plan activates an incident from its template, releases its tasks on schedule and sends its notice, in one
        step. Each section names the positions, boards, contact groups and rules that carry it out.
      </p>
      {plans.loading && !plans.data ? <Loading label="Loading plans…" /> : null}
      {plans.error ? <ErrorNote message={plans.error} /> : null}
      {plans.data && list.length === 0 ? <p className="eoc-flush eoc-muted">No plans yet.</p> : null}
      {list.length > 0 ? (
        <ul className="incidents-list" aria-label="Plans">
          {list.map((plan) => {
            const overdue = plan.reviewDueAt ? Date.parse(plan.reviewDueAt) <= now : false;
            return (
              <li key={plan.id} className="incidents-item">
                <div className="incidents-item-body">
                  <div className="incidents-row">
                    <strong>{plan.title}</strong>
                    <span className="incidents-kind">{KIND_LABELS[plan.kind]} · version {plan.version}</span>
                    {overdue ? <StatusBadge status="warning">Review due</StatusBadge> : null}
                  </div>
                  <div className="incidents-authority">
                    <span>Activates {templateTitle(plan.templateKey)}</span><span aria-hidden="true">·</span>
                    <span>{count(plan.sections, "section")}</span><span aria-hidden="true">·</span>
                    <span>{count(plan.tasks, "timed task")}</span><span aria-hidden="true">·</span>
                    <span>{plan.reviewDueAt ? `Next review ${formatTime(plan.reviewDueAt)}` : "No review cadence"}</span>
                  </div>
                </div>
                <div className="incidents-item-actions">
                  <Button label={`Read ${plan.title}`} onClick={() => void open(plan)} disabled={busy}>Read</Button>
                  {props.isAdmin ? <>
                    <Button label={`Activate ${plan.title}`} kind="primary" disabled={busy}
                      onClick={() => { close(); setActivating({ plan, name: "", eventAt: "" }); setNotice(""); setError(null); }}>Activate</Button>
                    <Button label={`Edit ${plan.title}`} onClick={() => void edit(plan)} disabled={busy}>Edit</Button>
                    <Button label={`Versions of ${plan.title}`} onClick={() => void showHistory(plan)} disabled={busy}>Versions</Button>
                    {plan.reviewDueAt ? <Button label={`Mark reviewed: ${plan.title}`} onClick={() => void review(plan)} disabled={busy}>Mark reviewed</Button> : null}
                  </> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {props.isAdmin ? (
        <div className="eoc-space-above">
          <Button disabled={busy || props.templates.length === 0}
            onClick={() => { close(); setDraft(emptyDraft(props.templates[0]?.key ?? "")); setNotice(""); setError(null); }}>New plan</Button>
          {props.templates.some((option) => option.key === CONTINUITY_PLAN_TEMPLATE.definition.templateKey) ? (
            <Button disabled={busy} onClick={() => { close(); setDraft(continuityTemplateDraft()); setNotice(""); setError(null); }}>
              Start from the continuity template
            </Button>
          ) : null}
        </div>
      ) : null}

      {activating ? (
        <form className="eoc-space-above incidents-section" aria-label={`Activate ${activating.plan.title}`}
          onSubmit={(event) => { event.preventDefault(); void activate(); }}>
          <h3>Activate {activating.plan.title}</h3>
          <div className="incidents-form-row">
            <TextField label="Incident name" value={activating.name} required
              onChange={(name) => setActivating({ ...activating, name })} />
            {activating.plan.kind === "recurring_event" ? (
              <label className="incidents-field">Event starts
                <input type="datetime-local" value={activating.eventAt} required
                  onChange={(event) => setActivating({ ...activating, eventAt: event.target.value })} />
              </label>
            ) : null}
          </div>
          <p className="eoc-muted">
            {activating.plan.kind === "recurring_event"
              ? "Tasks are timed from the event's start; one whose time has passed is released at once."
              : "Tasks are timed from now; each waits hidden until its time, then goes to its position."}
          </p>
          <div className="incidents-actions">
            <Button type="submit" kind="primary" disabled={busy}>{busy ? "Activating…" : "Activate the plan"}</Button>
            <Button onClick={() => setActivating(null)} disabled={busy}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {reading ? (
        <section className="eoc-space-above incidents-section" aria-label={`${reading.title}, version ${reading.version}`}>
          <h3>{reading.title}, version {reading.version}</h3>
          <p className="eoc-muted">{KIND_LABELS[reading.kind]} plan. Activates {templateTitle(reading.templateKey)}.</p>
          <PlanSections sections={reading.definition.sections} positionTitle={positionTitle} boardTitle={boardTitle} />
          {reading.definition.continuity ? <ContinuityView continuity={reading.definition.continuity} positionTitle={positionTitle} /> : null}
          {reading.definition.tasks.length ? (
            <>
              <h4>Timed tasks</h4>
              <ul className="plans-tasks">
                {reading.definition.tasks.map((task, index) => (
                  <li key={index}><strong>{task.item}</strong> · {positionTitle(task.position)} · {releaseLabel(task.releaseMinutes, reading.kind)}</li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="incidents-actions"><Button onClick={() => setReading(null)}>Close</Button></div>
        </section>
      ) : null}

      {history ? (
        <section className="eoc-space-above" aria-label={`Versions of ${history.plan.title}`}>
          <h3>Versions of {history.plan.title}</h3>
          <ol className="incidents-list">
            {history.versions.map((entry) => (
              <li key={entry.version} className="incidents-item">
                <div className="incidents-item-body">
                  <strong>Version {entry.version}: {entry.title}</strong>
                  <span className="incidents-authority">Saved {formatTime(entry.savedAt)} {entry.savedBy ? `by ${entry.savedBy}` : ""}</span>
                </div>
                <div className="incidents-item-actions">
                  <Button label={`Load into the editor: version ${entry.version}`} onClick={() => void loadVersion(history.plan, entry)} disabled={busy}>
                    Load into the editor
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {draft ? (
        <form className="eoc-space-above incidents-section" aria-label={draft.planId ? `Edit ${draft.title}` : "New plan"}
          onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <h3>{draft.planId ? `Edit ${draft.title}, version ${draft.expectedVersion}` : "New plan"}</h3>
          <div className="incidents-form-row">
            <TextField label="Plan title" value={draft.title} required onChange={(title) => update({ title })} />
            <EnumSelect label="Kind of plan" values={["incident_response", "recurring_event", "continuity"]} value={draft.kind}
              onChange={(kind) => update({
                kind: kind as PlanKind,
                continuity: kind === "continuity" ? draft.continuity ?? emptyContinuity() : null,
              })} labels={KIND_LABELS} />
            <EnumSelect label="Incident template it activates" values={props.templates.map((option) => option.key)} value={draft.templateKey}
              onChange={(templateKey) => update({ templateKey })}
              labels={Object.fromEntries(props.templates.map((option) => [option.key, option.title]))} />
            <EnumSelect label="Incident type" values={[...INCIDENT_KINDS]} value={draft.incidentKind}
              onChange={(incidentKind) => update({ incidentKind: incidentKind as PlanDraft["incidentKind"] })} labels={INCIDENT_KIND_LABELS} />
            <TextField label="Review every (days)" value={draft.reviewEveryDays} onChange={(reviewEveryDays) => update({ reviewEveryDays })} />
          </div>
          {template.error ? <ErrorNote message={template.error} /> : null}

          {draft.kind === "continuity" && draft.continuity ? (
            <ContinuityEditor draft={draft.continuity} onChange={(continuity) => update({ continuity })}
              positions={(t?.positions ?? []).map((key) => ({ key, title: positionTitle(key) }))} />
          ) : null}

          <fieldset className="incidents-fieldset">
            <legend>Sections</legend>
            {draft.sections.map((section, index) => (
              <div key={index} className="plans-block" role="group" aria-label={`Section ${index + 1}`}>
                <TextField label={`Section ${index + 1} title`} value={section.title} onChange={(title) => setSection(index, { title })} />
                <label className="incidents-field">Section {index + 1} text
                  <textarea rows={4} value={section.body} onChange={(event) => setSection(index, { body: event.target.value })} />
                </label>
                <LinkChoices legend="Positions that carry it out" values={t?.positions ?? []} chosen={section.positions}
                  label={positionTitle} onChange={(positions) => setSection(index, { positions })} />
                <LinkChoices legend="Boards" values={t?.boards ?? []} chosen={section.boards}
                  label={boardTitle} onChange={(boards) => setSection(index, { boards })} />
                <LinkChoices legend="Contact groups" values={groups} chosen={section.contactGroups}
                  label={(name) => name} onChange={(contactGroups) => setSection(index, { contactGroups })} />
                <LinkChoices legend="Notification rules" values={t?.rules ?? []} chosen={section.rules}
                  label={(key) => key} onChange={(rules) => setSection(index, { rules })} />
                <Button onClick={() => update({ sections: draft.sections.filter((_, i) => i !== index) })}>Remove section {index + 1}</Button>
              </div>
            ))}
            <div className="plans-add"><Button onClick={() => update({ sections: [...draft.sections, EMPTY_SECTION] })}>Add a section</Button></div>
          </fieldset>

          <fieldset className="incidents-fieldset">
            <legend>Timed tasks</legend>
            <p className="eoc-muted eoc-flush">
              {draft.kind === "recurring_event"
                ? "Hours from the event's start: negative is before it. A task waits hidden until its time."
                : "Hours after activation: 0 releases the task at activation. A task waits hidden until its time."}
            </p>
            {draft.tasks.map((task, index) => (
              <div key={index} className="plans-task-row" role="group" aria-label={`Task ${index + 1}`}>
                <EnumSelect label={`Task ${index + 1} position`} values={["", ...(t?.positions ?? [])]} value={task.position}
                  onChange={(position) => setTask(index, { position })}
                  labels={{ "": "Choose a position", ...Object.fromEntries((t?.positions ?? []).map((key) => [key, positionTitle(key)])) }} />
                <TextField label={`Task ${index + 1} description`} value={task.item} onChange={(item) => setTask(index, { item })} />
                <TextField label={`Task ${index + 1} release (hours)`} value={task.releaseHours} onChange={(releaseHours) => setTask(index, { releaseHours })} />
                <TextField label={`Task ${index + 1} due within (hours)`} value={task.dueHours} onChange={(dueHours) => setTask(index, { dueHours })} />
                <Button onClick={() => update({ tasks: draft.tasks.filter((_, i) => i !== index) })}>Remove task {index + 1}</Button>
              </div>
            ))}
            <div className="plans-add"><Button onClick={() => update({ tasks: [...draft.tasks, EMPTY_TASK] })}>Add a task</Button></div>
          </fieldset>

          <fieldset className="incidents-fieldset">
            <legend>Activation notice</legend>
            <label className="contacts-check">
              <input type="checkbox" checked={draft.notifying} onChange={(event) => update({ notifying: event.target.checked })} />
              Notify people when the plan activates
            </label>
            {draft.notifying ? <>
              <LinkChoices legend="Contact groups to notify" values={groups} chosen={draft.noticeGroups}
                label={(name) => name} onChange={(noticeGroups) => update({ noticeGroups })} />
              <LinkChoices legend="Holders of these positions" values={t?.positions ?? []} chosen={draft.noticePositions}
                label={positionTitle} onChange={(noticePositions) => update({ noticePositions })} />
              <LinkChoices legend="Whoever is on call for these positions" values={t?.positions ?? []} chosen={draft.noticeOnCall}
                label={positionTitle} onChange={(noticeOnCall) => update({ noticeOnCall })} />
              <LinkChoices legend="Send by" values={[...CHANNELS]} chosen={draft.noticeChannels}
                label={(channel) => CHANNEL_LABELS[channel] ?? channel} onChange={(noticeChannels) => update({ noticeChannels })} />
              <label className="incidents-field">Message (optional)
                <textarea rows={2} value={draft.noticeMessage} onChange={(event) => update({ noticeMessage: event.target.value })}
                  placeholder="Without one, the notice names the incident and the plan and asks people to check in." />
              </label>
            </> : null}
          </fieldset>
          <div className="incidents-actions">
            <Button type="submit" kind="primary" disabled={busy}>{busy ? "Saving…" : "Save plan"}</Button>
            <Button onClick={() => setDraft(null)} disabled={busy}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p role="status" className="eoc-note">{notice}</p> : null}
      {opened ? (
        <div className="incidents-actions">
          {props.onSwitch ? <Button kind="primary" onClick={() => void props.onSwitch?.(opened.incidentId)}>Switch to {opened.name}</Button> : null}
          <Button onClick={clearActivationReport}>Dismiss</Button>
        </div>
      ) : null}
    </Panel>
  );
}

function LinkChoices(props: {
  readonly legend: string;
  readonly values: readonly string[];
  readonly chosen: readonly string[];
  readonly label: (value: string) => string;
  readonly onChange: (next: string[]) => void;
}) {
  if (props.values.length === 0) return null;
  return (
    <fieldset className="plans-choices">
      <legend>{props.legend}</legend>
      <div className="incidents-positions">
        {props.values.map((value) => (
          <label key={value}>
            <input type="checkbox" checked={props.chosen.includes(value)}
              onChange={(event) => props.onChange(toggle(props.chosen, value, event.target.checked))} /> {props.label(value)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A plan's sections as its readers see them, each with what carries it out. */
export function PlanSections(props: {
  readonly sections: Readonly<PlanDetail["definition"]["sections"]>;
  readonly positionTitle: (key: string) => string;
  readonly boardTitle: (key: string) => string;
}) {
  if (props.sections.length === 0) return <p className="eoc-muted">The plan has no sections.</p>;
  return (
    <ol className="plans-sections">
      {props.sections.map((section, index) => {
        const parts = [
          ...section.positions.map(props.positionTitle),
          ...section.boards.map((key) => `${props.boardTitle(key)} board`),
          ...section.contactGroups.map((name) => `${name} contact group`),
          ...section.rules.map((key) => `rule ${key}`),
        ];
        return (
          <li key={index}>
            <h4>{section.title}</h4>
            {section.body ? <p className="plans-body">{section.body}</p> : null}
            {parts.length ? <p className="eoc-muted eoc-flush">Carried out by: {parts.join(", ")}.</p> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The plan an incident was activated from, in the incident's setup: its
 * sections at that version and the tasks it has still to release.
 */
export function IncidentPlanSection(props: {
  readonly client: Pick<ApiClient, "incidentPlan" | "listTemplates">;
  readonly incidentId: string;
  /** The incident's positions, for their titles. */
  readonly positions?: ReadonlyArray<{ readonly key: string; readonly title: string }>;
}) {
  const plan = useAsync(() => props.client.incidentPlan(props.incidentId), [props.incidentId]);
  const boards = useAsync(() => (plan.data ? props.client.listTemplates() : Promise.resolve([])), [plan.data]);
  if (plan.error) return <ErrorNote message={plan.error} />;
  if (!plan.data) return null;
  const p = plan.data;
  const positionTitle = (key: string) => props.positions?.find((position) => position.key === key)?.title ?? ICS_POSITION_TITLES[key] ?? key;
  const boardTitle = (key: string) => boards.data?.find((board) => board.key === key)?.title ?? key;
  return (
    <section aria-label="Incident plan">
      <h3 className="incidents-first">Plan: {p.title}, version {p.version}</h3>
      {p.eventAt ? <p className="eoc-muted">Event starts {formatTime(p.eventAt)}.</p> : null}
      <PlanSections sections={p.sections} positionTitle={positionTitle} boardTitle={boardTitle} />
      {p.continuity ? <ContinuityView continuity={p.continuity} positionTitle={positionTitle} /> : null}
      <h4>Tasks the plan has still to release</h4>
      {p.scheduled.length ? (
        <ul className="plans-tasks">
          {p.scheduled.map((task, index) => (
            <li key={index}><strong>{task.item}</strong> · {task.positionTitle} · releases {formatTime(task.releaseAt)}</li>
          ))}
        </ul>
      ) : <p className="eoc-muted">Every task the plan times has been released.</p>}
    </section>
  );
}
