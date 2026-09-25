import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  addMembership,
  createJurisdiction,
  createPerson,
  principalForPerson,
} from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { revokeIncidentParticipant } from "../incidents/participation.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminId: string;
let memberId: string;
let partnerId: string;
let boardId: string;
let incidentId: string;
let otherIncidentId: string;
let closedIncidentId: string;
let localPositionId: string;
let targetParticipantId: string;
let targetPersonId: string;
let coordinatorBId: string;
let coordinatorCId: string;
let expiredParticipantId: string;
let localRecordId: string;
let happyRecordId: string;
let ownerReviewRecordId: string;
let deniedRecordId: string;
let revokedRecordId: string;
let closedRecordId: string;
let adminToken: string;
let memberToken: string;
let targetToken: string;
let coordinatorBToken: string;
let coordinatorCToken: string;
let outsiderToken: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const workflowUrl = (recordId: string, suffix = "") =>
  `/api/v1/boards/${boardId}/records/${recordId}/workflow${suffix}`;

const templateV1 = {
  key: "routed_requests",
  version: 1,
  title: "Routed requests",
  description: "Workflow runtime test",
  fields: [{ key: "summary", label: "Summary", type: "text", required: true }],
  views: [{ key: "all", title: "All", columns: ["summary"] }],
  workflow: {
    initialState: "new",
    states: [
      { key: "new", label: "New" },
      { key: "routed", label: "Routed" },
      { key: "done", label: "Done", terminal: true },
    ],
    transitions: [
      {
        key: "route_review",
        label: "Route after review",
        from: "new",
        to: "routed",
        allowedActors: ["jurisdiction_admin"],
        assignment: { required: true, allowedTargets: ["position"] },
        approvals: [{
          key: "operations_review",
          label: "Operations review",
          approver: { kind: "position_key", positionKey: "operations" },
          count: 1,
          allowSelfApproval: false,
        }],
        due: { kind: "relative", minutes: 1, anchor: "transitioned" },
        escalations: [{
          key: "late",
          afterMinutes: 1,
          assignment: { required: true, allowedTargets: ["position"] },
        }],
      },
      {
        key: "owner_review",
        label: "Owner review",
        from: "new",
        to: "routed",
        allowedActors: ["jurisdiction_admin"],
        assignment: { required: true, allowedTargets: ["incident_participant"] },
        approvals: [{
          key: "partner_review",
          label: "Partner review",
          approver: { kind: "incident_coordinator" },
          count: 1,
          allowSelfApproval: false,
        }],
        escalations: [],
      },
      {
        key: "route",
        label: "Route request",
        from: "new",
        to: "routed",
        allowedActors: ["jurisdiction_admin"],
        assignment: { required: true, allowedTargets: ["position", "incident_participant"] },
        approvals: [],
        due: { kind: "relative", minutes: 1, anchor: "transitioned" },
        escalations: [{
          key: "late",
          afterMinutes: 1,
          assignment: { required: true, allowedTargets: ["position"] },
        }],
      },
      {
        key: "complete",
        label: "Complete request",
        from: "routed",
        to: "done",
        allowedActors: ["assigned_position"],
        approvals: [{
          key: "coord_review",
          label: "Coordinator review",
          approver: { kind: "incident_coordinator" },
          count: 2,
          allowSelfApproval: false,
        }],
        escalations: [],
      },
    ],
  },
} as const;

const templateV2 = {
  ...templateV1,
  version: 2,
  workflow: {
    initialState: "new",
    states: [
      { key: "new", label: "New" },
      { key: "cancelled", label: "Cancelled", terminal: true },
    ],
    transitions: [{
      key: "cancel",
      label: "Cancel",
      from: "new",
      to: "cancelled",
      allowedActors: ["jurisdiction_admin"],
      approvals: [],
      escalations: [],
    }],
  },
} as const;

