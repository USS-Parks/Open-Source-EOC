import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let otherJurisdictionId: string;
let crossId: string;
let viewerId: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  otherJurisdictionId = await createJurisdiction(admin, "karuk", "Karuk Tribe OES");
  viewerId = await createPerson(admin, { email: "viewer@example.org", displayName: "Viewer", password: "viewer-good-password" });
  await addMembership(admin, viewerId, seed.jurisdictionId, "viewer");
  // Member here and in a jurisdiction the seeded admin does not administer.
  crossId = await createPerson(admin, { email: "cross@example.org", displayName: "Cross", password: "cross-good-password" });
  await addMembership(admin, crossId, seed.jurisdictionId, "member");
  await addMembership(admin, crossId, otherJurisdictionId, "member");
  const rootId = await createPerson(admin, { email: "root@example.org", displayName: "Root", password: "instance-admin-pass" });
  await admin`update persons set is_instance_admin = true where id = ${rootId}`;
  app = buildApp(runtime, { oidc: null, integrations: ["meetings"] });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

const call = (token: string, method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) });
const members = (id = seed.jurisdictionId) => `/api/v1/jurisdictions/${id}/members`;

describe("administration routes", () => {
  it("refuse anyone who is not an administrator", async () => {
    for (const [method, url, payload] of [
      ["GET", members()],
      ["GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/guests`],
      ["GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/position-assignments`],
      ["GET", "/api/v1/persons?email=viewer@example.org"],
      ["PUT", `${members()}/${viewerId}`, { role: "admin" }],
      ["DELETE", `${members()}/${viewerId}`],
      ["PUT", `${members()}/${viewerId}/disabled`, { disabled: true }],
      ["POST", `${members()}/${viewerId}/mfa-reset`, { reason: "lost phone" }],
    ] as const) {
      const response = await call(memberToken, method, url, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("list members with role, account state and second factor, a page at a time", async () => {
    await admin`insert into person_mfa (person_id, secret_envelope, activated_at) values (${viewerId}, 'sealed', now())`;
    const seen: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;
    do {
      const page = await call(adminToken, "GET", `${members()}?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(page.statusCode, page.body).toBe(200);
      expect(page.json().jurisdiction).toMatchObject({ name: "Yurok Tribe OES", slug: "yurok" });
      seen.push(...page.json().members);
      cursor = page.json().nextCursor;
    } while (cursor);
    expect(seen.map((m) => m.displayName)).toEqual(["Admin", "Cross", "Member", "Viewer"]);
    expect(seen.find((m) => m.personId === viewerId)).toMatchObject({ role: "viewer", mfaEnrolled: true, disabled: false });
    expect(seen.find((m) => m.personId === seed.memberId)).toMatchObject({ mfaEnrolled: false });
    expect((await call(adminToken, "GET", `${members()}?cursor=junk`)).statusCode).toBe(400);
  });

  it("add a person found by email, and change their role effective on the next request", async () => {
    const found = await call(adminToken, "GET", "/api/v1/persons?email=CROSS@example.org");
    expect(found.json().person).toMatchObject({ id: crossId, displayName: "Cross" });
    expect((await call(adminToken, "GET", "/api/v1/persons?email=nobody@example.org")).statusCode).toBe(404);

    // The member's principal is cached by this read; the change must not wait out its TTL.
    const me = async () => (await call(memberToken, "GET", "/api/v1/me")).json().memberships;
    expect(await me()).toEqual([{ jurisdictionId: seed.jurisdictionId, role: "member" }]);
    const karukAdmin = await createPerson(admin, { email: "karuk-admin@example.org", displayName: "Karuk Admin", password: "karuk-admin-pass" });
    await addMembership(admin, karukAdmin, otherJurisdictionId, "admin");
    const karukToken = await tokenFor(app, "karuk-admin@example.org", "karuk-admin-pass");
    expect((await call(karukToken, "PUT", `${members(otherJurisdictionId)}/${seed.memberId}`, { role: "viewer" })).statusCode).toBe(200);
    expect(await me()).toContainEqual({ jurisdictionId: otherJurisdictionId, role: "viewer" });

    expect((await call(adminToken, "PUT", `${members()}/${seed.memberId}`, { role: "admin" })).statusCode).toBe(200);
    expect(await me()).toContainEqual({ jurisdictionId: seed.jurisdictionId, role: "admin" });
    expect((await call(adminToken, "PUT", `${members()}/${seed.memberId}`, { role: "member" })).statusCode).toBe(200);
    expect(await me()).toContainEqual({ jurisdictionId: seed.jurisdictionId, role: "member" });
    const events = await admin`
      select category, payload from audit_events
      where subject_id = ${seed.memberId} and category like 'membership.%' order by seq`;
    expect(events.map((e) => e.category)).toEqual(["membership.added", "membership.role.changed", "membership.role.changed"]);
    expect(events[2]!.payload).toEqual({ role: "member", previousRole: "admin" });
  });

  it("keep at least one administrator in every jurisdiction", async () => {
    const demote = await call(adminToken, "PUT", `${members()}/${seed.adminId}`, { role: "member" });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error).toContain("at least one administrator");
    expect((await call(adminToken, "DELETE", `${members()}/${seed.adminId}`)).statusCode).toBe(409);
    const [row] = await admin`
      select role from jurisdiction_memberships where person_id = ${seed.adminId} and jurisdiction_id = ${seed.jurisdictionId}`;
    expect(row!.role).toBe("admin");
  });

  it("assign, list and revoke position holders; removing a member ends their assignments", async () => {
    const [position] = await admin`
      insert into positions (jurisdiction_id, key, title) values (${seed.jurisdictionId}, 'safety_officer', 'Safety Officer')
      returning id`;
    const positionId = position!.id as string;
    expect((await call(adminToken, "POST", `/api/v1/positions/${positionId}/assignments`, { personId: viewerId })).statusCode).toBe(201);
    expect((await call(adminToken, "POST", `/api/v1/positions/${positionId}/assignments`, { personId: crossId })).statusCode).toBe(201);
    const holders = await call(adminToken, "GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/position-assignments`);
    expect(holders.json().assignments.map((a: { displayName: string }) => a.displayName)).toEqual(["Cross", "Viewer"]);

    expect((await call(adminToken, "DELETE", `/api/v1/positions/${positionId}/assignments/${crossId}`)).statusCode).toBe(200);
    expect((await call(adminToken, "DELETE", `/api/v1/positions/${positionId}/assignments/${crossId}`)).statusCode).toBe(404);
    expect((await call(adminToken, "DELETE", `/api/v1/positions/${positionId}/assignments/not-a-uuid`)).statusCode).toBe(400);

    expect((await call(adminToken, "DELETE", `${members()}/${viewerId}`)).statusCode).toBe(200);
    const after = await call(adminToken, "GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/position-assignments`);
    expect(after.json().assignments).toEqual([]);
    const [removed] = await admin`select payload from audit_events where category = 'membership.removed' and subject_id = ${viewerId}`;
    expect(removed!.payload).toEqual({ previousRole: "viewer" });
    // Put the viewer back for the tests below.
    await addMembership(admin, viewerId, seed.jurisdictionId, "viewer");
  });

  it("reset a second factor with a recorded reason", async () => {
    await admin`insert into mfa_recovery_codes (person_id, code_hash) values (${viewerId}, 'hash-1')`;
    const missingReason = await call(adminToken, "POST", `${members()}/${viewerId}/mfa-reset`, { reason: " " });
    expect(missingReason.statusCode).toBe(400);
    const reset = await call(adminToken, "POST", `${members()}/${viewerId}/mfa-reset`, { reason: "Lost phone, identity checked in person" });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(await admin`select 1 from person_mfa where person_id = ${viewerId}`).toHaveLength(0);
    expect(await admin`select 1 from mfa_recovery_codes where person_id = ${viewerId}`).toHaveLength(0);
    const [event] = await admin`select payload from audit_events where category = 'person.mfa.reset'`;
    expect(event!.payload).toEqual({ reason: "Lost phone, identity checked in person" });
    expect((await call(adminToken, "POST", `${members()}/${viewerId}/mfa-reset`, { reason: "again" })).statusCode).toBe(409);
  });

  it("disable an account at once, and only where the admin holds every membership", async () => {
    const viewerToken = await tokenFor(app, "viewer@example.org", "viewer-good-password");
    expect((await call(viewerToken, "GET", "/api/v1/me")).statusCode).toBe(200);
    const disable = await call(adminToken, "PUT", `${members()}/${viewerId}/disabled`, { disabled: true });
    expect(disable.statusCode, disable.body).toBe(200);
    expect((await call(viewerToken, "GET", "/api/v1/me")).statusCode).toBe(401);
    await expect(tokenFor(app, "viewer@example.org", "viewer-good-password")).rejects.toThrow(/401/);
    const listed = (await call(adminToken, "GET", members())).json().members;
    expect(listed.find((m: { personId: string }) => m.personId === viewerId).disabled).toBe(true);
    expect((await call(adminToken, "PUT", `${members()}/${viewerId}/disabled`, { disabled: false })).statusCode).toBe(200);
    expect((await tokenFor(app, "viewer@example.org", "viewer-good-password")).length).toBeGreaterThan(0);

    const self = await call(adminToken, "PUT", `${members()}/${seed.adminId}/disabled`, { disabled: true });
    expect(self.statusCode).toBe(409);
    expect((await call(adminToken, "PUT", `${members()}/${crossId}/disabled`, { disabled: true })).statusCode).toBe(403);
    const rootToken = await tokenFor(app, "root@example.org", "instance-admin-pass");
    await addMembership(admin, (await admin`select id from persons where email = 'root@example.org'`)[0]!.id as string, seed.jurisdictionId, "admin");
    expect((await call(rootToken, "PUT", `${members()}/${crossId}/disabled`, { disabled: true })).statusCode).toBe(200);
    expect((await call(rootToken, "PUT", `${members()}/${crossId}/disabled`, { disabled: false })).statusCode).toBe(200);
    const categories = await admin`select category from audit_events where category like 'person.%abled' order by seq`;
    expect(categories.map((e) => e.category)).toEqual(["person.disabled", "person.enabled", "person.disabled", "person.enabled"]);
  });

  it("hold the same authority in the database for a direct call", async () => {
    await expect(withPerson(runtime, seed.memberId, (tx) => tx`select set_person_disabled(${viewerId}, true)`))
      .rejects.toThrow(/not permitted/);
    await expect(withPerson(runtime, seed.memberId, (tx) => tx`select reset_person_mfa(${viewerId})`))
      .rejects.toThrow(/not permitted/);
    expect(await withPerson(runtime, seed.memberId, (tx) => tx`select members_with_mfa(${seed.jurisdictionId})`)).toHaveLength(0);
    const changed = await withPerson(runtime, seed.memberId, (tx) => tx`
      update jurisdiction_memberships set role = 'admin' where person_id = ${seed.memberId} returning role`);
    expect(changed).toHaveLength(0);
    const removed = await withPerson(runtime, seed.memberId, (tx) => tx`
      delete from jurisdiction_memberships where person_id = ${viewerId} returning person_id`);
    expect(removed).toHaveLength(0);
  });

  it("list guest grants newest first with their state", async () => {
    const guestId = await createPerson(admin, { email: "mutualaid@example.org", displayName: "Mutual Aid", password: "mutual-aid-password" });
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const grant = (scopes: string[]) => call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/guests`, { personId: guestId, scopes, expiresAt });
    const first = (await grant(["positions:read"])).json().id as string;
    const second = (await grant(["positions:read", "board:00000000-0000-4000-8000-000000000000:read"])).json().id as string;
    expect((await call(adminToken, "DELETE", `/api/v1/guests/${first}`)).statusCode).toBe(200);
    const page1 = (await call(adminToken, "GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/guests?limit=1`)).json();
    expect(page1.grants).toHaveLength(1);
    expect(page1.grants[0]).toMatchObject({ id: second, person: { displayName: "Mutual Aid" }, revokedAt: null });
    const page2 = (await call(adminToken, "GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/guests?limit=1&cursor=${page1.nextCursor}`)).json();
    expect(page2.grants[0].id).toBe(first);
    expect(page2.grants[0].revokedAt).not.toBeNull();
    expect(page2.nextCursor).toBeNull();
  });

  it("report which optional integrations this deployment registers, to any signed-in person", async () => {
    expect((await call(memberToken, "GET", "/api/v1/integrations")).statusCode).toBe(200);
    const response = await call(adminToken, "GET", "/api/v1/integrations");
    expect(response.json()).toEqual({
      variable: "OPENEOC_INTEGRATIONS",
      integrations: [
        { key: "collab", enabled: false },
        { key: "facilities", enabled: false },
        { key: "meetings", enabled: true },
        { key: "tracking", enabled: false },
      ],
    });
  });
});

describe("position and guest changes take effect and are attributed", () => {
  it("ends a revoked or replaced holder's active sign-in and audits every change", async () => {
    const pos = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`, {
      key: "logistics_chief",
      title: "Logistics Section Chief",
    });
    const positionId = pos.json().id as string;
    const whoami = async (token: string) => (await call(token, "GET", "/api/v1/me")).json().position?.id ?? null;

    // The member holds and signs into the position.
    expect((await call(adminToken, "POST", `/api/v1/positions/${positionId}/assignments`, { personId: seed.memberId })).statusCode).toBe(201);
    expect((await call(memberToken, "POST", `/api/v1/positions/${positionId}/sign-in`)).statusCode).toBeLessThan(300);
    expect(await whoami(memberToken)).toBe(positionId);

    // A reassignment to someone else ends the member's sign-in at once.
    expect((await call(adminToken, "POST", `/api/v1/positions/${positionId}/reassignments`, { personId: crossId })).statusCode).toBe(201);
    expect(await whoami(memberToken)).toBeNull();

    // A revoke ends the incoming holder's sign-in the same way.
    const crossToken = await tokenFor(app, "cross@example.org", "cross-good-password");
    expect((await call(crossToken, "POST", `/api/v1/positions/${positionId}/sign-in`)).statusCode).toBeLessThan(300);
    expect(await whoami(crossToken)).toBe(positionId);
    expect((await call(adminToken, "DELETE", `/api/v1/positions/${positionId}/assignments/${crossId}`)).statusCode).toBe(200);
    expect(await whoami(crossToken)).toBeNull();
    const [open] = await admin`
      select count(*)::int as n from position_signins
      where position_id = ${positionId} and signed_out_at is null`;
    expect(open!.n).toBe(0);

    const grant = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/guests`, {
      personId: viewerId,
      scopes: ["positions:read"],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(grant.statusCode).toBe(201);
    const grantId = grant.json().id as string;
    expect((await call(adminToken, "DELETE", `/api/v1/guests/${grantId}`)).statusCode).toBeLessThan(300);

    const categories = (await admin`
      select category from audit_events
      where subject_id in (${positionId}, ${grantId})
        and category in ('position.assigned', 'position.reassigned', 'position.revoked',
                         'guest.granted', 'guest.revoked')
      order by seq`).map((r) => r.category as string);
    expect(categories).toEqual([
      "position.assigned",
      "position.reassigned",
      "position.revoked",
      "guest.granted",
      "guest.revoked",
    ]);
  });
});
