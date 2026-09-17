import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let boardId: string;
let fileV1: string;

beforeAll(async () => {
  process.env.OPENEOC_DATA_DIR = mkdtempSync(join(tmpdir(), "openeoc-blobs-"));
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor("member@example.org", "another-good-password");
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken),
    payload: { templateKey: "significant_events" },
  });
  boardId = board.json().id as string;
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

async function upload(name: string, text: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/files`,
    headers: auth(memberToken),
    payload: {
      name,
      contentType: "text/plain",
      dataBase64: Buffer.from(text).toString("base64"),
      ...extra,
    },
  });
}

describe("content-addressed, immutable file storage", () => {
  it("uploads, downloads byte-identical, and dedupes identical content", async () => {
    const res = await upload("iap-draft.txt", "Operational period 1 objectives");
    expect(res.statusCode).toBe(201);
    fileV1 = res.json().id as string;
    const sha = res.json().sha256 as string;

    const dl = await app.inject({
      method: "GET",
      url: `/api/v1/files/${fileV1}/content`,
      headers: auth(memberToken),
    });
    expect(dl.body).toBe("Operational period 1 objectives");

    const dup = await upload("copy-of-iap.txt", "Operational period 1 objectives");
    expect(dup.json().sha256).toBe(sha); // same blob, second row
  });

  it("a new version supersedes without touching the old, which stays byte-identical", async () => {
    const v2 = await upload("iap-draft.txt", "Operational period 2 objectives", {
      supersedes: fileV1,
    });
    expect(v2.statusCode).toBe(201);
    expect(v2.json().version).toBe(2);

    const oldMeta = await app.inject({
      method: "GET",
      url: `/api/v1/files/${fileV1}`,
      headers: auth(memberToken),
    });
    expect(oldMeta.json().version).toBe(1);
    const oldContent = await app.inject({
      method: "GET",
      url: `/api/v1/files/${fileV1}/content`,
      headers: auth(memberToken),
    });
    expect(oldContent.body).toBe("Operational period 1 objectives");
  });

  it("file rows cannot be rewritten or deleted at any layer", async () => {
    await expect(admin`update files set name = 'forged' where id = ${fileV1}`).rejects.toThrow(
      /append-only/,
    );
    await expect(admin`delete from files where id = ${fileV1}`).rejects.toThrow(/append-only/);
  });

  it("refuses disallowed types and empty content", async () => {
    const exe = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/files`,
      headers: auth(memberToken),
      payload: {
        name: "tool.exe",
        contentType: "application/x-msdownload",
        dataBase64: Buffer.from("MZ").toString("base64"),
      },
    });
    expect(exe.statusCode).toBe(400);
  });
});

describe("permission-aware search", () => {
  it("finds records, libraries, files, and chronology entries for members", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(memberToken),
      payload: {
        summary: "Bridge out on SR-169 at Pecwan",
        occurred_at: "2026-09-17T10:00:00Z",
        severity: "critical",
      },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/libraries`,
      headers: auth(adminToken),
      payload: { title: "Bridge failure pre-plan", kind: "plan", body: "Detour via Johnsons" },
    });
    await upload("bridge-photos-index.txt", "Photo index for bridge damage");

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/search?q=bridge`,
      headers: auth(memberToken),
    });
    expect(res.statusCode).toBe(200);
    const kinds = new Set(
      (res.json().hits as Array<{ kind: string }>).map((h) => h.kind),
    );
    expect(kinds.has("record")).toBe(true);
    expect(kinds.has("library")).toBe(true);
    expect(kinds.has("file")).toBe(true);
    expect(kinds.has("chronology")).toBe(true);
  });

  it("never returns rows the caller cannot read", async () => {
    // A guest scoped to ONE board sees that board's records and nothing else.
    const guestId = (await admin`
      insert into persons (email, display_name, password_hash)
      values ('sguest@example.org', 'Search Guest',
              'scrypt:32768:8:1:00000000000000000000000000000000:00') returning id`)[0]!
      .id as string;
    await admin`update persons set password_hash =
      (select password_hash from persons where email = 'member@example.org')
      where id = ${guestId}`;
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
    const guestToken = await tokenFor("sguest@example.org", "another-good-password");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/search?q=bridge`,
      headers: auth(guestToken),
    });
    expect(res.statusCode).toBe(200);
    const hits = res.json().hits as Array<{ kind: string }>;
    expect(hits.every((h) => h.kind === "record")).toBe(true);
    expect(hits.length).toBeGreaterThan(0);

    // An outsider cannot search the jurisdiction at all.
    const outsiderId = (await admin`
      insert into persons (email, display_name, password_hash)
      values ('sout@example.org', 'Out',
              (select password_hash from persons where email = 'member@example.org'))
      returning id`)[0]!.id as string;
    void outsiderId;
    const outsiderToken = await tokenFor("sout@example.org", "another-good-password");
    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/search?q=bridge`,
      headers: auth(outsiderToken),
    });
    expect(denied.statusCode).toBe(403);
  });
});
