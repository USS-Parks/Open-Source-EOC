import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTINUITY_PLAN_TEMPLATE } from "@openeoc/shared";
import { addMembership, createJurisdiction, createPerson, principalForPerson } from "../auth/service.js";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { runDuePlans } from "../plans/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";

/**
 * Executable plans (Veoci and air gap VA13). A plan is saved against its
 * incident template and versioned; activation opens the incident, records
 * the plan version, releases the tasks whose time has come, keeps the rest
 * hidden until the scheduler releases them to their positions, and sends the
 * notice; a recurring event plan times its tasks from the event's start; and
 * administrators are reminded once when a review falls due. An after-action
 * corrective action names the plan and section it changes, and its owner is
 * reminded once for each due date it reaches open (VA30).
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let adminToken: string;
let memberToken: string;
let outsiderToken: string;
let operationsId: string;

const MINUTE = 60_000;

async function call(token: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown) {
  return app.inject({ method, url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as object }) });
}

async function runPlans(now: Date) {
  const principal = await principalForPerson(runtime, seed.adminId);
  return withPerson(runtime, seed.adminId, (tx) => runDuePlans(tx, principal, seed.jurisdictionId, now));
}

const stormPlan = {
  kind: "incident_response",
  templateKey: "severe_storm",
  sections: [
    {
      title: "Concept of operations",
      body: "The EOC opens at partial activation when the Weather Service issues a storm warning.",
      positions: ["incident_commander", "operations_section_chief"],
      boards: ["road_closures", "shelters"],
    },
  ],
  tasks: [
    { position: "operations_section_chief", item: "Confirm the road crews are staged", releaseMinutes: 0, dueMinutes: 30 },
    { position: "operations_section_chief", item: "Check the culverts on the river road", releaseMinutes: 60, dueMinutes: 120 },
    { position: "incident_commander", item: "Decide on the second operational period", releaseMinutes: 1440 },
  ],
  notice: { positions: ["operations_section_chief"], channels: ["inapp"], message: "Storm plan activated. Report to the EOC." },
  reviewEveryDays: 30,
};

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  const elsewhere = await createJurisdiction(admin, "county", "Humboldt County OES");
  const outsider = await createPerson(admin, { email: "outsider@example.org", displayName: "Other Admin", password: "outsider-password" });
  await addMembership(admin, outsider, elsewhere, "admin");
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  outsiderToken = await tokenFor(app, "outsider@example.org", "outsider-password");
  // The member holds Operations, so the plan's notice to that position reaches them.
  const position = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`,
    { key: "operations_section_chief", title: "Operations Section Chief" });
  expect(position.statusCode, position.body).toBeLessThan(300);
  operationsId = position.json().id as string;
  const assigned = await call(adminToken, "POST", `/api/v1/positions/${operationsId}/assignments`, { personId: seed.memberId });
  expect(assigned.statusCode, assigned.body).toBeLessThan(300);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

let stormId: string;
let annexId: string;

/** The start of the UTC day this many days from today; corrective action due dates are UTC calendar days. */
function utcDay(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
}

