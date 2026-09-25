import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, tokenFor, type Sql } from "./helpers.js";

/**
 * The IAP assembled from the period's ICS form components (Veoci and air gap
 * VA37, part two). The planning section chooses ready forms; the plan holds
 * each at the version it took and is approved as a whole. A draft plan takes
 * a form's newer ready version in place; after approval, a form marked ready
 * again makes the plan's next revision, and the approved revision stays.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let memberId: string;
let adminToken: string;
let memberToken: string;
let partnerToken: string;
let incidentId: string;
const forms = new Map<string, string>();
let planId: string;
let revisionTwo: string;

type Method = "GET" | "POST" | "PUT";
const call = (token: string, method: Method, url: string, payload?: unknown) =>
  app.inject({ method, url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as object }) });

/** Start a form for a period and save it once, ready unless told otherwise; its id is kept by name. */
async function form(token: string, formId: string, values: Record<string, unknown>, options: { label?: string; period?: number; status?: string } = {}) {
  const started = await call(token, "POST", `/api/v1/incidents/${incidentId}/ics-components`, {
    formId, periodRevision: options.period ?? 1, ...(options.label ? { label: options.label } : {}),
  });
  expect(started.statusCode, started.body).toBe(201);
  const id = started.json().id as string;
  const saved = await call(token, "PUT", `/api/v1/ics-components/${id}`, { values, status: options.status ?? "ready", expectedVersion: 1 });
  expect(saved.statusCode, saved.body).toBe(200);
  forms.set(`${formId}${options.label ? ` ${options.label}` : ""}${options.period && options.period !== 1 ? ` p${options.period}` : ""}`, id);
  return id;
}

async function save(token: string, key: string, values: Record<string, unknown>, status = "ready") {
  const id = forms.get(key)!;
  const current = (await call(token, "GET", `/api/v1/ics-components/${id}`)).json();
  const res = await call(token, "PUT", `/api/v1/ics-components/${id}`, { values, status, expectedVersion: current.version });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { version: number; plans: { id: string; revisionNumber: number; contentRevision: number; changed: unknown[] }[] };
}

async function assemble(token: string, keys: readonly string[], period = 1) {
  return call(token, "POST", `/api/v1/incidents/${incidentId}/iap`, {
    operationalPeriod: period === 1 ? "OP 1" : "OP 2", periodRevision: period, componentIds: keys.map((key) => forms.get(key) ?? key),
  });
}

