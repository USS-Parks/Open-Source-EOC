import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";
import { multipartUpload } from "./multipart.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let boardId: string;
let recordId: string;
let sourceIncidentId: string;
let fileV1: string;

beforeAll(async () => {
  process.env.OPENEOC_DATA_DIR = mkdtempSync(join(tmpdir(), "openeoc-blobs-"));
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken),
    payload: { templateKey: "significant_events" },
  });
  boardId = board.json().id as string;
  const [sourceIncident] = await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by)
    values (${seed.jurisdictionId}, 'D27 attachment source incident', 'incident', ${seed.adminId})
    returning id`;
  sourceIncidentId = sourceIncident!.id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${sourceIncidentId}, ${boardId})`;
  const [record] = await admin`
    insert into board_records (board_id, data, created_by, incident_id)
    values (${boardId}, ${admin.json({ summary: "D27 attachment source" } as never)}, ${seed.memberId}, ${sourceIncidentId})
    returning id`;
  recordId = record!.id as string;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});



async function upload(
  name: string,
  content: string | Buffer,
  extra: Record<string, string> = {},
  options: { target?: FastifyInstance; jurisdictionId?: string; contentType?: string } = {},
) {
  const body = await multipartUpload({ name, ...extra }, content, options.contentType ?? "text/plain");
  return (options.target ?? app).inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${options.jurisdictionId ?? seed.jurisdictionId}/files`,
    headers: { ...auth(memberToken), ...body.headers },
    payload: body.payload,
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

  it("sanitizes the download filename so it cannot inject response headers", async () => {
    // A name holding a quote and a CRLF would break out of the header and
    // inject one of its own; upload does not restrict the characters.
    const nasty = 'evil".txt\r\nSet-Cookie: pwn=1';
    const up = await upload(nasty, "payload");
    expect(up.statusCode).toBe(201);
    const dl = await app.inject({
      method: "GET",
      url: `/api/v1/files/${up.json().id as string}/content`,
      headers: auth(memberToken),
    });
    // Before the fix, Node rejects the CRLF header value and the download 500s.
    expect(dl.statusCode).toBe(200);
    const disp = dl.headers["content-disposition"] as string;
    expect(disp).not.toMatch(/[\r\n]/); // no injected line break
    expect(disp).toContain('filename="evil_.txt'); // quote and CRLF neutralized
    expect(disp).toContain("filename*=UTF-8''"); // RFC 5987 form present
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

  it("validates exact record attachments and lists them with deterministic pagination", async () => {
    const first = await upload("record-photo-a.txt", "one", {
      attachedKind: "record",
      attachedId: recordId,
    });
    const second = await upload("record-photo-b.txt", "two", {
      attachedKind: "record",
      attachedId: recordId,
    });
    const third = await upload("record-photo-c.txt", "three", {
      attachedKind: "record",
      attachedId: recordId,
    });
    expect([first.statusCode, second.statusCode, third.statusCode]).toEqual([201, 201, 201]);

    const firstPage = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/files?attachedKind=record&attachedId=${recordId}&limit=2`,
      headers: auth(memberToken),
    });
    expect(firstPage.statusCode, firstPage.body).toBe(200);
    expect(firstPage.json().files).toHaveLength(2);
    expect(firstPage.json().nextCursor).toEqual(expect.any(String));
    expect(firstPage.json().files[0]).toMatchObject({
      attachedKind: "record",
      attachedId: recordId,
      attachedBoardId: boardId,
      attachedIncidentId: sourceIncidentId,
      uploadedBy: { personId: seed.memberId, displayName: "Member" },
    });

    const secondPage = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/files?attachedKind=record&attachedId=${recordId}&limit=2&cursor=${encodeURIComponent(firstPage.json().nextCursor as string)}`,
      headers: auth(memberToken),
    });
    expect(secondPage.statusCode, secondPage.body).toBe(200);
    expect(secondPage.json().files).toHaveLength(1);
    expect(secondPage.json().nextCursor).toBeNull();
    const ids = [...firstPage.json().files, ...secondPage.json().files].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(3);

    const otherJurisdiction = await createJurisdiction(admin, "d27-other", "D27 Other");
    const [otherRecord] = await admin`
      insert into boards (jurisdiction_id, template_key, template_version, title)
      select ${otherJurisdiction}, key, version, 'Other board' from board_templates
      where key = 'significant_events' order by version desc limit 1
      returning id`;
    const [foreign] = await admin`
      insert into board_records (board_id, data, created_by)
      values (${otherRecord!.id as string}, '{}'::jsonb, ${seed.adminId}) returning id`;
    const rejected = await upload("wrong-context.txt", "blocked", {
      attachedKind: "record",
      attachedId: foreign!.id as string,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe("attachment target not found in this jurisdiction");
  });

  it("file rows cannot be rewritten or deleted at any layer", async () => {
    await expect(admin`update files set name = 'forged' where id = ${fileV1}`).rejects.toThrow(
      /append-only/,
    );
    await expect(admin`delete from files where id = ${fileV1}`).rejects.toThrow(/append-only/);
  });

  it("refuses disallowed types and empty content", async () => {
    const exe = await upload("tool.exe", "MZ", {}, { contentType: "application/x-msdownload" });
    expect(exe.statusCode).toBe(400);
    const empty = await upload("empty.txt", "");
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toBe("empty file");
  });

  it("no longer accepts the base64 JSON body", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/files`,
      headers: auth(memberToken),
      payload: { name: "old.txt", contentType: "text/plain", dataBase64: Buffer.from("x").toString("base64") },
    });
    expect(res.statusCode).toBe(415);
  });

  it("round-trips binary content byte for byte", async () => {
    const bytes = Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 256));
    const up = await upload("all-bytes.png", bytes, {}, { contentType: "image/png" });
    expect(up.statusCode, up.body).toBe(201);
    expect(up.json().sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    const dl = await app.inject({
      method: "GET",
      url: `/api/v1/files/${up.json().id as string}/content`,
      headers: auth(memberToken),
    });
    expect(dl.headers["content-type"]).toBe("image/png");
    expect(dl.rawPayload.equals(bytes)).toBe(true);
    const [row] = await admin`select size from files where id = ${up.json().id as string}`;
    expect(Number(row!.size)).toBe(bytes.length);
  });
});

