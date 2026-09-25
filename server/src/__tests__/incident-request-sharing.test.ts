import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Requests on an incident are shared by every organization on it: the
 * owner's members and each active participant read every request attached to
 * the incident and its chronology, never its costs unless they own it, and
 * nothing outside the incident. The participant a request is assigned to
 * records its delivery steps and nothing else, and a partner contributor may
 * request from the incident's owner, who assigns it.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let ownerId: string;
let ownerAdminId: string;
let partnerId: string;
let otherPartnerId: string;
let contributorId: string;
let viewerId: string;
let incidentId: string;
let otherIncidentId: string;
let viewerGrantId: string;
const tokens: Record<string, string> = {};

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

const call = (who: string, method: "GET" | "POST", url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload } : {}) });

async function person(key: string, organization: string, role: "admin" | "member" | "viewer" = "member"): Promise<string> {
  const id = await createPerson(admin, { email: `${key}@example.org`, displayName: key, password: `${key}-password-long` });
  await addMembership(admin, id, organization, role);
  tokens[key] = await login(`${key}@example.org`, `${key}-password-long`);
  return id;
}

async function grant(personId: string, organization: string, role: "viewer" | "contributor" | "coordinator", title: string): Promise<string> {
  const [row] = await admin`
    insert into incident_participants
      (incident_id, organization_id, person_id, incident_position_title, role, expires_at, reason, created_by)
    values (${incidentId}, ${organization}, ${personId}, ${title}, ${role}, now() + interval '1 day', 'shared requests', ${ownerAdminId})
    returning id`;
  return row!.id as string;
}

