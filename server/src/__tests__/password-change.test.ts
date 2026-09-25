import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { resetRateLimits } from "../auth/rate-limit.js";
import { freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  app = buildApp(runtime, { oidc: null, requireAdminMfa: false });
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

beforeEach(() => resetRateLimits());

const change = (token: string, currentPassword: string, newPassword: string) => app.inject({
  method: "POST",
  url: "/api/v1/auth/password",
  headers: { authorization: `Bearer ${token}` },
  payload: { currentPassword, newPassword },
});
const me = (token: string) => app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${token}` } });
const login = (email: string, password: string) => app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });

describe("changing one's own password", () => {
  it("refuses a wrong current password, a short new one and the same one, and changes nothing", async () => {
    const token = await tokenFor(app, "member@example.org", "another-good-password");
    expect((await change(token, "not-my-password", "a-brand-new-password")).statusCode).toBe(403);
    expect((await change(token, "another-good-password", "too-short")).statusCode).toBe(400);
    expect((await change(token, "another-good-password", "another-good-password")).statusCode).toBe(400);
    expect((await login("member@example.org", "another-good-password")).statusCode).toBe(200);
  });

  it("changes the password, keeps this session, ends the others and records the change", async () => {
    const other = await tokenFor(app, "member@example.org", "another-good-password");
    const token = await tokenFor(app, "member@example.org", "another-good-password");
    const response = await change(token, "another-good-password", "a-brand-new-password");
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ ok: true, otherSessionsEnded: expect.any(Number) });
    expect(response.json().otherSessionsEnded).toBeGreaterThanOrEqual(1);

    expect((await me(token)).statusCode).toBe(200);
    expect((await me(other)).statusCode).toBe(401);
    expect((await login("member@example.org", "another-good-password")).statusCode).toBe(401);
    expect((await login("member@example.org", "a-brand-new-password")).statusCode).toBe(200);

    const [event] = await admin`
      select category, subject_id, person_id from audit_events
      where category = 'auth.password.changed' and jurisdiction_id = ${seed.jurisdictionId}`;
    expect(event).toMatchObject({ category: "auth.password.changed", subject_id: seed.memberId, person_id: seed.memberId });
  });

  it("locks further attempts after repeated wrong current passwords", async () => {
    const token = await tokenFor(app, "admin@example.org", "correct-horse-battery");
    for (let attempt = 0; attempt < 5; attempt += 1)
      expect((await change(token, "wrong-password", "a-brand-new-password")).statusCode).toBe(403);
    expect((await change(token, "correct-horse-battery", "a-brand-new-password")).statusCode).toBe(429);
  });

  it("needs a signed-in person", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/password", payload: { currentPassword: "x", newPassword: "a-brand-new-password" } });
    expect(response.statusCode).toBe(401);
  });
});
