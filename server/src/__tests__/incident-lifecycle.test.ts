import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

type Role = "admin" | "member" | "viewer" | "guest" | "outsider" | "partner";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let memberId: string;
let guestId: string;
let fireId: string;
let fireBoardId: string;
let shiftId: string;
let shiftBoardId: string;
const tokens = {} as Record<Role, string>;

const call = (method: "GET" | "POST" | "DELETE" | "PUT", url: string, role: Role, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: auth(tokens[role]), ...(payload ? { payload } : {}) });

async function activate(templateKey: string, name: string): Promise<{ id: string; boardId: string }> {
  const res = await call("POST", `/api/v1/jurisdictions/${jurisdictionId}/incidents`, "admin", { templateKey, name });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().incidentId as string;
  const detail = await call("GET", `/api/v1/incidents/${id}`, "admin");
  const board = (detail.json().boards as Array<{ id: string; title: string }>)
    .find((b) => b.title === `${name}: Activity Log`);
  return { id, boardId: board!.id };
}

async function person(email: string, organization?: { id: string; role: "member" | "viewer" }): Promise<string> {
  const id = await createPerson(admin, { email, displayName: email.split("@")[0]!, password: "lifecycle-password" });
  if (organization) await addMembership(admin, id, organization.id, organization.role);
  return id;
}

const overview = (role: Role, query = "") =>
  call("GET", `/api/v1/jurisdictions/${jurisdictionId}/incidents/overview${query}`, role);
const listed = async (role: Role, query = "") => {
  const res = await call("GET", `/api/v1/jurisdictions/${jurisdictionId}/incidents${query}`, role);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().incidents as Array<{ id: string; archivedAt: string | null; lockedAt: string | null }>;
};
const audits = async (incidentId: string, category: string) =>
  (await admin`select 1 from audit_events where incident_id = ${incidentId} and category = ${category}`).length;

/** What the row-level security wall lets a person read on a board, with no route code in between. */
const wall = (personId: string, boardId: string) =>
  withPerson(runtime, personId, async (tx) => {
    const [row] = await tx`
      select (select count(*)::int from boards where id = ${boardId}) as boards,
             (select count(*)::int from board_records where board_id = ${boardId}) as records`;
    return { boards: row!.boards as number, records: row!.records as number };
  });

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  memberId = seed.memberId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await person("viewer@example.org", { id: jurisdictionId, role: "viewer" });
  const elsewhere = await createJurisdiction(admin, "elsewhere", "Elsewhere OES");
  await person("outsider@example.org", { id: elsewhere, role: "member" });
  const partnerOrg = await createJurisdiction(admin, "partner-org", "Partner County");
  await person("partner@example.org", { id: partnerOrg, role: "member" });
  guestId = await person("guest@example.org");
  tokens.admin = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  tokens.member = await tokenFor(app, "member@example.org", "another-good-password");
  for (const role of ["viewer", "outsider", "partner"] as const)
    tokens[role] = await tokenFor(app, `${role}@example.org`, "lifecycle-password");

  ({ id: fireId, boardId: fireBoardId } = await activate("wildfire", "Lifecycle Fire"));
  ({ id: shiftId, boardId: shiftBoardId } = await activate("daily_ops", "Harbor Shift"));
  await admin`
    insert into guest_grants (person_id, jurisdiction_id, scopes, expires_at, created_by)
    values (${guestId}, ${jurisdictionId}, ${[`board:${fireBoardId}:read`, `board:${shiftBoardId}:read`]},
            now() + interval '1 day', ${seed.adminId})`;
  tokens.guest = await tokenFor(app, "guest@example.org", "lifecycle-password");
  const participant = await call("POST", `/api/v1/incidents/${fireId}/participants`, "admin", {
    organizationSlug: "partner-org", personEmail: "partner@example.org",
    incidentPositionTitle: "Mutual Aid Liaison", role: "viewer",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(), reason: "Mutual aid for the fire",
  });
  expect(participant.statusCode, participant.body).toBe(201);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("jurisdiction master view", () => {
  it("rolls up each incident's open work, records, organizations and period", async () => {
    for (const entry of ["First report", "Second report"]) {
      const record = await call("POST", `/api/v1/boards/${fireBoardId}/records?incidentId=${fireId}`, "admin", { entry });
      expect(record.statusCode, record.body).toBe(201);
    }
    for (const state of ["submitted", "cancelled", "closed", "deployed"]) {
      await admin`
        insert into resource_requests (jurisdiction_id, incident_id, origin, item, requested_by, state)
        values (${jurisdictionId}, ${fireId}, 'eoc', ${`Engine ${state}`}, ${memberId}, ${state})`;
    }
    const area = await call("PUT", `/api/v1/incidents/${fireId}/operational-area`, "admin", {
      expectedRevision: 0, geometry: null, reason: "First period",
      operationalPeriod: { label: "OP-1", startsAt: "2026-09-23T08:00:00Z", endsAt: "2026-09-23T20:00:00Z" },
    });
    expect(area.statusCode, area.body).toBe(200);

    const res = await overview("member");
    expect(res.statusCode, res.body).toBe(200);
    const rows = res.json().incidents as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.id)).toEqual([shiftId, fireId]);
    expect(rows.find((row) => row.id === fireId)).toMatchObject({
      name: "Lifecycle Fire", kind: "incident", closedAt: null, archivedAt: null, lockedAt: null,
      operationalPeriod: { label: "OP-1", startsAt: "2026-09-23T08:00:00.000Z", endsAt: "2026-09-23T20:00:00.000Z" },
      openResourceRequests: 2, openTasks: 7, boardRecords: 2, participatingOrganizations: 1,
    });
    expect(rows.find((row) => row.id === shiftId)).toMatchObject({
      operationalPeriod: null, openResourceRequests: 0, openTasks: 1, boardRecords: 0, participatingOrganizations: 0,
    });
    expect(res.json().nextCursor).toBeNull();
  });

  it("answers members of the jurisdiction only", async () => {
    for (const role of ["admin", "member", "viewer"] as const) expect((await overview(role)).statusCode).toBe(200);
    for (const role of ["guest", "outsider", "partner"] as const) expect((await overview(role)).statusCode).toBe(403);
  });

  it("pages newest first by keyset and refuses a forged cursor", async () => {
    const drill = await activate("daily_ops", "Paging Drill");
    const first = await overview("member", "?limit=2");
    expect(first.json().incidents.map((row: { id: string }) => row.id)).toEqual([drill.id, shiftId]);
    const cursor = first.json().nextCursor as string;
    expect(cursor).toBeTruthy();
    const second = await overview("member", `?limit=2&cursor=${encodeURIComponent(cursor)}`);
    expect(second.json().incidents.map((row: { id: string }) => row.id)).toEqual([fireId]);
    expect(second.json().nextCursor).toBeNull();
    expect((await overview("member", "?cursor=forged")).statusCode).toBe(400);
    expect((await overview("member", "?archived=everything")).statusCode).toBe(400);
  });
});