describe("executable plans", () => {
  it("saves a plan checked against its template and keeps every version", async () => {
    const created = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/plans`,
      { title: "Severe Storm Plan", definition: stormPlan, expectedVersion: 0 });
    expect(created.statusCode, created.body).toBe(201);
    stormId = created.json().id as string;
    expect(created.json()).toMatchObject({ version: 1, kind: "incident_response", sections: 1, tasks: 3, reviewEveryDays: 30 });

    const listed = await call(memberToken, "GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/plans`);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().plans).toEqual([expect.objectContaining({ id: stormId, title: "Severe Storm Plan", templateKey: "severe_storm" })]);

    const byMember = await call(memberToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/plans`,
      { title: "Member plan", definition: stormPlan, expectedVersion: 0 });
    expect(byMember.statusCode).toBe(403);
    const unopened = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/plans`, {
      title: "Bad links", expectedVersion: 0,
      definition: { ...stormPlan, sections: [{ title: "Liaison", positions: ["tribal_liaison"] }] },
    });
    expect(unopened.statusCode).toBe(400);
    expect(unopened.json().error).toContain("position tribal_liaison is not one the Severe Storm template opens");
    const early = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/plans`, {
      title: "Early", expectedVersion: 0,
      definition: { ...stormPlan, tasks: [{ position: "incident_commander", item: "Too soon", releaseMinutes: -60 }] },
    });
    expect(early.statusCode).toBe(400);
    expect(early.json().error).toContain("releases a task at activation or after it");
    expect(await admin`select id from plans where title in ('Member plan', 'Bad links', 'Early')`).toHaveLength(0);

    const edited = await call(adminToken, "PUT", `/api/v1/plans/${stormId}`,
      { title: "Severe Storm Plan", definition: { ...stormPlan, reviewEveryDays: 60 }, expectedVersion: 1 });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({ version: 2, reviewEveryDays: 60 });
    const stale = await call(adminToken, "PUT", `/api/v1/plans/${stormId}`,
      { title: "Severe Storm Plan", definition: stormPlan, expectedVersion: 1 });
    expect(stale.statusCode).toBe(409);
    const versions = await call(memberToken, "GET", `/api/v1/plans/${stormId}/versions`);
    expect(versions.json().versions.map((v: { version: number; savedBy: string }) => [v.version, v.savedBy])).toEqual([[2, "Admin"], [1, "Admin"]]);
    await expect(admin`update plan_versions set title = 'x' where plan_id = ${stormId}`).rejects.toThrow(/append-only/);

    const foreign = await call(outsiderToken, "GET", `/api/v1/plans/${stormId}`);
    expect(foreign.statusCode).toBe(404);
  });

  it("activates the incident, releases what is due, sends the notice and releases the rest on schedule", async () => {
    const before = Date.now();
    const res = await call(adminToken, "POST", `/api/v1/plans/${stormId}/activate`, { name: "January Storm" });
    expect(res.statusCode, res.body).toBe(201);
    const activation = res.json();
    expect(activation).toMatchObject({ planVersion: 2, tasksReleased: 1, tasksScheduled: 2, notice: { recipients: 1 } });
    const incidentId = activation.incidentId as string;
    const [incident] = await admin`select template_key, plan_id, plan_version, kind from incidents where id = ${incidentId}`;
    expect(incident).toMatchObject({ template_key: "severe_storm", plan_id: stormId, plan_version: 2, kind: "incident" });

    // The template's checklists and the plan's first task are on the incident; the others wait, unseen.
    const tasks = await admin`select item, due_at from checklist_items where incident_id = ${incidentId}`;
    expect(tasks.map((t) => t.item)).toContain("Confirm the road crews are staged");
    expect(tasks.map((t) => t.item)).not.toContain("Check the culverts on the river road");
    const staged = tasks.find((t) => t.item === "Confirm the road crews are staged")!;
    expect(new Date(staged.due_at as string).getTime()).toBeGreaterThanOrEqual(before + 29 * MINUTE);

    const inbox = await call(memberToken, "GET", "/api/v1/notifications");
    expect(inbox.json().notifications).toContainEqual(expect.objectContaining({ title: "Activated: January Storm" }));

    const plan = await call(memberToken, "GET", `/api/v1/incidents/${incidentId}/plan`);
    expect(plan.statusCode).toBe(200);
    expect(plan.json().plan).toMatchObject({
      planId: stormId, title: "Severe Storm Plan", version: 2, eventAt: null,
      sections: [expect.objectContaining({ title: "Concept of operations", boards: ["road_closures", "shelters"] })],
      scheduled: [
        expect.objectContaining({ item: "Check the culverts on the river road", positionTitle: "Operations Section Chief" }),
        expect.objectContaining({ item: "Decide on the second operational period" }),
      ],
    });
    expect((await call(outsiderToken, "GET", `/api/v1/incidents/${incidentId}/plan`)).statusCode).toBe(404);

    const [due] = await admin`select count(*)::int as n from scheduler_due('plans', ${new Date(Date.now() + 61 * MINUTE)})`;
    expect(due!.n).toBe(1);
    expect(await runPlans(new Date(Date.now() + 30 * MINUTE))).toEqual({ released: 0, reminded: 0, actionsDue: 0 });
    const later = new Date(Date.now() + 61 * MINUTE);
    expect(await runPlans(later)).toEqual({ released: 1, reminded: 0, actionsDue: 0 });
    expect(await runPlans(later)).toEqual({ released: 0, reminded: 0, actionsDue: 0 });
    const [released] = await admin`
      select c.item, c.due_at, p.key from checklist_items c join positions p on p.id = c.position_id
      where c.incident_id = ${incidentId} and c.item = 'Check the culverts on the river road'`;
    expect(released).toMatchObject({ key: "operations_section_chief" });
    expect(new Date(released!.due_at as string).getTime()).toBe(later.getTime() + 120 * MINUTE);
    const told = await call(memberToken, "GET", "/api/v1/notifications");
    expect(told.json().notifications).toContainEqual(expect.objectContaining({ title: "New task: Check the culverts on the river road" }));
    expect((await call(memberToken, "GET", `/api/v1/incidents/${incidentId}/plan`)).json().plan.scheduled).toHaveLength(1);

    // A closed incident's waiting task stays unreleased.
    const closed = await call(adminToken, "POST", `/api/v1/incidents/${incidentId}/close`, {});
    expect(closed.statusCode, closed.body).toBeLessThan(300);
    expect(await runPlans(new Date(Date.now() + 2 * 1440 * MINUTE))).toMatchObject({ released: 0 });
    const audits = await admin`select category from audit_events where incident_id = ${incidentId} and category like 'plan.%' order by seq`;
    expect(audits.map((a) => a.category)).toEqual(["plan.activated", "plan.task_released"]);
  });

  it("times a recurring event plan's tasks from the event's start", async () => {
    const created = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/plans`, {
      title: "Salmon Festival", expectedVersion: 0,
      definition: {
        kind: "recurring_event", templateKey: "daily_ops",
        tasks: [
          { position: "operations_section_chief", item: "Book the first aid tent", releaseMinutes: -3 * 1440 },
          { position: "operations_section_chief", item: "Walk the festival grounds", releaseMinutes: -60 },
          { position: "operations_section_chief", item: "Open the event log", releaseMinutes: 0 },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const festivalId = created.json().id as string;
    expect((await call(adminToken, "POST", `/api/v1/plans/${festivalId}/activate`, { name: "Festival" })).statusCode).toBe(400);
    expect((await call(adminToken, "POST", `/api/v1/plans/${stormId}/activate`,
      { name: "Storm", eventAt: new Date().toISOString() })).statusCode).toBe(400);

    const eventAt = new Date(Date.now() + 1440 * MINUTE);
    const res = await call(adminToken, "POST", `/api/v1/plans/${festivalId}/activate`, { name: "Salmon Festival 2026", eventAt: eventAt.toISOString() });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ tasksReleased: 1, tasksScheduled: 2 });
    const incidentId = res.json().incidentId as string;
    const [incident] = await admin`select kind, plan_event_at from incidents where id = ${incidentId}`;
    expect(incident!.kind).toBe("planned_event");
    expect(new Date(incident!.plan_event_at as string).getTime()).toBe(eventAt.getTime());
    const releases = await admin`select item, release_at from plan_task_releases where incident_id = ${incidentId} order by release_at`;
    expect(releases.map((r) => [r.item, new Date(r.release_at as string).getTime()])).toEqual([
      ["Walk the festival grounds", eventAt.getTime() - 60 * MINUTE],
      ["Open the event log", eventAt.getTime()],
    ]);
  });

  it("reminds administrators once when a review falls due, and again after the next review", async () => {
    const created = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/plans`, {
      title: "Tsunami Annex", expectedVersion: 0,
      definition: { kind: "incident_response", templateKey: "daily_ops", reviewEveryDays: 1 },
    });
    expect(created.statusCode, created.body).toBe(201);
    annexId = created.json().id as string;
    const inTwoDays = new Date(Date.now() + 2 * 1440 * MINUTE);
    expect(await runPlans(inTwoDays)).toMatchObject({ reminded: 1 });
    expect(await runPlans(inTwoDays)).toMatchObject({ reminded: 0 });
    const inbox = await call(adminToken, "GET", "/api/v1/notifications");
    expect(inbox.json().notifications).toContainEqual(expect.objectContaining({ channel: "plan_review", title: "Plan review due: Tsunami Annex" }));
    expect((await call(memberToken, "GET", "/api/v1/notifications")).json().notifications)
      .not.toContainEqual(expect.objectContaining({ channel: "plan_review" }));

    const reviewed = await call(adminToken, "POST", `/api/v1/plans/${annexId}/review`, {});
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect(Date.parse(reviewed.json().reviewDueAt)).toBeGreaterThan(Date.now() + 1439 * MINUTE);
    expect(await runPlans(new Date(Date.now() + 60 * MINUTE))).toMatchObject({ reminded: 0 });
    expect(await runPlans(inTwoDays)).toMatchObject({ reminded: 1 });
    const [audit] = await admin`select category from audit_events where subject_id = ${annexId} and category = 'plan.reviewed'`;
    expect(audit).toBeDefined();
  });

  it("links corrective actions to a plan's sections and reminds their owners once for each due date", async () => {
    const actions = `/api/v1/jurisdictions/${seed.jurisdictionId}/corrective-actions`;
    const tomorrow = utcDay(1).toISOString().slice(0, 10);
    const staging = { capability: "operational_coordination", recommendation: "Name the road crew staging area", dueDate: tomorrow };
    const owned = await call(adminToken, "POST", actions,
      { ...staging, ownerPosition: operationsId, plan: { id: stormId, section: "Concept of operations" } });
    expect(owned.statusCode, owned.body).toBe(201);
    const ownedId = owned.json().id as string;
    const unowned = await call(adminToken, "POST", actions,
      { capability: "public_information_and_warning", recommendation: "Add the tsunami sirens to the annex", dueDate: tomorrow, plan: { id: annexId } });
    expect(unowned.statusCode, unowned.body).toBe(201);
    const unownedId = unowned.json().id as string;

    const noSection = await call(adminToken, "POST", actions, { ...staging, plan: { id: stormId, section: "Recovery" } });
    expect(noSection.statusCode).toBe(400);
    expect(noSection.json().error).toContain("the plan has no section with that title");
    const noPlan = await call(adminToken, "POST", actions, { ...staging, plan: { id: "00000000-0000-4000-8000-000000000000" } });
    expect(noPlan.statusCode).toBe(400);
    expect(noPlan.json().error).toContain("not one of this organization's plans");

    const listed = await call(memberToken, "GET", `${actions}?planId=${stormId}&includeComplete=false`);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().correctiveActions).toEqual([expect.objectContaining({
      id: ownedId, plan: { id: stormId, title: "Severe Storm Plan", section: "Concept of operations" },
    })]);
    const revision = listed.json().correctiveActions[0].revision as number;
    const unlinked = await call(adminToken, "PATCH", `/api/v1/corrective-actions/${ownedId}`, { expectedRevision: revision, plan: null });
    expect(unlinked.statusCode, unlinked.body).toBe(200);
    expect(unlinked.json().plan).toBeNull();
    const relinked = await call(adminToken, "PATCH", `/api/v1/corrective-actions/${ownedId}`,
      { expectedRevision: revision + 1, plan: { id: stormId, section: "Concept of operations" } });
    expect(relinked.json().plan).toEqual({ id: stormId, title: "Severe Storm Plan", section: "Concept of operations" });
    // Edits that leave the due date alone keep it to the day, whatever the database's time zone.
    expect(relinked.json().dueDate).toBe(tomorrow);

    // Due at the start of the due date, by the UTC calendar, and not before.
    const justBefore = new Date(utcDay(1).getTime() - 1000);
    const justAfter = new Date(utcDay(1).getTime() + 1000);
    const dueFor = async (at: Date) => (await admin`
      select 1 from scheduler_due('plans', ${at}) where jurisdiction_id = ${seed.jurisdictionId}`).length;
    expect(await dueFor(justBefore)).toBe(0);
    expect(await dueFor(justAfter)).toBe(1);
    expect(await runPlans(justBefore)).toMatchObject({ actionsDue: 0 });
    expect(await runPlans(justAfter)).toEqual({ released: 0, reminded: 0, actionsDue: 2 });
    expect(await runPlans(justAfter)).toMatchObject({ actionsDue: 0 });
    expect(await dueFor(justAfter)).toBe(0);

    // The owning position hears about its action; an action with no owner goes to the administrators.
    const memberInbox = (await call(memberToken, "GET", "/api/v1/notifications")).json().notifications;
    expect(memberInbox).toContainEqual(expect.objectContaining({
      channel: "corrective_action_due", title: "Corrective action due: Name the road crew staging area",
      body: `This corrective action was due ${tomorrow} and is not complete. It updates Severe Storm Plan, section Concept of operations. Update it under After-action.`,
    }));
    expect(memberInbox).not.toContainEqual(expect.objectContaining({ title: "Corrective action due: Add the tsunami sirens to the annex" }));
    expect((await call(adminToken, "GET", "/api/v1/notifications")).json().notifications)
      .toContainEqual(expect.objectContaining({ title: "Corrective action due: Add the tsunami sirens to the annex" }));

    // A plan's review reminder counts the open corrective actions that name it.
    expect((await call(adminToken, "POST", `/api/v1/plans/${annexId}/review`, {})).statusCode).toBe(200);
    expect(await runPlans(new Date(Date.now() + 2 * 1440 * MINUTE))).toMatchObject({ actionsDue: 0 });
    expect((await call(adminToken, "GET", "/api/v1/notifications")).json().notifications).toContainEqual(expect.objectContaining({
      channel: "plan_review", body: expect.stringContaining("1 open corrective action names this plan."),
    }));

    // A new due date reminds again; a completed action is not reminded.
    const later = utcDay(3).toISOString().slice(0, 10);
    const moved = await call(adminToken, "PATCH", `/api/v1/corrective-actions/${ownedId}`, { expectedRevision: revision + 2, dueDate: later });
    expect(moved.statusCode, moved.body).toBe(200);
    const done = (await call(adminToken, "GET", `/api/v1/corrective-actions/${unownedId}`)).json();
    expect((await call(adminToken, "PATCH", `/api/v1/corrective-actions/${unownedId}`,
      { expectedRevision: done.revision, dueDate: later, status: "complete" })).statusCode).toBe(200);
    expect(await runPlans(new Date(utcDay(3).getTime() + 1000))).toMatchObject({ actionsDue: 1 });
    expect(await admin`select due_date::text as due from corrective_action_reminders where corrective_action_id = ${ownedId} order by due_date`)
      .toEqual([{ due: tomorrow }, { due: later }]);
  });

  it("opens a continuity plan's essential functions as tasks due within their recovery times, by priority", async () => {
    const wrongPosition = structuredClone(CONTINUITY_PLAN_TEMPLATE.definition) as { continuity: { essentialFunctions: Array<{ position: string }> } };
    wrongPosition.continuity.essentialFunctions[0]!.position = "safety_officer";
    const refused = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/plans`,
      { title: "Continuity", definition: wrongPosition, expectedVersion: 0 });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toContain("continuity.essentialFunctions.0.position: position safety_officer is not one the Continuity of Operations template opens");
    const bare = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/plans`,
      { title: "No functions", definition: { kind: "continuity", templateKey: "continuity_of_operations" }, expectedVersion: 0 });
    expect(bare.statusCode).toBe(400);

    const created = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/plans`,
      { title: CONTINUITY_PLAN_TEMPLATE.title, definition: CONTINUITY_PLAN_TEMPLATE.definition, expectedVersion: 0 });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ kind: "continuity", templateKey: "continuity_of_operations", reviewEveryDays: 365 });
    const planId = created.json().id as string;
    expect((await call(adminToken, "POST", `/api/v1/plans/${planId}/activate`,
      { name: "Offices flooded", eventAt: new Date().toISOString() })).statusCode).toBe(400);

    const before = Date.now();
    const res = await call(adminToken, "POST", `/api/v1/plans/${planId}/activate`, { name: "Offices flooded" });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ tasksReleased: 8, tasksScheduled: 0 });
    const incidentId = res.json().incidentId as string;
    const tasks = await admin`
      select c.item, c.category, c.due_at, p.key from checklist_items c join positions p on p.id = c.position_id
      where c.incident_id = ${incidentId} and c.category = 'continuity' order by c.sort_order`;
    const functions = [...CONTINUITY_PLAN_TEMPLATE.definition.continuity!.essentialFunctions].sort((a, b) => a.priority - b.priority);
    expect(tasks.map((task) => [task.item, task.key])).toEqual(functions.map((fn) => [`Restore essential function: ${fn.name}`, fn.position]));
    for (const [index, fn] of functions.entries()) {
      const due = new Date(tasks[index]!.due_at as string).getTime();
      expect(due).toBeGreaterThanOrEqual(before + fn.recoveryHours * 3_600_000 - 60_000);
      expect(due).toBeLessThanOrEqual(Date.now() + fn.recoveryHours * 3_600_000);
    }
    // The template's own checklists come with it.
    expect(await admin`select 1 from checklist_items where incident_id = ${incidentId} and item = 'Choose and open the recovery location'`).toHaveLength(1);
    const plan = await call(memberToken, "GET", `/api/v1/incidents/${incidentId}/plan`);
    expect(plan.json().plan.continuity).toMatchObject({
      essentialFunctions: expect.arrayContaining([expect.objectContaining({ name: "Drinking water and wastewater", recoveryHours: 24 })]),
      succession: expect.arrayContaining([expect.objectContaining({ role: "Emergency manager" })]),
    });
  });
});
