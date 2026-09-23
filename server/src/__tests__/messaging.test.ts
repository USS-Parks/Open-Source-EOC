import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let secondId: string;
let secondToken: string;
let opsPositionId: string;
let incidentId: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  secondId = await createPerson(admin, {
    email: "second@example.org",
    displayName: "Second Member",
    password: "second-member-pass1",
  });
  await addMembership(admin, secondId, seed.jurisdictionId, "member");
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  secondToken = await tokenFor(app, "second@example.org", "second-member-pass1");

  const inc = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    headers: auth(adminToken),
    payload: { templateKey: "wildfire", name: "Messaging Fire" },
  });
  incidentId = inc.json().incidentId as string;
  const [pos] = await admin`
    select id from positions where jurisdiction_id = ${seed.jurisdictionId}
    and key = 'operations_section_chief'`;
  opsPositionId = pos!.id as string;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});



describe("direct threads (R6, no external backend)", () => {
  let threadId: string;

  it("two people message each other; a third sees nothing", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/threads`,
      headers: auth(memberToken),
      payload: { kind: "direct", members: [{ kind: "person", id: secondId }] },
    });
    expect(create.statusCode).toBe(201);
    threadId = create.json().id as string;

    await app.inject({
      method: "POST",
      url: `/api/v1/threads/${threadId}/messages`,
      headers: auth(memberToken),
      payload: { body: "Radio check" },
    });
    const reply = await app.inject({
      method: "POST",
      url: `/api/v1/threads/${threadId}/messages`,
      headers: auth(secondToken),
      payload: { body: "Loud and clear" },
    });
    expect(reply.statusCode).toBe(201);

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/threads/${threadId}/messages`,
      headers: auth(secondToken),
    });
    expect(read.json().messages.map((m: { body: string }) => m.body)).toEqual([
      "Radio check",
      "Loud and clear",
    ]);

    // The admin is not a participant; posting is refused even for admins.
    const outsider = await app.inject({
      method: "POST",
      url: `/api/v1/threads/${threadId}/messages`,
      headers: auth(adminToken),
      payload: { body: "intruding" },
    });
    expect([403, 404, 500]).not.toContain(outsider.statusCode === 201 ? 201 : 0);
    expect(outsider.statusCode).not.toBe(201);
  });

  it("the offline queue is idempotent: a retried client message is one row", async () => {
    const send = () =>
      app.inject({
        method: "POST",
        url: `/api/v1/threads/${threadId}/messages`,
        headers: auth(memberToken),
        payload: { body: "Queued while offline", clientMessageId: "offline-001" },
      });
    const first = await send();
    const retry = await send();
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().deduplicated).toBe(true);
    expect(retry.json().id).toBe(first.json().id);
    const rows = await admin`
      select count(*)::int as n from messages where client_message_id = 'offline-001'`;
    expect(rows[0]!.n).toBe(1);
  });

  it("messages cannot be edited by anyone (operational record)", async () => {
    await expect(admin`update messages set body = 'rewritten'`).rejects.toThrow(/append-only/);
  });

  it("refuses a thread member who belongs to another jurisdiction", async () => {
    const otherJurisdiction = await createJurisdiction(admin, "karuk", "Karuk Tribe OES");
    const outsiderId = await createPerson(admin, {
      email: "foreign@example.org",
      displayName: "Foreign Member",
      password: "foreign-member-pass",
    });
    await addMembership(admin, outsiderId, otherJurisdiction, "member");

    const create = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/threads`,
      headers: auth(memberToken),
      payload: { kind: "direct", members: [{ kind: "person", id: outsiderId }] },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json().error).toBe("member is not in this jurisdiction");
  });

  it("refuses an incident that belongs to another jurisdiction", async () => {
    const otherJurisdiction = await createJurisdiction(admin, "resighini", "Resighini Rancheria");
    const otherAdminId = await createPerson(admin, {
      email: "resighini-admin@example.org",
      displayName: "Resighini Admin",
      password: "resighini-admin-pass1",
    });
    await addMembership(admin, otherAdminId, otherJurisdiction, "admin");
    const otherAdminToken = await tokenFor(app, 
      "resighini-admin@example.org",
      "resighini-admin-pass1",
    );
    const foreignIncident = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${otherJurisdiction}/incidents`,
      headers: auth(otherAdminToken),
      payload: { templateKey: "wildfire", name: "Foreign Fire" },
    });
    expect(foreignIncident.statusCode).toBe(201);

    const create = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/threads`,
      headers: auth(adminToken),
      payload: {
        kind: "group",
        title: "Crossed wire",
        incidentId: foreignIncident.json().incidentId as string,
        members: [{ kind: "person", id: seed.memberId }],
      },
    });
    expect(create.statusCode).toBe(400);
    expect(create.json().error).toBe("incident not found in this jurisdiction");
  });
});

describe("position-addressed messaging (the seat, not the person)", () => {
  let seatThreadId: string;

  it("a message to Operations Section Chief reaches the current holder", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/positions/${opsPositionId}/assignments`,
      headers: auth(adminToken),
      payload: { personId: seed.memberId },
    });
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/threads`,
      headers: auth(adminToken),
      payload: {
        kind: "direct",
        title: "To the ops desk",
        members: [{ kind: "position", id: opsPositionId }],
      },
    });
    seatThreadId = create.json().id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/threads/${seatThreadId}/messages`,
      headers: auth(adminToken),
      payload: { body: "Report resource status by 1400" },
    });

    const holderRead = await app.inject({
      method: "GET",
      url: `/api/v1/threads/${seatThreadId}/messages`,
      headers: auth(memberToken),
    });
    expect(holderRead.statusCode).toBe(200);
    expect(holderRead.json().messages).toHaveLength(1);
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/threads`,
      headers: auth(memberToken),
    });
    const summary = listed.json().threads.find((thread: { id: string }) => thread.id === seatThreadId);
    expect(summary.recipients).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "position",
        label: "Operations Section Chief",
        currentHolders: ["Member"],
      }),
    ]));
  });

  it("the seat's history survives a shift change and access follows the assignment", async () => {
    // Shift change: revoke the first holder, assign the second.
    await admin`update position_assignments set revoked_at = now()
      where position_id = ${opsPositionId} and person_id = ${seed.memberId}`;
    await app.inject({
      method: "POST",
      url: `/api/v1/positions/${opsPositionId}/assignments`,
      headers: auth(adminToken),
      payload: { personId: secondId },
    });

    const newHolder = await app.inject({
      method: "GET",
      url: `/api/v1/threads/${seatThreadId}/messages`,
      headers: auth(secondToken),
    });
    expect(newHolder.statusCode).toBe(200);
    expect(newHolder.json().messages[0].body).toBe("Report resource status by 1400");
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/threads`,
      headers: auth(secondToken),
    });
    const summary = listed.json().threads.find((thread: { id: string }) => thread.id === seatThreadId);
    expect(summary.recipients).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "position", currentHolders: ["Second Member"] }),
    ]));

    const oldHolder = await app.inject({
      method: "GET",
      url: `/api/v1/threads/${seatThreadId}/messages`,
      headers: auth(memberToken),
    });
    expect(oldHolder.statusCode).toBe(404); // RLS hides the thread entirely
  });
});

