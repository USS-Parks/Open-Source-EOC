import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql, runtime: Sql, app: FastifyInstance;
let jurisdictionId: string, adminId: string, token: string, incidentId: string, otherIncidentId: string;
let taskId: string, participantTaskId: string, resourceId: string, iapId: string, iapRevision: number;
let boardId: string, boardRecordId: string, partnerId: string, activeParticipantId: string;
let contributorToken: string, expiredToken: string, outsiderToken: string;
const auth = (authToken = token) => ({ authorization: `Bearer ${authToken}` });
const source = { domain: "lifeline", framework: "fema_community_lifelines", definitionKey: "transportation" };

async function api(method: "GET" | "POST", url: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, headers: auth(), ...(payload ? { payload } : {}) });
}

async function apiAs(authToken: string, method: "GET" | "POST", url: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, headers: auth(authToken), ...(payload ? { payload } : {}) });
}

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin); jurisdictionId = seed.jurisdictionId; adminId = seed.adminId;
  partnerId = await createJurisdiction(admin, "relationship-partner", "Relationship Partner");
  const contributorId = await createPerson(admin, { email: "relationship-contributor@example.org", displayName: "Relationship Contributor", password: "relationship-contributor-password" });
  const expiredId = await createPerson(admin, { email: "relationship-expired@example.org", displayName: "Expired Contributor", password: "relationship-expired-password" });
  const outsiderId = await createPerson(admin, { email: "relationship-outsider@example.org", displayName: "Relationship Outsider", password: "relationship-outsider-password" });
  await addMembership(admin, contributorId, partnerId, "member");
  await addMembership(admin, expiredId, partnerId, "member");
  await addMembership(admin, outsiderId, partnerId, "member");
  await ensureStandardTemplates(admin); await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null }); await app.ready();
  token = await login("admin@example.org", "correct-horse-battery");
  contributorToken = await login("relationship-contributor@example.org", "relationship-contributor-password");
  expiredToken = await login("relationship-expired@example.org", "relationship-expired-password");
  outsiderToken = await login("relationship-outsider@example.org", "relationship-outsider-password");
  const activate = async (name: string) => (await api("POST", `/api/v1/jurisdictions/${jurisdictionId}/incidents`, { templateKey: "wildfire", name })).json().incidentId as string;
  incidentId = await activate("Relationship incident"); otherIncidentId = await activate("Foreign relationship incident");
  const detail = (await api("GET", `/api/v1/incidents/${incidentId}`)).json();
  const commander = detail.positions.find((item: { key: string }) => item.key === "incident_commander").id;
  await api("POST", `/api/v1/positions/${commander}/assignments`, { personId: adminId });
  const assessment = await api("POST", `/api/v1/incidents/${incidentId}/lifeline-assessments`, { lifeline: "transportation", condition: "unstable", assessedAt: new Date().toISOString(), confidence: "confirmed", impactStatement: "Route disruption", components: [], evidence: [], responsibleOrganizationIds: [], actions: [] });
  expect(assessment.statusCode).toBe(201);
  const [task] = await admin`insert into checklist_items (incident_id, item, category, status, sort_order) values (${incidentId}, 'Clear route', 'transportation', 'open', 1) returning id`;
  taskId = task!.id as string;
  const [participantTask] = await admin`insert into checklist_items (incident_id, item, category, status, sort_order) values (${incidentId}, 'Inspect bridge', 'transportation', 'open', 2) returning id`;
  participantTaskId = participantTask!.id as string;
  const [resource] = await admin`insert into resource_requests (jurisdiction_id, incident_id, origin, item, requested_by) values (${jurisdictionId}, ${incidentId}, 'eoc', 'Loader', ${adminId}) returning id`;
  resourceId = resource!.id as string;
  const createdIap = await api("POST", `/api/v1/incidents/${incidentId}/iap`, { operationalPeriod: "OP 1", objectives: ["Restore the route"] });
  expect(createdIap.statusCode).toBe(201); iapId = createdIap.json().id;
  iapRevision = (await api("GET", `/api/v1/iap/${iapId}`)).json().contentRevision;
  const [board] = await admin`select b.id from boards b join incident_boards ib on ib.board_id = b.id
    where ib.incident_id = ${incidentId} and b.template_key = 'shelters'`;
  boardId = board!.id as string;
  const [record] = await admin`insert into board_records (board_id, incident_id, data, created_by)
    values (${boardId}, ${incidentId}, ${admin.json({ name: "North shelter", status: "normal", capacity: 80, occupancy: 12 })}, ${adminId}) returning id`;
  boardRecordId = record!.id as string;

  const grant = async (email: string) => api("POST", `/api/v1/incidents/${incidentId}/participants`, {
    organizationSlug: "relationship-partner", personEmail: email,
    incidentPositionTitle: "Mutual Aid Coordinator", role: "coordinator",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), reason: "Operational relationship authority proof",
  });
  const activeGrant = await grant("relationship-contributor@example.org");
  const expiredGrant = await grant("relationship-expired@example.org");
  expect(activeGrant.statusCode, activeGrant.body).toBe(201);
  expect(expiredGrant.statusCode, expiredGrant.body).toBe(201);
  activeParticipantId = activeGrant.json().participant.id as string;
  await admin`alter table incident_participants disable trigger participant_immutable`;
  try {
    await admin`update incident_participants set expires_at = now() - interval '1 minute'
      where id = ${expiredGrant.json().participant.id as string}`;
  } finally {
    await admin`alter table incident_participants enable trigger participant_immutable`;
  }
});


