import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_CONTRACT, generateOpenApi } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { resetRateLimits } from "../auth/rate-limit.js";
import { addMembership, createJurisdiction, createPerson, principalForPerson, principalFromToken } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";

/**
 * Service identities (VC-25), on real PostgreSQL: an administrator creates a
 * named integration with a scope and an expiry and sees its token once; the
 * token reads and writes as that identity inside its jurisdiction and
 * nowhere else, by the server's checks and by row-level security alone;
 * its writes are audited under its own name; revocation, expiry and the
 * loss of its creator's administration refuse the next request and every
 * piece of background work that would run as it; it can never sign in,
 * hold a second factor or a session, or create identities; no stored hash
 * leaves the database; and no token reaches a log, an audit row or a later
 * response. Negative tests for threat row B17.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let karukId: string;
let adminToken: string;
let memberToken: string;
let karukToken: string;
let deputyId: string;
let deputyToken: string;
let boardId: string;
const lines: string[] = [];

const inAMonth = () => new Date(Date.now() + 30 * 86_400_000).toISOString();
const call = (token: string | null, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, ...(token ? { headers: auth(token) } : {}), ...(payload === undefined ? {} : { payload: payload as object }) });
const identities = (jurisdictionId = seed.jurisdictionId) => `/api/v1/jurisdictions/${jurisdictionId}/service-identities`;
const volunteers = (jurisdictionId: string) => `/api/v1/jurisdictions/${jurisdictionId}/volunteers`;

async function create(name: string, role: "viewer" | "member", creatorToken = adminToken) {
  const response = await call(creatorToken, "POST", identities(), { name, role, expiresAt: inAMonth() });
  expect(response.statusCode, response.body).toBe(201);
  const created = response.json() as { identity: { id: string; name: string; role: string }; token: string };
  const [row] = await admin`select person_id from service_identities where id = ${created.identity.id}`;
  return { ...created, personId: row!.person_id as string };
}
/** Whether the scheduler's report discovery would run this identity's report now. */
async function reportDue(personId: string): Promise<boolean> {
  const rows = await admin`select person_id from reports_due(now())`;
  return rows.some((r) => r.person_id === personId);
}
async function scheduleReport(personId: string): Promise<void> {
  await admin`
    insert into reports (jurisdiction_id, board_id, name, definition, schedule, next_run_at, created_by, updated_by)
    values (${seed.jurisdictionId}, ${boardId}, 'Nightly roster', '{}', '{}', now() - interval '1 minute', ${personId}, ${personId})`;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  karukId = await createJurisdiction(admin, "karuk", "Karuk Tribe OES");
  const karukAdmin = await createPerson(admin, { email: "karuk@example.org", displayName: "Karuk Admin", password: "karuk-good-password" });
  await addMembership(admin, karukAdmin, karukId, "admin");
  deputyId = await createPerson(admin, { email: "deputy@example.org", displayName: "Deputy Admin", password: "deputy-good-password" });
  await addMembership(admin, deputyId, seed.jurisdictionId, "admin");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null, logLevel: "info", logStream: { write: (line) => void lines.push(line) }, slowRequestMs: 0 });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  karukToken = await tokenFor(app, "karuk@example.org", "karuk-good-password");
  deputyToken = await tokenFor(app, "deputy@example.org", "deputy-good-password");
  const board = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey: "activity_log" });
  expect(board.statusCode, board.body).toBe(201);
  boardId = board.json().id as string;
  const karukVolunteer = await call(karukToken, "POST", volunteers(karukId), { name: "Karuk Runner", affiliation: "cert" });
  expect(karukVolunteer.statusCode, karukVolunteer.body).toBe(201);
});

