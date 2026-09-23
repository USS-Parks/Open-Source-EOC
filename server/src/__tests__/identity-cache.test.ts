import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp, trustProxyFromEnv } from "../app.js";
import { cachedPrincipal, forgetSession } from "../auth/principal-cache.js";
import { checkAllowed, recordFailure, resetRateLimits } from "../auth/rate-limit.js";
import { createPerson, type Principal } from "../auth/service.js";
import { rateLimit, resetRateLimit } from "../security/rate-limit.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  const rootId = await createPerson(admin, {
    email: "root@example.org",
    displayName: "Instance Admin",
    password: "instance-admin-pass",
  });
  await admin`update persons set is_instance_admin = true where id = ${rootId}`;
  await createPerson(admin, {
    email: "guest@example.org",
    displayName: "Guest",
    password: "guest-good-password",
  });
  app = buildApp(runtime, { oidc: null });
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

afterEach(() => {
  vi.useRealTimers();
  resetRateLimits();
});

/** Move the clock the application reads past `ms`, leaving timers real. */
function advance(ms: number): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + ms);
}

const me = (token: string) => app.inject({ method: "GET", url: "/api/v1/me", headers: auth(token) });

describe("login backoff bounds", () => {
  it("forgets an email's failures fifteen minutes after the last one", async () => {
    const login = (password: string) => app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "member@example.org", password },
    });
    for (let i = 0; i < 4; i++) expect((await login("wrong")).statusCode).toBe(401);
    advance(15 * 60_000 + 1000);
    expect((await login("wrong")).statusCode).toBe(401);
    expect((await login("another-good-password")).statusCode).toBe(200);
  });

  it("caps its table, dropping the stalest keys first", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) recordFailure("victim@example.org", t0);
    expect(checkAllowed("victim@example.org", t0)).toBe(false);
    for (let i = 0; i < 10_000; i++) recordFailure(`spray-${i}@example.org`, t0 + 1);
    expect(checkAllowed("victim@example.org", t0 + 2)).toBe(true);
    expect(checkAllowed("spray-9999@example.org", t0 + 2)).toBe(true);
  });
});

describe("flood limiter bound", () => {
  it("caps its client table, dropping the oldest windows first", () => {
    const t0 = 2_000_000;
    expect(rateLimit("first-client", 1, 60_000, t0).allowed).toBe(true);
    expect(rateLimit("first-client", 1, 60_000, t0).allowed).toBe(false);
    for (let i = 0; i < 20_000; i++) rateLimit(`client-${i}`, 1, 60_000, t0);
    expect(rateLimit("first-client", 1, 60_000, t0).allowed).toBe(true);
    resetRateLimit();
  });
});

describe("trusted proxies", () => {
  it("reads X-Forwarded-For only from a configured proxy", async () => {
    const direct = buildApp(runtime, { oidc: null, trustProxy: false });
    const proxied = buildApp(runtime, { oidc: null, trustProxy: "10.0.0.2" });
    for (const a of [direct, proxied]) a.get("/client-ip", async (req) => ({ ip: req.ip }));
    const ip = async (a: FastifyInstance, remoteAddress: string) => (await a.inject({
      method: "GET",
      url: "/client-ip",
      remoteAddress,
      headers: { "x-forwarded-for": "203.0.113.9" },
    })).json().ip as string;
    expect(await ip(direct, "10.0.0.2")).toBe("10.0.0.2");
    expect(await ip(proxied, "198.51.100.7")).toBe("198.51.100.7");
    expect(await ip(proxied, "10.0.0.2")).toBe("203.0.113.9");
    await direct.close();
    await proxied.close();

    expect(trustProxyFromEnv("")).toBe(false);
    expect(trustProxyFromEnv("false")).toBe(false);
    expect(trustProxyFromEnv("true")).toBe(true);
    expect(trustProxyFromEnv(" 10.0.0.2, 172.16.0.0/12 ")).toBe("10.0.0.2, 172.16.0.0/12");
  });
});

