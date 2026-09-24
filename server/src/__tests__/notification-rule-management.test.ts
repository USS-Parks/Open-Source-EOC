import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Notification rules once created: listed, changed, paused and removed by an
 * administrator of the jurisdiction only, each change audited; and the text a
 * rule sends, which reads in the board's and fields' own labels while the
 * webhook body keeps the stored keys and values.
 */

type Role = "admin" | "member" | "viewer" | "outsider";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let boardId: string;
const tokens = {} as Record<Role, string>;
const hook = "http://127.0.0.1:9/hook";

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, role: Role, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: auth(tokens[role]), ...(payload ? { payload } : {}) });
const rulesUrl = () => `/api/v1/jurisdictions/${jurisdictionId}/notification-rules`;

async function shelter(name: string, status: string): Promise<string> {
  const res = await call("POST", `/api/v1/boards/${boardId}/records`, "admin", { name, status, capacity: 100, occupancy: 10 });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function setStatus(recordId: string, status: string): Promise<void> {
  const res = await call("PATCH", `/api/v1/boards/${boardId}/records/${recordId}`, "admin", { status });
  expect(res.statusCode, res.body).toBe(200);
}

const outbox = (ruleId: string) => admin`
  select kind, headers, body from delivery_outbox where rule_id = ${ruleId} order by created_at, kind`;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  const viewer = await createPerson(admin, { email: "viewer@example.org", displayName: "Viewer", password: "rules-password-1" });
  await addMembership(admin, viewer, jurisdictionId, "viewer");
  const elsewhere = await createJurisdiction(admin, "elsewhere", "Elsewhere OES");
  const outsider = await createPerson(admin, { email: "outsider@example.org", displayName: "Outsider", password: "rules-password-1" });
  await addMembership(admin, outsider, elsewhere, "admin");
  tokens.admin = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  tokens.member = await tokenFor(app, "member@example.org", "another-good-password");
  tokens.viewer = await tokenFor(app, "viewer@example.org", "rules-password-1");
  tokens.outsider = await tokenFor(app, "outsider@example.org", "rules-password-1");
  const board = await call("POST", `/api/v1/jurisdictions/${jurisdictionId}/boards`, "admin", { templateKey: "shelters" });
  boardId = board.json().id as string;
  const allow = await app.inject({
    method: "PUT", url: `/api/v1/jurisdictions/${jurisdictionId}/notification-allowlist`,
    headers: auth(tokens.admin), payload: { entries: ["http://127.0.0.1:9"] },
  });
  expect(allow.statusCode, allow.body).toBe(200);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("managing notification rules", () => {
  it("lists, changes, pauses and removes a rule for an administrator only, and audits each change", async () => {
    const created = await call("POST", rulesUrl(), "admin", {
      boardId, event: "record.updated", condition: { op: "changed_to", field: "status", value: "closed" },
      channels: [{ kind: "ntfy", url: "http://127.0.0.1:9", topic: "shelters" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const ruleId = created.json().id as string;

    for (const role of ["member", "viewer", "outsider"] as const) {
      expect((await call("GET", rulesUrl(), role)).statusCode, role).toBe(403);
      expect((await call("PATCH", `/api/v1/notification-rules/${ruleId}`, role, { enabled: false })).statusCode, role)
        .toBe(role === "outsider" ? 404 : 403);
      expect((await call("DELETE", `/api/v1/notification-rules/${ruleId}`, role)).statusCode, role)
        .toBe(role === "outsider" ? 404 : 403);
    }
    const listed = await call("GET", rulesUrl(), "admin");
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toEqual({
      rules: [{
        id: ruleId, boardId, boardTitle: "Shelters", event: "record.updated",
        condition: { op: "changed_to", field: "status", value: "closed" },
        channels: [{ kind: "ntfy", url: "http://127.0.0.1:9", topic: "shelters" }],
        scheduleIntervalMinutes: null, rateLimit: { max: 60, windowMinutes: 10 }, enabled: true,
        createdAt: expect.any(String),
      }],
      nextCursor: null,
    });

    // Paused, the rule sends nothing.
    const paused = await call("PATCH", `/api/v1/notification-rules/${ruleId}`, "admin", { enabled: false });
    expect(paused.json()).toEqual({ id: ruleId, webhookSecret: null });
    const first = await shelter("Arcata Community Center", "normal");
    await setStatus(first, "closed");
    expect(await outbox(ruleId)).toHaveLength(0);

    // Resumed with a new condition, it fires on that condition.
    expect((await call("PATCH", `/api/v1/notification-rules/${ruleId}`, "admin", {
      enabled: true, condition: { op: "changed_to", field: "status", value: "evacuating" },
    })).statusCode).toBe(200);
    await setStatus(first, "evacuating");
    expect(await outbox(ruleId)).toHaveLength(1);

    // New channels are checked as at creation, and a first webhook brings its secret once.
    const refused = await call("PATCH", `/api/v1/notification-rules/${ruleId}`, "admin", {
      channels: [{ kind: "webhook", url: "https://unlisted.example.com/hook" }],
    });
    expect(refused.statusCode).toBe(422);
    const withHook = await call("PATCH", `/api/v1/notification-rules/${ruleId}`, "admin", { channels: [{ kind: "webhook", url: hook }] });
    expect(withHook.json().webhookSecret).toMatch(/^[0-9a-f]{48}$/);
    expect((await call("PATCH", `/api/v1/notification-rules/${ruleId}`, "admin", { channels: [{ kind: "webhook", url: hook }] }))
      .json().webhookSecret).toBeNull();
    expect((await call("GET", rulesUrl(), "admin")).body).not.toContain(withHook.json().webhookSecret as string);
    expect((await call("PATCH", `/api/v1/notification-rules/${ruleId}`, "admin", { color: "red" })).statusCode).toBe(400);

    // Removed, it leaves the list, stops firing and cannot be changed or removed again.
    expect((await call("DELETE", `/api/v1/notification-rules/${ruleId}`, "admin")).statusCode).toBe(200);
    expect((await call("GET", rulesUrl(), "admin")).json().rules).toEqual([]);
    await setStatus(first, "closed");
    await setStatus(first, "evacuating");
    expect(await outbox(ruleId)).toHaveLength(1);
    expect((await call("PATCH", `/api/v1/notification-rules/${ruleId}`, "admin", { enabled: true })).statusCode).toBe(404);
    expect((await call("DELETE", `/api/v1/notification-rules/${ruleId}`, "admin")).statusCode).toBe(404);
    const [row] = await admin`select enabled, removed_at from notification_rules where id = ${ruleId}`;
    expect(row!.enabled).toBe(false);
    expect(row!.removed_at).toBeInstanceOf(Date);
    // The database holds a removed rule disabled whatever path writes to it.
    await expect(admin`update notification_rules set enabled = true where id = ${ruleId}`).rejects.toThrow(/notification_rules_removed_disabled/);

    const audits = await admin`
      select category, payload from audit_events where subject_id = ${ruleId} order by seq`;
    expect(audits.map((a) => a.category)).toEqual([
      "notification.rule_changed", "notification.rule_changed", "notification.rule_changed",
      "notification.rule_changed", "notification.rule_removed",
    ]);
    expect(audits[0]!.payload).toEqual({ enabled: false });
  });
});

describe("the text a rule sends", () => {
  it("names the board, the record and what changed in labels, and keeps the webhook body in stored values", async () => {
    const created = await call("POST", rulesUrl(), "admin", {
      boardId, event: "record.updated", condition: { op: "changed_to", field: "status", value: "closed" },
      channels: [{ kind: "ntfy", url: "http://127.0.0.1:9", topic: "shelters" }, { kind: "webhook", url: hook }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const ruleId = created.json().id as string;
    const record = await shelter("McKinleyville Library", "normal");
    await setStatus(record, "closed");

    const [push, webhook] = await outbox(ruleId);
    expect(push).toMatchObject({
      kind: "ntfy",
      headers: { title: "Shelters record updated: McKinleyville Library" },
      body: "Shelters record updated: McKinleyville Library\nStatus: Closed (was Normal)",
    });
    expect(webhook!.kind).toBe("webhook");
    expect(JSON.parse(webhook!.body as string)).toMatchObject({
      event: "record.updated", board: "shelters", recordId: record,
      record: { name: "McKinleyville Library", status: "closed", capacity: 100, occupancy: 10 },
    });
    const notes = await admin`select channel, title, body from notifications where rule_id = ${ruleId} order by channel`;
    expect(notes.map((n) => [n.channel, n.title, n.body])).toEqual([
      ["ntfy", "Shelters record updated: McKinleyville Library", "Shelters record updated: McKinleyville Library\nStatus: Closed (was Normal)"],
      ["webhook", "Shelters record updated: McKinleyville Library", "Shelters record updated: McKinleyville Library\nStatus: Closed (was Normal)"],
    ]);
  });
});
