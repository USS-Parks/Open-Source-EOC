import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createJurisdiction, addMembership } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * EDXL resource messaging: a 213RR emitted from one instance as
 * EDXL-RM inside an EDXL-DE envelope re-imports on a second instance
 * without loss, and the envelope's explicit addressing gates who may
 * consume it. The two "instances" are two jurisdictions in one database.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let memberToken: string;
let jurisdictionB: string;
let boardA: string;
let recordId: string;

const ORIGINAL = {
  item: "Type 1 water tender",
  quantity: 3,
  priority: "immediate",
  state: "submitted",
  needed_by: "2026-09-18T06:00:00-07:00",
  notes: "Staging at Weitchpec; gravel road access only.",
};

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  // A second instance (jurisdiction) the member also belongs to.
  jurisdictionB = await createJurisdiction(admin, "downriver", "Downriver County OES");
  await addMembership(admin, seed.adminId, jurisdictionB, "admin");
  await addMembership(admin, seed.memberId, jurisdictionB, "member");

  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor("member@example.org", "another-good-password");

  boardA = await makeBoard(seed.jurisdictionId, adminToken);
  await makeBoard(jurisdictionB, adminToken); // B's resource-request board

  const rec = await app.inject({
    method: "POST",
    url: `/api/v1/boards/${boardA}/records`,
    headers: { authorization: `Bearer ${memberToken}` },
    payload: ORIGINAL,
  });
  recordId = rec.json().id as string;
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

async function makeBoard(jurisdictionId: string, token: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/boards`,
    headers: { authorization: `Bearer ${token}` },
    payload: { templateKey: "resource_request" },
  });
  return res.json().id as string;
}

async function emit(recipients?: string[]): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/boards/${boardA}/records/${recordId}/edxl`,
    headers: { authorization: `Bearer ${memberToken}` },
    payload: recipients ? { recipients } : {},
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toContain("application/emergency+xml");
  return res.body;
}

describe("emit and re-import a 213RR as EDXL", () => {
  it("re-imports on the second instance without loss", async () => {
    const xml = await emit(["downriver"]);
    expect(xml).toContain("EDXL:DE:1.0");
    expect(xml).toContain("EDXL:RM:1.0");

    const imported = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${jurisdictionB}/edxl/import`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { xml },
    });
    expect(imported.statusCode).toBe(201);
    const newRecordId = imported.json().recordId as string;

    const [row] = await admin`select data from board_records where id = ${newRecordId}`;
    expect(row!.data).toEqual(ORIGINAL); // nothing lost across the round trip
  });

  it("refuses an envelope not addressed to the importing jurisdiction", async () => {
    const xml = await emit(["downriver"]);
    // yurok (the sender) is not an addressee, so it cannot consume it.
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/edxl/import`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { xml },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets a broadcast envelope (no explicit address) import anywhere", async () => {
    const xml = await emit();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/edxl/import`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { xml },
    });
    expect(res.statusCode).toBe(201);
  });

  it("refuses unparseable EDXL", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${jurisdictionB}/edxl/import`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { xml: "<html>not edxl</html>" },
    });
    expect(res.statusCode).toBe(400);
  });
});