async function makePerson(orgId: string, email: string, password: string): Promise<string> {
  const id = await createPerson(admin, { email, displayName: email.split("@")[0]!, password });
  await addMembership(admin, id, orgId, "member");
  return id;
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

async function post(
  recordId: string,
  suffix: string,
  token: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: workflowUrl(recordId, suffix),
    headers: auth(token),
    payload,
  });
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  adminId = seed.adminId;
  memberId = seed.memberId;
  partnerId = await createJurisdiction(admin, "workflow-partner-e2", "Workflow Partner E2");
  targetPersonId = await makePerson(partnerId, "target-e2@example.org", "target-password-e2");
  coordinatorBId = await makePerson(partnerId, "coordinator-b-e2@example.org", "coordinator-b-pass");
  coordinatorCId = await makePerson(partnerId, "coordinator-c-e2@example.org", "coordinator-c-pass");
  const expiredPersonId = await makePerson(partnerId, "expired-e2@example.org", "expired-password-e2");
  await createPerson(admin, {
    email: "workflow-outsider@example.org",
    displayName: "Workflow Outsider",
    password: "outsider-password-e2",
  });

  await admin`
    insert into board_templates (key, version, title, definition)
    values (${templateV1.key}, 1, ${templateV1.title}, ${admin.json(templateV1 as never)}),
           (${templateV2.key}, 2, ${templateV2.title}, ${admin.json(templateV2 as never)})`;
  const [board] = await admin`
    insert into boards (jurisdiction_id, template_key, template_version, title)
    values (${jurisdictionId}, ${templateV1.key}, 1, 'Workflow requests') returning id`;
  boardId = board!.id as string;
  const [position] = await admin`
    insert into positions (jurisdiction_id, key, title)
    values (${jurisdictionId}, 'operations', 'Operations') returning id`;
  localPositionId = position!.id as string;
  await admin`
    insert into position_assignments (position_id, person_id, assigned_by)
    values (${localPositionId}, ${memberId}, ${adminId})`;

  const incidents = await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by, closed_at, closed_by)
    values (${jurisdictionId}, 'Workflow Incident E2', 'incident', ${adminId}, null, null),
           (${jurisdictionId}, 'Other Workflow Incident E2', 'incident', ${adminId}, null, null),
           (${jurisdictionId}, 'Closed Workflow Incident E2', 'incident', ${adminId}, now(), ${adminId})
    returning id, name`;
  incidentId = incidents.find((row) => row.name === "Workflow Incident E2")!.id as string;
  otherIncidentId = incidents.find((row) => row.name === "Other Workflow Incident E2")!.id as string;
  closedIncidentId = incidents.find((row) => row.name === "Closed Workflow Incident E2")!.id as string;
  await admin`
    insert into incident_boards (incident_id, board_id)
    values (${incidentId}, ${boardId}), (${closedIncidentId}, ${boardId})`;
  const grants = await admin`
    insert into incident_participants
      (incident_id, organization_id, person_id, incident_position_title, role,
       expires_at, reason, created_by)
    values
      (${incidentId}, ${partnerId}, ${targetPersonId}, 'Partner Operations', 'coordinator',
       now() + interval '1 day', 'workflow target', ${adminId}),
      (${incidentId}, ${partnerId}, ${coordinatorBId}, 'Partner Coordination B', 'coordinator',
       now() + interval '1 day', 'workflow approval', ${adminId}),
      (${incidentId}, ${partnerId}, ${coordinatorCId}, 'Partner Coordination C', 'coordinator',
       now() + interval '1 day', 'workflow approval', ${adminId})
    returning id, person_id`;
  targetParticipantId = grants.find((row) => row.person_id === targetPersonId)!.id as string;
  await admin`alter table incident_participants disable trigger participant_immutable`;
  try {
    const [expired] = await admin`
      insert into incident_participants
        (incident_id, organization_id, person_id, incident_position_title, role,
         expires_at, reason, created_by)
      values (${incidentId}, ${partnerId}, ${expiredPersonId}, 'Expired Partner', 'coordinator',
        now() - interval '1 hour', 'expired workflow target', ${adminId}) returning id`;
    expiredParticipantId = expired!.id as string;
  } finally {
    await admin`alter table incident_participants enable trigger participant_immutable`;
  }

  const records = await admin`
    insert into board_records (board_id, data, created_by, incident_id)
    values
      (${boardId}, ${admin.json({ summary: "Local routed request" })}, ${adminId}, null),
      (${boardId}, ${admin.json({ summary: "Happy incident request" })}, ${adminId}, ${incidentId}),
      (${boardId}, ${admin.json({ summary: "Owner review request" })}, ${adminId}, ${incidentId}),
      (${boardId}, ${admin.json({ summary: "Denied incident request" })}, ${adminId}, ${incidentId}),
      (${boardId}, ${admin.json({ summary: "Revoked actor request" })}, ${adminId}, ${incidentId}),
      (${boardId}, ${admin.json({ summary: "Closed incident request" })}, ${adminId}, ${closedIncidentId})
    returning id, data`;
  const idFor = (summary: string) => records.find((row) =>
    (row.data as Record<string, unknown>).summary === summary)!.id as string;
  localRecordId = idFor("Local routed request");
  happyRecordId = idFor("Happy incident request");
  ownerReviewRecordId = idFor("Owner review request");
  deniedRecordId = idFor("Denied incident request");
  revokedRecordId = idFor("Revoked actor request");
  closedRecordId = idFor("Closed incident request");

  app = buildApp(runtime, { oidc: null });
  adminToken = await login("admin@example.org", "correct-horse-battery");
  memberToken = await login("member@example.org", "another-good-password");
  targetToken = await login("target-e2@example.org", "target-password-e2");
  coordinatorBToken = await login("coordinator-b-e2@example.org", "coordinator-b-pass");
  coordinatorCToken = await login("coordinator-c-e2@example.org", "coordinator-c-pass");
  outsiderToken = await login("workflow-outsider@example.org", "outsider-password-e2");
  const signedIn = await app.inject({
    method: "POST",
    url: `/api/v1/positions/${localPositionId}/sign-in`,
    headers: auth(memberToken),
  });
  expect(signedIn.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("board workflow runtime", () => {
  it("rejects and cancels pending requests without changing state, and names who acted", async () => {
    const [row] = await admin`
      insert into board_records (board_id, data, created_by, incident_id)
      values (${boardId}, ${admin.json({ summary: "Withdrawn request" })}, ${adminId}, ${incidentId})
      returning id`;
    const recordId = row!.id as string;
    const routed = await post(recordId, "/transitions", adminToken, {
      transitionKey: "route",
      assignment: { kind: "incident_participant", incidentId, participantId: targetParticipantId },
      idempotencyKey: "withdraw-route",
    });
    expect(routed.statusCode, routed.body).toBe(200);
    const request = (key: string) => post(recordId, "/transitions", targetToken, { transitionKey: "complete", idempotencyKey: key });
    const approve = (key: string, token: string) =>
      post(recordId, "/approvals", token, { transitionKey: "complete", ruleKey: "coord_review", idempotencyKey: key });
    const withdraw = (token: string, action: "reject" | "cancel", key: string, note?: string) =>
      post(recordId, "/withdrawals", token, { transitionKey: "complete", action, ...(note ? { note } : {}), idempotencyKey: key });

    expect((await withdraw(targetToken, "cancel", "withdraw-nothing")).statusCode).toBe(409);
    expect((await request("withdraw-request-1")).statusCode).toBe(200);
    expect((await approve("withdraw-approve-b1", coordinatorBToken)).statusCode).toBe(200);
    // Cancelling is the requester's; rejecting needs approval authority, which a
    // requester without self-approval does not have.
    expect((await withdraw(coordinatorCToken, "cancel", "withdraw-c-cancel")).statusCode).toBe(403);
    expect((await withdraw(targetToken, "reject", "withdraw-self-reject")).statusCode).toBe(403);
    const rejected = await withdraw(coordinatorCToken, "reject", "withdraw-c-reject", "Crew still on site");
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json()).toMatchObject({ state: "routed", pendingTransition: null });

    // B's approval belonged to the rejected request, so the next request needs two again.
    expect((await request("withdraw-request-2")).statusCode).toBe(200);
    const one = await approve("withdraw-approve-c2", coordinatorCToken);
    expect(one.json()).toMatchObject({ state: "routed", pendingTransition: "complete" });
    const cancelled = await withdraw(targetToken, "cancel", "withdraw-cancel");
    expect(cancelled.json()).toMatchObject({ state: "routed", pendingTransition: null });
    expect((await request("withdraw-request-3")).statusCode).toBe(200);
    expect((await approve("withdraw-approve-b3", coordinatorBToken)).json()).toMatchObject({ pendingTransition: "complete" });
    expect((await approve("withdraw-approve-c3", coordinatorCToken)).json()).toMatchObject({ state: "done", pendingTransition: null });

    const read = await app.inject({ method: "GET", url: workflowUrl(recordId), headers: auth(adminToken) });
    const history = read.json().history as Array<{ eventKind: string; actorPersonId: string; actorName: string | null; detail: Record<string, unknown> }>;
    expect(history.map((event) => event.eventKind)).toEqual([
      "transition_requested", "transition_completed",
      "transition_requested", "approval_recorded", "transition_rejected",
      "transition_requested", "approval_recorded", "transition_cancelled",
      "transition_requested", "approval_recorded", "approval_recorded", "transition_completed",
    ]);
    const names = await admin`select id, display_name from persons`;
    const nameOf = new Map(names.map((person) => [person.id as string, person.display_name as string]));
    for (const event of history) expect(event.actorName).toBe(nameOf.get(event.actorPersonId));
    expect(history.find((event) => event.eventKind === "transition_rejected")!.detail).toEqual({ note: "Crew still on site" });
    const replayed = await withdraw(coordinatorCToken, "reject", "withdraw-c-reject", "Crew still on site");
    expect(replayed.json()).toEqual(rejected.json());
  });

  it("routes to current local positions and applies due escalation once under concurrent retry", async () => {
    const routed = await post(localRecordId, "/transitions", adminToken, {
      transitionKey: "route_review",
      assignment: { kind: "position", positionId: localPositionId },
      idempotencyKey: "local-route",
    });
    expect(routed.statusCode).toBe(200);
    expect(routed.json()).toMatchObject({ state: "new", pendingTransition: "route_review" });
    const [beforeApproval] = await admin`
      select count(*)::int as n from notifications
      where channel = 'workflow' and detail ->> 'recordId' = ${localRecordId}`;
    expect(beforeApproval!.n).toBe(0);
    const approvalPayload = {
      transitionKey: "route_review",
      ruleKey: "operations_review",
      idempotencyKey: "local-route-approval",
    };
    const approved = await post(localRecordId, "/approvals", memberToken, approvalPayload);
    expect(approved.statusCode).toBe(200);
    const approvalReplay = await post(localRecordId, "/approvals", memberToken, approvalPayload);
    expect(approvalReplay.statusCode).toBe(200);
    expect(approvalReplay.json()).toEqual(approved.json());
    expect(routed.json()).toMatchObject({
      state: "new",
      stateRevision: 0,
    });
    expect(approved.json()).toMatchObject({ state: "routed", stateRevision: 1,
      dueStatus: "scheduled", assignment: { kind: "position", positionId: localPositionId } });
    const tray = await app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      headers: auth(memberToken),
    });
    expect(tray.statusCode).toBe(200);
    expect(tray.json().notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "workflow", position_id: localPositionId }),
    ]));

    await admin`
      update board_workflow_instances
      set transitioned_at = now() - interval '2 minutes'
      where record_id = ${localRecordId}`;
    const payload = {
      ruleKey: "late",
      occurrence: 0,
      assignment: { kind: "position", positionId: localPositionId },
      idempotencyKey: "local-escalation-concurrent",
    };
    const [first, second] = await Promise.all([
      post(localRecordId, "/escalations", adminToken, payload),
      post(localRecordId, "/escalations", adminToken, payload),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toEqual(second.json());
    const [counts] = await admin`
      select
        (select count(*)::int from board_workflow_history
          where record_id = ${localRecordId} and event_kind = 'escalation') as events,
        (select count(*)::int from notifications
          where channel = 'workflow' and detail ->> 'recordId' = ${localRecordId}) as notices`;
    expect(counts).toMatchObject({ events: 1, notices: 2 });

    const conflict = await post(localRecordId, "/escalations", adminToken, {
      ...payload,
      occurrence: 1,
    });
    expect(conflict.statusCode).toBe(409);
  });

  it("routes across organizations, counts distinct approvals, and preserves the pinned definition", async () => {
    const routed = await post(happyRecordId, "/transitions", adminToken, {
      transitionKey: "route",
      assignment: { kind: "incident_participant", incidentId, participantId: targetParticipantId },
      idempotencyKey: "incident-route",
    });
    expect(routed.statusCode).toBe(200);
    expect(routed.json().assignment).toMatchObject({
      kind: "incident_participant",
      participantId: targetParticipantId,
      personId: targetPersonId,
    });
    const targetTray = await app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      headers: auth(targetToken),
    });
    expect(targetTray.statusCode).toBe(200);
    expect(targetTray.json().notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "workflow" }),
    ]));

    const requested = await post(happyRecordId, "/transitions", targetToken, {
      transitionKey: "complete",
      idempotencyKey: "complete-request",
    });
    expect(requested.statusCode).toBe(200);
    expect(requested.json()).toMatchObject({ state: "routed", pendingTransition: "complete" });
    const self = await post(happyRecordId, "/approvals", targetToken, {
      transitionKey: "complete",
      ruleKey: "coord_review",
      idempotencyKey: "self-approval",
    });
    expect(self.statusCode).toBe(403);
    const approval = {
      transitionKey: "complete",
      ruleKey: "coord_review",
      idempotencyKey: "approval-b",
    };
    const approvedB = await post(happyRecordId, "/approvals", coordinatorBToken, approval);
    expect(approvedB.statusCode).toBe(200);
    expect(approvedB.json().pendingTransition).toBe("complete");
    const replayB = await post(happyRecordId, "/approvals", coordinatorBToken, approval);
    expect(replayB.statusCode).toBe(200);
    expect(replayB.json()).toEqual(approvedB.json());
    const duplicateB = await post(happyRecordId, "/approvals", coordinatorBToken, {
      ...approval,
      idempotencyKey: "approval-b-again",
    });
    expect(duplicateB.statusCode).toBe(409);
    const approvedC = await post(happyRecordId, "/approvals", coordinatorCToken, {
      transitionKey: "complete",
      ruleKey: "coord_review",
      idempotencyKey: "approval-c",
    });
    expect(approvedC.statusCode).toBe(200);
    expect(approvedC.json()).toMatchObject({ state: "done", stateRevision: 2, pendingTransition: null });

    await admin`update boards set template_version = 2 where id = ${boardId}`;
    const state = await app.inject({
      method: "GET",
      url: workflowUrl(happyRecordId),
      headers: auth(targetToken),
    });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({ state: "done", pinnedTemplateVersion: 1 });
    expect(state.json().history.map((item: { eventKind: string }) => item.eventKind))
      .toEqual(["transition_requested", "transition_completed", "transition_requested",
        "approval_recorded", "approval_recorded", "transition_completed"]);
  });

  it("lets a partner coordinator approve a still-authorized host admin request", async () => {
    await admin`update boards set template_version = 1 where id = ${boardId}`;
    const requested = await post(ownerReviewRecordId, "/transitions", adminToken, {
      transitionKey: "owner_review",
      assignment: {
        kind: "incident_participant",
        incidentId,
        participantId: targetParticipantId,
      },
      idempotencyKey: "owner-review-request",
    });
    expect(requested.statusCode).toBe(200);
    expect(requested.json()).toMatchObject({ state: "new", pendingTransition: "owner_review" });
    const [pendingNotice] = await admin`
      select count(*)::int as n from notifications
      where channel = 'workflow' and detail ->> 'recordId' = ${ownerReviewRecordId}`;
    expect(pendingNotice!.n).toBe(0);
    const approved = await post(ownerReviewRecordId, "/approvals", coordinatorBToken, {
      transitionKey: "owner_review",
      ruleKey: "partner_review",
      idempotencyKey: "owner-review-approval",
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ state: "routed", pendingTransition: null });
    const notices = await admin`
      select jurisdiction_id, person_id, detail from notifications
      where channel = 'workflow' and detail ->> 'recordId' = ${ownerReviewRecordId}`;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ jurisdiction_id: jurisdictionId, person_id: targetPersonId });

    const [completion] = await admin`
      select id from board_workflow_history
      where record_id = ${ownerReviewRecordId} and event_kind = 'transition_completed'`;
    const rawInsert = (personId: string, recordId: string, targetId: string) =>
      withPerson(runtime, personId, (tx) => tx`
        insert into notifications
          (jurisdiction_id, person_id, channel, title, body, status, detail)
        values (${jurisdictionId}, ${targetId}, 'workflow', 'Raw attempt', '', 'delivered',
          ${tx.json({
            boardId,
            recordId,
            sourceJurisdictionId: jurisdictionId,
            incidentId,
            historyId: completion!.id as string,
          } as never)})`);
    await expect(rawInsert(coordinatorBId, ownerReviewRecordId, coordinatorCId))
      .rejects.toMatchObject({ code: "42501" });
    await expect(rawInsert(coordinatorBId, deniedRecordId, targetPersonId))
      .rejects.toMatchObject({ code: "42501" });
    const outsider = (await admin`
      select id from persons where email = 'workflow-outsider@example.org'`)[0]!.id as string;
    await expect(rawInsert(outsider, ownerReviewRecordId, targetPersonId))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("rejects anonymous, unrelated, expired, outsider, and closed-incident commands", async () => {
    await admin`update boards set template_version = 1 where id = ${boardId}`;
    const anonymous = await app.inject({
      method: "POST",
      url: workflowUrl(deniedRecordId, "/transitions"),
      payload: { transitionKey: "route", idempotencyKey: "anonymous" },
    });
    expect(anonymous.statusCode).toBe(401);
    const outsider = await post(deniedRecordId, "/transitions", outsiderToken, {
      transitionKey: "route",
      assignment: { kind: "incident_participant", incidentId, participantId: targetParticipantId },
      idempotencyKey: "outsider",
    });
    expect([403, 404]).toContain(outsider.statusCode);
    const crossIncident = await post(deniedRecordId, "/transitions", adminToken, {
      transitionKey: "route",
      assignment: { kind: "incident_participant", incidentId: otherIncidentId, participantId: targetParticipantId },
      idempotencyKey: "cross-incident",
    });
    expect(crossIncident.statusCode).toBe(400);
    const expired = await post(deniedRecordId, "/transitions", adminToken, {
      transitionKey: "route",
      assignment: { kind: "incident_participant", incidentId, participantId: expiredParticipantId },
      idempotencyKey: "expired-target",
    });
    expect(expired.statusCode).toBe(404);
    const closed = await post(closedRecordId, "/transitions", adminToken, {
      transitionKey: "route",
      assignment: { kind: "position", positionId: localPositionId },
      idempotencyKey: "closed-incident",
    });
    expect(closed.statusCode).toBe(409);
  });

  it("rechecks revoked authority before idempotent replay or pending completion", async () => {
    const routed = await post(revokedRecordId, "/transitions", adminToken, {
      transitionKey: "route",
      assignment: { kind: "incident_participant", incidentId, participantId: targetParticipantId },
      idempotencyKey: "revoked-route",
    });
    expect(routed.statusCode).toBe(200);
    const pendingPayload = { transitionKey: "complete", idempotencyKey: "revoked-request" };
    const pending = await post(revokedRecordId, "/transitions", targetToken, pendingPayload);
    expect(pending.statusCode).toBe(200);
    const owner = await principalForPerson(runtime, adminId);
    await withPerson(runtime, adminId, (tx) =>
      revokeIncidentParticipant(tx, owner, incidentId, targetParticipantId, "assignment ended"));
    const replay = await post(revokedRecordId, "/transitions", targetToken, pendingPayload);
    expect([403, 404]).toContain(replay.statusCode);
    const completion = await post(revokedRecordId, "/approvals", coordinatorBToken, {
      transitionKey: "complete",
      ruleKey: "coord_review",
      idempotencyKey: "revoked-approval",
    });
    expect(completion.statusCode).toBe(409);
    const [approvalCount] = await admin`
      select count(*)::int as n from board_workflow_approvals
      where record_id = ${revokedRecordId}`;
    expect(approvalCount!.n).toBe(0);
  });

  it("keeps history immutable beneath the runtime role", async () => {
    await expect(admin`
      update board_workflow_history set event_key = 'rewritten'
      where record_id = ${happyRecordId}`).rejects.toThrow(/append-only/);
    await expect(admin`
      delete from board_workflow_approvals
      where record_id = ${happyRecordId}`).rejects.toThrow(/append-only/);
  });
});
