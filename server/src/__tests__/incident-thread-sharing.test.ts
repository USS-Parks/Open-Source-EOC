import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * An incident-wide thread is read by everyone who can read its incident and
 * posted in by the owner's writers and the incident's contributors and
 * coordinators, computed from the live grant. A members thread stays with
 * its members. The partner's message lands in the owner's record.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let ownerId: string;
let ownerAdminId: string;
let contributorId: string;
let incidentId: string;
let contributorGrantId: string;
let wideThread: string;
let memberThread: string;
let partnerThread: string;
let partnerId: string;
let memberId: string;
const tokens: Record<string, string> = {};

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

const call = (who: string, method: "GET" | "POST" | "PUT", url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload } : {}) });

async function person(key: string, organization: string): Promise<string> {
  const id = await createPerson(admin, { email: `${key}@example.org`, displayName: key, password: `${key}-password-long` });
  await addMembership(admin, id, organization, "member");
  tokens[key] = await login(`${key}@example.org`, `${key}-password-long`);
  return id;
}

async function grant(personId: string, organization: string, role: "viewer" | "contributor", title: string): Promise<string> {
  const [row] = await admin`
    insert into incident_participants
      (incident_id, organization_id, person_id, incident_position_title, role, expires_at, reason, created_by)
    values (${incidentId}, ${organization}, ${personId}, ${title}, ${role}, now() + interval '1 day', 'incident threads', ${ownerAdminId})
    returning id`;
  return row!.id as string;
}

