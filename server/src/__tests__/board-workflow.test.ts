import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  createJurisdiction,
  createPerson,
  createPosition,
  principalForPerson,
} from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { revokeIncidentParticipant } from "../incidents/participation.js";
import { resolveWorkflowAssignment } from "../boards/workflow.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let ownerId: string;
let ownerAdminId: string;
let ownerMemberId: string;
let partnerId: string;
let supportId: string;
let localPositionId: string;
let foreignPositionId: string;
let incidentId: string;
let otherIncidentId: string;
let activeTargetId: string;
let revokedTargetId: string;
let expiredTargetId: string;
let viewerTargetId: string;
let coordinatorId: string;
let expiredCoordinatorId: string;
let supportTargetId: string;

async function person(orgId: string, email: string): Promise<string> {
  const id = await createPerson(admin, {
    email,
    displayName: email.split("@")[0]!,
    password: "workflow-test-password",
  });
  await addMembership(admin, id, orgId, "member");
  return id;
}

async function resolve(
  actorId: string,
  sourceJurisdictionId: string,
  request: Record<string, unknown>,
) {
  const actor = await principalForPerson(runtime, actorId);
  return withPerson(runtime, actorId, (tx) =>
    resolveWorkflowAssignment(tx, actor, sourceJurisdictionId, request));
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  ownerId = seed.jurisdictionId;
  ownerAdminId = seed.adminId;
  ownerMemberId = seed.memberId;
  partnerId = await createJurisdiction(admin, "workflow-partner", "Workflow Partner");
  supportId = await createJurisdiction(admin, "workflow-support", "Workflow Support");
  await addMembership(admin, ownerAdminId, partnerId, "member");
  const ownerActor = await principalForPerson(runtime, ownerAdminId);
  localPositionId = await withPerson(runtime, ownerAdminId, (tx) =>
    createPosition(tx, ownerActor, ownerId, "operations", "Operations"));
  foreignPositionId = (await admin`
    insert into positions (jurisdiction_id, key, title)
    values (${partnerId}, 'partner_ops', 'Partner Operations') returning id`)[0]!.id as string;

  const activeTargetPerson = await person(partnerId, "active-target@example.org");
  const revokedTargetPerson = await person(partnerId, "revoked-target@example.org");
  const expiredTargetPerson = await person(partnerId, "expired-target@example.org");
  const viewerTargetPerson = await person(partnerId, "viewer-target@example.org");
  coordinatorId = await person(partnerId, "coordinator@example.org");
  expiredCoordinatorId = await person(partnerId, "expired-coordinator@example.org");
  const supportTargetPerson = await person(supportId, "support-target@example.org");

  const incidents = await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by)
    values (${ownerId}, 'Workflow Incident', 'incident', ${ownerAdminId}),
           (${ownerId}, 'Other Incident', 'incident', ${ownerAdminId}) returning id`;
  incidentId = incidents[0]!.id as string;
  otherIncidentId = incidents[1]!.id as string;
  const grants = await admin`
    insert into incident_participants
      (incident_id, organization_id, person_id, incident_position_title, role,
       expires_at, reason, created_by)
    values
      (${incidentId}, ${partnerId}, ${activeTargetPerson}, 'Partner Operations', 'contributor',
       now() + interval '1 day', 'assignment target', ${ownerAdminId}),
      (${incidentId}, ${partnerId}, ${revokedTargetPerson}, 'Partner Logistics', 'contributor',
       now() + interval '1 day', 'revocation case', ${ownerAdminId}),
      (${incidentId}, ${partnerId}, ${viewerTargetPerson}, 'Partner Observer', 'viewer',
       now() + interval '1 day', 'viewer case', ${ownerAdminId}),
      (${incidentId}, ${partnerId}, ${coordinatorId}, 'Partner Coordinator', 'coordinator',
       now() + interval '1 day', 'actor authority', ${ownerAdminId}),
      (${incidentId}, ${supportId}, ${supportTargetPerson}, 'Support Operations', 'contributor',
       now() + interval '1 day', 'coordinator target', ${ownerAdminId}),
      (${otherIncidentId}, ${partnerId}, ${activeTargetPerson}, 'Other Incident Operations', 'contributor',
       now() + interval '1 day', 'unrelated incident', ${ownerAdminId})
    returning id, person_id, role, incident_id`;
  activeTargetId = grants.find((row) => row.person_id === activeTargetPerson && row.incident_id === incidentId)!.id as string;
  revokedTargetId = grants.find((row) => row.person_id === revokedTargetPerson)!.id as string;
  viewerTargetId = grants.find((row) => row.person_id === viewerTargetPerson)!.id as string;
  supportTargetId = grants.find((row) => row.person_id === supportTargetPerson)!.id as string;

  await admin`alter table incident_participants disable trigger participant_immutable`;
  try {
    const expired = await admin`
      insert into incident_participants
        (incident_id, organization_id, person_id, incident_position_title, role,
         expires_at, reason, created_by)
      values
        (${incidentId}, ${partnerId}, ${expiredTargetPerson}, 'Expired Target', 'contributor',
         now() - interval '1 hour', 'expired target case', ${ownerAdminId}),
        (${incidentId}, ${partnerId}, ${expiredCoordinatorId}, 'Expired Coordinator', 'coordinator',
         now() - interval '1 hour', 'expired actor case', ${ownerAdminId})
      returning id, person_id`;
    expiredTargetId = expired.find((row) => row.person_id === expiredTargetPerson)!.id as string;
  } finally {
    await admin`alter table incident_participants enable trigger participant_immutable`;
  }
});

afterAll(async () => {
  await runtime.end();
  await admin.end();
});

describe("workflow assignment authority", () => {
  it("resolves local positions but rejects raw foreign position authority", async () => {
    await expect(resolve(ownerAdminId, ownerId,
      { kind: "position", positionId: localPositionId })).resolves.toMatchObject({
      kind: "position", positionId: localPositionId, organizationId: ownerId,
      authority: "local_writer",
    });
    await expect(resolve(ownerAdminId, ownerId,
      { kind: "position", positionId: foreignPositionId })).rejects.toMatchObject({ status: 400 });
  });

  it("uses exact active incident grants for cross-organization assignments", async () => {
    await expect(resolve(ownerAdminId, ownerId, {
      kind: "incident_participant", incidentId, participantId: activeTargetId,
    })).resolves.toMatchObject({
      kind: "incident_participant", participantId: activeTargetId,
      organizationId: partnerId, authority: "incident_owner_admin",
    });
    await expect(resolve(ownerMemberId, ownerId, {
      kind: "incident_participant", incidentId, participantId: activeTargetId,
    })).rejects.toMatchObject({ status: 403 });
    await expect(resolve(ownerAdminId, ownerId, {
      kind: "incident_participant", incidentId: otherIncidentId, participantId: activeTargetId,
    })).rejects.toMatchObject({ status: 404 });
    await expect(resolve(ownerAdminId, ownerId, {
      kind: "incident_participant", incidentId, participantId: viewerTargetId,
    })).rejects.toMatchObject({ status: 403 });
    await expect(resolve(ownerAdminId, ownerId, {
      kind: "incident_participant", incidentId, participantId: expiredTargetId,
    })).rejects.toMatchObject({ status: 404 });
  });

  it("requires current coordinator authority and rejects revoked or expired grants", async () => {
    await expect(resolve(coordinatorId, partnerId, {
      kind: "incident_participant", incidentId, participantId: supportTargetId,
    })).resolves.toMatchObject({
      authority: "incident_coordinator", actorParticipationId: expect.any(String),
      organizationId: supportId,
    });
    const ownerActor = await principalForPerson(runtime, ownerAdminId);
    await withPerson(runtime, ownerAdminId, (tx) =>
      revokeIncidentParticipant(tx, ownerActor, incidentId, revokedTargetId, "no longer assigned"));
    await expect(resolve(ownerAdminId, ownerId, {
      kind: "incident_participant", incidentId, participantId: revokedTargetId,
    })).rejects.toMatchObject({ status: 404 });

    const coordinatorGrant = (await admin`select id from incident_participants
      where incident_id = ${incidentId} and person_id = ${coordinatorId}`)[0]!.id as string;
    await withPerson(runtime, ownerAdminId, (tx) =>
      revokeIncidentParticipant(tx, ownerActor, incidentId, coordinatorGrant, "shift ended"));
    await expect(resolve(coordinatorId, partnerId, {
      kind: "incident_participant", incidentId, participantId: supportTargetId,
    })).rejects.toMatchObject({ status: 404 });
    await expect(resolve(expiredCoordinatorId, partnerId, {
      kind: "incident_participant", incidentId, participantId: supportTargetId,
    })).rejects.toMatchObject({ status: 404 });
  });
});