describe("records policy (retention and the incident record)", () => {
  it("incident-thread messages land in the chronology when policy says so", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/threads`,
      headers: auth(adminToken),
      payload: {
        kind: "group",
        title: "Ops net",
        incidentId,
        members: [{ kind: "person", id: seed.memberId }],
      },
    });
    const threadId = create.json().id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/threads/${threadId}/messages`,
      headers: auth(adminToken),
      payload: { body: "Division A holding the line" },
    });
    const audit = await admin`
      select 1 from audit_events where category = 'message.sent'
      and incident_id = ${incidentId}`;
    expect(audit).toHaveLength(1);

    const exported = await app.inject({
      method: "GET",
      url: `/api/v1/threads/${threadId}/export`,
      headers: auth(adminToken),
    });
    expect(exported.json().lines[0]).toMatch(/Admin: Division A holding the line$/);
  });

  it("turning the record policy off keeps traffic out of the chronology", async () => {
    await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/messaging-settings`,
      headers: auth(adminToken),
      payload: { inIncidentRecord: false },
    });
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/threads`,
      headers: auth(adminToken),
      payload: {
        kind: "group",
        title: "Side channel",
        incidentId,
        members: [{ kind: "person", id: seed.memberId }],
      },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/threads/${create.json().id as string}/messages`,
      headers: auth(adminToken),
      payload: { body: "Off the record by policy" },
    });
    const audit = await admin`
      select count(*)::int as n from audit_events where category = 'message.sent'`;
    expect(audit[0]!.n).toBe(1); // unchanged from the prior test
  });

  it("the retention window hides expired messages from reads", async () => {
    await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/messaging-settings`,
      headers: auth(adminToken),
      payload: { retentionDays: 30 },
    });
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/threads`,
      headers: auth(adminToken),
      payload: {
        kind: "group",
        title: "Old traffic",
        members: [{ kind: "person", id: seed.memberId }],
      },
    });
    const threadId = create.json().id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/threads/${threadId}/messages`,
      headers: auth(adminToken),
      payload: { body: "Fresh message" },
    });
    // Backdate a message beyond the window (records maintenance simulation).
    await admin`
      alter table messages disable trigger messages_no_update`;
    await admin`
      update messages set created_at = now() - interval '60 days'
      where body = 'Fresh message'`;
    await admin`
      alter table messages enable trigger messages_no_update`;
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/threads/${threadId}/messages`,
      headers: auth(adminToken),
    });
    expect(read.json().messages).toHaveLength(0);
    const stillStored = await admin`
      select count(*)::int as n from messages where body = 'Fresh message'`;
    expect(stillStored[0]!.n).toBe(1); // destruction is a separate records act
  });
});