const plan = async (id: string) => (await call(memberToken, "GET", `/api/v1/iap/${id}`)).json();
const pdfText = (body: Buffer): string => [...body.toString("latin1").matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]).join("\n");

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const hostId = await createJurisdiction(admin, "plan-host", "Plan Host EOC");
  const partnerOrg = await createJurisdiction(admin, "plan-partner", "Plan Mutual Aid Partner");
  const adminId = await createPerson(admin, { email: "plan-admin@example.org", displayName: "Forms Admin", password: "plan-admin-password" });
  memberId = await createPerson(admin, { email: "plan-member@example.org", displayName: "Rosa Planner", password: "plan-member-password" });
  const partnerId = await createPerson(admin, { email: "plan-partner@example.org", displayName: "Pat Partner", password: "plan-partner-password" });
  await addMembership(admin, adminId, hostId, "admin");
  await addMembership(admin, memberId, hostId, "member");
  await addMembership(admin, partnerId, partnerOrg, "viewer");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = await tokenFor(app, "plan-admin@example.org", "plan-admin-password");
  memberToken = await tokenFor(app, "plan-member@example.org", "plan-member-password");
  partnerToken = await tokenFor(app, "plan-partner@example.org", "plan-partner-password");
  const activated = await call(adminToken, "POST", `/api/v1/jurisdictions/${hostId}/incidents`, { templateKey: "wildfire", name: "Klamath River Flood" });
  incidentId = activated.json().incidentId as string;
  for (const [revision, label, starts] of [[1, "OP 1", "2026-09-25T06:00:00Z"], [2, "OP 2", "2026-09-25T18:00:00Z"]] as const) {
    await admin`
      insert into incident_area_revisions (incident_id, revision, period_label, period_starts_at, period_ends_at, reason, created_by)
      values (${incidentId}, ${revision}, ${label}, ${starts}, ${new Date(new Date(starts).getTime() + 12 * 3_600_000)}, 'plan test period', ${adminId})`;
  }
  const grant = await call(adminToken, "POST", `/api/v1/incidents/${incidentId}/participants`, {
    organizationSlug: "plan-partner", personEmail: "plan-partner@example.org", incidentPositionTitle: "Mutual Aid Planning Lead",
    role: "contributor", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), reason: "VA37 part two partner planning",
  });
  expect(grant.statusCode, grant.body).toBe(201);
  await form(memberToken, "ICS-202", { objectives: "Keep Highway 96 open\nShelter evacuees at the school gym" });
  await form(memberToken, "ICS-204", { workAssignments: "Evacuate the river bar" }, { label: "Division B" });
  await form(memberToken, "ICS-204", { workAssignments: "Close the Martins Ferry bridge" }, { label: "Division A" });
  await form(memberToken, "ICS-205", { channels: [["", "", "", "TAC-2", "Division A", "155.1450 N", "", "", "", "", ""]] });
  await form(memberToken, "ICS-208", { message: "Stay off the levee crown." });
  await form(memberToken, "ICS-206", { procedures: "Call the ambulance on TAC-3." }, { status: "draft" });
  await form(memberToken, "ICS-202", { objectives: "Night shift objectives" }, { period: 2 });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("the IAP assembled from the period's ICS forms", () => {
  it("assembles a draft plan from the chosen ready forms, in form order, and refuses what it cannot hold", async () => {
    const res = await assemble(memberToken, ["ICS-208", "ICS-205", "ICS-202", "ICS-204 Division B", "ICS-204 Division A"]);
    expect(res.statusCode, res.body).toBe(201);
    planId = res.json().id as string;
    const content = res.json().content;
    expect(content.forms.map((f: { id: string; title: string }) => `${f.id} ${f.title}`)).toEqual([
      "ICS-202 Incident Objectives", "ICS-204 Assignment List: Division A", "ICS-204 Assignment List: Division B",
      "ICS-205 Incident Radio Communications Plan", "ICS-208 Safety Message/Plan",
    ]);
    expect(content.forms[0].preparedBy).toBe("Rosa Planner, Jurisdiction Member");
    expect(content.components.map((c: { version: number }) => c.version)).toEqual([2, 2, 2, 2, 2]);
    const detail = await plan(planId);
    expect(detail).toMatchObject({ status: "draft", contentRevision: 1 });
    expect(detail.components.map((c: { formId: string; label: string; version: number; currentVersion: number }) =>
      [c.formId, c.label, c.version, c.currentVersion])).toEqual([
      ["ICS-202", "", 2, 2], ["ICS-204", "Division A", 2, 2], ["ICS-204", "Division B", 2, 2],
      ["ICS-205", "", 2, 2], ["ICS-208", "", 2, 2],
    ]);
    const workspace = (await call(memberToken, "GET", `/api/v1/incidents/${incidentId}/iaps`)).json();
    expect(workspace.iaps[0].progress.completedFormIds).toEqual(["ICS-202", "ICS-204", "ICS-205", "ICS-208"]);

    const refused = async (keys: readonly string[], status: number, message: string, period = 1) => {
      const r = await assemble(memberToken, keys, period);
      expect(r.statusCode, r.body).toBe(status);
      expect(r.json().error).toBe(message);
    };
    await refused(["ICS-202", "ICS-206"], 400, "componentIds: ICS 206: Medical Plan is a draft; mark it ready before the plan takes it");
    await refused(["ICS-202", "ICS-202 p2"], 400, "componentIds: ICS 202: Incident Objectives belongs to another operational period");
    await refused([], 400, "componentIds: choose at least one ICS form for the plan");
    await refused(["00000000-0000-4000-8000-000000000009"], 404, "an ICS form chosen for the plan was not found");
    const noPeriod = await call(memberToken, "POST", `/api/v1/incidents/${incidentId}/iap`, {
      operationalPeriod: "OP 1", componentIds: [forms.get("ICS-202")],
    });
    expect(noPeriod.statusCode).toBe(400);
    const [assembled] = await admin`select payload from audit_events where category = 'iap.assembled' and subject_id = ${planId}`;
    expect(assembled!.payload).toMatchObject({ forms: 5, components: 5, periodRevision: 1 });
  });

  it("lets a draft plan take a form's newer ready version in place, and leaves a draft save out", async () => {
    const draftSave = await save(memberToken, "ICS-205", { channels: [["", "", "", "TAC-4", "Division B", "", "", "", "", "", ""]] }, "draft");
    expect(draftSave.plans).toEqual([]);
    let detail = await plan(planId);
    expect(detail.contentRevision).toBe(1);
    expect(detail.components[3]).toMatchObject({ formId: "ICS-205", version: 2, currentVersion: 3, currentStatus: "draft" });

    const ready = await save(memberToken, "ICS-205", { channels: [["", "", "", "TAC-4", "Division B", "155.2050 N", "", "", "", "", ""]] });
    expect(ready.plans).toEqual([{
      id: planId, revisionNumber: 1, contentRevision: 2, changed: [{ formId: "ICS-205", label: "", version: 4 }],
    }]);
    detail = await plan(planId);
    expect(detail.contentRevision).toBe(2);
    expect(detail.components[3]).toMatchObject({ version: 4, currentVersion: 4 });
    expect(detail.content.forms[3].sections[0].rows).toEqual([["", "", "", "TAC-4", "Division B", "155.2050 N", "", "", "", "", ""]]);
    const [event] = await admin`select payload from audit_events where category = 'iap.forms.refreshed' and subject_id = ${planId}`;
    expect(event!.payload).toMatchObject({ contentRevision: 2, forms: [{ formId: "ICS-205", version: 4 }] });
  });

  it("keeps the approved revision and makes the next one when a form is marked ready again", async () => {
    expect((await call(memberToken, "POST", `/api/v1/iap/${planId}/submit`)).statusCode).toBe(200);
    expect((await call(adminToken, "POST", `/api/v1/iap/${planId}/approve`)).statusCode).toBe(200);
    const approvedContent = (await plan(planId)).content;

    const changed = await save(memberToken, "ICS-208", { message: "Stay off the levee crown. Wear a PFD near moving water." });
    expect(changed.plans).toHaveLength(1);
    expect(changed.plans[0]).toMatchObject({ revisionNumber: 2, contentRevision: 1, changed: [{ formId: "ICS-208", version: 3 }] });
    revisionTwo = changed.plans[0]!.id;
    expect(revisionTwo).not.toBe(planId);
    const approved = await plan(planId);
    expect(approved.status).toBe("approved");
    expect(approved.content).toEqual(approvedContent);
    expect(approved.components[4]).toMatchObject({ version: 2, currentVersion: 3 });
    const successor = await plan(revisionTwo);
    expect(successor).toMatchObject({ status: "draft", contentRevision: 1 });
    expect(successor.components.map((c: { version: number }) => c.version)).toEqual([2, 2, 2, 4, 3]);
    expect(successor.content.forms[4].sections[0].lines).toEqual(["Stay off the levee crown. Wear a PFD near moving water."]);

    // Another change goes into that draft revision, not a third.
    const again = await save(memberToken, "ICS-208", { message: "Stay off the levee crown. Wear a PFD within 10 feet of moving water." });
    expect(again.plans).toEqual([{ id: revisionTwo, revisionNumber: 2, contentRevision: 2, changed: [{ formId: "ICS-208", label: "", version: 4 }] }]);
    const revisions = (await call(memberToken, "GET", `/api/v1/iap/${planId}/revisions`)).json().revisions;
    expect(revisions.map((r: { revisionNumber: number; status: string }) => [r.revisionNumber, r.status])).toEqual([[1, "approved"], [2, "draft"]]);
    const [created] = await admin`select payload from audit_events where category = 'iap.revision.created' and subject_id = ${revisionTwo}`;
    expect(created!.payload).toMatchObject({ revisionNumber: 2, supersedesIapId: planId, reason: "forms changed" });
  });

  it("holds a plan in approval to the forms it was submitted with; the change waits for a refresh after approval", async () => {
    expect((await call(memberToken, "POST", `/api/v1/iap/${revisionTwo}/submit`)).statusCode).toBe(200);
    const waiting = await save(memberToken, "ICS-202", { objectives: "Keep Highway 96 open\nReopen Weitchpec school" });
    expect(waiting.plans).toEqual([]);
    expect((await plan(revisionTwo)).components[0]).toMatchObject({ version: 2, currentVersion: 3, currentStatus: "ready" });
    const early = await call(memberToken, "POST", `/api/v1/iap/${revisionTwo}/forms/refresh`);
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toBe("a plan in approval or complete keeps the forms it holds; approve it, then revise");
    expect((await call(adminToken, "POST", `/api/v1/iap/${revisionTwo}/approve`)).statusCode).toBe(200);
    const refreshed = await call(memberToken, "POST", `/api/v1/iap/${revisionTwo}/forms/refresh`);
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.json()).toMatchObject({ revisionNumber: 3, contentRevision: 1, changed: [{ formId: "ICS-202", version: 3 }] });
    const unchanged = await call(memberToken, "POST", `/api/v1/iap/${refreshed.json().id}/forms/refresh`);
    expect(unchanged.json()).toMatchObject({ revisionNumber: 3, contentRevision: 1, changed: [] });
  });

  it("prints the whole plan with its contents and its approval", async () => {
    const approved = await call(memberToken, "GET", `/api/v1/iap/${planId}/pdf`);
    expect(approved.statusCode).toBe(200);
    const text = pdfText(approved.rawPayload);
    expect(text).toContain("INCIDENT ACTION PLAN");
    expect(text).toContain("Contents:");
    expect(text).toContain("  ICS 202 Incident Objectives, version 2");
    expect(text).toContain("  ICS 204 Assignment List: Division A, version 2");
    expect(text).toContain("Approval: approved by Forms Admin at");
    expect(text).toContain("Keep Highway 96 open");
    const draft = (await call(memberToken, "GET", `/api/v1/incidents/${incidentId}/iaps?view=working`)).json().iaps[0].id as string;
    expect(pdfText((await call(memberToken, "GET", `/api/v1/iap/${draft}/pdf`)).rawPayload)).toContain("Approval: not approved");
  });

  it("refuses the ICS-204 assignment editor on a plan assembled from forms", async () => {
    const assignments = [{
      name: "Group A", supervisor: { kind: "position", positionId: "00000000-0000-4000-8000-000000000204" }, tactics: ["Hold"], resources: [],
    }];
    const [draft] = await admin`select id from iaps where status = 'draft' and incident_id = ${incidentId} and period_revision = 1`;
    const editor = await call(memberToken, "PUT", `/api/v1/iap/${draft!.id as string}/ics-204`, { expectedContentRevision: 1, assignments });
    expect(editor.statusCode, editor.body).toBe(409);
    expect(editor.json().error).toBe("this plan's forms are ICS form components; change them under ICS Forms");
    const revision = await call(memberToken, "POST", `/api/v1/iap/${planId}/revisions`, { assignments });
    expect(revision.statusCode, revision.body).toBe(409);
    expect(revision.json().error).toBe("this plan's forms are ICS form components; change them under ICS Forms");
  });

  it("leaves a plan a partner may not revise for someone who can, and lets a partner revise their own", async () => {
    const period2 = await assemble(memberToken, ["ICS-202 p2"], 2);
    expect(period2.statusCode, period2.body).toBe(201);
    const hostPlan = period2.json().id as string;
    const partnerSave = await save(partnerToken, "ICS-202 p2", { objectives: "Night shift objectives\nStage the water rescue team" });
    expect(partnerSave.plans).toEqual([]);
    expect((await plan(hostPlan)).components[0]).toMatchObject({ version: 2, currentVersion: 3 });
    expect((await call(partnerToken, "POST", `/api/v1/iap/${hostPlan}/forms/refresh`)).statusCode).toBe(404);
    expect((await call(memberToken, "POST", `/api/v1/iap/${hostPlan}/forms/refresh`)).json()).toMatchObject({ contentRevision: 2 });

    // A partner's own plan: assembled under the grant and refreshed by their own save, in the owner's trail.
    const own = await assemble(partnerToken, ["ICS-202 p2"], 2);
    expect(own.statusCode, own.body).toBe(201);
    const partnerPlan = own.json().id as string;
    const followed = await save(partnerToken, "ICS-202 p2", { objectives: "Night shift objectives\nStage the water rescue team at Orleans" });
    expect(followed.plans.map((p) => p.id).sort()).toEqual([partnerPlan]);
    const trail = await admin`
      select category from audit_events where subject_id = ${partnerPlan} order by seq`;
    expect(trail.map((row) => row.category)).toEqual(["iap.assembled", "iap.forms.refreshed"]);
  });

  it("guards a plan's forms in the database", async () => {
    const asMember = <T>(fn: (tx: Sql) => Promise<T>) => withPerson(runtime, memberId, fn);
    await expect(asMember((tx) => tx`delete from iap_components where iap_id = ${planId}`)).rejects.toThrow(/permission denied/);
    await expect(asMember((tx) => tx`update iap_components set version = 3 where iap_id = ${planId} and component_id = ${forms.get("ICS-208")!}`))
      .rejects.toThrow(/submitted or published IAP are fixed/);
    await expect(admin`delete from iap_components where iap_id = ${planId}`).rejects.toThrow(/keeps the components it was assembled with/);
    const [draft] = await admin`select id from iaps where status = 'draft' and incident_id = ${incidentId} and period_revision = 1`;
    await expect(asMember((tx) => tx`insert into iap_components (iap_id, component_id, version, ordinal)
      values (${draft!.id as string}, ${forms.get("ICS-202 p2")!}, 2, 40)`)).rejects.toThrow(/only its own period's ICS forms/);
    await expect(asMember((tx) => tx`insert into iap_components (iap_id, component_id, version, ordinal)
      values (${draft!.id as string}, ${forms.get("ICS-206")!}, 9, 41)`)).rejects.toThrow(/iap_components_version_reference/);
  });
});
