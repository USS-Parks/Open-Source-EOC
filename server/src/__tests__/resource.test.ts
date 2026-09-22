import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson, principalForPerson, type Principal } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { escalate, type EscalationPayload } from "../resource/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The 213RR resource lifecycle (VEOC-35, F5). A request moves through the
 * guarded NIMS states with a full chronology and per-change notifications; a
 * request escalates field-to-state over a peer token and the upper tier
 * reports fulfillment back; and costs export for reimbursement.
 */

interface Instance {
  admin: Sql;
  runtime: Sql;
  app: FastifyInstance;
  jurisdictionId: string;
  adminId: string;
  adminToken: string;
  principal: Principal;
}

async function standUp(): Promise<Instance> {
  const { admin, runtime } = await freshDb();
  const seed = await seedIdentity(admin);
  const app = buildApp(runtime, { oidc: null });
  await app.ready();
  const adminToken = (
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@example.org", password: "correct-horse-battery" },
    })
  ).json().accessToken as string;
  const principal = await principalForPerson(runtime, seed.adminId);
  return {
    admin,
    runtime,
    app,
    jurisdictionId: seed.jurisdictionId,
    adminId: seed.adminId,
    adminToken,
    principal,
  };
}

let county: Instance;
let state: Instance;

function post(inst: Instance, url: string, payload?: Record<string, unknown>) {
  return inst.app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${inst.adminToken}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}
function get(inst: Instance, url: string) {
  return inst.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${inst.adminToken}` } });
}
async function registerPeer(inst: Instance, name: string): Promise<string> {
  const res = await post(inst, `/api/v1/jurisdictions/${inst.jurisdictionId}/peers`, { name });
  return res.json().token as string;
}

beforeAll(async () => {
  county = await standUp();
  state = await standUp();
}, 60000);

afterAll(async () => {
  for (const inst of [county, state]) {
    if (!inst) continue;
    await inst.app.close();
    await inst.runtime.end();
    await inst.admin.end();
  }
});

describe("single-instance lifecycle", () => {
  it("walks the ordering cycle, rejects skips, and logs the chronology", async () => {
    const submit = await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/resource-requests`, {
      origin: "eoc",
      item: "Type 3 Engine",
      quantity: 2,
      priority: "priority",
    });
    expect(submit.statusCode).toBe(201);
    const id = submit.json().id as string;

    await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "triaged" });
    await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "sourcing" });

    // A skip is refused by the state machine.
    const skip = await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "closed" });
    expect(skip.statusCode).toBe(409);

    const position = (
      await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/positions`, {
        key: "logistics_section_chief",
        title: "Logistics Section Chief",
      })
    ).json().id as string;
    const assigned = await post(county, `/api/v1/resource-requests/${id}/assign`, { positionId: position });
    expect(assigned.json().state).toBe("assigned");

    await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "deployed" });
    await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "demobilizing" });
    await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "closed" });

    const detail = (await get(county, `/api/v1/resource-requests/${id}`)).json();
    expect(detail.state).toBe("closed");
    expect(detail.chronology.map((e: { toState: string }) => e.toState)).toEqual([
      "submitted",
      "triaged",
      "sourcing",
      "assigned",
      "deployed",
      "demobilizing",
      "closed",
    ]);

    // Every state change left a notification.
    const notes = await county.admin`
      select count(*)::int as n from notifications where channel = 'resource'`;
    expect(notes[0]!.n).toBeGreaterThanOrEqual(7);
  });
});

describe("D22 assignment and organization projection", () => {
  it("persists a named incident participant supplier and exposes both organizations", async () => {
    const partnerId = await createJurisdiction(county.admin, "resource-partner", "Resource Partner");
    const partnerPersonId = await createPerson(county.admin, {
      email: "resource-partner@example.org", displayName: "Resource Partner", password: "resource-partner-password",
    });
    await addMembership(county.admin, partnerPersonId, partnerId, "member");
    const [incident] = await county.admin`
      insert into incidents (jurisdiction_id, name, kind, activated_by)
      values (${county.jurisdictionId}, 'D22 Resource Incident', 'incident', ${county.adminId}) returning id`;
    const [participant] = await county.admin`
      insert into incident_participants
        (incident_id, organization_id, person_id, incident_position_title, role, expires_at, reason, created_by)
      values (${incident!.id as string}, ${partnerId}, ${partnerPersonId}, 'Mutual Aid Logistics',
        'contributor', now() + interval '1 day', 'D22 assigned supplier', ${county.adminId}) returning id`;
    const submitted = await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/resource-requests`, {
      origin: "eoc", item: "Portable water tender", quantity: 2, priority: "immediate", incidentId: incident!.id as string,
    });
    expect(submitted.statusCode).toBe(201);
    const id = submitted.json().id as string;
    await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "triaged" });
    await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "sourcing" });
    const assigned = await post(county, `/api/v1/resource-requests/${id}/assign`, {
      kind: "incident_participant", incidentId: incident!.id as string, participantId: participant!.id as string,
    });
    expect(assigned.statusCode).toBe(200);
    const detail = (await get(county, `/api/v1/resource-requests/${id}`)).json();
    expect(detail).toMatchObject({
      state: "assigned",
      receivingOrganization: { id: county.jurisdictionId },
      supplyingOrganization: { id: partnerId, name: "Resource Partner" },
      assignment: { kind: "incident_participant", participantId: participant!.id as string,
        personName: "Resource Partner", incidentPositionTitle: "Mutual Aid Logistics" },
    });
    expect(detail.chronology.at(-1)).toMatchObject({ toState: "assigned", note: "assigned to Mutual Aid Logistics" });
  });
});