const messages = async (who: string, threadId: string) => {
  const response = await call(who, "GET", `/api/v1/threads/${threadId}/messages`);
  return { status: response.statusCode, messages: response.statusCode === 200 ? response.json().messages as { body: string; senderOrganization: string }[] : [] };
};

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  ownerId = seed.jurisdictionId;
  ownerAdminId = seed.adminId;
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  tokens.owner = await login("admin@example.org", "correct-horse-battery");
  partnerId = await createJurisdiction(admin, "thread-partner", "Thread Partner Utility");
  const outsiderOrg = await createJurisdiction(admin, "thread-outsider", "Thread Outsider");
  memberId = await person("thread-member", ownerId);
  contributorId = await person("thread-contributor", partnerId);
  const viewerId = await person("thread-viewer", partnerId);
  await person("thread-outsider", outsiderOrg);
  const [incident] = await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by)
    values (${ownerId}, 'Threads Incident', 'incident', ${ownerAdminId}) returning id`;
  incidentId = incident!.id as string;
  contributorGrantId = await grant(contributorId, partnerId, "contributor", "Utility liaison");
  await grant(viewerId, partnerId, "viewer", "Utility observer");

  const wide = await call("owner", "POST", `/api/v1/jurisdictions/${ownerId}/threads`,
    { kind: "group", title: "Storm coordination", incidentId, audience: "incident" });
  expect(wide.statusCode, wide.body).toBe(201);
  wideThread = wide.json().id as string;
  const [position] = await admin`
    insert into positions (jurisdiction_id, key, title) values (${ownerId}, 'thread_desk', 'Thread Desk') returning id`;
  const members = await call("owner", "POST", `/api/v1/jurisdictions/${ownerId}/threads`,
    { kind: "group", title: "County only", incidentId, members: [{ kind: "position", id: position!.id as string }] });
  expect(members.statusCode, members.body).toBe(201);
  memberThread = members.json().id as string;
  expect((await call("owner", "POST", `/api/v1/threads/${memberThread}/messages`, { body: "County staffing note" })).statusCode).toBe(201);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("incident-wide threads", () => {
  it("lets a partner contributor read and post in an incident-wide thread, named by its organization", async () => {
    const listed = await call("thread-contributor", "GET", `/api/v1/incidents/${incidentId}/threads`);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().threads.map((thread: { id: string }) => thread.id)).toEqual([wideThread]);
    expect(listed.json().threads[0]).toMatchObject({ audience: "incident", recipients: [] });

    const posted = await call("thread-contributor", "POST", `/api/v1/threads/${wideThread}/messages`,
      { body: "Substation 4 is flooded; crews staged at Eureka.", clientMessageId: "sub-4" });
    expect(posted.statusCode, posted.body).toBe(201);
    const again = await call("thread-contributor", "POST", `/api/v1/threads/${wideThread}/messages`,
      { body: "Substation 4 is flooded; crews staged at Eureka.", clientMessageId: "sub-4" });
    expect(again.json()).toMatchObject({ id: posted.json().id, deduplicated: true });

    const asOwner = await messages("owner", wideThread);
    expect(asOwner.messages).toEqual([expect.objectContaining({
      body: "Substation 4 is flooded; crews staged at Eureka.", senderOrganization: "Thread Partner Utility" })]);
    // An owner member who is not in any member list reads it in the jurisdiction's threads too.
    const jurisdictionList = await call("thread-member", "GET", `/api/v1/jurisdictions/${ownerId}/threads`);
    expect(jurisdictionList.json().threads.map((thread: { id: string }) => thread.id)).toContain(wideThread);
    expect((await call("thread-member", "POST", `/api/v1/threads/${wideThread}/messages`, { body: "County copies." })).statusCode).toBe(201);

    const [audit] = await admin`
      select jurisdiction_id, incident_id, person_id from audit_events
      where category = 'message.sent' and subject_id = ${posted.json().id as string}`;
    expect(audit).toMatchObject({ jurisdiction_id: ownerId, incident_id: incidentId, person_id: contributorId });
    const activity = await call("owner", "GET", `/api/v1/incidents/${incidentId}/activity`);
    expect(activity.statusCode, activity.body).toBe(200);
    expect(JSON.stringify(activity.json())).toContain("Substation 4 is flooded");
  });

  it("lets a partner contributor start an incident-wide thread", async () => {
    const started = await call("thread-contributor", "POST", `/api/v1/jurisdictions/${ownerId}/threads`,
      { kind: "group", title: "Utility restoration", incidentId, audience: "incident" });
    expect(started.statusCode, started.body).toBe(201);
    partnerThread = started.json().id as string;
    const [thread] = await admin`select jurisdiction_id, created_by, audience from threads where id = ${partnerThread}`;
    expect(thread).toMatchObject({ jurisdiction_id: ownerId, created_by: contributorId, audience: "incident" });
    const viewer = await call("thread-viewer", "POST", `/api/v1/jurisdictions/${ownerId}/threads`,
      { kind: "group", title: "Viewer thread", incidentId, audience: "incident" });
    expect(viewer.statusCode).toBe(403);
  });

  it("keeps a members thread with its members, a viewer read-only, and an outsider out", async () => {
    expect((await messages("thread-contributor", memberThread)).status).toBe(404);
    expect((await call("thread-contributor", "POST", `/api/v1/threads/${memberThread}/messages`, { body: "Let me in" })).statusCode).toBe(404);

    const asViewer = await messages("thread-viewer", wideThread);
    expect(asViewer.status).toBe(200);
    expect(asViewer.messages.map((message) => message.body)).toContain("Substation 4 is flooded; crews staged at Eureka.");
    expect((await call("thread-viewer", "POST", `/api/v1/threads/${wideThread}/messages`, { body: "Observer note" })).statusCode).toBe(403);

    expect((await call("thread-outsider", "GET", `/api/v1/incidents/${incidentId}/threads`)).statusCode).toBe(404);
    expect((await messages("thread-outsider", wideThread)).status).toBe(404);

    // Straight to the database the partner cannot write a message or reach a members thread.
    await expect(withPerson(runtime, contributorId, (tx) => tx`
      insert into messages (thread_id, sender_person, body, created_at)
      values (${wideThread}, ${contributorId}, 'Backdated', now() - interval '1 day')`)).rejects.toThrow(/row-level security/);
    const intoMembers = await withPerson(runtime, contributorId, (tx) =>
      tx`select public.post_incident_message(${memberThread}, null, 'Sideways', null) as id`);
    expect(intoMembers[0]!.id).toBeNull();
    // An owner member cannot make an incident-wide thread or give one members by hand.
    await expect(withPerson(runtime, memberId, (tx) => tx`
      insert into threads (jurisdiction_id, kind, incident_id, title, created_by, audience)
      values (${ownerId}, 'group', ${incidentId}, 'By hand', ${memberId}, 'incident')`)).rejects.toThrow(/row-level security/);
    await expect(withPerson(runtime, memberId, (tx) => tx`
      insert into thread_members (thread_id, member_kind, person_id, added_by)
      values (${wideThread}, 'person', ${memberId}, ${memberId})`)).rejects.toThrow(/row-level security/);
  });

  it("names a partner holding its own organization's position by its grant, and applies the owner's retention", async () => {
    const [own] = await admin`
      insert into positions (jurisdiction_id, key, title) values (${partnerId}, 'utility_desk', 'Utility EOC Desk') returning id`;
    await admin`insert into position_assignments (position_id, person_id, assigned_by) values (${own!.id as string}, ${contributorId}, ${ownerAdminId})`;
    const [posted] = await withPerson(runtime, contributorId, (tx) =>
      tx`select public.post_incident_message(${wideThread}, null, 'From the utility desk', ${own!.id as string}) as id`);
    const [stored] = await admin`select sender_position from messages where id = ${posted!.id as string}`;
    expect(stored!.sender_position).toBeNull();
    const [audit] = await admin`select position_id from audit_events where category = 'message.sent' and subject_id = ${posted!.id as string}`;
    expect(audit!.position_id).toBeNull();
    expect((await messages("owner", wideThread)).messages.find((message) => message.body === "From the utility desk"))
      .toMatchObject({ senderOrganization: "Thread Partner Utility" });

    await admin`
      insert into messages (thread_id, sender_person, body, created_at)
      values (${wideThread}, ${ownerAdminId}, 'Three days old', now() - interval '3 days')`;
    expect((await messages("thread-viewer", wideThread)).messages.map((message) => message.body)).toContain("Three days old");
    expect((await call("owner", "PUT", `/api/v1/jurisdictions/${ownerId}/messaging-settings`,
      { retentionDays: 1, inIncidentRecord: true })).statusCode).toBe(200);
    expect((await messages("thread-viewer", wideThread)).messages.map((message) => message.body)).not.toContain("Three days old");
    expect((await messages("owner", wideThread)).messages.map((message) => message.body)).not.toContain("Three days old");
  });

  it("ends a partner's reading and posting on revocation", async () => {
    const revoked = await call("owner", "POST", `/api/v1/incidents/${incidentId}/participants/${contributorGrantId}/revoke`,
      { reason: "Liaison rotated off the incident" });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect((await call("thread-contributor", "GET", `/api/v1/incidents/${incidentId}/threads`)).statusCode).toBe(404);
    expect((await messages("thread-contributor", wideThread)).status).toBe(404);
    expect((await call("thread-contributor", "POST", `/api/v1/threads/${wideThread}/messages`, { body: "Still here?" })).statusCode).toBe(404);
    // The thread it started is gone from it too.
    expect((await messages("thread-contributor", partnerThread)).status).toBe(404);
    // The owner still names the partner's past message by the organization it wrote for.
    expect((await messages("owner", wideThread)).messages[0]).toMatchObject({ senderOrganization: "Thread Partner Utility" });
  });

  it("keeps an incident-wide thread readable after close and refuses new posts", async () => {
    await admin`update incidents set closed_at = now(), closed_by = ${ownerAdminId} where id = ${incidentId}`;
    expect((await messages("thread-member", wideThread)).status).toBe(200);
    expect((await call("thread-member", "POST", `/api/v1/threads/${wideThread}/messages`, { body: "After close" })).statusCode).toBe(409);
    expect((await call("owner", "POST", `/api/v1/jurisdictions/${ownerId}/threads`,
      { kind: "group", title: "Late thread", incidentId, audience: "incident" })).statusCode).toBe(409);
  });
});