describe("archival", () => {
  it("is an owner administrator action on a closed incident, reversible and audited", async () => {
    for (const role of ["member", "viewer", "partner"] as const)
      expect((await call("POST", `/api/v1/incidents/${fireId}/archive`, role)).statusCode).toBe(403);
    for (const role of ["guest", "outsider"] as const)
      expect((await call("POST", `/api/v1/incidents/${shiftId}/archive`, role)).statusCode).toBe(404);

    const open = await call("POST", `/api/v1/incidents/${shiftId}/archive`, "admin");
    expect(open.statusCode).toBe(409);
    expect(open.json().error).toMatch(/close the incident/);
    expect((await call("POST", `/api/v1/incidents/${shiftId}/close`, "admin")).statusCode).toBe(200);
    expect((await call("POST", `/api/v1/incidents/${shiftId}/archive`, "admin")).statusCode).toBe(200);
    expect((await call("POST", `/api/v1/incidents/${shiftId}/archive`, "admin")).statusCode).toBe(409);

    expect((await listed("member")).map((i) => i.id)).not.toContain(shiftId);
    expect((await listed("member", "?archived=include")).map((i) => i.id)).toContain(shiftId);
    const only = await listed("member", "?archived=only");
    expect(only.map((i) => i.id)).toEqual([shiftId]);
    expect(only[0]!.archivedAt).toBeTruthy();
    expect((await call("GET", `/api/v1/jurisdictions/${jurisdictionId}/incidents?archived=bogus`, "member")).statusCode).toBe(400);
    const defaultView = (await overview("member")).json().incidents as Array<{ id: string }>;
    expect(defaultView.map((row) => row.id)).not.toContain(shiftId);
    const archivedView = (await overview("viewer", "?archived=only")).json().incidents as Array<{ id: string; archivedAt: string | null }>;
    expect(archivedView.map((row) => row.id)).toEqual([shiftId]);

    // Archived stays readable to those who could read it, and stays read-only.
    expect((await call("GET", `/api/v1/incidents/${shiftId}`, "member")).statusCode).toBe(200);
    expect(await wall(guestId, shiftBoardId)).toEqual({ boards: 1, records: 0 });
    const write = await call("POST", `/api/v1/boards/${shiftBoardId}/records?incidentId=${shiftId}`, "admin", { entry: "Late entry" });
    expect(write.statusCode, write.body).toBe(409);

    for (const role of ["member", "viewer"] as const)
      expect((await call("POST", `/api/v1/incidents/${shiftId}/unarchive`, role)).statusCode).toBe(403);
    expect((await call("POST", `/api/v1/incidents/${shiftId}/unarchive`, "admin")).statusCode).toBe(200);
    expect((await call("POST", `/api/v1/incidents/${shiftId}/unarchive`, "admin")).statusCode).toBe(409);
    expect((await listed("member")).map((i) => i.id)).toContain(shiftId);
    const [row] = await admin`select closed_at, archived_at, archived_by from incidents where id = ${shiftId}`;
    expect(row!.closed_at).toBeTruthy();
    expect(row!.archived_at).toBeNull();
    expect(row!.archived_by).toBeNull();
    expect(await audits(shiftId, "incident.archived")).toBe(1);
    expect(await audits(shiftId, "incident.unarchived")).toBe(1);
  });
});

