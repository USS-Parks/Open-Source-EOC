import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { MAX_IMPORT_ROWS, parseCsv } from "../boards/transfer.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";
import { multipartUpload } from "./multipart.js";

/**
 * WebEOC board migration on real PostgreSQL: a dry run writes nothing, a
 * commit writes exactly the valid rows through the record write path with
 * WebEOC provenance, the rejection report holds every invalid row, an export
 * committed twice creates each dataid once, and only a writer of the board
 * may import into it.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let viewerToken: string;
let outsiderToken: string;
let eventsBoard: string;
let savedBoard: string;

/** A WebEOC Significant Events export: seven records, one blank line, and one record with no dataid. */
const EXPORT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "webeoc-significant-events.csv"), "utf8");
const HEADER = EXPORT.split(/\r?\n/)[0]!;
const MAPPING = { summary: "Summary", details: "Details", occurred_at: "occurred", severity: "severity" };
const REJECTED = [
  ["4", "Summary is required and this row leaves it empty"],
  ["5", 'Severity "High" is not one of its options: normal, warning, critical, unknown'],
  ["6", "Occurred is not a date"],
  ["7", "Summary is longer than 500 characters"],
  ["8", "dataid 101 repeats row 2"],
];

async function upload(token: string, boardId: string, csv: string, query: string, fields: Record<string, string> = {}) {
  const body = await multipartUpload(fields, csv, "text/csv");
  return app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/webeoc-import${query}`,
    headers: { ...auth(token), ...body.headers }, payload: body.payload });
}

const withMapping = (timeZone?: string) => ({ mapping: JSON.stringify(MAPPING), ...(timeZone ? { timeZone } : {}) });
const count = async (table: "board_records" | "webeoc_imported_rows" | "sync_updates", boardId: string) =>
  (await admin`select count(*)::int as n from ${admin(table)} where board_id = ${boardId}`)[0]!.n as number;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  const viewerId = await createPerson(admin, { email: "viewer@example.org", displayName: "Viewer", password: "viewer-good-password" });
  await addMembership(admin, viewerId, seed.jurisdictionId, "viewer");
  const neighbour = await createJurisdiction(admin, "karuk", "Karuk Tribe OES");
  const outsiderId = await createPerson(admin, { email: "outsider@example.org", displayName: "Outsider", password: "outsider-good-password" });
  await addMembership(admin, outsiderId, neighbour, "admin");
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  viewerToken = await tokenFor(app, "viewer@example.org", "viewer-good-password");
  outsiderToken = await tokenFor(app, "outsider@example.org", "outsider-good-password");
  const board = async (title: string) => (await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken), payload: { templateKey: "significant_events", title } })).json().id as string;
  eventsBoard = await board("Significant events from WebEOC");
  savedBoard = await board("Saved mapping");
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("WebEOC import", () => {
  it("dry-runs every row with its outcome and writes nothing", async () => {
    const dry = await upload(adminToken, eventsBoard, EXPORT, "?dryRun=true", withMapping("America/Los_Angeles"));
    expect(dry.statusCode, dry.body).toBe(200);
    const report = dry.json();
    expect(report).toMatchObject({
      dryRun: true, rows: 8, valid: 3, created: 0, skipped: 0, rejected: 5, mapping: MAPPING,
      provenance: ["dataid", "prevdataid", "entrydate", "username", "positionname", "subscribername"],
      dropped: ["remarks_extra"],
    });
    expect(report.outcomes.map((o: { row: number; outcome: string }) => [o.row, o.outcome])).toEqual([
      [2, "create"], [3, "create"], [4, "reject"], [5, "reject"], [6, "reject"], [7, "reject"], [8, "reject"], [10, "create"],
    ]);
    expect(report.outcomes.filter((o: { outcome: string }) => o.outcome === "reject")
      .map((o: { row: number; reasons: string[] }) => [String(o.row), o.reasons.join("; ")])).toEqual(REJECTED);
    expect(await count("board_records", eventsBoard)).toBe(0);
    expect(await count("webeoc_imported_rows", eventsBoard)).toBe(0);
    expect(await count("sync_updates", eventsBoard)).toBe(0);
  });

  it("reads a local WebEOC date only in a chosen time zone and rejects a required field left unmapped", async () => {
    const report = (await upload(adminToken, eventsBoard, EXPORT, "?dryRun=true", withMapping())).json();
    expect(report.outcomes.find((o: { row: number }) => o.row === 2).reasons)
      .toEqual(["Occurred has no time zone; choose the time zone the WebEOC server used"]);
    expect(report.outcomes.find((o: { row: number }) => o.row === 10).outcome).toBe("create");
    const { severity: _severity, ...partial } = MAPPING;
    const unmapped = (await upload(adminToken, eventsBoard, EXPORT, "?dryRun=true",
      { mapping: JSON.stringify(partial), timeZone: "America/Los_Angeles" })).json();
    expect(unmapped.outcomes[0].reasons).toEqual(["Severity is required and no column is mapped to it"]);
    expect(unmapped.dropped).toEqual(["severity", "remarks_extra"]);
  });

  it("commits exactly the valid rows through the record write path with WebEOC provenance", async () => {
    const res = await upload(adminToken, eventsBoard, EXPORT, "", withMapping("America/Los_Angeles"));
    expect(res.statusCode, res.body).toBe(201);
    const report = res.json();
    expect(report).toMatchObject({ dryRun: false, rows: 8, valid: 3, created: 3, rejected: 5 });
    const stored = await admin`select id, data from board_records where board_id = ${eventsBoard} order by data ->> 'occurred_at'`;
    expect(stored.map((row) => row.data)).toEqual([
      { summary: "Untracked note", occurred_at: "2026-09-20T14:00:00-07:00", severity: "unknown" },
      { summary: "Levee seep reported", details: "Station 4 crew on scene, sandbagging", occurred_at: "2026-09-20T15:10:00.000Z", severity: "warning" },
      { summary: "Road washed out on Route 96", occurred_at: "2026-09-20T16:30:00.000Z", severity: "critical" },
    ]);
    const created = report.outcomes.filter((o: { outcome: string }) => o.outcome === "create").map((o: { recordId: string }) => o.recordId);
    expect(new Set(created)).toEqual(new Set(stored.map((row) => row.id as string)));
    const [event] = await admin`
      select payload from audit_events
      where category = 'board.record.created' and subject_id = ${created[0]} and payload ->> 'via' = 'import'`;
    expect(event!.payload.source).toEqual({
      system: "webeoc", dataid: "101", prevdataid: "0", entrydate: "2026-09-20 08:15:00.000",
      username: "jsmith", positionname: "Planning Chief", subscribername: "County EOC",
    });
    expect(await count("sync_updates", eventsBoard)).toBe(3);
    expect((await admin`select dataid from webeoc_imported_rows where board_id = ${eventsBoard} order by dataid`)
      .map((row) => row.dataid)).toEqual(["101", "102"]);
    const history = await app.inject({ method: "GET", url: `/api/v1/boards/${eventsBoard}/records/${created[0]}/history`, headers: auth(adminToken) });
    expect(history.json().entries.map((e: { category: string }) => e.category)).toEqual(["board.record.created"]);

    const [head, ...rejected] = parseCsv(report.rejectionCsv);
    expect(head).toEqual(["Rejected row", "Rejection reason", ...HEADER.split(",")]);
    expect(rejected.map((row) => [row[0], row[1]])).toEqual(REJECTED);
    expect(rejected[0]![8]).toBe("");
    expect(rejected[1]![11]).toBe("High");
  });

  it("skips a dataid already imported when the same export is committed again", async () => {
    const again = await upload(adminToken, eventsBoard, EXPORT, "", withMapping("America/Los_Angeles"));
    expect(again.statusCode, again.body).toBe(201);
    const report = again.json();
    // Only the row without a dataid is created again; the guide says so.
    expect(report).toMatchObject({ created: 1, skipped: 3, rejected: 4 });
    expect(report.outcomes.filter((o: { outcome: string }) => o.outcome === "skip").map((o: { row: number; reasons: string[] }) => [o.row, o.reasons]))
      .toEqual([[2, ["dataid 101 was imported earlier"]], [3, ["dataid 102 was imported earlier"]], [8, ["dataid 101 was imported earlier"]]]);
    expect(await count("board_records", eventsBoard)).toBe(4);
  });

  it("saves a mapping, uses it when none is sent, and matches fields by key or label before one is saved", async () => {
    const guessed = (await upload(adminToken, savedBoard, EXPORT, "?dryRun=true")).json();
    expect(guessed.mapping).toEqual({ summary: "Summary", details: "Details", occurred_at: "occurred", severity: "severity" });
    const put = (payload: unknown, token = adminToken) =>
      app.inject({ method: "PUT", url: `/api/v1/boards/${savedBoard}/webeoc-mapping`, headers: auth(token), payload: payload as object });
    expect((await put({ mapping: { summary: "Details", nope: "x" } })).statusCode).toBe(400);
    expect((await put({ mapping: { summary: "Details" }, timeZone: "Mars/Olympus" })).statusCode).toBe(400);
    const saved = await put({ mapping: { summary: "Details", occurred_at: "occurred", severity: "severity" }, timeZone: "America/Chicago" });
    expect(saved.statusCode, saved.body).toBe(200);
    const read = (await app.inject({ method: "GET", url: `/api/v1/boards/${savedBoard}/webeoc-mapping`, headers: auth(memberToken) })).json();
    expect(read).toMatchObject({ mapping: { summary: "Details", occurred_at: "occurred", severity: "severity" }, timeZone: "America/Chicago" });
    const report = (await upload(adminToken, savedBoard, EXPORT, "?dryRun=true")).json();
    expect(report.mapping).toEqual({ summary: "Details", occurred_at: "occurred", severity: "severity" });
    expect(report.outcomes[0]).toMatchObject({ row: 2, outcome: "create" });
    const [audit] = await admin`select payload from audit_events where category = 'board.webeoc_mapping.saved'`;
    expect(audit!.payload).toMatchObject({ board: "significant_events", timeZone: "America/Chicago" });
  });

  it("fails closed: only a writer of the board imports, and the request names no authority", async () => {
    const csv = "Summary,occurred,severity,verified\r\nOne,2026-09-20T10:00:00Z,normal,true\r\n";
    const viewer = await upload(viewerToken, eventsBoard, csv, "?dryRun=true");
    expect(viewer.statusCode).toBe(403);
    const outsider = await upload(outsiderToken, eventsBoard, csv, "");
    expect(outsider.statusCode).toBe(404);
    const named = await upload(adminToken, eventsBoard, csv, `?dryRun=true&jurisdictionId=${seed.jurisdictionId}`);
    expect(named.statusCode).toBe(400);
    const anonymous = await app.inject({ method: "POST", url: `/api/v1/boards/${eventsBoard}/webeoc-import?dryRun=true` });
    expect(anonymous.statusCode).toBe(401);
    for (const method of ["GET", "PUT"] as const) {
      const res = await app.inject({ method, url: `/api/v1/boards/${eventsBoard}/webeoc-mapping`, headers: auth(viewerToken),
        ...(method === "PUT" ? { payload: { mapping: { summary: "Summary" } } } : {}) });
      expect(res.statusCode).toBe(403);
    }
    // A member writes the board but not its administrator-only field.
    const member = await upload(memberToken, eventsBoard, csv, "?dryRun=true",
      { mapping: JSON.stringify({ summary: "Summary", occurred_at: "occurred", severity: "severity", verified: "verified" }) });
    expect(member.statusCode, member.body).toBe(200);
    expect(member.json().outcomes[0].reasons).toEqual(["field verified is admin-writable only"]);
    expect(await count("board_records", eventsBoard)).toBe(4);
  });

  it(`refuses a file of more than ${MAX_IMPORT_ROWS} rows and writes nothing`, async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Event ${i},2026-09-20T10:00:00Z,normal`);
    const res = await upload(adminToken, eventsBoard, ["Summary,occurred,severity", ...rows].join("\r\n"), "?dryRun=true");
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe(`import exceeds ${MAX_IMPORT_ROWS} rows`);
    expect(await count("board_records", eventsBoard)).toBe(4);
  });
});