describe("D22 partner-owned incident requests", () => {
  it("allows an active partner contributor to create, progress and assign its own incident-linked request", async () => {
    const partnerId = await createJurisdiction(county.admin, "d22-owning-partner", "D22 Owning Partner");
    const partnerPersonId = await createPerson(county.admin, {
      email: "d22-owning-partner@example.org", displayName: "D22 Owning Partner", password: "d22-owning-password",
    });
    await addMembership(county.admin, partnerPersonId, partnerId, "member");
    const unrelatedJurisdictionId = await createJurisdiction(county.admin, "d22-unrelated-writer", "D22 Unrelated Writer");
    await addMembership(county.admin, partnerPersonId, unrelatedJurisdictionId, "member");
    const [incident] = await county.admin`
      insert into incidents (jurisdiction_id, name, kind, activated_by)
      values (${county.jurisdictionId}, 'D22 Partner Resource Incident', 'incident', ${county.adminId}) returning id`;
    const incidentId = incident!.id as string;
    await county.admin`
      insert into incident_participants
        (incident_id, organization_id, person_id, incident_position_title, role, expires_at, reason, created_by)
      values (${incidentId}, ${partnerId}, ${partnerPersonId}, 'Partner Logistics',
        'contributor', now() + interval '1 day', 'D22 partner-owned request', ${county.adminId})`;
    const [position] = await county.admin`
      insert into positions (jurisdiction_id, key, title)
      values (${partnerId}, 'd22_partner_logistics', 'D22 Partner Logistics') returning id`;
    const partnerLogin = await county.app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: "d22-owning-partner@example.org", password: "d22-owning-password" },
    });
    expect(partnerLogin.statusCode, partnerLogin.body).toBe(200);
    const partnerHeaders = { authorization: `Bearer ${partnerLogin.json().accessToken as string}` };
    const partnerPost = (url: string, payload: Record<string, unknown>) => county.app.inject({
      method: "POST", url, headers: partnerHeaders, payload,
    });
    const unrelated = await partnerPost(`/api/v1/jurisdictions/${unrelatedJurisdictionId}/resource-requests`, {
      origin: "eoc", item: "Unrelated-jurisdiction request", incidentId,
    });
    expect(unrelated.statusCode, unrelated.body).toBe(403);
    expect(unrelated.json().error).toBe("incident authority does not cover this receiving organization");
    const submitted = await partnerPost(`/api/v1/jurisdictions/${partnerId}/resource-requests`, {
      origin: "eoc", item: "Partner-owned water tender", incidentId,
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    const requestId = submitted.json().id as string;
    expect((await partnerPost(`/api/v1/resource-requests/${requestId}/transition`, { toState: "triaged" })).statusCode).toBe(200);
    expect((await partnerPost(`/api/v1/resource-requests/${requestId}/transition`, { toState: "sourcing" })).statusCode).toBe(200);
    const assigned = await partnerPost(`/api/v1/resource-requests/${requestId}/assign`, { positionId: position!.id as string });
    expect(assigned.statusCode, assigned.body).toBe(200);
    await county.admin`update incidents set closed_at = now(), closed_by = ${county.adminId} where id = ${incidentId}`;
    const closed = await partnerPost(`/api/v1/resource-requests/${requestId}/transition`, { toState: "deployed" });
    expect(closed.statusCode, closed.body).toBe(409);
    expect(closed.json().error).toBe("incident is closed");
  });
});