describe("upload size limit and per-jurisdiction quota", () => {
  // 0.004 MB = 4194 bytes per file; 0.006 MB = 6291 bytes per jurisdiction.
  const MAX = 4194;
  let limited: FastifyInstance;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = process.env.OPENEOC_DATA_DIR!;
    process.env.OPENEOC_MAX_UPLOAD_MB = "0.004";
    process.env.OPENEOC_JURISDICTION_QUOTA_MB = "0.006";
    try {
      limited = buildApp(runtime, { oidc: null });
    } finally {
      delete process.env.OPENEOC_MAX_UPLOAD_MB;
      delete process.env.OPENEOC_JURISDICTION_QUOTA_MB;
    }
  });

  afterAll(async () => {
    await limited.close();
  });

  async function freshJurisdiction(slug: string): Promise<string> {
    const id = await createJurisdiction(admin, slug, slug);
    await addMembership(admin, seed.memberId, id, "member");
    return id;
  }

  const staged = () => readdirSync(dataDir).filter((name) => name.startsWith(".upload-"));

  it("streams up to the per-file limit and refuses one byte more with 413", async () => {
    const jurisdictionId = await freshJurisdiction("quota-size");
    const over = await upload("over.txt", "x".repeat(MAX + 1), {}, { target: limited, jurisdictionId });
    expect(over.statusCode).toBe(413);
    expect(over.json().error).toBe(`file exceeds the ${MAX} byte limit`);
    const exact = await upload("exact.txt", "y".repeat(MAX), {}, { target: limited, jurisdictionId });
    expect(exact.statusCode, exact.body).toBe(201);
    expect(staged()).toEqual([]);
  });

  it("refuses an upload that would exceed the jurisdiction's quota", async () => {
    const jurisdictionId = await freshJurisdiction("quota-full");
    const first = await upload("first.txt", "a".repeat(4000), {}, { target: limited, jurisdictionId });
    expect(first.statusCode).toBe(201);
    const second = await upload("second.txt", "b".repeat(3000), {}, { target: limited, jurisdictionId });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatch(/^jurisdiction file quota exceeded: 4000 of 6291 bytes in use/);
    // Another jurisdiction's quota is its own.
    const elsewhere = await upload("elsewhere.txt", "c".repeat(3000), {}, {
      target: limited,
      jurisdictionId: await freshJurisdiction("quota-other"),
    });
    expect(elsewhere.statusCode).toBe(201);
    expect(staged()).toEqual([]);
  });

  it("admits only one of two concurrent uploads that together exceed the quota", async () => {
    const jurisdictionId = await freshJurisdiction("quota-race");
    // Hold the files table so both uploads are inside their transactions at
    // once, each waiting on a lock, before either can read the usage.
    let tableLocked!: () => void;
    const locked = new Promise<void>((resolve) => (tableLocked = resolve));
    const holder = admin.begin(async (tx) => {
      await tx`lock table files in access exclusive mode`;
      tableLocked();
      for (let attempt = 0; attempt < 400; attempt++) {
        const [waiting] = await admin`
          select count(*)::int as n from pg_stat_activity
          where datname = current_database() and usename = 'app_runtime' and wait_event_type = 'Lock'`;
        if (waiting!.n >= 2) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("the two uploads never waited together");
    });
    await locked;
    const results = await Promise.all([
      upload("left.txt", "l".repeat(4000), {}, { target: limited, jurisdictionId }),
      upload("right.txt", "r".repeat(4000), {}, { target: limited, jurisdictionId }),
    ]);
    await holder;
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const [usage] = await admin`
      select count(*)::int as files, coalesce(sum(size), 0)::int as bytes
      from files where jurisdiction_id = ${jurisdictionId}`;
    expect(usage).toEqual({ files: 1, bytes: 4000 });
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
    const searchHits = res.json().hits as Array<{ kind: string; boardId?: string; incidentId?: string | null }>;
    const kinds = new Set(searchHits.map((hit) => hit.kind));
    expect(searchHits.find((hit) => hit.kind === "record")?.boardId).toBe(boardId);
    expect(kinds.has("record")).toBe(true);
    expect(kinds.has("library")).toBe(true);
    expect(kinds.has("file")).toBe(true);
    expect(kinds.has("chronology")).toBe(true);

    const scoped = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/search?q=attachment`,
      headers: auth(memberToken),
    });
    expect(scoped.statusCode, scoped.body).toBe(200);
    expect(scoped.json().hits).toContainEqual(expect.objectContaining({
      kind: "record",
      id: recordId,
      boardId,
      incidentId: sourceIncidentId,
    }));
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
    const guestToken = await tokenFor(app, "sguest@example.org", "another-good-password");
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
    const outsiderToken = await tokenFor(app, "sout@example.org", "another-good-password");
    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/search?q=bridge`,
      headers: auth(outsiderToken),
    });
    expect(denied.statusCode).toBe(403);
  });
});
