import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { resetRateLimits } from "../auth/rate-limit.js";
import { addMembership, createPerson } from "../auth/service.js";
import { fromBase32, hotp, matchTotp, toBase32, totp, totpStep } from "../auth/totp.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let lenient: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let priorKey: string | undefined;
let secret = "";
let recoveryCodes: string[] = [];
let activationStep = 0;

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-mfa-key";
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  const second = await createPerson(admin, {
    email: "second-admin@example.org",
    displayName: "Second Admin",
    password: "second-admin-password",
  });
  await addMembership(admin, second, seed.jurisdictionId, "admin");
  const root = await createPerson(admin, {
    email: "root@example.org",
    displayName: "Instance Admin",
    password: "instance-admin-password",
  });
  await admin`update persons set is_instance_admin = true where id = ${root}`;
  app = buildApp(runtime, { oidc: null, requireAdminMfa: true });
  lenient = buildApp(runtime, { oidc: null, requireAdminMfa: false });
});

afterAll(async () => {
  await app.close();
  await lenient.close();
  await runtime.end();
  await admin.end();
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

beforeEach(() => resetRateLimits());

async function call(target: FastifyInstance, url: string, payload: Record<string, unknown>) {
  const res = await target.inject({ method: "POST", url, payload });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

const login = (email: string, password: string, target = app) =>
  call(target, "/api/v1/auth/login", { email, password });
const verify = (mfaToken: unknown, code: string) =>
  call(app, "/api/v1/auth/mfa/verify", { mfaToken, code });

async function auditCategories(personId: string): Promise<string[]> {
  const rows = await admin`
    select category from audit_events where person_id = ${personId} order by seq`;
  return rows.map((row) => row.category as string);
}

describe("TOTP", () => {
  it("matches the RFC 6238 SHA-1 test vectors at six digits", () => {
    const key = toBase32(Buffer.from("12345678901234567890", "ascii"));
    expect(key).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(fromBase32(key).toString("ascii")).toBe("12345678901234567890");
    const vectors: Array<[number, string]> = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
      [20000000000, "353130"],
    ];
    for (const [seconds, code] of vectors) expect(totp(key, seconds * 1000)).toBe(code);
  });

  it("accepts one step of drift either way and nothing further", () => {
    const key = toBase32(Buffer.from("12345678901234567890", "ascii"));
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    for (const offset of [-1, 0, 1]) expect(matchTotp(key, hotp(key, step + offset), now)).toBe(step + offset);
    expect(matchTotp(key, hotp(key, step + 2), now)).toBeNull();
    expect(matchTotp(key, hotp(key, step - 2), now)).toBeNull();
    expect(matchTotp(key, "12345", now)).toBeNull();
  });
});

describe("enforcement", () => {
  it("gives a member a session with a password alone", async () => {
    const { status, body } = await login("member@example.org", "another-good-password");
    expect(status).toBe(200);
    expect(body.accessToken).toBeTruthy();
  });

  it("requires a jurisdiction admin and an instance admin to enroll before any session", async () => {
    for (const [email, password] of [
      ["admin@example.org", "correct-horse-battery"],
      ["root@example.org", "instance-admin-password"],
    ] as const) {
      const { status, body } = await login(email, password);
      expect(status).toBe(200);
      expect(body).toEqual({ mfaEnrollmentRequired: true, mfaToken: expect.any(String) });
    }
  });

  it("keeps the password-only login for an unenrolled admin when the switch is off", async () => {
    const { status, body } = await login("admin@example.org", "correct-horse-battery", lenient);
    expect(status).toBe(200);
    expect(body.accessToken).toBeTruthy();
    expect(body.mfaEnrollmentRequired).toBeUndefined();
  });

  it("fails closed with a 409 when the server has no secret key", async () => {
    const { body } = await login("second-admin@example.org", "second-admin-password");
    delete process.env.OPENEOC_SECRET_KEY;
    try {
      const res = await call(app, "/api/v1/auth/mfa/enroll", { mfaToken: body.mfaToken });
      expect(res.status).toBe(409);
    } finally {
      process.env.OPENEOC_SECRET_KEY = "test-only-mfa-key";
    }
  });
});

describe("enrollment", () => {
  it("activates with a first code, returns ten recovery codes once and completes sign-in", async () => {
    const { body: challenge } = await login("admin@example.org", "correct-horse-battery");
    const enroll = await call(app, "/api/v1/auth/mfa/enroll", { mfaToken: challenge.mfaToken });
    expect(enroll.status).toBe(200);
    secret = enroll.body.secret as string;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enroll.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/OpenEOC%3Aadmin%40example\.org\?secret=/);

    const [stored] = await admin`select secret_envelope from person_mfa where person_id = ${seed.adminId}`;
    expect(stored!.secret_envelope).not.toContain(secret);

    const wrong = await call(app, "/api/v1/auth/mfa/activate", {
      mfaToken: challenge.mfaToken,
      code: hotp(secret, totpStep() + 5),
    });
    expect(wrong.status).toBe(401);

    activationStep = totpStep();
    const done = await call(app, "/api/v1/auth/mfa/activate", {
      mfaToken: challenge.mfaToken,
      code: hotp(secret, activationStep),
    });
    expect(done.status).toBe(200);
    recoveryCodes = done.body.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${done.body.accessToken as string}` },
    });
    expect(me.statusCode).toBe(200);

    const hashes = await admin`select code_hash from mfa_recovery_codes where person_id = ${seed.adminId}`;
    expect(hashes).toHaveLength(10);
    for (const row of hashes) expect(recoveryCodes).not.toContain(row.code_hash);
    expect(await auditCategories(seed.adminId)).toEqual(
      expect.arrayContaining(["mfa.verification_failed", "mfa.enrolled"]),
    );

    // The enrollment challenge is spent, and an active enrollment cannot be replaced.
    const again = await call(app, "/api/v1/auth/mfa/enroll", { mfaToken: challenge.mfaToken });
    expect(again.status).toBe(401);
  });
});

describe("verification", () => {
  it("asks an enrolled person for a code even when the admin switch is off", async () => {
    const { body } = await login("admin@example.org", "correct-horse-battery", lenient);
    expect(body).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
  });

  it("refuses a replayed step and accepts the next one", async () => {
    const { body: challenge } = await login("admin@example.org", "correct-horse-battery");
    expect(challenge.mfaRequired).toBe(true);
    expect(challenge.accessToken).toBeUndefined();
    const replay = await verify(challenge.mfaToken, hotp(secret, activationStep));
    expect(replay.status).toBe(401);
    const next = await verify(challenge.mfaToken, hotp(secret, activationStep + 1));
    expect(next.status).toBe(200);
    expect(next.body.accessToken).toBeTruthy();

    // The challenge is single use, and the accepted step cannot be used again.
    const reuse = await verify(challenge.mfaToken, hotp(secret, activationStep + 1));
    expect(reuse.status).toBe(401);
    const { body: fresh } = await login("admin@example.org", "correct-horse-battery");
    const replayed = await verify(fresh.mfaToken, hotp(secret, activationStep + 1));
    expect(replayed.status).toBe(401);
  });

  it("rejects a wrong code and records the failure", async () => {
    const before = (await auditCategories(seed.adminId)).filter((c) => c === "mfa.verification_failed").length;
    const { body: challenge } = await login("admin@example.org", "correct-horse-battery");
    const wrong = await verify(challenge.mfaToken, "not-a-code");
    expect(wrong.status).toBe(401);
    const after = (await auditCategories(seed.adminId)).filter((c) => c === "mfa.verification_failed").length;
    expect(after).toBe(before + 1);
  });

  it("spends each recovery code on first use", async () => {
    const first = await login("admin@example.org", "correct-horse-battery");
    const used = await verify(first.body.mfaToken, recoveryCodes[0]!);
    expect(used.status).toBe(200);
    expect(await auditCategories(seed.adminId)).toContain("mfa.recovery_code_used");

    const second = await login("admin@example.org", "correct-horse-battery");
    const reused = await verify(second.body.mfaToken, recoveryCodes[0]!);
    expect(reused.status).toBe(401);
    const loose = await verify(second.body.mfaToken, recoveryCodes[1]!.replace("-", "").toUpperCase());
    expect(loose.status).toBe(200);
  });

  it("rejects an expired challenge", async () => {
    const { body: challenge } = await login("admin@example.org", "correct-horse-battery");
    await admin`update mfa_challenges set expires_at = now() - interval '1 second' where used_at is null`;
    const res = await verify(challenge.mfaToken, recoveryCodes[2]!);
    expect(res.status).toBe(401);
    const [code] = await admin`select count(*)::int as unused from mfa_recovery_codes
      where person_id = ${seed.adminId} and used_at is null`;
    expect(code!.unused).toBe(8);
  });

  it("backs off after five wrong codes", async () => {
    const { body: challenge } = await login("admin@example.org", "correct-horse-battery");
    const stale = hotp(secret, totpStep() + 5);
    for (let i = 0; i < 5; i++) expect((await verify(challenge.mfaToken, stale)).status).toBe(401);
    const locked = await verify(challenge.mfaToken, recoveryCodes[3]!);
    expect(locked.status).toBe(429);
  });
});