afterAll(async () => { await app?.close(); await runtime?.end(); await admin?.end(); });

describe("operational relationships", () => {
  it("records attributed same-incident task and resource links while rejecting a foreign target", async () => {
    const task = await api("POST", `/api/v1/incidents/${incidentId}/operational-relationships`, { source, target: { kind: "task", taskId } });
    expect(task.statusCode, task.body).toBe(201);
    expect(task.json()).toMatchObject({ source, target: { kind: "task", taskId }, targetState: "available", attribution: { personId: adminId } });
    const resource = await api("POST", `/api/v1/incidents/${incidentId}/operational-relationships`, { source, target: { kind: "resource_request", resourceRequestId: resourceId } });
    expect(resource.statusCode, resource.body).toBe(201);
    const [foreign] = await admin`insert into checklist_items (incident_id, item, category, status, sort_order) values (${otherIncidentId}, 'Foreign task', 'transportation', 'open', 1) returning id`;
    const rejected = await api("POST", `/api/v1/incidents/${incidentId}/operational-relationships`, { source, target: { kind: "task", taskId: foreign!.id as string } });
    expect(rejected.statusCode).toBe(400);
  });
  it("pins an IAP objective to its content revision and reports it stale after revision changes", async () => {
    const linked = await api("POST", `/api/v1/incidents/${incidentId}/operational-relationships`, { source, target: { kind: "iap_objective", iapId, contentRevision: iapRevision, objectiveIndex: 0 } });
    expect(linked.statusCode, linked.body).toBe(201);
    expect(linked.json().target).toMatchObject({ contentRevision: iapRevision, objectiveLabel: "Restore the route", operationalPeriod: "OP 1" });
    const [stored] = await admin`select content from iaps where id = ${iapId}`;
    const changed = structuredClone(stored!.content) as { forms: Array<{ id: string; sections: Array<{ heading: string; lines?: string[] }> }> };
    const objectives = changed.forms.find((form) => form.id === "ICS-202")!.sections.find((section) => section.heading === "Objectives")!;
    objectives.lines![0] = "Changed objective";
    await admin`update iaps set content = ${admin.json(changed)}, content_revision = content_revision + 1 where id = ${iapId}`;
    const listed = await api("GET", `/api/v1/incidents/${incidentId}/operational-relationships`);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().relationships).toContainEqual(expect.objectContaining({
      target: expect.objectContaining({ kind: "iap_objective", iapId, contentRevision: iapRevision, objectiveLabel: "Restore the route", operationalPeriod: "OP 1" }),
      targetState: "stale",
    }));
  });
  it("projects an exact readable board record identity for navigation", async () => {
    const linked = await api("POST", `/api/v1/incidents/${incidentId}/operational-relationships`, { source, target: { kind: "board_record", boardRecordId } });
    expect(linked.statusCode, linked.body).toBe(201);
    expect(linked.json().target).toMatchObject({ kind: "board_record", boardRecordId, boardId, label: "North shelter" });
  });
  it("attributes an external contributor and denies unrelated, expired, and freshly revoked sessions", async () => {
    const contributed = await apiAs(contributorToken, "POST", `/api/v1/incidents/${incidentId}/operational-relationships`, { source, target: { kind: "task", taskId: participantTaskId } });
    expect(contributed.statusCode, contributed.body).toBe(201);
    expect(contributed.json().attribution).toMatchObject({ organizationId: partnerId, participationId: activeParticipantId });
    const participantList = await apiAs(contributorToken, "GET", `/api/v1/incidents/${incidentId}/operational-relationships`);
    expect(participantList.statusCode, participantList.body).toBe(200);
    expect(participantList.json().relationships).not.toContainEqual(expect.objectContaining({ target: expect.objectContaining({ kind: "iap_objective", iapId }) }));
    expect((await apiAs(outsiderToken, "GET", `/api/v1/incidents/${incidentId}/operational-relationships`)).statusCode).toBe(404);
    expect((await apiAs(expiredToken, "GET", `/api/v1/incidents/${incidentId}/operational-relationships`)).statusCode).toBe(404);
    expect((await apiAs(outsiderToken, "POST", `/api/v1/incidents/${incidentId}/operational-relationships`, { source, target: { kind: "task", taskId } })).statusCode).toBe(404);
    expect((await apiAs(expiredToken, "POST", `/api/v1/incidents/${incidentId}/operational-relationships`, { source, target: { kind: "task", taskId } })).statusCode).toBe(404);
    const revoked = await api("POST", `/api/v1/incidents/${incidentId}/participants/${activeParticipantId}/revoke`, { reason: "Relationship shift ended" });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect((await apiAs(contributorToken, "GET", `/api/v1/incidents/${incidentId}/operational-relationships`)).statusCode).toBe(404);
    expect((await apiAs(contributorToken, "POST", `/api/v1/incidents/${incidentId}/operational-relationships`, { source, target: { kind: "task", taskId } })).statusCode).toBe(404);
  });
  it("rejects a new link after incident closure", async () => {
    expect((await api("POST", `/api/v1/incidents/${incidentId}/close`)).statusCode).toBe(200);
    const closed = await api("POST", `/api/v1/incidents/${incidentId}/operational-relationships`, { source, target: { kind: "task", taskId } });
    expect(closed.statusCode).toBe(409);
  });
});