describe("principal cache", () => {
  it("serves repeat requests from the cache until the TTL lapses", async () => {
    const token = await tokenFor(app, "member@example.org", "another-good-password");
    expect((await me(token)).json().person.displayName).toBe("Member");
    await admin`update persons set display_name = 'Renamed Member' where id = ${seed.memberId}`;
    expect((await me(token)).json().person.displayName).toBe("Member");
    advance(5001);
    expect((await me(token)).json().person.displayName).toBe("Renamed Member");
    await admin`update persons set display_name = 'Member' where id = ${seed.memberId}`;
  });

  it("never keeps an entry past the session's access expiry", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "member@example.org", password: "another-good-password" },
    });
    const { accessToken, sessionId } = login.json() as { accessToken: string; sessionId: string };
    await admin`
      update auth_sessions set access_expires_at = now() + interval '2 seconds'
      where id = ${sessionId}`;
    expect((await me(accessToken)).statusCode).toBe(200);
    advance(3000);
    const expired = await me(accessToken);
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error).toBe("session expired");
  });

  it("drops a session's entry at sign-out", async () => {
    const token = await tokenFor(app, "member@example.org", "another-good-password");
    expect((await me(token)).statusCode).toBe(200);
    const out = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: auth(token) });
    expect(out.statusCode).toBe(200);
    expect((await me(token)).statusCode).toBe(401);
  });

  it("shows position sign-in and sign-out on the next request", async () => {
    const [position] = await admin`
      insert into positions (jurisdiction_id, key, title)
      values (${seed.jurisdictionId}, 'cache_duty', 'Cache Duty') returning id`;
    const positionId = position!.id as string;
    await admin`
      insert into position_assignments (position_id, person_id, assigned_by)
      values (${positionId}, ${seed.memberId}, ${seed.adminId})`;
    const token = await tokenFor(app, "member@example.org", "another-good-password");
    expect((await me(token)).json().position).toBeNull();
    const signIn = await app.inject({
      method: "POST",
      url: `/api/v1/positions/${positionId}/sign-in`,
      headers: auth(token),
    });
    expect(signIn.statusCode).toBe(200);
    expect((await me(token)).json().position.key).toBe("cache_duty");
    await app.inject({ method: "POST", url: "/api/v1/positions/sign-out", headers: auth(token) });
    expect((await me(token)).json().position).toBeNull();
  });

  it("applies a role granted through the API at once and one changed out of band within the TTL", async () => {
    const root = await tokenFor(app, "root@example.org", "instance-admin-pass");
    const member = await tokenFor(app, "member@example.org", "another-good-password");
    expect((await me(member)).json().memberships).toHaveLength(1);
    const provisioned = await app.inject({
      method: "POST",
      url: "/api/v1/provision/jurisdictions",
      headers: auth(root),
      payload: { slug: "karuk", name: "Karuk Tribe OES", adminPersonId: seed.memberId },
    });
    expect(provisioned.statusCode).toBe(201);
    const karukId = provisioned.json().jurisdictionId as string;
    const createPosition = (key: string) => app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${karukId}/positions`,
      headers: auth(member),
      payload: { key, title: "Cache Check" },
    });
    expect((await createPosition("granted_check")).statusCode).toBe(201);

    // No route demotes an admin in this version; an operator does it in SQL,
    // and the cached principal catches up when its TTL lapses.
    await admin`
      update jurisdiction_memberships set role = 'member'
      where person_id = ${seed.memberId} and jurisdiction_id = ${karukId}`;
    advance(5001);
    expect((await me(member)).json().memberships).toContainEqual({ jurisdictionId: karukId, role: "member" });
    expect((await createPosition("demoted_check")).statusCode).toBe(403);
  });

  it("applies a guest grant and its revocation on the next request", async () => {
    const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
    const guest = await tokenFor(app, "guest@example.org", "guest-good-password");
    const [guestRow] = await admin`select id from persons where email = 'guest@example.org'`;
    const list = () => app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`,
      headers: auth(guest),
    });
    expect((await list()).statusCode).toBe(403);
    const grant = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/guests`,
      headers: auth(adminToken),
      payload: {
        personId: guestRow!.id as string,
        scopes: ["positions:read"],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    expect(grant.statusCode).toBe(201);
    expect((await list()).statusCode).toBe(200);
    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/v1/guests/${grant.json().id as string}`,
      headers: auth(adminToken),
    });
    expect(revoke.statusCode).toBe(200);
    expect((await list()).statusCode).toBe(403);
  });

  it("does not keep a principal loaded across an invalidation", async () => {
    const principal = { sessionId: "race-session", person: { id: "p" }, guests: [] } as unknown as Principal;
    const later = new Date(Date.now() + 60_000);
    let loads = 0;
    let release = (): void => undefined;
    // The loader starts synchronously, so the forget below lands mid-load.
    const pending = cachedPrincipal("race-hash", async () => {
      loads += 1;
      await new Promise<void>((resolve) => { release = resolve; });
      return { principal, accessExpiresAt: later };
    });
    forgetSession("race-session");
    release();
    await pending;
    const load = async () => { loads += 1; return { principal, accessExpiresAt: later }; };
    await cachedPrincipal("race-hash", load);
    expect(loads).toBe(2);
    await cachedPrincipal("race-hash", load);
    expect(loads).toBe(2);
  });
});