describe("incident lockdown", () => {
  it("withholds one incident from guest grants at the row-level security wall, never from members or participants", async () => {
    for (const role of ["member", "viewer", "partner"] as const)
      expect((await call("POST", `/api/v1/incidents/${fireId}/lockdown`, role)).statusCode).toBe(403);
    for (const role of ["guest", "outsider"] as const)
      expect((await call("POST", `/api/v1/incidents/${fireId}/lockdown`, role)).statusCode).toBe(404);
    const [fresh] = await admin`select locked_at from incidents where id = ${fireId}`;
    expect(fresh!.locked_at).toBeNull();

    // Unlocked: the guest's board grant reads the incident's board and its records.
    expect(await wall(guestId, fireBoardId)).toEqual({ boards: 1, records: 2 });
    expect((await call("GET", `/api/v1/boards/${fireBoardId}`, "guest")).statusCode).toBe(200);
    expect(await wall(memberId, fireBoardId)).toEqual({ boards: 1, records: 2 });

    expect((await call("POST", `/api/v1/incidents/${fireId}/lockdown`, "admin")).statusCode).toBe(200);
    expect((await call("POST", `/api/v1/incidents/${fireId}/lockdown`, "admin")).statusCode).toBe(409);

    // Locked: the guest is refused by the wall itself; members and the
    // participating organization read as before; the guest's grant on a board
    // of another incident is untouched.
    expect(await wall(guestId, fireBoardId)).toEqual({ boards: 0, records: 0 });
    expect((await call("GET", `/api/v1/boards/${fireBoardId}`, "guest")).statusCode).toBe(404);
    expect(await wall(memberId, fireBoardId)).toEqual({ boards: 1, records: 2 });
    expect((await call("GET", `/api/v1/boards/${fireBoardId}`, "member")).statusCode).toBe(200);
    expect((await call("GET", `/api/v1/incidents/${fireId}/operational-area`, "partner")).statusCode).toBe(200);
    expect(await wall(guestId, shiftBoardId)).toEqual({ boards: 1, records: 0 });
    expect((await listed("member")).find((i) => i.id === fireId)?.lockedAt).toBeTruthy();
    const row = ((await overview("member")).json().incidents as Array<{ id: string; lockedAt: string | null }>)
      .find((incident) => incident.id === fireId);
    expect(row?.lockedAt).toBeTruthy();

    expect((await call("DELETE", `/api/v1/incidents/${fireId}/lockdown`, "member")).statusCode).toBe(403);
    expect((await call("DELETE", `/api/v1/incidents/${fireId}/lockdown`, "admin")).statusCode).toBe(200);
    expect((await call("DELETE", `/api/v1/incidents/${fireId}/lockdown`, "admin")).statusCode).toBe(409);
    expect(await wall(guestId, fireBoardId)).toEqual({ boards: 1, records: 2 });

    expect((await call("POST", `/api/v1/incidents/${fireId}/lockdown`, "admin")).statusCode).toBe(200);
    expect(await wall(guestId, fireBoardId)).toEqual({ boards: 0, records: 0 });
    expect(await audits(fireId, "incident.locked")).toBe(2);
    expect(await audits(fireId, "incident.unlocked")).toBe(1);
  });
});
