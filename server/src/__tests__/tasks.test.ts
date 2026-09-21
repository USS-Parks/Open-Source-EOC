import type { FastifyInstance } from "fastify";
import type { TaskCompletionReceipt } from "@openeoc/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminId: string;
let partnerId: string;
let partnerPersonId: string;
let localMemberId: string;
let outsiderId: string;
let adminToken: string;
let partnerToken: string;
let localMemberToken: string;
let outsiderToken: string;
let incidentId: string;
let otherIncidentId: string;
let participantId: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

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
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    headers: auth(adminToken),
    payload: { templateKey: "task_engine", name },
  });
  expect(response.statusCode).toBe(201);
  return response.json().incidentId as string;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  adminId = seed.adminId;
  partnerId = await createJurisdiction(admin, "task-partner", "Task Partner");
  partnerPersonId = await createPerson(admin, {
    email: "task-partner@example.org",
    displayName: "Task Partner User",
    password: "task-partner-password",
  });
  await addMembership(admin, partnerPersonId, partnerId, "member");
  localMemberId = await createPerson(admin, {
    email: "task-member@example.org",
    displayName: "Task Member",
    password: "task-member-password",
  });
  await addMembership(admin, localMemberId, jurisdictionId, "member");
  outsiderId = await createPerson(admin, {
    email: "task-outsider@example.org",
    displayName: "Task Outsider",
    password: "task-outsider-password",
  });
  const definition = {
    key: "task_engine",
    title: "Task Engine",
    positions: ["incident_commander", "operations_section_chief"],
    boards: [],
    checklists: [{
      position: "incident_commander",
      items: [
        {
          item: "Establish command",
          category: "command",
          due: { kind: "relative", anchor: "created", minutes: 30 },
        },
        "Coordinate partner support",
        "Confirm demobilization plan",
      ],
    }],
  };
  await admin`
    insert into incident_templates (key, title, definition)
    values ('task_engine', 'Task Engine', ${admin.json(definition as never)})`;
  app = buildApp(runtime, { oidc: null });
  adminToken = await login("admin@example.org", "correct-horse-battery");
  partnerToken = await login("task-partner@example.org", "task-partner-password");
  localMemberToken = await login("task-member@example.org", "task-member-password");
  outsiderToken = await login("task-outsider@example.org", "task-outsider-password");
  incidentId = await activate("Task Incident");
  otherIncidentId = await activate("Other Task Incident");
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("incident checklist task engine", () => {
  it("activates declarative tasks, applies CAS, and reconciles local completion retries", async () => {
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/tasks`,
      headers: auth(adminToken),
    });
    expect(listed.statusCode).toBe(200);
    const initial = listed.json();
    expect(initial.tasks).toHaveLength(3);
    expect(initial.analytics.total).toBe(initial.tasks.length);
    expect(initial.analytics.byStatus.open).toBe(3);
    expect(initial.analytics.dueNext24Hours).toBe(1);
    const command = initial.tasks.find((task: { item: string }) =>
      task.item === "Establish command");
    expect(command.dueAt).toBeTruthy();
    expect(command.assignment.kind).toBe("position");

    const changed = await app.inject({
      method: "PATCH",
      url: `/api/v1/incidents/${incidentId}/tasks/${command.id}`,
      headers: auth(adminToken),
      payload: { expectedRevision: 1, status: "in_progress", category: "priority" },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ revision: 2, status: "in_progress", category: "priority" });
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/v1/incidents/${incidentId}/tasks/${command.id}`,
      headers: auth(adminToken),
      payload: { expectedRevision: 1, category: "stale" },
    });
    expect(stale.statusCode).toBe(409);

    const positions = await admin`
      select p.id, p.key from incident_positions ip join positions p on p.id = ip.position_id
      where ip.incident_id = ${incidentId}`;
    const icPosition = positions.find((row) => row.key === "incident_commander")!.id as string;
    const opsPosition = positions.find((row) => row.key === "operations_section_chief")!.id as string;
    for (const positionId of [icPosition, opsPosition]) {
      const assigned = await app.inject({
        method: "POST",
        url: `/api/v1/positions/${positionId}/assignments`,
        headers: auth(adminToken),
        payload: { personId: adminId },
      });
      expect(assigned.statusCode).toBe(201);
    }
    const signedIn = await app.inject({
      method: "POST",
      url: `/api/v1/positions/${icPosition}/sign-in`,
      headers: auth(adminToken),
    });
    expect(signedIn.statusCode).toBe(200);

    const operationId = "11111111-1111-4111-8111-111111111111";
    const completed = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/tasks/${command.id}/complete`,
      headers: auth(adminToken),
      payload: { operationId },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      operationId,
      status: "completed",
      revision: 3,
      completedBy: { personId: adminId, positionId: icPosition, organizationId: jurisdictionId },
    });

    const changedPosition = await app.inject({
      method: "POST",
      url: `/api/v1/positions/${opsPosition}/sign-in`,
      headers: auth(adminToken),
    });
    expect(changedPosition.statusCode).toBe(200);
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/tasks/${command.id}/complete`,
      headers: auth(adminToken),
      payload: { operationId },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(completed.json());
    expect(replay.json().completedBy.positionId).toBe(icPosition);
    const [counts] = await admin`
      select
        (select count(*)::int from checklist_completion_operations
          where operation_id = ${operationId}) as receipts,
        (select count(*)::int from audit_events
          where category = 'checklist.completed' and subject_id = ${command.id}) as audits`;
    expect(counts).toMatchObject({ receipts: 1, audits: 1 });

    const filtered = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/tasks?status=completed&category=priority`,
      headers: auth(adminToken),
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().tasks).toHaveLength(1);
    expect(filtered.json().analytics).toMatchObject({
      total: 1,
      byStatus: { open: 0, in_progress: 0, completed: 1 },
      byCategory: { priority: 1 },
    });
  });

  it("allows assignee status CAS, rejects metadata, and preserves retry after position revocation", async () => {
    const localIncidentId = await activate("Local Assignee Incident");
    const [position] = await admin`
      select p.id from incident_positions ip join positions p on p.id = ip.position_id
      where ip.incident_id = ${localIncidentId} and p.key = 'incident_commander'`;
    const assignedPosition = await app.inject({
      method: "POST",
      url: `/api/v1/positions/${position!.id}/assignments`,
      headers: auth(adminToken),
      payload: { personId: localMemberId },
    });
    expect(assignedPosition.statusCode).toBe(201);
    const signedIn = await app.inject({
      method: "POST",
      url: `/api/v1/positions/${position!.id}/sign-in`,
      headers: auth(localMemberToken),
    });
    expect(signedIn.statusCode).toBe(200);
    const tasks = (await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${localIncidentId}/tasks`,
      headers: auth(localMemberToken),
    })).json().tasks;
    const [first, second] = tasks;
    const started = await app.inject({
      method: "PATCH",
      url: `/api/v1/incidents/${localIncidentId}/tasks/${first.id}`,
      headers: auth(localMemberToken),
      payload: { expectedRevision: first.revision, status: "in_progress" },
    });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json()).toMatchObject({ status: "in_progress", revision: 2 });
    const metadata = await app.inject({
      method: "PATCH",
      url: `/api/v1/incidents/${localIncidentId}/tasks/${first.id}`,
      headers: auth(localMemberToken),
      payload: { expectedRevision: 2, category: "unauthorized" },
    });
    expect(metadata.statusCode).toBe(403);

    await expect(withPerson(runtime, localMemberId, (tx) => tx`
      update checklist_items set id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      where id = ${first.id}`)).rejects.toMatchObject({ code: "P0001" });
    await expect(withPerson(runtime, localMemberId, (tx) => tx`
      update checklist_items set created_at = created_at - interval '1 day'
      where id = ${first.id}`)).rejects.toMatchObject({ code: "P0001" });

    const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const completed = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${localIncidentId}/tasks/${first.id}/complete`,
      headers: auth(localMemberToken),
      payload: { operationId },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    const reassigned = await app.inject({
      method: "POST",
      url: `/api/v1/positions/${position!.id}/reassignments`,
      headers: auth(adminToken),
      payload: { personId: adminId },
    });
    expect(reassigned.statusCode).toBe(201);
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${localIncidentId}/tasks/${first.id}/complete`,
      headers: auth(localMemberToken),
      payload: { operationId },
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(completed.json());
    const revokedStatus = await app.inject({
      method: "PATCH",
      url: `/api/v1/incidents/${localIncidentId}/tasks/${second.id}`,
      headers: auth(localMemberToken),
      payload: { expectedRevision: second.revision, status: "in_progress" },
    });
    expect([403, 404]).toContain(revokedStatus.statusCode);
    const revokedCompletion = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${localIncidentId}/tasks/${second.id}/complete`,
      headers: auth(localMemberToken),
      payload: { operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    });
    expect([403, 404]).toContain(revokedCompletion.statusCode);
  });

  it("assigns an explicit participant and retains their organization attribution", async () => {
    const granted = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/participants`,
      headers: auth(adminToken),
      payload: {
        organizationSlug: "task-partner",
        personEmail: "task-partner@example.org",
        incidentPositionTitle: "Partner Task Liaison",
        role: "contributor",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        reason: "Task coordination",
      },
    });
    expect(granted.statusCode).toBe(201);
    participantId = granted.json().participant.id as string;
    const tasks = (await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/tasks`,
      headers: auth(adminToken),
    })).json().tasks;
    const partnerTask = tasks.find((task: { item: string }) =>
      task.item === "Coordinate partner support");
    const assigned = await app.inject({
      method: "PATCH",
      url: `/api/v1/incidents/${incidentId}/tasks/${partnerTask.id}`,
      headers: auth(adminToken),
      payload: {
        expectedRevision: partnerTask.revision,
        assignment: { kind: "incident_participant", incidentId, participantId },
      },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().assignment).toMatchObject({
      kind: "incident_participant",
      id: participantId,
      organizationId: partnerId,
      personId: partnerPersonId,
    });
    const started = await app.inject({
      method: "PATCH",
      url: `/api/v1/incidents/${incidentId}/tasks/${partnerTask.id}`,
      headers: auth(partnerToken),
      payload: { expectedRevision: assigned.json().revision, status: "in_progress" },
    });
    expect(started.statusCode, started.body).toBe(200);
    const metadata = await app.inject({
      method: "PATCH",
      url: `/api/v1/incidents/${incidentId}/tasks/${partnerTask.id}`,
      headers: auth(partnerToken),
      payload: { expectedRevision: started.json().revision, category: "unauthorized" },
    });
    expect(metadata.statusCode).toBe(403);
    const runtimeVisibility = await withPerson(runtime, partnerPersonId, (tx) => tx`
      select c.id, checklist_actor_can_update(c) as allowed
      from checklist_items c where c.id = ${partnerTask.id}`);
    expect(runtimeVisibility).toMatchObject([{ id: partnerTask.id, allowed: true }]);
    const completed = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/tasks/${partnerTask.id}/complete`,
      headers: auth(partnerToken),
      payload: { operationId: "22222222-2222-4222-8222-222222222222" },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.json().completedBy).toMatchObject({
      personId: partnerPersonId,
      positionId: null,
      organizationId: partnerId,
      participationId: participantId,
      title: "Partner Task Liaison",
    });
    const visibleAudit = await withPerson(runtime, partnerPersonId, (tx) => tx`
      select id from audit_events where category = 'checklist.completed'
        and subject_id = ${partnerTask.id}`);
    expect(visibleAudit).toHaveLength(1);
    const forgedReceipt = {
      ...completed.json(),
      operationId: "99999999-9999-4999-8999-999999999999",
    };
    const wrongOrganizationOperation = "66666666-6666-4666-8666-666666666666";
    const completedReceipt = completed.json<TaskCompletionReceipt>();
    await expect(withPerson(runtime, partnerPersonId, (tx) => tx`
      insert into checklist_completion_operations
        (operation_id, task_id, incident_id, actor_person_id, request_digest, receipt)
      values (${wrongOrganizationOperation}, ${partnerTask.id}, ${incidentId},
        ${partnerPersonId}, ${"0".repeat(64)}, ${tx.json({
          ...completedReceipt,
          operationId: wrongOrganizationOperation,
          completedBy: { ...completedReceipt.completedBy, organizationId: jurisdictionId },
        } as never)})`))
      .rejects.toMatchObject({ code: "42501" });
    await expect(withPerson(runtime, partnerPersonId, (tx) => tx`
      insert into checklist_completion_operations
        (operation_id, task_id, incident_id, actor_person_id, request_digest, receipt)
      values ('88888888-8888-4888-8888-888888888888', ${partnerTask.id}, ${incidentId},
        ${partnerPersonId}, ${"0".repeat(64)}, ${tx.json(forgedReceipt as never)})`))
      .rejects.toMatchObject({ code: "42501" });
    await expect(withPerson(runtime, partnerPersonId, (tx) => tx`
      insert into checklist_completion_operations
        (operation_id, task_id, incident_id, actor_person_id, request_digest, receipt)
      values ('77777777-7777-4777-8777-777777777777', ${partnerTask.id}, ${incidentId},
        ${adminId}, ${"0".repeat(64)}, ${tx.json({
          ...forgedReceipt,
          operationId: "77777777-7777-4777-8777-777777777777",
          completedBy: { ...forgedReceipt.completedBy, personId: adminId },
        } as never)})`))
      .rejects.toMatchObject({ code: "42501" });
    await expect(withPerson(runtime, partnerPersonId, (tx) => tx`
      update checklist_completion_operations set receipt = ${tx.json(forgedReceipt as never)}
      where operation_id = '22222222-2222-4222-8222-222222222222'`))
      .rejects.toMatchObject({ code: "42501" });
    await expect(withPerson(runtime, partnerPersonId, (tx) => tx`
      insert into audit_events
        (jurisdiction_id, incident_id, person_id, category, subject_table, subject_id, payload)
      values (${jurisdictionId}, ${incidentId}, ${partnerPersonId}, 'checklist.completed',
        'checklist_items', ${partnerTask.id},
        ${tx.json({ operationId: "99999999-9999-4999-8999-999999999999", revision: 2 } as never)})`))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("denies cross-incident, outsider, and revoked completion attempts under runtime RLS", async () => {
    const tasks = (await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/tasks`,
      headers: auth(adminToken),
    })).json().tasks;
    const task = tasks.find((item: { item: string }) => item.item === "Confirm demobilization plan");
    const crossIncident = await app.inject({
      method: "PATCH",
      url: `/api/v1/incidents/${incidentId}/tasks/${task.id}`,
      headers: auth(adminToken),
      payload: {
        expectedRevision: task.revision,
        assignment: { kind: "incident_participant", incidentId: otherIncidentId, participantId },
      },
    });
    expect(crossIncident.statusCode).toBe(400);
    const assigned = await app.inject({
      method: "PATCH",
      url: `/api/v1/incidents/${incidentId}/tasks/${task.id}`,
      headers: auth(adminToken),
      payload: {
        expectedRevision: task.revision,
        assignment: { kind: "incident_participant", incidentId, participantId },
      },
    });
    expect(assigned.statusCode).toBe(200);

    const outsider = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/tasks/${task.id}/complete`,
      headers: auth(outsiderToken),
      payload: { operationId: "33333333-3333-4333-8333-333333333333" },
    });
    expect([403, 404]).toContain(outsider.statusCode);
    const rawOutsider = await withPerson(runtime, outsiderId, (tx) => tx`
      update checklist_items set status = 'in_progress'
      where id = ${task.id} returning id`);
    expect(rawOutsider).toEqual([]);

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/participants/${participantId}/revoke`,
      headers: auth(adminToken),
      payload: { reason: "Mutual aid assignment ended" },
    });
    expect(revoked.statusCode).toBe(200);
    const afterRevoke = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/tasks/${task.id}/complete`,
      headers: auth(partnerToken),
      payload: { operationId: "44444444-4444-4444-8444-444444444444" },
    });
    expect([403, 404]).toContain(afterRevoke.statusCode);
    const rawRevoked = await withPerson(runtime, partnerPersonId, (tx) => tx`
      update checklist_items set status = 'in_progress'
      where id = ${task.id} returning id`);
    expect(rawRevoked).toEqual([]);
    const revokedAudit = await withPerson(runtime, partnerPersonId, (tx) => tx`
      select id from audit_events where category = 'checklist.completed'`);
    expect(revokedAudit).toEqual([]);
  });
});
