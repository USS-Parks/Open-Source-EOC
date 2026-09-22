import type { FastifyInstance } from "fastify";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let hostId: string;
let partnerId: string;
let supportId: string;
let adminId: string;
let memberId: string;
let adminToken: string;
let partnerToken: string;
let outsiderToken: string;
let incidentA: string;
let incidentB: string;
let partnerGrantId: string;
let targetGrantId: string;
let viewerGrantId: string;
let expiredGrantId: string;
let localSupervisorPositionId: string;
let revisionOneId: string;
let revisionTwoId: string;
let authorityDraftId: string;
let revisionOnePdf: Buffer;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function api(
  token: string,
  method: "GET" | "POST" | "PUT",
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
    method: "POST", url: "/api/v1/auth/login", payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}

async function activate(name: string): Promise<string> {
  const response = await api(adminToken, "POST", `/api/v1/jurisdictions/${hostId}/incidents`, {
    templateKey: "wildfire", name,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().incidentId as string;
}

async function grant(
  incidentId: string,
  organizationSlug: string,
  personEmail: string,
  title: string,
  role: "viewer" | "contributor" | "coordinator",
  expiresAt = new Date(Date.now() + 60_000).toISOString(),
): Promise<string> {
  const response = await api(adminToken, "POST", `/api/v1/incidents/${incidentId}/participants`, {
    organizationSlug,
    personEmail,
    incidentPositionTitle: title,
    role,
    expiresAt,
    reason: "84A ICS-204 authority evidence",
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().participant.id as string;
}

async function createPlan(token = partnerToken): Promise<string> {
  const response = await api(token, "POST", `/api/v1/incidents/${incidentA}/iap`, {
    operationalPeriod: "OP 1",
    formIds: ["ICS-202", "ICS-204"],
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

function resource(name: string) {
  return {
    name,
    identifier: `${name}-01`,
    leader: `${name} Leader`,
    quantity: "2",
    notes: `${name} staged at Division Alpha`,
  };
}

function participantAssignment(participantId: string, incidentId = incidentA) {
  return {
    name: "Division Alpha",
    supervisor: { kind: "incident_participant", incidentId, participantId },
    tactics: [
      "LONG-TACTIC-START establish structure protection along the eastern flank",
      ...Array.from({ length: 70 }, (_, index) =>
        `Tactic ${String(index + 1).padStart(2, "0")}: patrol the assigned sector and report changing conditions.`),
      "LONG-TACTIC-END coordinate relief before the end of the operational period",
    ],
    resources: [resource("Type 3 Engine"), resource("Water Tender")],
  };
}

function localAssignment() {
  return {
    name: "Division Bravo",
    supervisor: { kind: "position", positionId: localSupervisorPositionId },
    tactics: ["Hold the western line", "Coordinate the revised contingency group"],
    resources: [resource("Hand Crew")],
  };
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  hostId = await createJurisdiction(admin, "ics204-host", "ICS-204 Host EOC");
  partnerId = await createJurisdiction(admin, "ics204-partner", "Planning Mutual Aid");
  supportId = await createJurisdiction(admin, "ics204-support", "Supporting Agency");
  const outsiderOrg = await createJurisdiction(admin, "ics204-outsider", "Unrelated Agency");
  adminId = await createPerson(admin, {
    email: "ics204-admin@example.org", displayName: "Planning Admin", password: "ics204-admin-password",
  });
  memberId = await createPerson(admin, {
    email: "ics204-member@example.org", displayName: "Division Supervisor", password: "ics204-member-password",
  });
  const partnerPerson = await createPerson(admin, {
    email: "ics204-partner@example.org", displayName: "Partner Coordinator", password: "ics204-partner-password",
  });
  const targetPerson = await createPerson(admin, {
    email: "ics204-target@example.org", displayName: "Named Mutual Aid Supervisor", password: "ics204-target-password",
  });
  const viewerPerson = await createPerson(admin, {
    email: "ics204-viewer@example.org", displayName: "Viewer Only", password: "ics204-viewer-password",
  });
  const expiredPerson = await createPerson(admin, {
    email: "ics204-expired@example.org", displayName: "Expired Supervisor", password: "ics204-expired-password",
  });
  const outsiderPerson = await createPerson(admin, {
    email: "ics204-outsider@example.org", displayName: "Unrelated User", password: "ics204-outsider-password",
  });
  await addMembership(admin, adminId, hostId, "admin");
  await addMembership(admin, memberId, hostId, "member");
  await addMembership(admin, partnerPerson, partnerId, "viewer");
  await addMembership(admin, targetPerson, supportId, "viewer");
  await addMembership(admin, viewerPerson, supportId, "viewer");
  await addMembership(admin, expiredPerson, supportId, "viewer");
  await addMembership(admin, outsiderPerson, outsiderOrg, "viewer");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = await login("ics204-admin@example.org", "ics204-admin-password");
  partnerToken = await login("ics204-partner@example.org", "ics204-partner-password");
  outsiderToken = await login("ics204-outsider@example.org", "ics204-outsider-password");
  incidentA = await activate("ICS-204 Alpha Incident");
  incidentB = await activate("ICS-204 Bravo Incident");
  const detail = (await api(adminToken, "GET", `/api/v1/incidents/${incidentA}`)).json();
  localSupervisorPositionId = detail.positions.find((position: { key: string }) =>
    position.key === "operations_section_chief").id as string;
  expect((await api(adminToken, "POST",
    `/api/v1/positions/${localSupervisorPositionId}/assignments`, { personId: memberId })).statusCode).toBe(201);

  partnerGrantId = await grant(
    incidentA, "ics204-partner", "ics204-partner@example.org", "Partner Planning Coordinator", "coordinator",
  );
  targetGrantId = await grant(
    incidentA, "ics204-support", "ics204-target@example.org", "Mutual Aid Division Supervisor", "contributor",
  );
  viewerGrantId = await grant(
    incidentA, "ics204-support", "ics204-viewer@example.org", "Observer", "viewer",
  );
  expiredGrantId = await grant(
    incidentA, "ics204-support", "ics204-expired@example.org", "Temporary Supervisor", "contributor",
    new Date(Date.now() + 1_000).toISOString(),
  );
  await grant(
    incidentB, "ics204-support", "ics204-target@example.org", "Other Incident Supervisor", "contributor",
  );
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("editable ICS-204 assignments", () => {
  it("authors a partner-owned draft with named cross-organization authority and CAS", async () => {
    revisionOneId = await createPlan();
    const first = await api(partnerToken, "PUT", `/api/v1/iap/${revisionOneId}/ics-204`, {
      expectedContentRevision: 1,
      assignments: [participantAssignment(targetGrantId)],
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().contentRevision).toBe(2);
    const unchanged = await api(partnerToken, "PUT", `/api/v1/iap/${revisionOneId}/ics-204`, {
      expectedContentRevision: 2,
      assignments: [{ ...participantAssignment(targetGrantId), id: first.json().assignments[0].id }],
    });
    expect(unchanged.statusCode, unchanged.body).toBe(200);
    expect(unchanged.json().contentRevision).toBe(2);
    expect(first.json().assignments[0].supervisor).toMatchObject({
      kind: "incident_participant",
      participantId: targetGrantId,
      personName: "Named Mutual Aid Supervisor",
      organizationName: "Supporting Agency",
      participantRole: "contributor",
      authority: "incident_coordinator",
      actorParticipationId: partnerGrantId,
    });
    expect((await api(partnerToken, "PUT", `/api/v1/iap/${revisionOneId}/ics-204`, {
      expectedContentRevision: 1,
      assignments: [participantAssignment(targetGrantId)],
    })).statusCode).toBe(409);
    expect((await api(outsiderToken, "PUT", `/api/v1/iap/${revisionOneId}/ics-204`, {
      expectedContentRevision: 2,
      assignments: [participantAssignment(targetGrantId)],
    })).statusCode).toBe(404);
    const competingDraft = await createPlan();
    const competing = await Promise.all([
      api(partnerToken, "PUT", `/api/v1/iap/${competingDraft}/ics-204`, {
        expectedContentRevision: 1,
        assignments: [participantAssignment(targetGrantId)],
      }),
      api(partnerToken, "PUT", `/api/v1/iap/${competingDraft}/ics-204`, {
        expectedContentRevision: 1,
        assignments: [participantAssignment(targetGrantId)],
      }),
    ]);
    expect(competing.map((response) => response.statusCode).sort()).toEqual([200, 409]);
  });

  it("resolves host edits of partner drafts against the acting host authority", async () => {
    const draftId = await createPlan();
    const local = await api(adminToken, "PUT", `/api/v1/iap/${draftId}/ics-204`, {
      expectedContentRevision: 1,
      assignments: [localAssignment()],
    });
    expect(local.statusCode, local.body).toBe(200);
    expect(local.json().assignments[0].supervisor).toMatchObject({
      organizationId: hostId, personId: memberId, authority: "local_writer",
    });
    const external = await api(adminToken, "PUT", `/api/v1/iap/${draftId}/ics-204`, {
      expectedContentRevision: 2,
      assignments: [participantAssignment(targetGrantId)],
    });
    expect(external.statusCode, external.body).toBe(200);
    expect(external.json().assignments[0].supervisor).toMatchObject({
      participantId: targetGrantId, authority: "incident_owner_admin",
      actorParticipationId: null,
    });
    const [draft] = await admin`select prepared_organization_id from iaps where id = ${draftId}`;
    expect(draft!.prepared_organization_id).toBe(partnerId);
  });

  it("rejects viewer, expired, revoked, and other-incident assignment targets", async () => {
    authorityDraftId = await createPlan();
    expect((await api(partnerToken, "PUT", `/api/v1/iap/${authorityDraftId}/ics-204`, {
      expectedContentRevision: 1,
      assignments: [participantAssignment(viewerGrantId)],
    })).statusCode).toBe(403);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect((await api(partnerToken, "PUT", `/api/v1/iap/${authorityDraftId}/ics-204`, {
      expectedContentRevision: 1,
      assignments: [participantAssignment(expiredGrantId)],
    })).statusCode).toBe(404);
    expect((await api(partnerToken, "PUT", `/api/v1/iap/${authorityDraftId}/ics-204`, {
      expectedContentRevision: 1,
      assignments: [participantAssignment(targetGrantId, incidentB)],
    })).statusCode).toBe(400);
    expect((await api(adminToken, "POST",
      `/api/v1/incidents/${incidentA}/participants/${targetGrantId}/revoke`, {
        reason: "Supervisor assignment ended",
      })).statusCode).toBe(200);
    expect((await api(partnerToken, "PUT", `/api/v1/iap/${authorityDraftId}/ics-204`, {
      expectedContentRevision: 1,
      assignments: [participantAssignment(targetGrantId)],
    })).statusCode).toBe(404);
  });

  it("freezes approved revision one and creates a new draft revision from its exact snapshot", async () => {
    expect((await api(partnerToken, "POST", `/api/v1/iap/${revisionOneId}/submit`)).statusCode).toBe(200);
    expect((await api(adminToken, "POST", `/api/v1/iap/${revisionOneId}/approve`)).statusCode).toBe(200);
    expect((await api(partnerToken, "PUT", `/api/v1/iap/${revisionOneId}/ics-204`, {
      expectedContentRevision: 2,
      assignments: [localAssignment()],
    })).statusCode).toBe(409);
    const before = await api(adminToken, "GET", `/api/v1/iap/${revisionOneId}/revisions/1/pdf`);
    expect(before.statusCode).toBe(200);
    revisionOnePdf = before.rawPayload;
    const text = revisionOnePdf.toString("latin1");
    expect(text).toContain("Named Mutual Aid Supervisor");
    expect(text).toContain(targetGrantId);
    expect(text).toContain("Type 3 Engine");
    expect(text).toContain("LONG-TACTIC-START");
    expect(text).toContain("LONG-TACTIC-END");
    expect(text).toMatch(/\/Count [2-9]/);
    const pdfPath = process.env.OPENEOC_84A_PDF_PATH;
    if (pdfPath) {
      await mkdir(dirname(pdfPath), { recursive: true });
      await writeFile(pdfPath, revisionOnePdf);
    }

    const revision = await api(adminToken, "POST", `/api/v1/iap/${revisionOneId}/revisions`, {
      assignments: [localAssignment()],
    });
    expect(revision.statusCode, revision.body).toBe(201);
    expect(revision.json()).toMatchObject({ revisionNumber: 2, contentRevision: 1 });
    revisionTwoId = revision.json().id as string;
    await expect(withPerson(runtime, adminId, (tx) =>
      tx`update iaps set operational_period = 'rewritten period' where id = ${revisionTwoId}`,
    )).rejects.toThrow(/period binding is immutable/);
    const unchanged = await api(adminToken, "GET", `/api/v1/iap/${revisionTwoId}/revisions/1/pdf`);
    expect(unchanged.rawPayload.equals(revisionOnePdf)).toBe(true);
    const revisionTwo = await api(adminToken, "GET", `/api/v1/iap/${revisionTwoId}/revisions/2/pdf`);
    const revisionTwoText = revisionTwo.rawPayload.toString("latin1");
    expect(revisionTwoText).toContain("Division Supervisor");
    expect(revisionTwoText).toContain("Hand Crew");
    expect(revisionTwoText).not.toContain("Named Mutual Aid Supervisor");
    expect(revisionTwoText).not.toContain("Type 3 Engine");
  });

  it("serializes successor creation and lists the immutable lineage", async () => {
    expect((await api(adminToken, "POST", `/api/v1/iap/${revisionTwoId}/approve`)).statusCode).toBe(200);
    const attempts = await Promise.all([
      api(adminToken, "POST", `/api/v1/iap/${revisionTwoId}/revisions`, {
        assignments: [localAssignment()],
      }),
      api(adminToken, "POST", `/api/v1/iap/${revisionTwoId}/revisions`, {
        assignments: [localAssignment()],
      }),
    ]);
    expect(attempts.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const lineage = await api(adminToken, "GET", `/api/v1/iap/${revisionOneId}/revisions`);
    expect(lineage.statusCode).toBe(200);
    expect(lineage.json().revisions.map((revision: { revisionNumber: number }) =>
      revision.revisionNumber)).toEqual([1, 2, 3]);
    const fetchedOne = (await api(adminToken, "GET", `/api/v1/iap/${revisionOneId}`)).json();
    expect(fetchedOne.content.ics204Assignments[0].supervisor.participantId).toBe(targetGrantId);
    const [resourceRequests] = await admin`select count(*)::int as count from resource_requests`;
    expect(resourceRequests!.count).toBe(0);
  });
});
