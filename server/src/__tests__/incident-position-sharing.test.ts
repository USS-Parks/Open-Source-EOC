import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The incident's positions are shared with every organization on the
 * incident, with their current holders; the rest of the owner's roster is
 * not. A partner's record names its author's incident position and
 * organization to the owner.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let ownerId: string;
let ownerAdminId: string;
let incidentId: string;
let viewerId: string;
let outsiderId: string;
let logisticsId: string;
let viewerGrantId: string;
const tokens: Record<string, string> = {};

const call = (who: string, method: "GET" | "POST", url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload } : {}) });

async function login(key: string, email: string, password: string): Promise<void> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(response.statusCode, response.body).toBe(200);
  tokens[key] = response.json().accessToken as string;
}

async function person(key: string, organization: string): Promise<string> {
  const id = await createPerson(admin, { email: `${key}@example.org`, displayName: key, password: `${key}-password-long` });
  await addMembership(admin, id, organization, "member");
  await login(key, `${key}@example.org`, `${key}-password-long`);
  return id;
}

async function grant(slug: string, email: string, role: string, title: string): Promise<string> {
  const response = await call("owner", "POST", `/api/v1/incidents/${incidentId}/participants`, {
    organizationSlug: slug, personEmail: email, incidentPositionTitle: title, role,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(), reason: "incident positions",
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().participant.id as string;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  ownerId = seed.jurisdictionId;
  ownerAdminId = seed.adminId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  await login("owner", "admin@example.org", "correct-horse-battery");
  const partnerId = await createJurisdiction(admin, "position-partner", "Position Partner Utility");
  const outsiderOrg = await createJurisdiction(admin, "position-outsider", "Position Outsider");
  await person("position-contributor", partnerId);
  viewerId = await person("position-viewer", partnerId);
  outsiderId = await person("position-outsider", outsiderOrg);

  const activated = await call("owner", "POST", `/api/v1/jurisdictions/${ownerId}/incidents`, { templateKey: "wildfire", name: "Positions Incident" });
  expect(activated.statusCode, activated.body).toBe(201);
  incidentId = activated.json().incidentId as string;
  const [logistics] = await admin`select id from positions where jurisdiction_id = ${ownerId} and key = 'logistics_section_chief'`;
  logisticsId = logistics!.id as string;
  expect((await call("owner", "POST", `/api/v1/positions/${logisticsId}/assignments`, { personId: ownerAdminId })).statusCode).toBeLessThan(300);
  expect((await call("owner", "POST", `/api/v1/jurisdictions/${ownerId}/positions`, { key: "finance_clerk", title: "Finance Clerk" })).statusCode).toBeLessThan(300);
  await grant("position-partner", "position-contributor@example.org", "contributor", "Utility liaison");
  viewerGrantId = await grant("position-partner", "position-viewer@example.org", "viewer", "Utility observer");
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("incident positions shared across organizations", () => {
  it("shows a partner the incident's positions and their holders, and not the rest of the roster", async () => {
    const incident = await call("position-viewer", "GET", `/api/v1/incidents/${incidentId}`);
    expect(incident.statusCode, incident.body).toBe(200);
    const titles = incident.json().positions.map((position: { title: string }) => position.title);
    expect(titles).toContain("Logistics Section Chief");
    expect(titles).not.toContain("Finance Clerk");

    const visible = await withPerson(runtime, viewerId, (tx) => tx`
      select p.title, holder.display_name from positions p
      left join position_assignments pa on pa.position_id = p.id
      left join persons holder on holder.id = pa.person_id
      where p.jurisdiction_id = ${ownerId}`);
    expect(visible.map((row) => row.title)).not.toContain("Finance Clerk");
    expect(visible.find((row) => row.title === "Logistics Section Chief")?.display_name).toBe("Admin");
    const outside = await withPerson(runtime, outsiderId, (tx) => tx`select count(*)::int as n from positions where jurisdiction_id = ${ownerId}`);
    expect(outside[0]!.n).toBe(0);
  });

  it("names a position owner's title and holders on the partner's task list", async () => {
    const created = await call("owner", "POST", `/api/v1/incidents/${incidentId}/tasks`, {
      item: "Stage generators", assignment: { kind: "position", positionId: logisticsId },
    });
    expect(created.statusCode, created.body).toBe(201);
    const tasks = (await call("position-viewer", "GET", `/api/v1/incidents/${incidentId}/tasks`)).json().tasks as
      { item: string; assignment: { title: string; personName: string | null; organizationName: string } | null }[];
    expect(tasks.find((task) => task.item === "Stage generators")?.assignment)
      .toMatchObject({ title: "Logistics Section Chief", personName: "Admin" });
  });

  it("names a partner author's incident position and organization on the owner's record detail", async () => {
    const [board] = await admin`
      select b.id from boards b join incident_boards ib on ib.board_id = b.id
      where ib.incident_id = ${incidentId} and b.template_key = 'significant_events'`;
    const boardId = board!.id as string;
    const created = await call("position-contributor", "POST", `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, {
      summary: "Substation flooded", occurred_at: new Date().toISOString(), severity: "warning",
    });
    expect(created.statusCode, created.body).toBe(201);
    const detail = await call("owner", "GET", `/api/v1/boards/${boardId}/records/${created.json().id as string}/detail?incidentId=${incidentId}`);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().createdBy).toMatchObject({ positionTitle: "Utility liaison", organizationName: "Position Partner Utility" });
    expect(detail.json().history[0].actor).toMatchObject({ positionTitle: "Utility liaison", organizationName: "Position Partner Utility" });
  });

  it("ends a partner's view of the positions on revocation", async () => {
    const revoked = await call("owner", "POST", `/api/v1/incidents/${incidentId}/participants/${viewerGrantId}/revoke`, { reason: "Rotated off" });
    expect(revoked.statusCode, revoked.body).toBe(200);
    const after = await withPerson(runtime, viewerId, (tx) => tx`select count(*)::int as n from positions where jurisdiction_id = ${ownerId}`);
    expect(after[0]!.n).toBe(0);
    const holders = await withPerson(runtime, viewerId, (tx) => tx`select count(*)::int as n from position_assignments where position_id = ${logisticsId}`);
    expect(holders[0]!.n).toBe(0);
  });
});
