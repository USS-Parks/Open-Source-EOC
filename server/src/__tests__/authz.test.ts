import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createPerson } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let instanceAdminId: string;
let guestId: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  instanceAdminId = await createPerson(admin, {
    email: "root@example.org",
    displayName: "Instance Admin",
    password: "instance-admin-pass",
  });
  await admin`update persons set is_instance_admin = true where id = ${instanceAdminId}`;
  guestId = await createPerson(admin, {
    email: "mutualaid@example.org",
    displayName: "Mutual Aid",
    password: "mutual-aid-password",
  });
  app = buildApp(runtime, { oidc: null });
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

describe("provisioning (F16, one action)", () => {
  let hoopaId: string;

  it("an instance admin provisions a jurisdiction with the ICS position set", async () => {
    const token = await tokenFor("root@example.org", "instance-admin-pass");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/provision/jurisdictions",
      headers: { authorization: `Bearer ${token}` },
      payload: { slug: "hoopa", name: "Hoopa Valley OES", adminPersonId: seed.adminId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().positions).toBe(8);
    hoopaId = res.json().jurisdictionId as string;

    const adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${hoopaId}/positions`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(list.statusCode).toBe(200);
    const keys = list.json().positions.map((p: { key: string }) => p.key);
    expect(keys).toContain("incident_commander");
    expect(keys).toContain("operations_section_chief");
    expect(keys).toHaveLength(8);
  });

  it("a non-instance-admin cannot provision", async () => {
    const token = await tokenFor("member@example.org", "another-good-password");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/provision/jurisdictions",
      headers: { authorization: `Bearer ${token}` },
      payload: { slug: "rogue", name: "Rogue Org", adminPersonId: seed.memberId },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("cross-jurisdiction default deny (INV-7)", () => {
  it("a member of one jurisdiction cannot read another's positions", async () => {
    const [hoopa] = await admin`select id from jurisdictions where slug = 'hoopa'`;
    const token = await tokenFor("member@example.org", "another-good-password");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${hoopa!.id as string}/positions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("the RLS wall hides foreign rows even from a direct query", async () => {
    const [hoopa] = await admin`select id from jurisdictions where slug = 'hoopa'`;
    const rows = await withPerson(
      runtime,
      seed.memberId,
      (tx) => tx`select id from positions where jurisdiction_id = ${hoopa!.id as string}`,
    );
    expect(rows).toHaveLength(0);
    // The same query as superuser sees all eight: the wall, not the data, differs.
    const all = await admin`
      select id from positions where jurisdiction_id = ${hoopa!.id as string}`;
    expect(all).toHaveLength(8);
  });

  it("an unbound query sees no tenant rows at all (fail closed)", async () => {
    const rows = await runtime`select id from positions`;
    expect(rows).toHaveLength(0);
  });
});

describe("identity-table RLS (parity audit finding 1)", () => {
  it("sessions are visible only to their own person, and never without a context", async () => {
    await tokenFor("admin@example.org", "correct-horse-battery"); // mints an admin session
    await tokenFor("member@example.org", "another-good-password"); // mints a member session
    const adminSessions = await withPerson(
      runtime,
      seed.adminId,
      (tx) => tx`select person_id from auth_sessions`,
    );
    expect(adminSessions.length).toBeGreaterThan(0);
    expect(adminSessions.every((r) => (r.person_id as string) === seed.adminId)).toBe(true);
    // The member cannot see the admin's session rows.
    const memberSees = await withPerson(
      runtime,
      seed.memberId,
      (tx) => tx`select id from auth_sessions where person_id = ${seed.adminId}`,
    );
    expect(memberSees).toHaveLength(0);
    // No person context: fail closed.
    expect(await runtime`select id from auth_sessions`).toHaveLength(0);
  });

  it("persons and jurisdictions read across tenants when authenticated, deny without a context, and the app role cannot rewrite a person", async () => {
    // Cross-tenant attribution needs any authenticated actor to read names.
    const [people] = await withPerson(
      runtime,
      seed.memberId,
      (tx) => tx`select count(*)::int as n from persons`,
    );
    expect(people!.n as number).toBeGreaterThan(1);
    const [juris] = await withPerson(
      runtime,
      seed.memberId,
      (tx) => tx`select count(*)::int as n from jurisdictions`,
    );
    expect(juris!.n as number).toBeGreaterThan(0);
    // No person context: fail closed.
    expect(await runtime`select id from persons`).toHaveLength(0);
    expect(await runtime`select id from jurisdictions`).toHaveLength(0);
    // The app role has no update path on persons: the write silently affects
    // no rows (RLS grants none), so the record is unchanged.
    await withPerson(
      runtime,
      seed.adminId,
      (tx) => tx`update persons set display_name = 'hacked' where id = ${seed.memberId}`,
    );
    const [row] = await admin`select display_name from persons where id = ${seed.memberId}`;
    expect(row!.display_name).not.toBe("hacked");
  });
});

describe("mutual-aid guest access (R3)", () => {
  let grantId: string;

  it("an admin issues a time-boxed positions:read grant and the guest can read", async () => {
    const adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/guests`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        personId: guestId,
        scopes: ["positions:read"],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    expect(res.statusCode).toBe(201);
    grantId = res.json().id as string;

    const guestToken = await tokenFor("mutualaid@example.org", "mutual-aid-password");
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`,
      headers: { authorization: `Bearer ${guestToken}` },
    });
    expect(list.statusCode).toBe(200);
  });

  it("a guest can never write: position creation and self-granting fail", async () => {
    const guestToken = await tokenFor("mutualaid@example.org", "mutual-aid-password");
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`,
      headers: { authorization: `Bearer ${guestToken}` },
      payload: { key: "guest_made", title: "Guest Made" },
    });
    expect(create.statusCode).toBe(403);
    const selfGrant = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/guests`,
      headers: { authorization: `Bearer ${guestToken}` },
      payload: {
        personId: guestId,
        scopes: ["positions:read"],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    expect(selfGrant.statusCode).toBe(403);
  });

  it("an expired grant stops working at both walls", async () => {
    await admin`update guest_grants set expires_at = now() - interval '1 minute'
      where id = ${grantId}`;
    const guestToken = await tokenFor("mutualaid@example.org", "mutual-aid-password");
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`,
      headers: { authorization: `Bearer ${guestToken}` },
    });
    expect(list.statusCode).toBe(403);
    const rows = await withPerson(
      runtime,
      guestId,
      (tx) => tx`select id from positions where jurisdiction_id = ${seed.jurisdictionId}`,
    );
    expect(rows).toHaveLength(0);
  });
});
