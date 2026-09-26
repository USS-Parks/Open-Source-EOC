import { mkdtempSync } from "node:fs";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BoardTemplateSchema } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { BlobStore } from "../files/service.js";
import { runDueReports } from "../reports/job.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";
import { fakeRelay } from "./smtp-relay.js";

/**
 * Charts in reports (VC-24) against a real database: a chart counts the
 * report's own rows, so its groups reconcile with the table and its groups;
 * over time it counts per hour, day or week on a time zone's wall clock with
 * empty buckets as zero; it is drawn in the PDF, listed in the spreadsheet
 * outputs and sent with a scheduled email; a chart over a field the runner
 * cannot read is left out and named.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminToken: string;
let memberToken: string;
let boardId: string;
let relay: Server;

const log = BoardTemplateSchema.parse({
  key: "chart_log",
  version: 1,
  title: "Chart log",
  fields: [
    { key: "item", label: "Item", type: "text", required: true },
    { key: "quantity", label: "Quantity", type: "number" },
    { key: "priority", label: "Priority", type: "enum", values: ["routine", "urgent"] },
    { key: "reported_at", label: "Reported at", type: "datetime" },
    { key: "location", label: "Location", type: "geometry", geometryKind: "point" },
    { key: "funding", label: "Funding", type: "enum", values: ["state", "federal"], read: "admin", write: "admin" },
  ],
  views: [{ key: "all", title: "All", columns: ["item"] }],
});

const request = (method: string, url: string, token: string, payload?: unknown) =>
  app.inject({ method: method as "GET", url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as object }) });

const create = (token: string, name: string, definition: Record<string, unknown>, schedule: unknown = null) =>
  request("POST", `/api/v1/jurisdictions/${jurisdictionId}/reports`, token, { name, boardId, definition, schedule });

async function output(token: string, reportId: string, format = "json") {
  const res = await request("GET", `/api/v1/reports/${reportId}/output?format=${format}`, token);
  expect(res.statusCode, res.body).toBe(200);
  return res;
}

/** The text a PDF draws, in order, from its string operands. */
function pdfText(bytes: Buffer): string[] {
  const text = bytes.toString("latin1");
  return [...text.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]!.replace(/\\([\\()])/g, "$1"));
}

/** The cross-reference table points at every object, and each stream's length is its body's. */
function checkPdf(bytes: Buffer): number {
  const text = bytes.toString("latin1");
  expect(text.startsWith("%PDF-1.4\n") && text.endsWith("%%EOF\n")).toBe(true);
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  const entries = text.slice(start).split("\n").slice(3).filter((line) => line.endsWith(" 00000 n "));
  entries.forEach((entry, i) => expect(text.slice(Number(entry.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true));
  for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const body = m.index + m[0].length;
    expect(text.slice(body + Number(m[1]), body + Number(m[1]) + 10)).toBe("\nendstream");
  }
  return (text.match(/\/Type \/Page /g) ?? []).length;
}

type Chart = { title: string; display: string; groups: Array<{ value: string; count: number }> };
const sum = (chart: Chart) => chart.groups.reduce((total, group) => total + group.count, 0);

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await admin`
    insert into board_templates (key, version, title, definition)
    values (${log.key}, ${log.version}, ${log.title}, ${admin.json(log as never)})`;
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  boardId = (await request("POST", `/api/v1/jurisdictions/${jurisdictionId}/boards`, adminToken, { templateKey: log.key })).json().id as string;
  const rows: Array<Record<string, unknown>> = [
    // 23:30 on the 19th in Los Angeles, the 20th in UTC.
    { item: "Sandbags", quantity: 100, priority: "routine", reported_at: "2026-09-20T06:30:00Z" },
    { item: "Water", quantity: 200, priority: "routine", reported_at: "2026-09-20T18:00:00Z" },
    { item: "Cots", quantity: 50, priority: "urgent", reported_at: "2026-09-22T12:00:00Z" },
    { item: "Generators", quantity: 3, priority: "urgent" },
    { item: "Tarps", quantity: 40, priority: "routine", reported_at: "2026-09-22T20:00:00Z" },
    { item: "Tents", quantity: 5, priority: "urgent", reported_at: "2026-09-21T20:00:00Z" },
  ];
  const ids: string[] = [];
  for (const data of rows) {
    const res = await request("POST", `/api/v1/boards/${boardId}/records`, memberToken, data);
    expect(res.statusCode, res.body).toBe(201);
    ids.push(res.json().id as string);
  }
  expect((await request("POST", `/api/v1/boards/${boardId}/records/${ids[5]!}/archive`, memberToken)).statusCode).toBe(200);
  expect((await request("PATCH", `/api/v1/boards/${boardId}/records/${ids[0]!}`, adminToken, { funding: "federal" })).statusCode).toBe(200);
  const fake = await fakeRelay({});
  relay = fake.server;
  const email = await request("PUT", `/api/v1/jurisdictions/${jurisdictionId}/notification-channels/email`, adminToken,
    { settings: { host: "127.0.0.1", port: fake.port, security: "none", from: "eoc@example.org" } });
  expect(email.statusCode, email.body).toBe(200);
}, 60_000);