describe("D22 closed incident resource mutations", () => {
  it("rejects incident-scoped creation, transition and assignment after closeout", async () => {
    const [incident] = await county.admin`
      insert into incidents (jurisdiction_id, name, kind, activated_by)
      values (${county.jurisdictionId}, 'D22 Closed Resource Incident', 'incident', ${county.adminId}) returning id`;
    const incidentId = incident!.id as string;
    const submitted = await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/resource-requests`, {
      origin: "eoc", item: "Closed incident generator", incidentId,
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    const requestId = submitted.json().id as string;
    const position = await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/positions`, {
      key: "d22_closed_logistics", title: "D22 Closed Logistics",
    });
    expect(position.statusCode, position.body).toBe(201);
    await county.admin`update incidents set closed_at = now(), closed_by = ${county.adminId} where id = ${incidentId}`;

    const rejectedCreate = await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/resource-requests`, {
      origin: "eoc", item: "Rejected after close", incidentId,
    });
    const rejectedTransition = await post(county, `/api/v1/resource-requests/${requestId}/transition`, { toState: "triaged" });
    const rejectedAssignment = await post(county, `/api/v1/resource-requests/${requestId}/assign`, {
      positionId: position.json().id as string,
    });
    for (const response of [rejectedCreate, rejectedTransition, rejectedAssignment]) {
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toBe("incident is closed");
    }
    const [stored] = await county.admin`select state, assigned_position from resource_requests where id = ${requestId}`;
    expect(stored).toMatchObject({ state: "submitted", assigned_position: null });
  });
});

describe("cross-tier escalation, field to state and back", () => {
  it("escalates over a peer token and the upper tier reports fulfillment back", async () => {
    // state registers county so county can push up; county registers state so
    // state can report back down.
    const tokenIntoState = await registerPeer(state, "county");
    const tokenIntoCounty = await registerPeer(county, "state");

    // County submits and works it to sourcing, then cannot fill locally.
    const countyReqId = (
      await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/resource-requests`, {
        origin: "field",
        item: "Swiftwater Rescue Team",
        quantity: 1,
        priority: "immediate",
      })
    ).json().id as string;
    await post(county, `/api/v1/resource-requests/${countyReqId}/transition`, { toState: "triaged" });
    await post(county, `/api/v1/resource-requests/${countyReqId}/transition`, { toState: "sourcing" });

    // Escalate up to the state tier (delivery injected into the state app).
    let stateReqId = "";
    const deliver = async (payload: EscalationPayload): Promise<void> => {
      const res = await state.app.inject({
        method: "POST",
        url: "/api/v1/resource-requests/receive",
        headers: { "x-peer-token": tokenIntoState },
        payload,
      });
      expect(res.statusCode).toBe(201);
      stateReqId = res.json().id as string;
    };
    await withPerson(county.runtime, county.adminId, (tx) =>
      escalate(tx, county.principal, countyReqId, "state", deliver),
    );
    expect(stateReqId).not.toBe("");

    // The state tier works the escalated request.
    await post(state, `/api/v1/resource-requests/${stateReqId}/transition`, { toState: "triaged" });
    await post(state, `/api/v1/resource-requests/${stateReqId}/transition`, { toState: "sourcing" });
    const statePosition = (
      await post(state, `/api/v1/jurisdictions/${state.jurisdictionId}/positions`, {
        key: "operations_section_chief",
        title: "Operations Section Chief",
      })
    ).json().id as string;
    await post(state, `/api/v1/resource-requests/${stateReqId}/assign`, { kind: "position", positionId: statePosition });
    await post(state, `/api/v1/resource-requests/${stateReqId}/transition`, { toState: "deployed" });

    // State reports fulfillment back down to the county's originating request.
    for (const toState of ["assigned", "deployed"]) {
      // The state tier delivers its report down to the county's app, using
      // the token county issued it.
      const res = await county.app.inject({
        method: "POST",
        url: "/api/v1/resource-requests/report",
        headers: { "x-peer-token": tokenIntoCounty },
        payload: { sourceRequestId: countyReqId, toState, note: "state task force en route" },
      });
      expect(res.statusCode).toBe(200);
    }

    // The county request has advanced and its chronology tells the whole story.
    const countyDetail = (await get(county, `/api/v1/resource-requests/${countyReqId}`)).json();
    expect(countyDetail.state).toBe("deployed");
    const notes = countyDetail.chronology.map((e: { note: string | null }) => e.note ?? "");
    expect(notes.some((n: string) => n.includes("escalated to state"))).toBe(true);
    expect(notes.some((n: string) => n.includes("state reported deployed"))).toBe(true);

    // The state-side request records where it came from.
    const [stateRow] = await state.admin`
      select source_peer, source_request_id from resource_requests where id = ${stateReqId}`;
    expect(stateRow!.source_peer).toBe("county");
    expect(stateRow!.source_request_id).toBe(countyReqId);
  });
});

describe("cost export for reimbursement", () => {
  it("exports a CSV with a total", async () => {
    const id = (
      await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/resource-requests`, {
        origin: "eoc",
        item: "Generator, 100kW",
      })
    ).json().id as string;
    await post(county, `/api/v1/resource-requests/${id}/costs`, {
      category: "equipment",
      description: "72 hours",
      amountCents: 540000,
      incurredAt: "2026-09-18",
    });
    await post(county, `/api/v1/resource-requests/${id}/costs`, {
      category: "fuel",
      amountCents: 96050,
      incurredAt: "2026-09-18",
    });
    const res = await get(county, `/api/v1/resource-requests/${id}/costs/export`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("Amount (USD)");
    expect(res.body).toContain("5400.00");
    expect(res.body).toContain("TOTAL,6360.50");
  });
});
