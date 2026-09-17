import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let boardId: string;
let adminToken: string;
let memberToken: string;
let firstEventId: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });

  adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor("member@example.org", "another-good-password");

  const posRes = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`,
    headers: auth(adminToken),
    payload: { key: "ops_chief", title: "Operations Section Chief" },
  });
  const positionId = posRes.json().id as string;
  await app.inject({
    method: "POST",
    url: `/api/v1/positions/${positionId}/assignments`,
    headers: auth(adminToken),
    payload: { personId: seed.adminId },
  });
  await app.inject({
    method: "POST",
    url: `/api/v1/positions/${positionId}/sign-in`,
    headers: auth(adminToken),
  });

  const boardRes = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken),
    payload: { templateKey: "significant_events" },
  });
  boardId = boardRes.json().id as string;
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

describe("attribution on every state change (INV-2)", () => {
  it("record creation and update emit attributed audit events", async () => {
    const rec = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(adminToken),
      payload: {
        summary: "Bridge out on SR-169",
        occurred_at: "2026-09-17T10:00:00Z",
        severity: "critical",
      },
    });
    expect(rec.statusCode).toBe(201);
    const recordId = rec.json().id as string;

    await app.inject({
      method: "PATCH",
      url: `/api/v1/boards/${boardId}/records/${recordId}`,
      headers: auth(memberToken),
      payload: { severity: "warning" },
    });

    const events = await admin`
      select id, category, person_id, position_id, created_at from audit_events
      where jurisdiction_id = ${seed.jurisdictionId} order by seq`;
    expect(events).toHaveLength(2);
    firstEventId = events[0]!.id as string;
    expect(events[0]!.category).toBe("board.record.created");
    expect(events[0]!.person_id).toBe(seed.adminId);
    expect(events[0]!.position_id).not.toBeNull();
    expect(events[0]!.created_at).toBeTruthy();
    expect(events[1]!.category).toBe("board.record.updated");
    expect(events[1]!.person_id).toBe(seed.memberId);
    expect(events[1]!.position_id).toBeNull();
  });
});

describe("append-only at every layer (contract item 10)", () => {
  it("the runtime role holds no UPDATE or DELETE privilege", async () => {
    await expect(
      withPerson(runtime, seed.adminId, (tx) => tx`update audit_events set category = 'forged'`),
    ).rejects.toThrow(/permission denied|append-only/);
    await expect(
      withPerson(runtime, seed.adminId, (tx) => tx`delete from audit_events`),
    ).rejects.toThrow(/permission denied|append-only/);
  });

  it("even the table owner is stopped by the immutability trigger", async () => {
    await expect(admin`update audit_events set category = 'forged'`).rejects.toThrow(
      /append-only/,
    );
    await expect(admin`delete from audit_events`).rejects.toThrow(/append-only/);
  });
});

describe("corrections reference, never replace", () => {
  it("a correction is a new event and the original is untouched", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/audit/${firstEventId}/corrections`,
      headers: auth(adminToken),
      payload: { note: "Initial severity overstated; road was passable one lane." },
    });
    expect(res.statusCode).toBe(201);
    const [original] = await admin`
      select category, payload from audit_events where id = ${firstEventId}`;
    expect(original!.category).toBe("board.record.created");
    const [correction] = await admin`
      select category, corrects from audit_events where corrects = ${firstEventId}`;
    expect(correction!.category).toBe("correction");
  });
});

describe("the reimbursement-grade chronology (F2)", () => {
  it("exports the ordered, attributed record of the scripted incident", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/chronology`,
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const entries = res.json().entries as Array<{
      seq: number;
      category: string;
      line: string;
      position: string | null;
    }>;
    expect(entries.map((e) => e.category)).toEqual([
      "board.record.created",
      "board.record.updated",
      "correction",
    ]);
    expect(entries[0]!.position).toBe("Operations Section Chief");
    expect(entries[0]!.line).toMatch(
      /^\d{4}-\d{2}-\d{2}T.*Admin \(Operations Section Chief\): board\.record\.created$/,
    );
    expect(entries[2]!.line).toContain("(correction)");
    const seqs = entries.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it("stays inside the jurisdiction wall", async () => {
    const outsiderId = (await admin`
      insert into persons (email, display_name, password_hash)
      values ('aud-out@example.org', 'Out', 'scrypt:32768:8:1:00:00') returning id`)[0]!
      .id as string;
    const rows = await withPerson(
      runtime,
      outsiderId,
      (tx) => tx`select id from audit_events`,
    );
    expect(rows).toHaveLength(0);
  });
});
