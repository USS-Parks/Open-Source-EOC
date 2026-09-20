import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { createPerson } from "../auth/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let incidentId: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor("member@example.org", "another-good-password");
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

async function tokenFor(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  return res.json().accessToken as string;
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe("one-action activation (F12, F13)", () => {
  it("a wildfire activation yields org chart, boards, checklists, and libraries", async () => {
    const lib = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/libraries`,
      headers: auth(adminToken),
      payload: {
        title: "Wildfire pre-plan",
        kind: "scenario",
        body: "Evacuation zones A-C, staging at the rodeo grounds.",
        forTemplate: "wildfire",
      },
    });
    expect(lib.statusCode).toBe(201);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      headers: auth(adminToken),
      payload: { templateKey: "wildfire", name: "Bald Hills Fire" },
    });
    expect(res.statusCode).toBe(201);
    const result = res.json();
    incidentId = result.incidentId as string;
    expect(result.positions).toBe(8);
    expect(result.boards).toBe(6);
    expect(result.checklistItems).toBe(7);
    expect(result.libraries).toBe(1);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}`,
      headers: auth(memberToken),
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.positions.map((p: { key: string }) => p.key)).toContain("incident_commander");
    expect(body.boards).toHaveLength(6);
    expect(body.libraries[0].title).toBe("Wildfire pre-plan");
    expect(body.kind).toBe("incident");

    const audit = await admin`
      select category, incident_id from audit_events where category = 'incident.activated'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.incident_id).toBe(incidentId);
  });

  it("members cannot activate incidents", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      headers: auth(memberToken),
      payload: { templateKey: "wildfire", name: "Rogue Activation" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("daily-ops incidents differ only by the kind flag (F17)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      headers: auth(adminToken),
      payload: { templateKey: "daily_ops", name: "Shift 2026-09-17", kind: "daily_ops" },
    });
    expect(res.statusCode).toBe(201);
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${res.json().incidentId}`,
      headers: auth(adminToken),
    });
    expect(detail.json().kind).toBe("daily_ops");
    expect(detail.json().boards.length).toBeGreaterThan(0);
  });

  it("lists a jurisdiction's incidents for a member", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      headers: auth(memberToken),
    });
    expect(res.statusCode).toBe(200);
    const incidents = res.json().incidents as Array<{ name: string; closedAt: string | null }>;
    expect(incidents.length).toBeGreaterThanOrEqual(2);
    expect(incidents.map((i) => i.name)).toContain("Bald Hills Fire");
    expect(incidents.every((i) => i.closedAt === null)).toBe(true);
  });
});

describe("position-attributed checklists (F12)", () => {
  it("only the holder of the owning position completes its items, attributed", async () => {
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}`,
      headers: auth(adminToken),
    });
    const icItem = detail
      .json()
      .checklists.find((c: { positionKey: string }) => c.positionKey === "incident_commander");
    expect(icItem).toBeTruthy();

    // Not signed into the position: refused.
    const early = await app.inject({
      method: "POST",
      url: `/api/v1/checklist-items/${icItem.id}/complete`,
      headers: auth(adminToken),
    });
    expect(early.statusCode).toBe(403);

    // Assign, sign in as IC, complete.
    const [icPos] = await admin`
      select id from positions where jurisdiction_id = ${seed.jurisdictionId}
      and key = 'incident_commander'`;
    await app.inject({
      method: "POST",
      url: `/api/v1/positions/${icPos!.id as string}/assignments`,
      headers: auth(adminToken),
      payload: { personId: seed.adminId },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/positions/${icPos!.id as string}/sign-in`,
      headers: auth(adminToken),
    });
    const done = await app.inject({
      method: "POST",
      url: `/api/v1/checklist-items/${icItem.id}/complete`,
      headers: auth(adminToken),
    });
    expect(done.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}`,
      headers: auth(adminToken),
    });
    const completed = after
      .json()
      .checklists.find((c: { id: string }) => c.id === icItem.id);
    expect(completed.completedAt).toBeTruthy();
    expect(completed.completedByPosition).toBe("Incident Commander");

    const again = await app.inject({
      method: "POST",
      url: `/api/v1/checklist-items/${icItem.id}/complete`,
      headers: auth(adminToken),
    });
    expect(again.statusCode).toBe(409);
  });
});

describe("closure", () => {
  it("an admin closes the incident and the chronology records it", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/close`,
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const audit = await admin`
      select 1 from audit_events where category = 'incident.closed'
      and incident_id = ${incidentId}`;
    expect(audit).toHaveLength(1);
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/close`,
      headers: auth(adminToken),
    });
    expect(again.statusCode).toBe(409);
  });
});

describe("incident lockdown (Basho, 2026-09-20)", () => {
  it("activation locks the jurisdiction; an admin can lift it; a member cannot set it", async () => {
    const act = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      headers: auth(adminToken),
      payload: { templateKey: "wildfire", name: "Lockdown Test Fire" },
    });
    expect(act.statusCode).toBe(201);
    const state = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/lockdown`,
      headers: auth(adminToken),
    });
    expect(state.json().locked).toBe(true);
    const memberSet = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/lockdown`,
      headers: auth(memberToken),
      payload: { locked: false },
    });
    expect(memberSet.statusCode).toBe(403);
    const lift = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/lockdown`,
      headers: auth(adminToken),
      payload: { locked: false },
    });
    expect(lift.statusCode).toBe(200);
    expect(lift.json().locked).toBe(false);
  });

  it("suspends guest read at the RLS wall while locked", async () => {
    const guestId = await createPerson(admin, {
      email: "guest-ld@example.org",
      displayName: "Guest LD",
      password: "guest-good-password",
    });
    await admin`
      insert into guest_grants (person_id, jurisdiction_id, scopes, expires_at, created_by)
      values (${guestId}, ${seed.jurisdictionId}, ${["positions:read"]}, now() + interval '1 day', ${seed.adminId})`;
    await admin`select set_config('app.person_id', ${guestId}, false)`;
    await admin`update jurisdictions set locked = false where id = ${seed.jurisdictionId}`;
    const unlocked = await admin`select has_guest_scope(${seed.jurisdictionId}, 'positions:read') as ok`;
    expect(unlocked[0]!.ok).toBe(true);
    await admin`update jurisdictions set locked = true where id = ${seed.jurisdictionId}`;
    const locked = await admin`select has_guest_scope(${seed.jurisdictionId}, 'positions:read') as ok`;
    expect(locked[0]!.ok).toBe(false);
    await admin`update jurisdictions set locked = false where id = ${seed.jurisdictionId}`;
    await admin`select set_config('app.person_id', '', false)`;
  });
});
