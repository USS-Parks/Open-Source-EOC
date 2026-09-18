import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * INV-10 second independent deploy proof (VEOC-43): the codebase outlives any
 * one maintainer. Two independent instances built from the source alone
 * (migrations from scratch, then the standard templates) produce byte-identical
 * board and incident template libraries and both serve a working API. Nothing
 * in a running instance depends on a maintainer's hidden state; the source
 * fully determines the system.
 */

interface Instance {
  admin: Sql;
  runtime: Sql;
  app: FastifyInstance;
}

async function deployFromSource(): Promise<Instance> {
  const { admin, runtime } = await freshDb(); // migrates from scratch
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  const app = buildApp(runtime, { oidc: null });
  await app.ready();
  return { admin, runtime, app };
}

async function templateFingerprint(admin: Sql): Promise<string> {
  const boards = await admin`
    select key, version, definition from board_templates order by key, version`;
  const incidents = await admin`
    select key, definition from incident_templates order by key`;
  return JSON.stringify({
    boards: boards.map((r) => ({ key: r.key, version: r.version, def: r.definition })),
    incidents: incidents.map((r) => ({ key: r.key, def: r.definition })),
  });
}

let a: Instance;
let b: Instance;

beforeAll(async () => {
  a = await deployFromSource();
  b = await deployFromSource();
}, 120000);

afterAll(async () => {
  for (const inst of [a, b]) {
    if (!inst) continue;
    await inst.app.close();
    await inst.runtime.end();
    await inst.admin.end();
  }
});

describe("two independent deploys from source are identical and working", () => {
  it("produce byte-identical template libraries", async () => {
    const fa = await templateFingerprint(a.admin);
    const fb = await templateFingerprint(b.admin);
    expect(fa).toBe(fb);
    // And the library is non-trivial (the standard set is actually present).
    expect(fa.length).toBeGreaterThan(1000);
  });

  it("each serves a working API built from the same source", async () => {
    for (const inst of [a, b]) {
      const seed = await seedIdentity(inst.admin);
      expect(seed.jurisdictionId).toBeTruthy();
      const res = await inst.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "admin@example.org", password: "correct-horse-battery" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().accessToken).toBeTruthy();
    }
  });
});
