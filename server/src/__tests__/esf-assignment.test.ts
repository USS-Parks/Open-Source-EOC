import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let ownerId: string;
let partnerId: string;
let targetId: string;
let incidentId: string;
let otherIncidentId: string;
let coordinatorGrantId: string;
let targetGrantId: string;
let otherTargetGrantId: string;
let adminToken: string;
let partnerToken: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST", url: "/api/v1/auth/login", payload: { email, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

async function activate(name: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${ownerId}/incidents`,
    headers: auth(adminToken),
    payload: { templateKey: "daily_ops", name },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().incidentId as string;
}

async function grant(
  incident: string,
  organizationSlug: string,
  personEmail: string,
  role: "contributor" | "coordinator",
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/incidents/${incident}/participants`,
    headers: auth(adminToken),
    payload: {
      organizationSlug,
      personEmail,
      incidentPositionTitle: role === "coordinator" ? "External ESF Coordinator" : "Field Unit Lead",
      role,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      reason: "P-LIFE-3 bounded assignment proof",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().participant.id as string;
}

function assessment(assignmentIncidentId: string, participantId: string) {
  return {
    identity: { framework: "california", esf: "ca_esf_4", definitionVersion: 1 },
    activation: "activated",
    capacity: "constrained",
    assessedAt: new Date().toISOString(),
    confidence: "confirmed",
    situation: "External coordinator assigned a field unit through explicit incident authority.",
    missions: ["Coordinate field unit"],
    priorities: [],
    evidence: [],
    relatedLifelines: [],
    actions: [{
      key: "coordinate_field_unit",
      title: "Coordinate field unit",
      status: "planned",
      assignment: {
        kind: "incident_participant",
        incidentId: assignmentIncidentId,
        participantId,
      },
    }],
  };
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  ownerId = seed.jurisdictionId;
  partnerId = await createJurisdiction(admin, "esf-partner", "ESF Partner");
  targetId = await createJurisdiction(admin, "esf-target", "ESF Target");
  const partnerPersonId = await createPerson(admin, {
    email: "esf-coordinator@example.org",
    displayName: "External ESF Coordinator",
    password: "external-esf-password",
  });
  const targetPersonId = await createPerson(admin, {
    email: "esf-target@example.org",
    displayName: "ESF Field Target",
    password: "external-target-password",
  });
  await addMembership(admin, partnerPersonId, partnerId, "member");
  await addMembership(admin, targetPersonId, targetId, "member");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  adminToken = await login("admin@example.org", "correct-horse-battery");
  partnerToken = await login("esf-coordinator@example.org", "external-esf-password");
  incidentId = await activate("ESF Assignment Incident");
  otherIncidentId = await activate("Separate ESF Incident");
  coordinatorGrantId = await grant(incidentId, "esf-partner", "esf-coordinator@example.org", "coordinator");
  targetGrantId = await grant(incidentId, "esf-target", "esf-target@example.org", "contributor");
  otherTargetGrantId = await grant(otherIncidentId, "esf-target", "esf-target@example.org", "contributor");
});

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("ESF stabilization assignment authority", () => {
  it("uses the external coordinator home organization and rejects a cross-incident target", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/esf-assessments`,
      headers: auth(partnerToken),
      payload: assessment(incidentId, targetGrantId),
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      attribution: {
        participationId: coordinatorGrantId,
        homeOrganizationId: partnerId,
      },
      payload: {
        actions: [{
          assignment: {
            kind: "incident_participant",
            incidentId,
            participantId: targetGrantId,
            organizationId: targetId,
            authority: "incident_coordinator",
            actorParticipationId: coordinatorGrantId,
          },
        }],
      },
    });

    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/esf-assessments`,
      headers: auth(partnerToken),
      payload: assessment(otherIncidentId, otherTargetGrantId),
    });
    expect(rejected.statusCode, rejected.body).toBe(400);
    expect(rejected.json().error).toContain("another incident");
    const [count] = await admin`
      select count(*)::int as value from operational_assessments
      where domain = 'esf' and incident_id = ${incidentId} and created_by = (
        select person_id from incident_participants where id = ${coordinatorGrantId})`;
    expect(count!.value).toBe(1);
  });
});
