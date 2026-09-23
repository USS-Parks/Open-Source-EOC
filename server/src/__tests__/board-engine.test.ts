import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BoardTemplateSchema, type BoardTemplate } from "@openeoc/shared";
import { addMembership, createPerson, principalForPerson } from "../auth/service.js";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { readFirstWorksheet } from "../forms/xlsx-import.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { BoardSyncHub } from "../sync/hub.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";
import { multipartUpload } from "./multipart.js";

/**
 * Board engine depth, against a real database: record-level access on every
 * read path, archive and tombstone delete with history, the per-record
 * history route, CSV and Excel import and export, the wider filter
 * operators, multi-key sort with keyset paging, and grouped views.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let hub: BoardSyncHub;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let authorToken: string;
let holderToken: string;
let outsiderToken: string;
let authorId: string;
let outsiderId: string;
let incidentId: string;
let probeBoard: string;
let privateBoard: string;
let sourceBoard: string;
let sharedBoard: string;
let positionId: string;

const template = (raw: unknown): BoardTemplate => BoardTemplateSchema.parse(raw);

const probe = template({
  key: "engine_probe",
  version: 1,
  title: "Engine probe",
  fields: [
    { key: "name", label: "Name", type: "text" },
    { key: "rank", label: "Rank", type: "number" },
    { key: "due", label: "Due", type: "datetime" },
    { key: "status", label: "Status", type: "enum", values: ["open", "closed"] },
    { key: "urgent", label: "Urgent", type: "boolean" },
    { key: "secret", label: "Secret", type: "text", read: "admin", write: "admin" },
  ],
  views: [
    { key: "all", title: "All", columns: ["name", "rank", "status", "secret"] },
    { key: "multi", title: "Multi", columns: ["name"], sorts: [{ field: "status", dir: "asc" }, { field: "rank", dir: "desc" }] },
    { key: "grouped", title: "Grouped", columns: ["name"], groupBy: "status", sorts: [{ field: "rank", dir: "asc" }] },
    { key: "big", title: "Big", columns: ["name"], where: [{ field: "rank", op: "gte", value: 5 }] },
  ],
});

/** Private notes: only the creator, anyone holding the creator's position, and admins read one. */
const privateNotes = template({
  key: "private_notes",
  version: 1,
  title: "Private notes",
  fields: [
    { key: "code", label: "Code", type: "text", required: true },
    { key: "name", label: "Name", type: "text" },
    { key: "memo", label: "Memo", type: "text", read: "admin", write: "admin" },
  ],
  views: [{ key: "all", title: "All", columns: ["code", "name"] }],
  recordAccess: {
    read: [{ kind: "creator" }, { kind: "creator_position" }],
    edit: [{ kind: "creator" }],
  },
});

const referenceSource = template({
  key: "note_links",
  version: 1,
  title: "Note links",
  fields: [{
    key: "note", label: "Note", type: "record_ref", targetBoardKey: "private_notes",
    labelFields: ["code", "name", "memo"],
  }],
  views: [{ key: "all", title: "All", columns: ["note"] }],
});

/** Everyone reads; only the creator edits. */
const sharedNotes = template({
  key: "shared_notes",
  version: 1,
  title: "Shared notes",
  fields: [{ key: "title", label: "Title", type: "text" }],
  views: [{ key: "all", title: "All", columns: ["title"] }],
  recordAccess: { read: [{ kind: "role", roles: ["member", "viewer"] }], edit: [{ kind: "creator" }] },
});

const request = (method: string, url: string, token: string, payload?: unknown) =>
  app.inject({ method: method as "GET", url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as object }) });

