import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { resetRateLimits } from "../auth/rate-limit.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let sql: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;

beforeAll(async () => {
  sql = await freshDb();
  seed = await seedIdentity(sql);
  app = buildApp(sql);
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

beforeEach(() => resetRateLimits());

async function loginAs(email: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  return { status: res.statusCode, body: res.json() };
}

describe("login", () => {
  it("issues access and resume tokens for valid credentials", async () => {
    const { status, body } = await loginAs("admin@example.org", "correct-horse-battery");
    expect(status).toBe(200);
    expect(body.accessToken).toBeTruthy();
    expect(body.resumeToken).toBeTruthy();
  });

  it("rejects a wrong password and an unknown user identically", async () => {
    const wrong = await loginAs("admin@example.org", "nope-nope-nope");
    const unknown = await loginAs("ghost@example.org", "nope-nope-nope");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("locks an email after five consecutive failures", async () => {
    for (let i = 0; i < 5; i++) await loginAs("member@example.org", "bad");
    const locked = await loginAs("member@example.org", "another-good-password");
    expect(locked.status).toBe(429);
  });
});

describe("principal and position login", () => {
  it("carries person and position on every authenticated request", async () => {
    const { body } = await loginAs("admin@example.org", "correct-horse-battery");
    const auth = { authorization: `Bearer ${body.accessToken}` };

    const posRes = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`,
      headers: auth,
      payload: { key: "ops_chief", title: "Operations Section Chief" },
    });
    expect(posRes.statusCode).toBe(201);
    const positionId = posRes.json().id as string;

    const assign = await app.inject({
      method: "POST",
      url: `/api/v1/positions/${positionId}/assignments`,
      headers: auth,
      payload: { personId: seed.adminId },
    });
    expect(assign.statusCode).toBe(201);

    const signIn = await app.inject({
      method: "POST",
      url: `/api/v1/positions/${positionId}/sign-in`,
      headers: auth,
    });
    expect(signIn.statusCode).toBe(200);

    const me = await app.inject({ method: "GET", url: "/api/v1/me", headers: auth });
    expect(me.json().person.email).toBe("admin@example.org");
    expect(me.json().position.key).toBe("ops_chief");
  });

  it("refuses sign-in without an active assignment", async () => {
    const { body } = await loginAs("member@example.org", "another-good-password");
    const auth = { authorization: `Bearer ${body.accessToken}` };
    const [pos] = await sql`select id from positions where key = 'ops_chief'`;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/positions/${pos!.id as string}/sign-in`,
      headers: auth,
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses position creation and assignment by non-admins", async () => {
    const { body } = await loginAs("member@example.org", "another-good-password");
    const auth = { authorization: `Bearer ${body.accessToken}` };
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`,
      headers: auth,
      payload: { key: "self_made", title: "Self Made Chief" },
    });
    expect(create.statusCode).toBe(403);
    const [pos] = await sql`select id from positions where key = 'ops_chief'`;
    const assign = await app.inject({
      method: "POST",
      url: `/api/v1/positions/${pos!.id as string}/assignments`,
      headers: auth,
      payload: { personId: seed.memberId },
    });
    expect(assign.statusCode).toBe(403);
  });
});

describe("session continuity (INV-8)", () => {
  it("an expired access token renews via resume with position retained", async () => {
    const { body } = await loginAs("admin@example.org", "correct-horse-battery");
    const auth = { authorization: `Bearer ${body.accessToken}` };
    const [pos] = await sql`select id from positions where key = 'ops_chief'`;
    await app.inject({
      method: "POST",
      url: `/api/v1/positions/${pos!.id as string}/sign-in`,
      headers: auth,
    });

    // Force expiry server-side, as a long shift would.
    await sql`
      update auth_sessions set access_expires_at = now() - interval '1 minute'
      where id = ${body.sessionId}`;
    const expired = await app.inject({ method: "GET", url: "/api/v1/me", headers: auth });
    expect(expired.statusCode).toBe(401);

    const renewed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resume",
      payload: { resumeToken: body.resumeToken },
    });
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json().sessionId).toBe(body.sessionId);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${renewed.json().accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().sessionId).toBe(body.sessionId);
    expect(me.json().position.key).toBe("ops_chief");
  });

  it("logout ends the session and closes open position sign-ins", async () => {
    const { body } = await loginAs("admin@example.org", "correct-horse-battery");
    const auth = { authorization: `Bearer ${body.accessToken}` };
    await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: auth });
    const me = await app.inject({ method: "GET", url: "/api/v1/me", headers: auth });
    expect(me.statusCode).toBe(401);
    const open = await sql`
      select count(*)::int as n from position_signins
      where session_id = ${body.sessionId} and signed_out_at is null`;
    expect(open[0]!.n).toBe(0);
    const resumeAfter = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resume",
      payload: { resumeToken: body.resumeToken },
    });
    expect(resumeAfter.statusCode).toBe(401);
  });
});
