import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, type Sql } from "./helpers.js";
import { withPerson } from "../db/context.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let hostId: string;
let partnerId: string;
let adminId: string;
let memberId: string;
let partnerPersonId: string;
let adminToken: string;
let memberToken: string;
let partnerToken: string;
let expiredToken: string;
let outsiderToken: string;
let incidentA: string;
let incidentB: string;
let adminDraft: string;
let partnerDraft: string;
let memberPositionDraft: string;
let partnerGrantId: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function api(
  token: string,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    headers: auth(token),
    ...(payload === undefined ? {} : { payload }),
  });
}

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}

async function activate(name: string): Promise<string> {
  const response = await api(adminToken, "POST", `/api/v1/jurisdictions/${hostId}/incidents`, {
    templateKey: "wildfire",
    name,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().incidentId as string;
}

async function createPlan(
  token: string,
  incidentId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const response = await api(token, "POST", `/api/v1/incidents/${incidentId}/iap`, payload);
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  hostId = await createJurisdiction(admin, "iap-host", "IAP Host EOC");
  partnerId = await createJurisdiction(admin, "iap-partner", "Mutual Aid Partner");
  const outsiderOrg = await createJurisdiction(admin, "iap-outsider", "Unrelated Agency");
  adminId = await createPerson(admin, {
    email: "iap-admin@example.org", displayName: "IAP Admin", password: "iap-admin-password",
  });
  memberId = await createPerson(admin, {
    email: "iap-member@example.org", displayName: "IAP Member", password: "iap-member-password",
  });
  partnerPersonId = await createPerson(admin, {
    email: "iap-partner@example.org", displayName: "Partner Planner", password: "iap-partner-password",
  });
  const expiredPersonId = await createPerson(admin, {
    email: "iap-expired@example.org", displayName: "Expired Planner", password: "iap-expired-password",
  });
  const outsiderPersonId = await createPerson(admin, {
    email: "iap-outsider@example.org", displayName: "Unrelated Planner", password: "iap-outsider-password",
  });
  await addMembership(admin, adminId, hostId, "admin");
  await addMembership(admin, memberId, hostId, "member");
  await addMembership(admin, partnerPersonId, partnerId, "viewer");
  await addMembership(admin, expiredPersonId, partnerId, "viewer");
  await addMembership(admin, outsiderPersonId, outsiderOrg, "viewer");
  await ensureStandardTemplates(admin);
  const [activityTemplate] = await admin`
    select definition from board_templates where key = 'activity_log' order by version desc limit 1`;
  const activityDefinition = activityTemplate!.definition as {
    fields: Array<{ key: string; read?: string }>;
  };
  const entryField = activityDefinition.fields.find((field) => field.key === "entry")!;
  entryField.read = "admin";
  await admin`update board_templates set definition = ${admin.json(activityDefinition as never)}
    where key = 'activity_log'`;
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = await login("iap-admin@example.org", "iap-admin-password");
  memberToken = await login("iap-member@example.org", "iap-member-password");
  partnerToken = await login("iap-partner@example.org", "iap-partner-password");
  expiredToken = await login("iap-expired@example.org", "iap-expired-password");
  outsiderToken = await login("iap-outsider@example.org", "iap-outsider-password");
  incidentA = await activate("IAP Alpha Incident");
  incidentB = await activate("IAP Bravo Incident");
  const detail = (await api(adminToken, "GET", `/api/v1/incidents/${incidentA}`)).json();
  const activityBoard = detail.boards.find((board: { title: string }) =>
    board.title.endsWith("Activity Log")).id as string;
  expect((await api(adminToken, "POST", `/api/v1/boards/${activityBoard}/records`, {
    entry: "Command-only IAP objective",
  })).statusCode).toBe(201);

  const starts = new Date("2026-09-21T06:00:00Z");
  const ends = new Date("2026-09-21T18:00:00Z");
  await admin`
    insert into incident_area_revisions
      (incident_id, revision, period_label, period_starts_at, period_ends_at, reason, created_by)
    values (${incidentA}, 1, 'OP 1', ${starts}, ${ends}, 'initial period', ${adminId})`;
  await admin`
    insert into incident_area_revisions
      (incident_id, revision, period_label, period_starts_at, period_ends_at, reason, created_by)
    values (${incidentA}, 2, 'OP 1', ${starts}, ${ends}, 'same period revised area', ${adminId})`;
  await admin`
    insert into incident_area_revisions
      (incident_id, revision, period_label, period_starts_at, period_ends_at, reason, created_by)
    values (${incidentB}, 1, 'OP B', ${starts}, ${ends}, 'other incident period', ${adminId})`;

  const grant = await api(adminToken, "POST", `/api/v1/incidents/${incidentA}/participants`, {
    organizationSlug: "iap-partner",
    personEmail: "iap-partner@example.org",
    incidentPositionTitle: "Mutual Aid Planning Lead",
    role: "coordinator",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    reason: "84-E IAP preparation",
  });
  expect(grant.statusCode).toBe(201);
  partnerGrantId = grant.json().participant.id as string;
  const expiring = await api(adminToken, "POST", `/api/v1/incidents/${incidentA}/participants`, {
    organizationSlug: "iap-partner",
    personEmail: "iap-expired@example.org",
    incidentPositionTitle: "Temporary Planner",
    role: "coordinator",
    expiresAt: new Date(Date.now() + 1_000).toISOString(),
    reason: "84-E expiry evidence",
  });
  expect(expiring.statusCode).toBe(201);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("IAP workspace period, progress, and attribution", () => {
  it("binds deterministic incident periods and reports exact required-form progress", async () => {
    adminDraft = await createPlan(adminToken, incidentA, {
      operationalPeriod: "OP 1",
      periodRevision: 2,
      formIds: ["ICS-202", "ICS-202", "not-a-form"],
    });
    const response = await api(adminToken, "GET", `/api/v1/incidents/${incidentA}/iaps`);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const plan = body.iaps.find((item: { id: string }) => item.id === adminDraft);
    expect(plan.status).toBe("in_progress");
    expect(plan.progress).toMatchObject({ completed: 1, required: 7, percent: 14 });
    expect(plan.progress.completedFormIds).toEqual(["ICS-202"]);
    expect(plan.period).toMatchObject({ revision: 2, label: "OP 1" });
    expect(plan.preparedAttribution).toMatchObject({
      organizationId: hostId,
      roleKey: "membership:admin",
    });
    expect(body.summary).toMatchObject({ total: 1, completedForms: 1, requiredForms: 7 });
  });

  it("prevents the runtime writer from rewriting an IAP identity or period", async () => {
    await expect(withPerson(runtime, adminId, (tx) =>
      tx`update iaps set id = ${randomUUID()} where id = ${adminDraft}`,
    )).rejects.toThrow(/preparation attribution is immutable/);
    await expect(withPerson(runtime, adminId, (tx) =>
      tx`update iaps set period_revision = 1 where id = ${adminDraft}`,
    )).rejects.toThrow(/period binding is immutable/);
    await expect(withPerson(runtime, adminId, (tx) =>
      tx`update iaps set period_revision = null where id = ${adminDraft}`,
    )).rejects.toThrow(/period binding is immutable/);
    await expect(withPerson(runtime, adminId, (tx) =>
      tx`update iaps set operational_period = 'Changed period' where id = ${adminDraft}`,
    )).rejects.toThrow(/period binding is immutable/);
  });

  it("supports explicit not-started plans and rejects cross-incident or ambiguous period binding", async () => {
    const empty = await createPlan(adminToken, incidentA, {
      operationalPeriod: "Legacy unmatched period",
      formIds: [],
    });
    const list = (await api(adminToken, "GET", `/api/v1/incidents/${incidentA}/iaps`)).json();
    const emptyPlan = list.iaps.find((item: { id: string }) => item.id === empty);
    expect(emptyPlan.status).toBe("not_started");
    expect(emptyPlan.period).toBeNull();
    const crossIncident = await api(adminToken, "POST", `/api/v1/incidents/${incidentA}/iap`, {
      operationalPeriod: "OP B", periodRevision: 1,
    });
    expect(crossIncident.statusCode).toBe(400);

    await admin`
      insert into incident_area_revisions
        (incident_id, revision, period_label, period_starts_at, period_ends_at, reason, created_by)
      values (${incidentA}, 3, 'OP 1', '2026-09-21T18:00:00Z', '2026-09-22T06:00:00Z',
        'ambiguous repeated label', ${adminId})`;
    const ambiguous = await api(adminToken, "POST", `/api/v1/incidents/${incidentA}/iap`, {
      operationalPeriod: "OP 1",
    });
    expect(ambiguous.statusCode).toBe(400);
  });

  it("filters by stored organization, role, period, and working/published state", async () => {
    partnerDraft = await createPlan(partnerToken, incidentA, {
      operationalPeriod: "OP 1", periodRevision: 2, formIds: ["ICS-202", "ICS-203", "ICS-214"],
    });
    const all = (await api(adminToken, "GET", `/api/v1/incidents/${incidentA}/iaps`)).json();
    const partnerPlan = all.iaps.find((item: { id: string }) => item.id === partnerDraft);
    expect(partnerPlan.preparedAttribution).toMatchObject({
      organizationId: partnerId,
      roleKey: "incident:mutual-aid-planning-lead",
    });
    const organization = (await api(adminToken, "GET",
      `/api/v1/incidents/${incidentA}/iaps?organizationId=${partnerId}`)).json();
    expect(organization.iaps.map((item: { id: string }) => item.id)).toEqual([partnerDraft]);
    const role = (await api(adminToken, "GET",
      `/api/v1/incidents/${incidentA}/iaps?role=incident%3Amutual-aid-planning-lead`)).json();
    expect(role.iaps.map((item: { id: string }) => item.id)).toEqual([partnerDraft]);
    const period = (await api(adminToken, "GET",
      `/api/v1/incidents/${incidentA}/iaps?periodRevision=2`)).json();
    expect(period.iaps.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([adminDraft, partnerDraft]),
    );
    expect((await api(adminToken, "GET",
      `/api/v1/incidents/${incidentA}/iaps?view=published`)).json().iaps).toEqual([]);
  });

  it("applies the established board field mask before one-off and stored partner forms", async () => {
    const adminForm = (await api(adminToken, "GET",
      `/api/v1/incidents/${incidentA}/ics-forms/ICS-214?period=OP%201`)).json();
    expect(adminForm.sections[0].rows.map((row: string[]) => row[1])).toContain(
      "Command-only IAP objective",
    );
    const partnerForm = (await api(partnerToken, "GET",
      `/api/v1/incidents/${incidentA}/ics-forms/ICS-214?period=OP%201`)).json();
    expect(partnerForm.sections[0].rows.map((row: string[]) => row[1])).not.toContain(
      "Command-only IAP objective",
    );
    const ownList = (await api(partnerToken, "GET", `/api/v1/incidents/${incidentA}/iaps`)).json();
    expect(ownList.iaps.length).toBeGreaterThan(0);
    expect(ownList.iaps.every((item: { preparedBy: string }) =>
      item.preparedBy === "Partner Planner")).toBe(true);
    const ownFetch = await api(partnerToken, "GET", `/api/v1/iap/${partnerDraft}`);
    expect(ownFetch.statusCode).toBe(200);
    expect((await api(partnerToken, "GET", `/api/v1/iap/${partnerDraft}/pdf`)).statusCode).toBe(200);
    const stored = ownFetch.json();
    const stored214 = stored.content.forms.find((form: { id: string }) => form.id === "ICS-214");
    expect(stored214.sections[0].rows.map((row: string[]) => row[1])).not.toContain(
      "Command-only IAP objective",
    );

    const adminRestricted = await createPlan(adminToken, incidentA, {
      operationalPeriod: "Admin restricted snapshot", formIds: ["ICS-214"],
    });
    expect((await api(partnerToken, "GET", `/api/v1/iap/${adminRestricted}`)).statusCode).toBe(404);
    expect((await api(partnerToken, "GET", `/api/v1/iap/${adminRestricted}/pdf`)).statusCode).toBe(404);
  });

});

describe("authorized IAP handoffs and incident isolation", () => {
  it("limits an external participant to its own draft while preserving owner-writer handoff", async () => {
    expect([403, 404]).toContain((await api(partnerToken, "POST",
      `/api/v1/iap/${adminDraft}/submit`)).statusCode);
    const partnerOwn = await createPlan(partnerToken, incidentA, {
      operationalPeriod: "Partner handoff", formIds: ["ICS-202"],
    });
    expect((await api(partnerToken, "POST", `/api/v1/iap/${partnerOwn}/submit`)).statusCode).toBe(200);
    expect((await api(memberToken, "POST", `/api/v1/iap/${partnerDraft}/submit`)).statusCode).toBe(200);
    expect((await api(adminToken, "POST", `/api/v1/iap/${partnerDraft}/approve`)).statusCode).toBe(200);
    const published = (await api(adminToken, "GET",
      `/api/v1/incidents/${incidentA}/iaps?view=published`)).json();
    const plan = published.iaps.find((item: { id: string }) => item.id === partnerDraft);
    expect(plan).toMatchObject({ status: "approved", preparedBy: "Partner Planner", submittedBy: "IAP Member" });
    expect(plan.approvedBy).toBe("IAP Admin");
  });

  it("serializes competing submissions and keeps two incidents isolated", async () => {
    const draft = await createPlan(memberToken, incidentA, {
      operationalPeriod: "Race period", formIds: ["ICS-202"],
    });
    const results = await Promise.all([
      api(memberToken, "POST", `/api/v1/iap/${draft}/submit`),
      api(memberToken, "POST", `/api/v1/iap/${draft}/submit`),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const otherPlan = await createPlan(adminToken, incidentB, {
      operationalPeriod: "OP B", periodRevision: 1, formIds: ["ICS-202"],
    });
    const [alpha, bravo] = await Promise.all([
      api(adminToken, "GET", `/api/v1/incidents/${incidentA}/iaps`),
      api(adminToken, "GET", `/api/v1/incidents/${incidentB}/iaps`),
    ]);
    expect(alpha.json().iaps.some((item: { id: string }) => item.id === otherPlan)).toBe(false);
    expect(bravo.json().iaps.map((item: { id: string }) => item.id)).toEqual([otherPlan]);
  });

  it("fails closed for outsiders, expired participation, and a revoked active position", async () => {
    expect([403, 404]).toContain((await api(outsiderToken, "GET",
      `/api/v1/incidents/${incidentA}/iaps`)).statusCode);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect([403, 404]).toContain((await api(expiredToken, "POST",
      `/api/v1/incidents/${incidentA}/iap`, { operationalPeriod: "Expired", formIds: [] })).statusCode);

    const detail = (await api(adminToken, "GET", `/api/v1/incidents/${incidentA}`)).json();
    const positionId = detail.positions.find((position: { key: string }) =>
      position.key === "planning_section_chief").id as string;
    expect((await api(adminToken, "POST", `/api/v1/positions/${positionId}/assignments`, {
      personId: memberId,
    })).statusCode).toBe(201);
    expect((await api(memberToken, "POST", `/api/v1/positions/${positionId}/sign-in`)).statusCode).toBe(200);
    memberPositionDraft = await createPlan(memberToken, incidentA, {
      operationalPeriod: "Position handoff", formIds: ["ICS-202"],
    });
    await admin`update position_assignments set revoked_at = now()
      where position_id = ${positionId} and person_id = ${memberId} and revoked_at is null`;
    expect((await api(memberToken, "POST", `/api/v1/iap/${memberPositionDraft}/submit`)).statusCode).toBe(403);

    expect((await api(adminToken, "POST",
      `/api/v1/incidents/${incidentA}/participants/${partnerGrantId}/revoke`, {
        reason: "IAP mutual-aid assignment ended",
      })).statusCode).toBe(200);
    expect((await api(partnerToken, "GET", `/api/v1/iap/${partnerDraft}`)).statusCode).toBe(404);
    expect((await api(partnerToken, "GET", `/api/v1/iap/${partnerDraft}/pdf`)).statusCode).toBe(404);
  });
});