let ownerRequest: string;
let partnerRequest: string;
let otherIncidentRequest: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  ownerId = seed.jurisdictionId;
  ownerAdminId = seed.adminId;
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  tokens.owner = await login("admin@example.org", "correct-horse-battery");
  partnerId = await createJurisdiction(admin, "shared-partner", "Shared Partner");
  otherPartnerId = await createJurisdiction(admin, "shared-other-partner", "Shared Other Partner");
  const outsiderOrg = await createJurisdiction(admin, "shared-outsider", "Shared Outsider");
  contributorId = await person("shared-contributor", partnerId);
  viewerId = await person("shared-viewer", otherPartnerId);
  await person("shared-outsider", outsiderOrg);
  const [incident] = await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by)
    values (${ownerId}, 'Shared Requests Incident', 'incident', ${ownerAdminId}) returning id`;
  incidentId = incident!.id as string;
  const [other] = await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by)
    values (${ownerId}, 'Another Incident', 'incident', ${ownerAdminId}) returning id`;
  otherIncidentId = other!.id as string;
  await grant(contributorId, partnerId, "contributor", "Utility liaison");
  viewerGrantId = await grant(viewerId, otherPartnerId, "viewer", "Observer");

  const generator = await call("owner", "POST", `/api/v1/jurisdictions/${ownerId}/resource-requests`,
    { origin: "eoc", item: "Generator", incidentId });
  expect(generator.statusCode, generator.body).toBe(201);
  ownerRequest = generator.json().id as string;
  const cost = await call("owner", "POST", `/api/v1/resource-requests/${ownerRequest}/costs`,
    { category: "equipment", amountCents: 50000 });
  expect(cost.statusCode, cost.body).toBe(201);
  partnerRequest = (await call("shared-contributor", "POST", `/api/v1/jurisdictions/${partnerId}/resource-requests`,
    { origin: "eoc", item: "Line crew", incidentId })).json().id as string;
  otherIncidentRequest = (await call("owner", "POST", `/api/v1/jurisdictions/${ownerId}/resource-requests`,
    { origin: "eoc", item: "Other incident pumps", incidentId: otherIncidentId })).json().id as string;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("requests shared across an incident's organizations", () => {
  it("lets every organization on the incident read every request on it, without another owner's costs", async () => {
    for (const who of ["owner", "shared-contributor", "shared-viewer"]) {
      const list = await call(who, "GET", `/api/v1/incidents/${incidentId}/resource-requests`);
      expect(list.statusCode, list.body).toBe(200);
      const ids = list.json().requests.map((request: { id: string }) => request.id);
      expect(ids.sort()).toEqual([ownerRequest, partnerRequest].sort());
      expect(ids).not.toContain(otherIncidentRequest);
    }
    const asViewer = (await call("shared-viewer", "GET", `/api/v1/incidents/${incidentId}/resource-requests`)).json().requests;
    expect(asViewer.find((request: { id: string }) => request.id === ownerRequest).costCents).toBeNull();
    const asOwner = (await call("owner", "GET", `/api/v1/incidents/${incidentId}/resource-requests`)).json().requests;
    expect(asOwner.find((request: { id: string }) => request.id === ownerRequest).costCents).toBe(50000);
    expect(asOwner.find((request: { id: string }) => request.id === partnerRequest).costCents).toBeNull();

    const detail = await call("shared-viewer", "GET", `/api/v1/resource-requests/${ownerRequest}`);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().chronology.map((entry: { toState: string }) => entry.toState)).toEqual(["submitted"]);
    expect((await call("shared-viewer", "GET", `/api/v1/resource-requests/${ownerRequest}/costs/export`)).statusCode).toBe(403);
    const costs = await withPerson(runtime, contributorId, (tx) => tx`select count(*)::int as n from rr_costs`);
    expect(costs[0]!.n).toBe(0);
  });

  it("keeps an outsider and another incident's requests out", async () => {
    expect((await call("shared-outsider", "GET", `/api/v1/incidents/${incidentId}/resource-requests`)).statusCode).toBe(404);
    expect((await call("shared-outsider", "GET", `/api/v1/resource-requests/${ownerRequest}`)).statusCode).toBe(404);
    expect((await call("shared-viewer", "GET", `/api/v1/resource-requests/${otherIncidentRequest}`)).statusCode).toBe(404);
    expect((await call("shared-viewer", "GET", `/api/v1/incidents/${otherIncidentId}/resource-requests`)).statusCode).toBe(404);
  });

  it("lets the partner the owner assigns record the delivery steps, and nothing else", async () => {
    await call("owner", "POST", `/api/v1/resource-requests/${ownerRequest}/transition`, { toState: "accepted" });
    await call("owner", "POST", `/api/v1/resource-requests/${ownerRequest}/transition`, { toState: "sourcing" });
    const [contributorGrant] = await admin`
      select id from incident_participants where incident_id = ${incidentId} and person_id = ${contributorId}`;
    const assigned = await call("owner", "POST", `/api/v1/resource-requests/${ownerRequest}/assign`,
      { kind: "incident_participant", incidentId, participantId: contributorGrant!.id as string });
    expect(assigned.statusCode, assigned.body).toBe(200);

    const skip = await call("shared-contributor", "POST", `/api/v1/resource-requests/${ownerRequest}/transition`, { toState: "cancelled" });
    expect(skip.statusCode).toBe(403);
    expect(skip.json().error).toBe("an assigned participant records only the delivery steps");
    const deployed = await call("shared-contributor", "POST", `/api/v1/resource-requests/${ownerRequest}/transition`,
      { toState: "deployed", note: "crew on site" });
    expect(deployed.statusCode, deployed.body).toBe(200);

    const detail = (await call("owner", "GET", `/api/v1/resource-requests/${ownerRequest}`)).json();
    expect(detail.state).toBe("deployed");
    expect(detail.chronology.at(-1)).toMatchObject({ toState: "deployed", note: "crew on site", by: "shared-contributor" });
    const [audit] = await admin`
      select jurisdiction_id, incident_id, person_id from audit_events
      where category = 'rr.transition' and subject_id = ${ownerRequest} and payload ->> 'to' = 'deployed'`;
    expect(audit).toMatchObject({ jurisdiction_id: ownerId, incident_id: incidentId, person_id: contributorId });

    // Straight to the database the partner changes no column, and the delivery
    // function takes only the next step from the current state.
    const edited = await withPerson(runtime, contributorId, (tx) =>
      tx`update resource_requests set item = 'Something else', state = 'closed' where id = ${ownerRequest} returning id`);
    expect(edited).toHaveLength(0);
    const skipped = await withPerson(runtime, contributorId, (tx) =>
      tx`select public.record_request_delivery(${ownerRequest}, 'closed', null) as state`);
    expect(skipped[0]!.state).toBeNull();
    const [unchanged] = await admin`select item, state from resource_requests where id = ${ownerRequest}`;
    expect(unchanged).toMatchObject({ item: "Generator", state: "deployed" });
    // The viewer and a request not assigned to the partner stay read-only.
    expect((await call("shared-viewer", "POST", `/api/v1/resource-requests/${ownerRequest}/transition`, { toState: "demobilizing" })).statusCode).toBe(403);
    const unassigned = (await call("owner", "POST", `/api/v1/jurisdictions/${ownerId}/resource-requests`,
      { origin: "eoc", item: "Sandbags", incidentId })).json().id as string;
    expect((await call("shared-contributor", "POST", `/api/v1/resource-requests/${unassigned}/transition`, { toState: "accepted" })).statusCode).toBe(403);
  });

  it("lets a partner contributor request from the incident's owner, who assigns it", async () => {
    const asked = await call("shared-contributor", "POST", `/api/v1/jurisdictions/${ownerId}/resource-requests`,
      { origin: "eoc", item: "Fuel delivery", incidentId, priority: "priority" });
    expect(asked.statusCode, asked.body).toBe(201);
    const id = asked.json().id as string;
    const [row] = await admin`select jurisdiction_id, receiving_organization_id, requested_by, state from resource_requests where id = ${id}`;
    expect(row).toMatchObject({ jurisdiction_id: ownerId, receiving_organization_id: ownerId, requested_by: contributorId, state: "submitted" });
    expect((await call("owner", "POST", `/api/v1/resource-requests/${id}/transition`, { toState: "accepted" })).statusCode).toBe(200);
    const detail = (await call("shared-contributor", "GET", `/api/v1/resource-requests/${id}`)).json();
    expect(detail.chronology.map((entry: { toState: string }) => entry.toState)).toEqual(["submitted", "accepted"]);
    const [notice] = await admin`
      select count(*)::int as n from notifications where person_id = ${contributorId} and jurisdiction_id = ${ownerId} and channel = 'resource'`;
    expect(notice!.n).toBe(2);

    // A viewer cannot request; nobody requests from an organization that does not own the incident.
    expect((await call("shared-viewer", "POST", `/api/v1/jurisdictions/${ownerId}/resource-requests`,
      { origin: "eoc", item: "Viewer ask", incidentId })).statusCode).toBe(403);
    expect((await call("shared-contributor", "POST", `/api/v1/jurisdictions/${otherPartnerId}/resource-requests`,
      { origin: "eoc", item: "Wrong organization", incidentId })).statusCode).toBe(403);
    expect((await call("shared-contributor", "POST", `/api/v1/jurisdictions/${ownerId}/resource-requests`,
      { origin: "eoc", item: "No incident" })).statusCode).toBe(403);
    expect((await call("shared-contributor", "POST", `/api/v1/jurisdictions/${ownerId}/resource-requests`,
      { origin: "eoc", item: "Typed ask", incidentId, resourceKind: "generator" })).statusCode).toBe(400);
    await expect(withPerson(runtime, contributorId, (tx) => tx`
      insert into resource_requests (jurisdiction_id, receiving_organization_id, incident_id, origin, item, state, requested_by)
      values (${ownerId}, ${ownerId}, ${incidentId}, 'eoc', 'Skipped triage', 'assigned', ${contributorId})`)).rejects.toThrow(/row-level security/);
    // The function sets every server-owned value; the caller names only the ask.
    await expect(withPerson(runtime, contributorId, (tx) => tx`
      select public.submit_participant_request(${incidentId}, 'Forged', 1, 'routine', null, null, 'escalated')`))
      .rejects.toThrow(/unsupported request origin/);
    const viaFunction = await withPerson(runtime, contributorId, (tx) => tx`
      select public.submit_participant_request(${incidentId}, 'Water', 2, 'routine', null, null, 'field') as id`);
    const [made] = await admin`
      select state, origin, source_peer, escalation_claimed_at, requested_by, created_at > now() - interval '1 minute' as fresh
      from resource_requests where id = ${viaFunction[0]!.id as string}`;
    expect(made).toMatchObject({ state: "submitted", origin: "field", source_peer: null, escalation_claimed_at: null, requested_by: contributorId, fresh: true });
    const viewerTry = await withPerson(runtime, viewerId, (tx) => tx`
      select public.submit_participant_request(${incidentId}, 'Viewer', 1, 'routine', null, null, 'eoc') as id`);
    expect(viewerTry[0]!.id).toBeNull();
  });

  it("lets an organization tag its own request only to an incident it works in", async () => {
    expect((await call("shared-contributor", "POST", `/api/v1/jurisdictions/${partnerId}/resource-requests`,
      { origin: "eoc", item: "Elsewhere", incidentId: otherIncidentId })).statusCode).toBe(404);
    await expect(withPerson(runtime, contributorId, (tx) => tx`
      insert into resource_requests (jurisdiction_id, receiving_organization_id, incident_id, origin, item, requested_by)
      values (${partnerId}, ${partnerId}, ${otherIncidentId}, 'eoc', 'Elsewhere', ${contributorId})`)).rejects.toThrow(/incident scope invalid/);
    await expect(withPerson(runtime, contributorId, (tx) => tx`
      update resource_requests set incident_id = ${otherIncidentId} where id = ${partnerRequest}`)).rejects.toThrow(/incident scope invalid/);
    // Standing on the incident counts only for the organization the grant is for.
    const secondOrg = await createJurisdiction(admin, "shared-second-home", "Shared Second Home");
    await addMembership(admin, contributorId, secondOrg, "member");
    await expect(withPerson(runtime, contributorId, (tx) => tx`
      insert into resource_requests (jurisdiction_id, receiving_organization_id, incident_id, origin, item, requested_by)
      values (${secondOrg}, ${secondOrg}, ${incidentId}, 'eoc', 'Other hat', ${contributorId})`)).rejects.toThrow(/incident scope invalid/);
    // An update that leaves the tag alone is not refused.
    const renamed = await withPerson(runtime, contributorId, (tx) => tx`
      update resource_requests set notes = 'crew of four' where id = ${partnerRequest} returning id`);
    expect(renamed).toHaveLength(1);
    expect((await call("shared-contributor", "POST", `/api/v1/jurisdictions/${ownerId}/resource-requests`,
      { origin: "eoc", item: "Loud ask", incidentId, priority: "drop everything" })).statusCode).toBe(400);
  });

  it("ends a partner's access on revocation and expiry, and its writes once the incident closes", async () => {
    const revoked = await call("owner", "POST", `/api/v1/incidents/${incidentId}/participants/${viewerGrantId}/revoke`,
      { reason: "Observer rotated off the incident" });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect((await call("shared-viewer", "GET", `/api/v1/incidents/${incidentId}/resource-requests`)).statusCode).toBe(404);
    expect((await call("shared-viewer", "GET", `/api/v1/resource-requests/${ownerRequest}`)).statusCode).toBe(404);

    // Grants change only by revocation, so expiry is proven on a grant that lapses on its own.
    const expiringId = await person("shared-expiring", partnerId);
    await admin`
      insert into incident_participants
        (incident_id, organization_id, person_id, incident_position_title, role, expires_at, reason, created_by)
      values (${incidentId}, ${partnerId}, ${expiringId}, 'Short shift', 'viewer', now() + interval '2 seconds', 'expiry', ${ownerAdminId})`;
    expect((await call("shared-expiring", "GET", `/api/v1/resource-requests/${ownerRequest}`)).statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect((await call("shared-expiring", "GET", `/api/v1/resource-requests/${ownerRequest}`)).statusCode).toBe(404);
    expect((await call("shared-expiring", "GET", `/api/v1/incidents/${incidentId}/resource-requests`)).statusCode).toBe(404);

    await admin`update incidents set closed_at = now(), closed_by = ${ownerAdminId} where id = ${incidentId}`;
    const closed = await call("shared-contributor", "POST", `/api/v1/resource-requests/${ownerRequest}/transition`, { toState: "fulfilled" });
    expect(closed.statusCode).toBe(409);
    expect((await call("shared-contributor", "POST", `/api/v1/jurisdictions/${ownerId}/resource-requests`,
      { origin: "eoc", item: "After close", incidentId })).statusCode).toBe(409);
    expect((await call("shared-contributor", "GET", `/api/v1/resource-requests/${ownerRequest}`)).statusCode).toBe(200);
  });
});