async function walk(url: string, token: string, limit: number) {
  const records: Array<Record<string, unknown>> = [];
  const sizes: number[] = [];
  let cursor: string | null = null;
  let first: Record<string, unknown> | null = null;
  do {
    const separator = url.includes("?") ? "&" : "?";
    const res = await request("GET", `${url}${separator}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, token);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { records: Array<Record<string, unknown>>; nextCursor: string | null };
    first ??= body;
    records.push(...body.records);
    sizes.push(body.records.length);
    cursor = body.nextCursor;
  } while (cursor && sizes.length < 400);
  return { records, sizes, first: first! };
}

const ids = (rows: ReadonlyArray<Record<string, unknown>>) => rows.map((row) => row.id as string);

async function createVia(token: string, boardId: string, data: Record<string, unknown>, incident?: string) {
  const res = await request("POST", `/api/v1/boards/${boardId}/records${incident ? `?incidentId=${incident}` : ""}`, token, data);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function newMember(email: string, role: "member" | "viewer" = "member") {
  const id = await createPerson(admin, { email, displayName: email.split("@")[0]!, password: "engine-test-password" });
  await addMembership(admin, id, seed.jurisdictionId, role);
  return { id, token: await tokenFor(app, email, "engine-test-password") };
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  for (const t of [probe, privateNotes, referenceSource, sharedNotes]) {
    await admin`
      insert into board_templates (key, version, title, definition)
      values (${t.key}, ${t.version}, ${t.title}, ${admin.json(t as never)})`;
  }
  app = buildApp(runtime, { oidc: null });
  hub = new BoardSyncHub(runtime);
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const author = await newMember("author@example.org");
  const holder = await newMember("holder@example.org");
  const outsider = await newMember("outsider@example.org");
  authorId = author.id;
  authorToken = author.token;
  holderToken = holder.token;
  outsiderId = outsider.id;
  outsiderToken = outsider.token;
  const board = async (templateKey: string) => (await request("POST",
    `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, adminToken, { templateKey })).json().id as string;
  probeBoard = await board("engine_probe");
  privateBoard = await board("private_notes");
  sourceBoard = await board("note_links");
  sharedBoard = await board("shared_notes");
  const [incident] = await admin`
    insert into incidents (jurisdiction_id, template_key, name, kind, activated_by)
    values (${seed.jurisdictionId}, 'daily_ops', 'Engine incident', 'incident', ${seed.adminId})
    returning id`;
  incidentId = incident!.id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${privateBoard}), (${incidentId}, ${sourceBoard})`;
  // The author and the holder share a position; the author signs in to it.
  const [position] = await admin`
    insert into positions (jurisdiction_id, key, title) values (${seed.jurisdictionId}, 'planning', 'Planning Chief')
    returning id`;
  positionId = position!.id as string;
  await admin`
    insert into position_assignments (position_id, person_id, assigned_by)
    values (${positionId}, ${author.id}, ${seed.adminId}), (${positionId}, ${holder.id}, ${seed.adminId})`;
  expect((await request("POST", `/api/v1/positions/${positionId}/sign-in`, authorToken)).statusCode).toBe(200);
}, 60_000);

afterAll(async () => {
  hub.close();
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("record-level access", () => {
  let restricted: string;
  let outsiderNote: string;

  beforeAll(async () => {
    restricted = await createVia(authorToken, privateBoard, { code: "C-1", name: "Alpha" }, incidentId);
    await admin`update board_records set data = data || '{"memo": "hidden"}'::jsonb where id = ${restricted}`;
    for (let i = 0; i < 5; i += 1) await createVia(authorToken, privateBoard, { code: `A-${i}` }, incidentId);
    outsiderNote = await createVia(outsiderToken, privateBoard, { code: "O-1", name: "Outsider" }, incidentId);
  });

  it("never lists a restricted record on any view page for an excluded caller", async () => {
    for (const scope of ["", `?incidentId=${incidentId}`]) {
      const outsider = await walk(`/api/v1/boards/${privateBoard}/views/all${scope}`, outsiderToken, 2);
      expect(ids(outsider.records)).toEqual([outsiderNote]);
      const author = await walk(`/api/v1/boards/${privateBoard}/views/all${scope}`, authorToken, 2);
      expect(author.records).toHaveLength(6);
      expect(ids(author.records)).not.toContain(outsiderNote);
      const holder = await walk(`/api/v1/boards/${privateBoard}/views/all${scope}`, holderToken, 4);
      expect(ids(holder.records)).toContain(restricted);
      const everyone = await walk(`/api/v1/boards/${privateBoard}/views/all${scope}`, adminToken, 3);
      expect(everyone.records).toHaveLength(7);
    }
  });

  it("hides a file attached to the record from a caller the record's rule excludes", async () => {
    const [file] = await admin`
      insert into files (jurisdiction_id, name, content_type, size, sha256, attached_kind, attached_id, uploaded_by)
      values (${seed.jurisdictionId}, 'restricted-photo.jpg', 'image/jpeg', 3, 'abc', 'record', ${restricted}, ${authorId})
      returning id`;
    const fileId = file!.id as string;
    const listed = async (token: string) => ((await request("GET",
      `/api/v1/jurisdictions/${seed.jurisdictionId}/files?limit=100`, token)).json().files as Array<{ id: string }>)
      .map((f) => f.id);
    expect(await listed(outsiderToken)).not.toContain(fileId);
    expect((await request("GET", `/api/v1/files/${fileId}`, outsiderToken)).statusCode).toBe(404);
    expect(await listed(authorToken)).toContain(fileId);
  });

  it("hides the record from detail, history, export, references and the chronology", async () => {
    expect((await request("GET", `/api/v1/boards/${privateBoard}/records/${restricted}/detail`, outsiderToken)).statusCode).toBe(404);
    expect((await request("GET", `/api/v1/boards/${privateBoard}/records/${restricted}/history`, outsiderToken)).statusCode).toBe(404);
    expect((await request("GET", `/api/v1/boards/${privateBoard}/records/${restricted}/detail`, holderToken)).statusCode).toBe(200);
    const csv = (await request("GET", `/api/v1/boards/${privateBoard}/views/all/export?archived=include`, outsiderToken)).body;
    expect(csv).not.toContain(restricted);
    expect(csv).toContain(outsiderNote);
    const refs = await request("GET",
      `/api/v1/boards/${sourceBoard}/record-references/note?incidentId=${incidentId}&limit=100`, outsiderToken);
    expect(refs.statusCode).toBe(200);
    expect((refs.json().options as Array<{ id: string }>).map((o) => o.id)).toEqual([outsiderNote]);
    const chronology = async (token: string) => ((await request("GET",
      `/api/v1/jurisdictions/${seed.jurisdictionId}/chronology?limit=500`, token)).json().entries as Array<{ subjectId: string | null }>)
      .map((entry) => entry.subjectId);
    expect(await chronology(outsiderToken)).not.toContain(restricted);
    expect(await chronology(adminToken)).toContain(restricted);
  });

  it("composes reference labels from several fields, omitting unreadable ones", async () => {
    const labels = async (token: string) => {
      const res = await request("GET",
        `/api/v1/boards/${sourceBoard}/record-references/note?incidentId=${incidentId}&limit=100`, token);
      return new Map((res.json().options as Array<{ id: string; label: string }>).map((o) => [o.id, o.label]));
    };
    expect((await labels(holderToken)).get(restricted)).toBe("C-1 / Alpha");
    expect((await labels(adminToken)).get(restricted)).toBe("C-1 / Alpha / hidden");
    expect((await labels(holderToken)).has(outsiderNote)).toBe(false);
  });

  it("refuses edits the edit rule does not grant, on REST and on the database", async () => {
    const patch = (token: string) => request("PATCH", `/api/v1/boards/${privateBoard}/records/${restricted}`, token, { name: "Changed" });
    expect((await patch(holderToken)).statusCode).toBe(403);
    expect((await patch(outsiderToken)).statusCode).toBe(404);
    expect((await request("POST", `/api/v1/boards/${privateBoard}/records/${restricted}/archive`, holderToken)).statusCode).toBe(403);
    expect((await patch(authorToken)).statusCode).toBe(200);
    // The second wall: an update outside the service still touches no row.
    const holder = await principalForPerson(runtime, (await admin`select id from persons where email = 'holder@example.org'`)[0]!.id as string);
    const touched = await runtime.begin(async (tx) => {
      await tx`select set_config('app.person_id', ${holder.person.id}, true)`;
      return (await tx`update board_records set data = '{"code":"X"}'::jsonb where id = ${restricted}`).count;
    });
    expect(touched).toBe(0);
  });

  it("serves a restricted board's sync state only to callers who read every record", async () => {
    const outsider = await principalForPerson(runtime, outsiderId);
    await expect(hub.open(outsider, privateBoard)).rejects.toMatchObject({ status: 403 });
    await expect(hub.open(outsider, privateBoard, incidentId)).rejects.toMatchObject({ status: 403 });
    const author = await principalForPerson(runtime, authorId);
    await expect(hub.open(author, privateBoard, incidentId)).rejects.toMatchObject({ status: 403 });
    const chief = await principalForPerson(runtime, seed.adminId);
    const { state } = await hub.open(chief, privateBoard, incidentId);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    expect([...doc.getMap("records").keys()].some((key) => key.startsWith(`${restricted}/`))).toBe(true);
  });

  it("turns a sync edit the edit rule refuses into a conflict", async () => {
    const author = await principalForPerson(runtime, authorId);
    const other = await principalForPerson(runtime, outsiderId);
    const recordId = randomUUID();
    const seedDoc = new Y.Doc();
    Y.applyUpdate(seedDoc, (await hub.open(author, sharedBoard)).state);
    seedDoc.getMap("records").set(`${recordId}/title`, "By the author");
    expect((await hub.apply(author, sharedBoard, Y.encodeStateAsUpdate(seedDoc), "author")).conflicts).toBe(0);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await hub.open(other, sharedBoard)).state);
    doc.getMap("records").set(`${recordId}/title`, "Taken over");
    expect((await hub.apply(other, sharedBoard, Y.encodeStateAsUpdate(doc), "other")).conflicts).toBe(1);
    const [row] = await admin`select data from board_records where id = ${recordId}`;
    expect(row!.data).toEqual({ title: "By the author" });
    const [conflict] = await admin`select reason from sync_conflicts where record_id = ${recordId}`;
    expect(conflict!.reason).toBe("not permitted to edit this record");
  });
});

describe("archive, delete and history", () => {
  it("archives out of default views and restores, with audit entries", async () => {
    const id = await createVia(memberToken, probeBoard, { name: "Archive me", rank: 1, status: "open" });
    const listed = async (archived?: string) => ids((await walk(
      `/api/v1/boards/${probeBoard}/views/all${archived ? `?archived=${archived}` : ""}`, memberToken, 500)).records);
    expect((await request("POST", `/api/v1/boards/${probeBoard}/records/${id}/archive`, memberToken)).statusCode).toBe(200);
    expect(await listed()).not.toContain(id);
    expect(await listed("include")).toContain(id);
    expect(await listed("only")).toEqual([id]);
    const only = await walk(`/api/v1/boards/${probeBoard}/views/all?archived=only`, memberToken, 10);
    expect(typeof only.records[0]!.archivedAt).toBe("string");
    expect((await request("POST", `/api/v1/boards/${probeBoard}/records/${id}/restore`, memberToken)).statusCode).toBe(200);
    expect(await listed()).toContain(id);
    const categories = await admin`
      select category from audit_events where subject_id = ${id} order by seq`;
    expect(categories.map((row) => row.category)).toEqual(
      ["board.record.created", "board.record.archived", "board.record.restored"]);
  });

  it("returns the full change history, paged, with values before and after", async () => {
    const id = await createVia(memberToken, probeBoard, { name: "First", rank: 1 });
    for (const patch of [{ name: "Second" }, { name: "Third", rank: 2 }]) {
      expect((await request("PATCH", `/api/v1/boards/${probeBoard}/records/${id}`, memberToken, patch)).statusCode).toBe(200);
    }
    expect((await request("PATCH", `/api/v1/boards/${probeBoard}/records/${id}`, adminToken, { secret: "s" })).statusCode).toBe(200);
    await request("POST", `/api/v1/boards/${probeBoard}/records/${id}/archive`, memberToken);
    const entries: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;
    do {
      const res = await request("GET",
        `/api/v1/boards/${probeBoard}/records/${id}/history?limit=2${cursor ? `&cursor=${cursor}` : ""}`, memberToken);
      expect(res.statusCode).toBe(200);
      entries.push(...res.json().entries);
      cursor = res.json().nextCursor;
    } while (cursor);
    expect(entries.map((entry) => entry.category)).toEqual([
      "board.record.created", "board.record.updated", "board.record.updated",
      "board.record.updated", "board.record.archived",
    ]);
    expect(entries[0]!.actor).toMatchObject({ displayName: "Member" });
    expect(entries[1]!.changes).toEqual([{ field: "name", before: "First", after: "Second" }]);
    expect(entries[2]!.changes).toEqual([
      { field: "name", before: "Second", after: "Third" }, { field: "rank", before: 1, after: 2 }]);
    // The member cannot read `secret`, so the admin's change shows no fields.
    expect(entries[3]!.changes).toEqual([]);
    const adminView = await request("GET", `/api/v1/boards/${probeBoard}/records/${id}/history`, adminToken);
    expect(adminView.json().entries[3].changes).toEqual([{ field: "secret", before: null, after: "s" }]);
  });

  it("deletes for admins only, as a tombstone every read path skips, history kept", async () => {
    const id = await createVia(memberToken, probeBoard, { name: "Doomed", rank: 3, status: "closed" });
    expect((await request("DELETE", `/api/v1/boards/${probeBoard}/records/${id}`, memberToken)).statusCode).toBe(403);
    expect((await request("DELETE", `/api/v1/boards/${probeBoard}/records/${id}`, adminToken)).statusCode).toBe(200);
    expect((await request("DELETE", `/api/v1/boards/${probeBoard}/records/${id}`, adminToken)).statusCode).toBe(404);
    for (const token of [memberToken, adminToken]) {
      expect(ids((await walk(`/api/v1/boards/${probeBoard}/views/all?archived=include`, token, 500)).records)).not.toContain(id);
      expect((await request("GET", `/api/v1/boards/${probeBoard}/records/${id}/detail`, token)).statusCode).toBe(404);
      expect((await request("PATCH", `/api/v1/boards/${probeBoard}/records/${id}`, token, { name: "x" })).statusCode).toBe(404);
    }
    const [row] = await admin`select deleted_at, deleted_by, data from board_records where id = ${id}`;
    expect(row!.deleted_at).not.toBeNull();
    expect(row!.deleted_by).toBe(seed.adminId);
    const history = (await request("GET", `/api/v1/boards/${probeBoard}/records/${id}/history`, memberToken)).json();
    const last = history.entries.at(-1);
    expect(last.category).toBe("board.record.deleted");
    expect(last.changes).toEqual(expect.arrayContaining([{ field: "name", before: "Doomed", after: null }]));
  });

  it("removes a deleted record from the sync log and from open documents", async () => {
    const chief = await principalForPerson(runtime, seed.adminId);
    const recordId = randomUUID();
    const client = new Y.Doc();
    Y.applyUpdate(client, (await hub.open(chief, probeBoard)).state);
    const heard: Uint8Array[] = [];
    const release = hub.subscribe(probeBoard, null, (update) => heard.push(update));
    client.getMap("records").set(`${recordId}/name`, "Synced");
    await hub.apply(chief, probeBoard, Y.encodeStateAsUpdate(client), "client");
    // A second client holds the record and goes offline before the delete.
    const offline = new Y.Doc();
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(client));
    expect((await request("DELETE", `/api/v1/boards/${probeBoard}/records/${recordId}`, adminToken)).statusCode).toBe(200);
    for (const update of heard) Y.applyUpdate(client, update);
    expect(client.getMap("records").has(`${recordId}/name`)).toBe(false);
    release();
    // A hub with no memory of the document rebuilds it from the log alone.
    const fresh = new BoardSyncHub(runtime);
    try {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, (await fresh.open(chief, probeBoard)).state);
      expect([...doc.getMap("records").keys()].some((key) => key.startsWith(`${recordId}/`))).toBe(false);
    } finally {
      fresh.close();
    }
    // Its later edit to the deleted record is a conflict, not a resurrection.
    offline.getMap("records").set(`${recordId}/name`, "Back from the dead");
    expect((await hub.apply(chief, probeBoard, Y.encodeStateAsUpdate(offline), "offline")).conflicts).toBe(1);
    const [row] = await admin`select data, deleted_at from board_records where id = ${recordId}`;
    expect(row!.data).toEqual({ name: "Synced" });
    expect(row!.deleted_at).not.toBeNull();
  });
});

describe("filters, multi-key sort and groups", () => {
  let board: string;
  const now = Date.now();
  const rows: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    board = (await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, adminToken,
      { templateKey: "engine_probe", title: "Operators" })).json().id as string;
    for (let i = 0; i < 60; i += 1) {
      const data: Record<string, unknown> = {
        name: i % 7 === 0 ? `Alpha ${i}` : `beta ${i}`,
        rank: i % 9,
        status: i % 3 === 0 ? "closed" : "open",
        ...(i % 5 === 0 ? {} : { due: new Date(now + (i - 30) * 86_400_000).toISOString() }),
        ...(i % 4 === 0 ? { urgent: true } : {}),
      };
      rows.push(data);
    }
    // Timestamps a microsecond apart: ties on every sort key fall to the keyset tiebreak.
    await admin`
      insert into board_records (board_id, data, created_by, created_at)
      select ${board}, value, ${seed.adminId}, date_trunc('milliseconds', now()) + (ordinality % 3) * interval '1 microsecond'
      from jsonb_array_elements(${admin.json(rows as never)}) with ordinality`;
  });

  const matching = async (where: unknown[], limit = 7) => {
    const url = `/api/v1/boards/${board}/views/all?where=${encodeURIComponent(JSON.stringify(where))}`;
    const walked = await walk(url, memberToken, limit);
    return { names: walked.records.map((r) => r.name as string).sort(), sizes: walked.sizes };
  };
  const expected = (keep: (row: Record<string, unknown>) => boolean) =>
    rows.filter(keep).map((row) => row.name as string).sort();
  const day = 86_400_000;
  const dueOf = (row: Record<string, unknown>) => (typeof row.due === "string" ? Date.parse(row.due) : null);

  it("pushes every operator down to SQL, with full pages", async () => {
    const cases: Array<[unknown[], (row: Record<string, unknown>) => boolean]> = [
      [[{ field: "name", op: "contains", value: "ALPHA" }], (r) => String(r.name).includes("Alpha")],
      [[{ field: "name", op: "starts_with", value: "be" }], (r) => String(r.name).startsWith("beta")],
      [[{ field: "status", op: "in", value: ["closed"] }], (r) => r.status === "closed"],
      [[{ field: "status", op: "not_in", value: ["closed"] }], (r) => r.status !== "closed"],
      [[{ field: "rank", op: "gt", value: 6 }], (r) => (r.rank as number) > 6],
      [[{ field: "rank", op: "lte", value: 1 }], (r) => (r.rank as number) <= 1],
      [[{ field: "rank", op: "between", value: [2, 4] }], (r) => (r.rank as number) >= 2 && (r.rank as number) <= 4],
      [[{ field: "due", op: "before", value: "now" }], (r) => (dueOf(r) ?? Infinity) < Date.now()],
      [[{ field: "due", op: "after", value: "now+10d" }], (r) => (dueOf(r) ?? -Infinity) > Date.now() + 10 * day],
      [[{ field: "due", op: "between", value: ["now-5d", "now+5d"] }],
        (r) => dueOf(r) !== null && Math.abs(dueOf(r)! - Date.now()) <= 5 * day],
      [[{ field: "due", op: "is_empty" }], (r) => r.due === undefined],
      [[{ field: "urgent", op: "is_not_empty" }, { field: "status", op: "eq", value: "open" }],
        (r) => r.urgent === true && r.status === "open"],
      [[{ field: "secret", op: "is_empty" }], () => true],
      [[{ field: "secret", op: "is_not_empty" }], () => false],
    ];
    for (const [where, keep] of cases) {
      const result = await matching(where);
      expect(result.names, JSON.stringify(where)).toEqual(expected(keep));
      expect(result.sizes.slice(0, -1).every((size) => size === 7), JSON.stringify(where)).toBe(true);
    }
    const bad = await request("GET",
      `/api/v1/boards/${board}/views/all?where=${encodeURIComponent('[{"field":"rank","op":"gt","value":"x"}]')}`, memberToken);
    expect(bad.statusCode).toBe(400);
  });

  it("walks a multi-key sort exactly once across ties", async () => {
    for (const limit of [1, 4, 13]) {
      const walked = await walk(`/api/v1/boards/${board}/views/multi`, memberToken, limit);
      const ordered = await admin`
        select id from board_records where board_id = ${board}
        order by coalesce(data ->> 'status', '') asc, (data ->> 'rank')::float8 desc, created_at desc, id desc`;
      expect(ids(walked.records)).toEqual(ordered.map((row) => row.id as string));
    }
    const adhoc = await walk(`/api/v1/boards/${board}/views/all?sort=urgent:desc,due:asc,rank:asc`, memberToken, 6);
    expect(new Set(ids(adhoc.records)).size).toBe(60);
    const bad = await request("GET", `/api/v1/boards/${board}/views/multi?cursor=${Buffer.from(JSON.stringify(["open", "x", "2026-01-01T00:00:00.000000Z", randomUUID()])).toString("base64url")}`, memberToken);
    expect(bad.statusCode).toBe(400);
  });

  it("counts each group over every matching record and orders rows by group", async () => {
    const first = await request("GET", `/api/v1/boards/${board}/views/grouped?limit=5`, memberToken);
    expect(first.json().groups).toEqual([
      { value: "closed", count: rows.filter((r) => r.status === "closed").length },
      { value: "open", count: rows.filter((r) => r.status === "open").length },
    ]);
    const walked = await walk(`/api/v1/boards/${board}/views/grouped`, memberToken, 5);
    const statuses = walked.records.map((r) => r.status ?? rows.find((row) => row.name === r.name)!.status);
    expect(statuses).toEqual([...statuses].sort());
    const next = await request("GET", `/api/v1/boards/${board}/views/grouped?limit=5&cursor=${first.json().nextCursor}`, memberToken);
    expect(next.json().groups).toBeUndefined();
    const filtered = await request("GET",
      `/api/v1/boards/${board}/views/all?groupBy=urgent&where=${encodeURIComponent('[{"field":"rank","op":"gte","value":4}]')}`, memberToken);
    expect(filtered.json().groups).toEqual([
      { value: null, count: rows.filter((r) => (r.rank as number) >= 4 && r.urgent === undefined).length },
      { value: true, count: rows.filter((r) => (r.rank as number) >= 4 && r.urgent === true).length },
    ]);
  });
});

describe("import and export", () => {
  it("exports a view as CSV with its filters, visibility and the formula guard", async () => {
    const board = (await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, adminToken,
      { templateKey: "engine_probe", title: "Export" })).json().id as string;
    await createVia(adminToken, board, { name: "=HYPERLINK(\"http://x\")", rank: 9, status: "open", secret: "top" });
    await createVia(adminToken, board, { name: "-5 degrees", rank: -2 });
    await createVia(adminToken, board, { name: "small", rank: 1 });
    const res = await request("GET", `/api/v1/boards/${board}/views/big/export`, memberToken);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.body.trimEnd().split("\r\n");
    expect(lines[0]).toBe("id,name");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^[0-9a-f-]{36},"'=HYPERLINK\(""http:\/\/x""\)"$/);
    const all = (await request("GET", `/api/v1/boards/${board}/views/all/export`, adminToken)).body;
    expect(all.split("\r\n")[0]).toBe("id,name,rank,status,secret");
    expect(all).toContain(",'-5 degrees,-2,");
  });

  it("exports .xlsx that reads back cell for cell", async () => {
    const res = await request("GET", `/api/v1/boards/${probeBoard}/views/all/export?format=xlsx`, memberToken);
    expect(res.statusCode).toBe(200);
    const rows = readFirstWorksheet(res.rawPayload);
    const view = await walk(`/api/v1/boards/${probeBoard}/views/all`, memberToken, 500);
    expect(rows.map((row) => row.id)).toEqual(ids(view.records));
    const original = view.records.find((r) => typeof r.rank === "number")!;
    const read = rows.find((row) => row.id === original.id)!;
    expect(Number(read.rank)).toBe(original.rank);
    expect(read.name).toBe(original.name);
  });

  const upload = async (boardId: string, csv: string | Buffer, query: string, fields: Record<string, string> = {}, type = "text/csv") => {
    const body = await multipartUpload(fields, csv, type);
    return app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/import${query}`,
      headers: { ...auth(memberToken), ...body.headers }, payload: body.payload });
  };

  it("dry-runs with per-row errors and commits all rows or none", async () => {
    const board = (await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, adminToken,
      { templateKey: "engine_probe", title: "Import" })).json().id as string;
    const csv = "Name,rank,Status,due,extra\r\nOne,1,open,2026-09-23T10:00:00Z,x\r\nTwo,lots,shut,,\r\n,,,,\r\n\"Three, quoted\",3,closed,,\r\n";
    const dry = await upload(board, csv, "?dryRun=true");
    expect(dry.statusCode).toBe(200);
    expect(dry.json()).toMatchObject({
      dryRun: true, rows: 3, created: 0, ignored: ["extra"],
      mapping: { Name: "name", rank: "rank", Status: "status", due: "due" }, errorCount: 1,
    });
    expect(dry.json().errors).toEqual([{ row: 3, field: "rank", message: "Rank is not a number" }]);
    const failed = await upload(board, csv, "");
    expect(failed.statusCode).toBe(422);
    expect(failed.json().created).toBe(0);
    expect((await admin`select count(*)::int as n from board_records where board_id = ${board}`)[0]!.n).toBe(0);
    const fixed = csv.replace("Two,lots,shut", "Two,2,open");
    const ok = await upload(board, fixed, "");
    expect(ok.statusCode).toBe(201);
    expect(ok.json().created).toBe(3);
    const stored = await admin`select data from board_records where board_id = ${board} order by data ->> 'rank'`;
    expect(stored.map((row) => row.data)).toEqual([
      { name: "One", rank: 1, status: "open", due: "2026-09-23T10:00:00Z" },
      { name: "Two", rank: 2, status: "open" },
      { name: "Three, quoted", rank: 3, status: "closed" },
    ]);
    const audits = await admin`
      select count(*)::int as n from audit_events
      where category = 'board.record.created' and payload ->> 'via' = 'import' and payload ->> 'board' = 'engine_probe'`;
    expect(audits[0]!.n).toBe(3);
    // A member cannot write an admin-only field by import any more than by hand.
    const secret = await upload(board, "name,secret\r\nx,y\r\n", "?dryRun=true");
    expect(secret.json().errors).toEqual([{ row: 2, message: "field secret is admin-writable only" }]);
  });

  it("round-trips its own CSV and .xlsx exports, with an explicit mapping", async () => {
    const source = (await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, adminToken,
      { templateKey: "engine_probe", title: "Round trip" })).json().id as string;
    await createVia(memberToken, source, { name: "=cmd", rank: -1.5, status: "closed", urgent: false });
    await createVia(memberToken, source, { name: "+plain, with comma", due: "2026-01-02T03:04:05.000Z" });
    const csv = (await request("GET", `/api/v1/boards/${source}/views/all/export`, memberToken)).body;
    const xlsx = (await request("GET", `/api/v1/boards/${source}/views/all/export?format=xlsx`, memberToken)).rawPayload;
    const sourceRows = (await admin`select data from board_records where board_id = ${source}`).map((row) => row.data);
    for (const [file, type] of [[csv, "text/csv"], [xlsx, "application/octet-stream"]] as const) {
      const target = (await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, adminToken,
        { templateKey: "engine_probe", title: "Copy" })).json().id as string;
      const res = await upload(target, file, "", { mapping: JSON.stringify({ status: "status", rank: null }) }, type);
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().ignored).toEqual(["id", "rank"]);
      const copied = (await admin`select data from board_records where board_id = ${target}`).map((row) => row.data);
      const withoutRank = sourceRows.map((row) => {
        const { rank: _rank, due: _due, urgent: _urgent, ...rest } = row as Record<string, unknown>;
        return rest;
      });
      expect(copied).toEqual(expect.arrayContaining(withoutRank));
      expect(copied).toHaveLength(2);
    }
    expect((await upload(source, csv, "", { mapping: JSON.stringify({ name: "nope" }) })).statusCode).toBe(400);
  });
});
