import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STANDARD_TEMPLATES } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { exportPackage, generateSigningKeyPair } from "../boards/package.js";
import { createPerson, addMembership } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const signer = generateSigningKeyPair();

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let viewerId: string;
let guestId: string;
let outsiderId: string;
let boardId: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  viewerId = await createPerson(admin, {
    email: "viewer@example.org",
    displayName: "Viewer",
    password: "viewer-password-long",
  });
  await addMembership(admin, viewerId, seed.jurisdictionId, "viewer");
  guestId = await createPerson(admin, {
    email: "guest@example.org",
    displayName: "Guest",
    password: "guest-password-long",
  });
  outsiderId = await createPerson(admin, {
    email: "outsider@example.org",
    displayName: "Outsider",
    password: "outsider-password-1",
  });
  await admin`update persons set is_instance_admin = true
    where id = ${seed.adminId}`;
  app = buildApp(runtime, { oidc: null, trustedTemplateKeys: [signer.publicKeyPem] });
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

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe("board lifecycle", () => {
  it("admin creates a board from the standard library and a member posts a record", async () => {
    const adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
      headers: auth(adminToken),
      payload: { templateKey: "significant_events" },
    });
    expect(create.statusCode).toBe(201);
    boardId = create.json().id as string;

    const memberToken = await tokenFor("member@example.org", "another-good-password");
    const rec = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(memberToken),
      payload: {
        summary: "Bridge out on SR-169",
        occurred_at: "2026-09-17T10:00:00Z",
        severity: "critical",
      },
    });
    expect(rec.statusCode).toBe(201);

    const view = await app.inject({
      method: "GET",
      url: `/api/v1/boards/${boardId}/views/critical`,
      headers: auth(memberToken),
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().records).toHaveLength(1);
    expect(view.json().records[0].summary).toBe("Bridge out on SR-169");
  });

  it("rejects records that violate the schema", async () => {
    const memberToken = await tokenFor("member@example.org", "another-good-password");
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(memberToken),
      payload: { summary: "x", occurred_at: "2026-09-17T10:00:00Z", severity: "catastrophic" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("enforces admin-only fields at write time", async () => {
    const memberToken = await tokenFor("member@example.org", "another-good-password");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(memberToken),
      payload: {
        summary: "Verified event",
        occurred_at: "2026-09-17T11:00:00Z",
        severity: "warning",
        verified: true,
      },
    });
    expect(res.statusCode).toBe(403);
    const adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(adminToken),
      payload: {
        summary: "Verified event",
        occurred_at: "2026-09-17T11:00:00Z",
        severity: "warning",
        verified: true,
      },
    });
    expect(ok.statusCode).toBe(201);
  });

  it("viewers read but cannot write", async () => {
    const viewerToken = await tokenFor("viewer@example.org", "viewer-password-long");
    const view = await app.inject({
      method: "GET",
      url: `/api/v1/boards/${boardId}/views/all`,
      headers: auth(viewerToken),
    });
    expect(view.statusCode).toBe(200);
    const write = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(viewerToken),
      payload: { summary: "n", occurred_at: "2026-09-17T12:00:00Z", severity: "normal" },
    });
    expect(write.statusCode).toBe(403);
  });
});

describe("guest board scope (R3)", () => {
  it("a guest reads only the designated board, and outsiders see nothing", async () => {
    const adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
    await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/guests`,
      headers: auth(adminToken),
      payload: {
        personId: guestId,
        scopes: [`board:${boardId}:read`],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const guestToken = await tokenFor("guest@example.org", "guest-password-long");
    const view = await app.inject({
      method: "GET",
      url: `/api/v1/boards/${boardId}/views/all`,
      headers: auth(guestToken),
    });
    expect(view.statusCode).toBe(200);
    const write = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(guestToken),
      payload: { summary: "g", occurred_at: "2026-09-17T12:00:00Z", severity: "normal" },
    });
    expect(write.statusCode).toBe(403);

    const outsiderToken = await tokenFor("outsider@example.org", "outsider-password-1");
    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/boards/${boardId}/views/all`,
      headers: auth(outsiderToken),
    });
    // RLS hides the board before the service can even say forbidden:
    // an outsider learns nothing, not even that the board exists.
    expect(denied.statusCode).toBe(404);
    const rows = await withPerson(
      runtime,
      outsiderId,
      (tx) => tx`select id from board_records`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("upgrade with preserved customization (INV-5)", () => {
  it("keeps local fields, adopts new template fields, and re-converges duplicates", async () => {
    const adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
    await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/local-fields`,
      headers: auth(adminToken),
      payload: { key: "x_tribal_notes", label: "Tribal notes", type: "text" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/local-fields`,
      headers: auth(adminToken),
      payload: { key: "x_source", label: "Source", type: "text" },
    });

    const sig = STANDARD_TEMPLATES.find((t) => t.key === "significant_events")!;
    const v2 = {
      ...sig,
      version: 2,
      fields: [...sig.fields, { key: "source", label: "Source", type: "text" }],
    };
    const reg = await app.inject({
      method: "POST",
      url: "/api/v1/templates",
      headers: auth(adminToken),
      payload: v2,
    });
    expect(reg.statusCode).toBe(201);

    const before = await admin`select count(*)::int as n from board_records
      where board_id = ${boardId}`;
    const upgrade = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/upgrade`,
      headers: auth(adminToken),
      payload: { toVersion: 2 },
    });
    expect(upgrade.statusCode).toBe(200);
    expect(upgrade.json().dropped).toEqual(["x_source"]);

    const board = await app.inject({
      method: "GET",
      url: `/api/v1/boards/${boardId}`,
      headers: auth(adminToken),
    });
    const keys = board.json().fields.map((f: { key: string }) => f.key);
    expect(keys).toContain("source");
    expect(keys).toContain("x_tribal_notes");
    expect(keys).not.toContain("x_source");
    const after = await admin`select count(*)::int as n from board_records
      where board_id = ${boardId}`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});

describe("signed package import", () => {
  it("imports a trusted package and refuses a tampered one", async () => {
    const adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
    const custom = {
      ...STANDARD_TEMPLATES.find((t) => t.key === "shelters")!,
      key: "regional_shelters",
      version: 1,
    };
    const pkg = exportPackage([custom], "Test Region", signer.privateKeyPem, signer.publicKeyPem);
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/templates/import",
      headers: auth(adminToken),
      payload: pkg,
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().imported).toBe(1);

    const additional = {
      ...STANDARD_TEMPLATES.find((t) => t.key === "damage_assessment")!,
      key: "regional_damage_assessment",
      version: 1,
    };
    const mixed = exportPackage(
      [custom, additional],
      "Test Region",
      signer.privateKeyPem,
      signer.publicKeyPem,
    );
    const retried = await app.inject({
      method: "POST",
      url: "/api/v1/templates/import",
      headers: auth(adminToken),
      payload: mixed,
    });
    expect(retried.statusCode).toBe(201);
    expect(retried.json().imported).toBe(1);

    const tampered = structuredClone(pkg) as typeof pkg;
    (tampered.templates[0] as { title: string }).title = "Evil";
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/templates/import",
      headers: auth(adminToken),
      payload: tampered,
    });
    expect(bad.statusCode).toBe(400);
  });
});