afterAll(async () => {
  resetRateLimits();
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("service identities", () => {
  it("are created by a jurisdiction administrator, shown once and stored only as a hash", async () => {
    const response = await call(adminToken, "POST", identities(), { name: "CAD bridge", role: "member", expiresAt: inAMonth() });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    const { identity, token } = response.json() as { identity: Record<string, unknown>; token: string };
    expect(identity).toMatchObject({ name: "CAD bridge", role: "member", createdBy: "Admin", lastUsedAt: null, revokedAt: null });
    expect(token).toMatch(new RegExp(`^oeoc-svc\\.${identity.id as string}\\.[A-Za-z0-9_-]{43}$`));
    const secret = token.split(".").at(-1)!;
    const [stored] = await admin`select * from service_identities where id = ${identity.id as string}`;
    expect(stored!.token_hash).toBe(createHash("sha256").update(secret).digest("hex"));
    const [backing] = await admin`
      select p.service_identity, p.display_name, p.password_hash, m.jurisdiction_id, m.role
      from persons p join jurisdiction_memberships m on m.person_id = p.id where p.id = ${stored!.person_id as string}`;
    expect(backing).toMatchObject({ service_identity: true, display_name: "CAD bridge (service identity)", jurisdiction_id: seed.jurisdictionId, role: "member" });
    const [audit] = await admin`select person_id, payload from audit_events where category = 'service_identity.created'`;
    expect(audit!.person_id).toBe(seed.adminId);
    expect(audit!.payload).toMatchObject({ name: "CAD bridge", role: "member" });
    // Neither the secret nor its hash is anywhere the application can read back.
    const listed = await call(adminToken, "GET", identities());
    expect(listed.statusCode).toBe(200);
    for (const text of [listed.body, JSON.stringify(audit)]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(stored!.token_hash as string);
    }
    await expect(withPerson(runtime, seed.adminId, (tx) => tx`select token_hash from service_identities`))
      .rejects.toThrow(/permission denied/);
    // Nor through the resolution function: it matches a hash the caller
    // computed and answers nothing for a wrong one, never the stored hash.
    const wrong = createHash("sha256").update("A".repeat(43)).digest("hex");
    expect(await runtime`select * from service_identity_credential(${identity.id as string}::uuid, ${wrong})`).toEqual([]);
    const [resolved] = await runtime`
      select * from service_identity_credential(${identity.id as string}::uuid, ${stored!.token_hash as string})`;
    expect(resolved).toMatchObject({ name: "CAD bridge", stopped: null });
    expect(Object.keys(resolved!)).not.toContain("token_hash");
    expect(JSON.stringify(resolved)).not.toContain(stored!.token_hash as string);
  });

  it("refuse a name holding control or invisible characters", async () => {
    for (const name of ["CAD\u202Ebridge", "CAD\u200Bbridge", "\u3164", "CAD\u0007bridge", "CAD\u2028bridge"]) {
      const response = await call(adminToken, "POST", identities(), { name, role: "viewer", expiresAt: inAMonth() });
      expect(response.statusCode, JSON.stringify(name)).toBe(400);
      expect(response.json().error).toBe("name: the name holds a control or invisible character");
    }
  });

  it("refuse a role above member, an expiry out of range, a duplicate live name and anyone but an administrator", async () => {
    for (const [body, status] of [
      [{ name: "Too much", role: "admin", expiresAt: inAMonth() }, 400],
      [{ name: "Past", role: "viewer", expiresAt: new Date(Date.now() - 60_000).toISOString() }, 400],
      [{ name: "Forever", role: "viewer", expiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString() }, 400],
      [{ name: "cad BRIDGE", role: "viewer", expiresAt: inAMonth() }, 409],
    ] as const) {
      const response = await call(adminToken, "POST", identities(), body);
      expect(response.statusCode, `${body.name}: ${response.body}`).toBe(status);
    }
    expect((await call(memberToken, "GET", identities())).statusCode).toBe(403);
    expect((await call(memberToken, "POST", identities(), { name: "Mine", role: "viewer", expiresAt: inAMonth() })).statusCode).toBe(403);
    expect((await call(adminToken, "GET", identities(karukId))).statusCode).toBe(403);
  });

  it("read and write inside the jurisdiction, and are held out of another by the server", async () => {
    const { identity, token } = await create("Roster sync", "member");
    const me = await call(token, "GET", "/api/v1/me");
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ person: { displayName: "Roster sync (service identity)" }, service: { id: identity.id, name: "Roster sync" } });
    expect((await call(token, "GET", volunteers(seed.jurisdictionId))).statusCode).toBe(200);
    const written = await call(token, "POST", volunteers(seed.jurisdictionId), { name: "Yurok Runner", affiliation: "cert" });
    expect(written.statusCode, written.body).toBe(201);
    // Out of scope: the other jurisdiction, read or write.
    expect((await call(token, "GET", volunteers(karukId))).statusCode).toBe(403);
    expect((await call(token, "POST", volunteers(karukId), { name: "Intruder", affiliation: "cert" })).statusCode).toBe(403);
    // The write is attributed to the identity, never to a person.
    const [event] = await admin`
      select e.person_id, p.display_name, p.service_identity from audit_events e join persons p on p.id = e.person_id
      where e.category = 'volunteer.saved' and e.subject_id = ${written.json().id as string}`;
    expect(event).toMatchObject({ display_name: "Roster sync (service identity)", service_identity: true });
    const chronology = await call(adminToken, "GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/chronology`);
    expect(chronology.json().entries.find((e: { category: string }) => e.category === "volunteer.saved").person)
      .toBe("Roster sync (service identity)");
    // Last use shows on the list.
    const listed = (await call(adminToken, "GET", identities())).json().identities as Array<{ id: string; lastUsedAt: string | null }>;
    expect(listed.find((i) => i.id === identity.id)!.lastUsedAt).not.toBeNull();
  });

  it("are held to their jurisdiction by row-level security even where a route forgets its check", async () => {
    const { identity } = await create("Forgetful route", "member");
    const [row] = await admin`select person_id from service_identities where id = ${identity.id}`;
    const personId = row!.person_id as string;
    // What a route with no check of its own would run, as this identity.
    const seen = await withPerson(runtime, personId, (tx) => tx`select name, jurisdiction_id from volunteers`);
    expect(seen.map((v) => v.jurisdiction_id)).not.toContain(karukId);
    expect(seen.map((v) => v.name)).toContain("Yurok Runner");
    const karukAudit = await withPerson(runtime, personId, (tx) => tx`select id from audit_events where jurisdiction_id = ${karukId}`);
    expect(karukAudit).toEqual([]);
    await expect(withPerson(runtime, personId, (tx) => tx`
      insert into volunteers (jurisdiction_id, name, affiliation, created_by, updated_by)
      values (${karukId}, 'Planted', 'cert', ${personId}, ${personId})`)).rejects.toThrow(/row-level security/);
  });

  it("with the viewer role only read, and cannot create identities or act as a person", async () => {
    const { token } = await create("Wall display", "viewer");
    expect((await call(token, "GET", volunteers(seed.jurisdictionId))).statusCode).toBe(200);
    const write = await call(token, "POST", volunteers(seed.jurisdictionId), { name: "Nope", affiliation: "cert" });
    expect(write.statusCode).toBe(403);
    expect(write.json().error).toBe("this service identity may only read");
    const member = await create("Integration admin", "member");
    for (const [method, url, payload] of [
      ["POST", identities(), { name: "Child", role: "viewer", expiresAt: inAMonth() }],
      ["GET", identities()],
      ["POST", "/api/v1/auth/logout"],
      ["POST", "/api/v1/auth/password", { currentPassword: "x", newPassword: "long-enough-password" }],
      ["POST", "/api/v1/positions/sign-out"],
    ] as const) {
      const response = await call(member.token, method, url, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("can never sign in, hold a session, a second factor, a position, a guest grant or another membership", async () => {
    const { identity } = await create("Locked down", "member");
    const [row] = await admin`
      select s.person_id, p.email from service_identities s join persons p on p.id = s.person_id where s.id = ${identity.id}`;
    const personId = row!.person_id as string;
    const login = await call(null, "POST", "/api/v1/auth/login", { email: row!.email, password: "!service-identity" });
    expect(login.statusCode).toBe(401);
    expect(await admin`select * from find_person_by_email(${row!.email as string})`).toEqual([]);
    const [position] = await admin`insert into positions (jurisdiction_id, key, title) values (${seed.jurisdictionId}, 'liaison', 'Liaison') returning id`;
    for (const statement of [
      admin`select create_auth_session(${personId}, ${"a".repeat(64)}, ${"b".repeat(64)}, now() + interval '1 hour')`,
      admin`insert into person_mfa (person_id, secret_envelope) values (${personId}, 'sealed')`,
      admin`insert into position_assignments (position_id, person_id, assigned_by) values (${position!.id as string}, ${personId}, ${seed.adminId})`,
      admin`insert into guest_grants (jurisdiction_id, person_id, scopes, expires_at, created_by)
            values (${karukId}, ${personId}, ${["positions:read"]}, now() + interval '1 day', ${seed.adminId})`,
      admin`insert into jurisdiction_memberships (person_id, jurisdiction_id, role) values (${personId}, ${karukId}, 'viewer')`,
      admin`update jurisdiction_memberships set role = 'admin' where person_id = ${personId}`,
    ]) {
      await expect(statement).rejects.toThrow(/service identity/);
    }
    // Through the screen's routes: not listed as a person, and its role is fixed.
    const members = (await call(adminToken, "GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/members`)).json().members as Array<{ personId: string }>;
    expect(members.map((m) => m.personId)).not.toContain(personId);
    expect((await call(adminToken, "GET", `/api/v1/persons?email=${encodeURIComponent(row!.email as string)}`)).statusCode).toBe(404);
    const promote = await call(adminToken, "PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/members/${personId}`, { role: "admin" });
    expect(promote.statusCode).toBe(409);
  });

  it("are refused on the next request once revoked or expired", async () => {
    const { identity, token } = await create("Short lived", "member");
    expect((await call(token, "GET", volunteers(seed.jurisdictionId))).statusCode).toBe(200);
    const revoked = await call(adminToken, "DELETE", `/api/v1/service-identities/${identity.id}`);
    expect(revoked.statusCode, revoked.body).toBe(200);
    const after = await call(token, "GET", volunteers(seed.jurisdictionId));
    expect(after.statusCode).toBe(401);
    expect(after.json().error).toBe("this service identity was revoked");
    expect((await call(adminToken, "DELETE", `/api/v1/service-identities/${identity.id}`)).statusCode).toBe(409);
    expect((await call(karukToken, "DELETE", `/api/v1/service-identities/${identity.id}`)).statusCode).toBe(404);
    const [state] = await admin`
      select s.revoked_by, p.disabled from service_identities s join persons p on p.id = s.person_id where s.id = ${identity.id}`;
    expect(state).toMatchObject({ revoked_by: seed.adminId, disabled: true });
    const [audit] = await admin`select person_id, payload from audit_events where category = 'service_identity.revoked'`;
    expect(audit).toMatchObject({ person_id: seed.adminId, payload: { name: "Short lived" } });
    const listed = (await call(adminToken, "GET", identities())).json().identities as Array<{ id: string; revokedBy: string | null }>;
    expect(listed.find((i) => i.id === identity.id)!.revokedBy).toBe("Admin");

    const lapsing = await create("Lapsing", "viewer");
    expect((await call(lapsing.token, "GET", volunteers(seed.jurisdictionId))).statusCode).toBe(200);
    await admin`
      update service_identities set created_at = now() - interval '2 days', expires_at = now() - interval '1 second'
      where id = ${lapsing.identity.id}`;
    const expired = await call(lapsing.token, "GET", volunteers(seed.jurisdictionId));
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error).toBe("this service identity has expired");

    // An administrator who disables the backing row through the People routes stops it too.
    const paused = await create("Paused", "viewer");
    const [backing] = await admin`select person_id from service_identities where id = ${paused.identity.id}`;
    const disable = await call(adminToken, "PUT",
      `/api/v1/jurisdictions/${seed.jurisdictionId}/members/${backing!.person_id as string}/disabled`, { disabled: true });
    expect(disable.statusCode, disable.body).toBe(200);
    const disabled = await call(paused.token, "GET", volunteers(seed.jurisdictionId));
    expect(disabled.statusCode).toBe(401);
    expect(disabled.json().error).toBe("this service identity is disabled");
  });

  it("stop background work as well: expiry, and revocation that an administrator tries to undo", async () => {
    const lapsing = await create("Lapsing sender", "member");
    await scheduleReport(lapsing.personId);
    expect(await reportDue(lapsing.personId)).toBe(true);
    expect((await principalForPerson(runtime, lapsing.personId)).memberships).toEqual([{ jurisdictionId: seed.jurisdictionId, role: "member" }]);
    await admin`
      update service_identities set created_at = now() - interval '2 days', expires_at = now() - interval '1 second'
      where id = ${lapsing.identity.id}`;
    // What the scheduled report job resolves for the owner is now refused, and discovery skips it.
    await expect(principalForPerson(runtime, lapsing.personId)).rejects.toThrow(/person unavailable/);
    expect(await reportDue(lapsing.personId)).toBe(false);
    await admin`update persons set disabled = true where id = ${lapsing.personId}`;
    const lapsedEnable = await call(adminToken, "PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/members/${lapsing.personId}/disabled`, { disabled: false });
    expect(lapsedEnable.statusCode).toBe(403);

    const revoked = await create("Revoked sender", "member");
    await scheduleReport(revoked.personId);
    expect((await call(adminToken, "DELETE", `/api/v1/service-identities/${revoked.identity.id}`)).statusCode).toBe(200);
    const enable = await call(adminToken, "PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/members/${revoked.personId}/disabled`, { disabled: false });
    expect(enable.statusCode).toBe(403);
    expect(enable.json().error).toBe("a service identity that is revoked, expired or without its creator cannot be enabled");
    const [flag] = await admin`select disabled from persons where id = ${revoked.personId}`;
    expect(flag!.disabled).toBe(true);
    await expect(principalForPerson(runtime, revoked.personId)).rejects.toThrow(/person unavailable/);
    expect(await reportDue(revoked.personId)).toBe(false);
    // Even with the flag cleared behind the routes, the identity may not act.
    await admin`update persons set disabled = false where id = ${revoked.personId}`;
    await expect(principalForPerson(runtime, revoked.personId)).rejects.toThrow(/person unavailable/);
    expect(await reportDue(revoked.personId)).toBe(false);
    expect((await call(revoked.token, "GET", "/api/v1/me")).json().error).toBe("this service identity was revoked");
  });

  it("work only while their creator is an enabled administrator of the jurisdiction", async () => {
    const orphan = await create("Deputy feed", "member", deputyToken);
    await scheduleReport(orphan.personId);
    expect((await call(orphan.token, "GET", volunteers(seed.jurisdictionId))).statusCode).toBe(200);
    expect(await reportDue(orphan.personId)).toBe(true);
    const state = async () => ((await call(adminToken, "GET", identities())).json().identities as Array<{ id: string; createdBy: string; stopped: string | null }>)
      .find((i) => i.id === orphan.identity.id)!;
    expect(await state()).toMatchObject({ createdBy: "Deputy Admin", stopped: null });

    // The deputy stops administering here: the identity stops at its next request and in the background.
    expect((await call(adminToken, "PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/members/${deputyId}`, { role: "member" })).statusCode).toBe(200);
    const refused = await call(orphan.token, "GET", volunteers(seed.jurisdictionId));
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error).toBe("this service identity is stopped: the administrator who created it no longer administers its jurisdiction");
    await expect(principalForPerson(runtime, orphan.personId)).rejects.toThrow(/person unavailable/);
    expect(await reportDue(orphan.personId)).toBe(false);
    expect(await state()).toMatchObject({ stopped: "creator" });

    // Restored, it works again; disabled, it stops again.
    expect((await call(adminToken, "PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/members/${deputyId}`, { role: "admin" })).statusCode).toBe(200);
    expect((await call(orphan.token, "GET", volunteers(seed.jurisdictionId))).statusCode).toBe(200);
    expect(await reportDue(orphan.personId)).toBe(true);
    expect((await call(adminToken, "PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/members/${deputyId}/disabled`, { disabled: true })).statusCode).toBe(200);
    expect((await call(orphan.token, "GET", volunteers(seed.jurisdictionId))).statusCode).toBe(401);
    expect(await reportDue(orphan.personId)).toBe(false);
    expect((await call(adminToken, "PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/members/${deputyId}/disabled`, { disabled: false })).statusCode).toBe(200);
    expect((await call(orphan.token, "GET", volunteers(seed.jurisdictionId))).statusCode).toBe(200);
  });

  it("are not found by the people import or an incident participation by email, and a guard answers 403, not 500", async () => {
    const karukIdentity = await call(karukToken, "POST", identities(karukId), { name: "Karuk bridge", role: "member", expiresAt: inAMonth() });
    expect(karukIdentity.statusCode, karukIdentity.body).toBe(201);
    const [karukRow] = await admin`
      select s.person_id, p.email from service_identities s join persons p on p.id = s.person_id
      where s.id = ${karukIdentity.json().identity.id as string}`;
    const own = await create("Import target", "member");
    const [ownRow] = await admin`select email from persons where id = ${own.personId}`;

    // People import: the row is refused with its reason; the rest of the file goes in.
    const form = new FormData();
    form.append("file", new Blob([`email,name,role,positions\n${ownRow!.email as string},Nobody,member,\nnewhire@example.org,New Hire,viewer,\n`], { type: "text/csv" }), "staff.csv");
    const request = new Request("http://upload.invalid/", { method: "POST", body: form });
    const imported = await app.inject({
      method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/people-import?dryRun=true`,
      headers: { ...auth(adminToken), "content-type": request.headers.get("content-type")! },
      payload: Buffer.from(await request.arrayBuffer()),
    });
    expect(imported.statusCode, imported.body).toBe(200);
    const outcomes = imported.json().outcomes as Array<{ row: number; outcome: string; detail: string }>;
    expect(outcomes.find((r) => r.row === 2)).toMatchObject({ outcome: "refused", detail: "email belongs to a service identity, not a person" });
    expect(outcomes.find((r) => r.row === 3)).toMatchObject({ outcome: "created" });

    // Incident participation by email: not found, where it used to reach the guard.
    const incident = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, { templateKey: "daily_ops", name: "River Road" });
    expect(incident.statusCode, incident.body).toBe(201);
    const grant = await call(adminToken, "POST", `/api/v1/incidents/${incident.json().incidentId as string}/participants`, {
      organizationSlug: "karuk", personEmail: karukRow!.email, incidentPositionTitle: "Liaison", role: "viewer",
      expiresAt: inAMonth(), reason: "Joint response",
    });
    expect(grant.statusCode, grant.body).toBe(404);

    // Paths that name the backing row by id reach the database guard, which answers 403 in plain words.
    const position = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`, { key: "gis", title: "GIS Specialist" });
    const assigned = await call(adminToken, "POST", `/api/v1/positions/${position.json().id as string}/assignments`, { personId: own.personId });
    expect(assigned.statusCode).toBe(403);
    expect(assigned.json().error).toBe("a service identity cannot hold a position");
    const guest = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/guests`, {
      personId: karukRow!.person_id, scopes: ["positions:read"], expiresAt: inAMonth(),
    });
    expect(guest.statusCode).toBe(403);
    expect(guest.json().error).toBe("a service identity cannot hold a guest grant");
  });

  it("are refused on every route the contract marks person only, and on the WebSocket channels", async () => {
    const { token, identity } = await create("Person-only probe", "member");
    const personOnly = API_CONTRACT.rest.filter((e) => e.personOnly);
    expect(personOnly).toHaveLength(10);
    const fill = (path: string) => path.replace(/:[A-Za-z]+/g, (param) => param === ":jurisdictionId" ? seed.jurisdictionId : identity.id);
    for (const e of personOnly.filter((route) => !route.path.endsWith("/stream") && !route.path.includes("/sync/"))) {
      const response = await call(token, e.method as "GET" | "POST" | "DELETE", fill(e.path), e.method === "POST" ? {} : undefined);
      expect(response.statusCode, `${e.method} ${e.path}`).toBe(403);
    }
    // The three WebSocket channels sign in with a session token only.
    await expect(principalFromToken(runtime, token)).rejects.toThrow(/not authenticated/);
    const described = generateOpenApi() as { paths: Record<string, Record<string, { security: unknown }>> };
    for (const e of personOnly) {
      expect(described.paths[e.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")]![e.method.toLowerCase()]!.security).toEqual([{ personSession: [] }]);
    }
  });

  it("serve the OpenAPI document to a signed-in caller and a service identity, never to an anonymous one", async () => {
    const { token } = await create("API reader", "viewer");
    expect((await call(null, "GET", "/api/v1/openapi.json")).statusCode).toBe(401);
    const viaService = await call(token, "GET", "/api/v1/openapi.json");
    expect(viaService.statusCode).toBe(200);
    expect(viaService.json()).toEqual(generateOpenApi());
    expect((await call(memberToken, "GET", "/api/v1/openapi.json")).statusCode).toBe(200);
  });

  it("refuse a forged secret and lock a guessing address out without shutting out a valid token from it", async () => {
    const { identity, token } = await create("Guessed", "viewer");
    resetRateLimits();
    const forged = `oeoc-svc.${identity.id}.${"A".repeat(43)}`;
    for (const bad of [forged, "oeoc-svc.not-a-token", `oeoc-svc.${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}.${"A".repeat(43)}`]) {
      const response = await call(bad, "GET", volunteers(seed.jurisdictionId));
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe("not authenticated");
    }
    await call(forged, "GET", volunteers(seed.jurisdictionId));
    await call(forged, "GET", volunteers(seed.jurisdictionId));
    // Five failures lock the address's failed attempts out...
    expect((await call(forged, "GET", volunteers(seed.jurisdictionId))).statusCode).toBe(429);
    expect((await call("oeoc-svc.junk", "GET", volunteers(seed.jurisdictionId))).statusCode).toBe(429);
    // ...while a valid token from the same address still works.
    expect((await call(token, "GET", volunteers(seed.jurisdictionId))).statusCode).toBe(200);
    expect((await call(token, "GET", "/api/v1/me")).statusCode).toBe(200);
    resetRateLimits();
    const logs = lines.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toContain(token.split(".").at(-1)!);
    expect(logs).not.toContain("oeoc-svc.");
  });
});