afterAll(async () => {
  relay?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("a report's chart", () => {
  it("counts the table's own rows, so each group reconciles with the rows and groups", async () => {
    const created = await create(memberToken, "Supplies by priority", {
      columns: ["item", "quantity"], groupBy: ["priority"], where: [{ field: "quantity", op: "gte", value: 10 }],
      chart: { display: "bar", field: "priority" },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().definition.chart).toEqual({ display: "bar", field: "priority", interval: null, timeZone: "UTC" });
    const result = (await output(memberToken, created.json().id as string)).json();
    expect(result.rows.map((row: { item: string }) => row.item).sort()).toEqual(["Cots", "Sandbags", "Tarps", "Water"]);
    expect(result.chart).toEqual({
      kind: "chart", key: "chart", title: "Records by Priority", display: "bar",
      groups: [{ value: "Routine", count: 3 }, { value: "Urgent", count: 1 }],
    });
    expect(sum(result.chart)).toBe(result.total.count);
    for (const group of result.groups) {
      const label = group.values[0] === "routine" ? "Routine" : "Urgent";
      expect(result.chart.groups.find((g: { value: string }) => g.value === label).count).toBe(group.count);
    }
    // A report with no chart still reads as before.
    const plain = await create(memberToken, "Plain", { columns: ["item"] });
    expect(plain.json().definition.chart).toBeNull();
    expect((await output(memberToken, plain.json().id as string)).json().chart).toBeNull();
  });

  it("counts over time on a time zone's wall clock, with empty buckets as zero and records without a time last", async () => {
    const preview = async (chart: Record<string, unknown>, archived = "exclude") => {
      const res = await request("POST", `/api/v1/jurisdictions/${jurisdictionId}/reports/preview`, memberToken,
        { boardId, definition: { columns: ["item"], archived, chart } });
      expect(res.statusCode, res.body).toBe(200);
      const result = res.json();
      expect(sum(result.chart)).toBe(result.total.count);
      return result.chart as Chart;
    };
    const daily = await preview({ display: "bar", field: "reported_at", interval: "day", timeZone: "America/Los_Angeles" });
    expect(daily.title).toBe("Records per day by Reported at (America/Los_Angeles)");
    expect(daily.groups).toEqual([
      { value: "2026-09-19", count: 1 }, { value: "2026-09-20", count: 1 }, { value: "2026-09-21", count: 0 },
      { value: "2026-09-22", count: 2 }, { value: "(no value)", count: 1 },
    ]);
    expect((await preview({ display: "bar", field: "reported_at", interval: "day" })).groups).toEqual([
      { value: "2026-09-20", count: 2 }, { value: "2026-09-21", count: 0 }, { value: "2026-09-22", count: 2 },
      { value: "(no value)", count: 1 },
    ]);
    // The archived record joins when the report includes archived records; weeks start on Monday.
    expect((await preview({ display: "bar", field: "reported_at", interval: "week", timeZone: "America/Los_Angeles" }, "include")).groups)
      .toEqual([{ value: "Week of 2026-09-14", count: 2 }, { value: "Week of 2026-09-21", count: 3 }, { value: "(no value)", count: 1 }]);
    // Sixty-three hours: the earliest fold into one group so the chart keeps forty-eight buckets.
    const hourly = await preview({ display: "bar", field: "reported_at", interval: "hour", timeZone: "America/Los_Angeles" });
    expect(hourly.groups).toHaveLength(49);
    expect(hourly.groups[0]).toEqual({ value: "Before 2026-09-20 15:00", count: 2 });
    expect(hourly.groups[1]).toEqual({ value: "2026-09-20 15:00", count: 0 });
    expect(hourly.groups.filter((g) => g.count > 0).map((g) => g.value))
      .toEqual(["Before 2026-09-20 15:00", "2026-09-22 05:00", "2026-09-22 13:00", "(no value)"]);
    // A donut keeps its five colors apart: four groups and the rest as one.
    const donut = await preview({ display: "donut", field: "item" }, "include");
    expect(donut.groups).toEqual([
      { value: "Cots", count: 1 }, { value: "Generators", count: 1 }, { value: "Sandbags", count: 1 },
      { value: "Tarps", count: 1 }, { value: "Other (2 values)", count: 2 },
    ]);
  });

  it("draws the chart in the PDF before the table, and lists its counts in CSV and Excel", async () => {
    const bars = await create(memberToken, "Supplies chart", { columns: ["item", "quantity"], chart: { display: "bar", field: "priority" } });
    const reportId = bars.json().id as string;
    const pdf = (await output(memberToken, reportId, "pdf")).rawPayload;
    expect(checkPdf(pdf)).toBe(2);
    const text = pdfText(pdf);
    expect(text.indexOf("Records by Priority")).toBeLessThan(text.indexOf("Sandbags"));
    expect(text.slice(text.indexOf("Records by Priority"), text.indexOf("Page 1 of 2")))
      .toEqual(expect.arrayContaining(["5 records", "Routine", "3", "Urgent", "2"]));
    expect(pdf.toString("latin1").match(/ re f Q/g)).toHaveLength(2);
    const csv = (await output(memberToken, reportId, "csv")).body;
    expect(csv).toContain("\r\n\r\nRecords by Priority,Records\r\nRoutine,3\r\nUrgent,2");

    const donut = await create(memberToken, "Supplies donut", { columns: ["item"], chart: { display: "donut", field: "priority" } });
    const ring = (await output(memberToken, donut.json().id as string, "pdf")).rawPayload;
    checkPdf(ring);
    expect(pdfText(ring)).toEqual(expect.arrayContaining(["Routine: 3 (60%)", "Urgent: 2 (40%)", "5"]));
    expect(ring.toString("latin1")).toMatch(/ c .* l .* c h f Q/);
  });

  it("sends the chart in a scheduled email's PDF", async () => {
    const created = await create(memberToken, "Daily supplies", { columns: ["item"], chart: { display: "bar", field: "priority" } },
      { cadence: { kind: "interval", minutes: 60 }, format: "pdf", emails: ["ops@example.org"] });
    expect(created.statusCode, created.body).toBe(201);
    const store = new BlobStore(mkdtempSync(join(tmpdir(), "openeoc-report-charts-")));
    expect(await runDueReports(runtime, new Date(Date.parse(created.json().nextRunAt as string) + 60_000), { store })).toBe(1);
    const [queued] = await admin`
      select o.attachments from delivery_outbox o join notifications n on n.id = o.notification_id
      where n.detail ->> 'reportId' = ${created.json().id as string}`;
    const [attachment] = queued!.attachments as Array<{ sha256: string }>;
    const text = pdfText(await store.get(attachment!.sha256));
    expect(text).toEqual(expect.arrayContaining(["Daily supplies", "Records by Priority", "Routine", "Urgent"]));
  });

  it("refuses a chart its field cannot draw, and leaves out one over a field the runner cannot read", async () => {
    const bad = async (chart: Record<string, unknown>) =>
      (await create(memberToken, "Bad", { columns: ["item"], chart })).statusCode;
    expect(await bad({ display: "bar", field: "reported_at" })).toBe(400);
    expect(await bad({ display: "donut", field: "reported_at", interval: "day" })).toBe(400);
    expect(await bad({ display: "bar", field: "priority", interval: "day" })).toBe(400);
    expect(await bad({ display: "bar", field: "location" })).toBe(400);
    expect(await bad({ display: "bar", field: "funding" })).toBe(400);
    expect(await bad({ display: "bar", field: "reported_at", interval: "day", timeZone: "Mars/Olympus" })).toBe(400);
    expect(await bad({ display: "pie", field: "priority" })).toBe(400);

    const byAdmin = await create(adminToken, "By funding", { columns: ["item"], chart: { display: "bar", field: "funding" } });
    expect(byAdmin.statusCode, byAdmin.body).toBe(201);
    const reportId = byAdmin.json().id as string;
    expect((await output(adminToken, reportId)).json().chart.groups)
      .toEqual([{ value: "Federal", count: 1 }, { value: "(no value)", count: 4 }]);
    const asMember = (await output(memberToken, reportId)).json();
    expect(asMember.chart).toBeNull();
    expect(asMember.omitted).toEqual(["funding"]);
    expect(pdfText((await output(memberToken, reportId, "pdf")).rawPayload)).not.toContain("Records by Funding");
  });
});
