import { mkdtempSync } from "node:fs";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BoardTemplateSchema } from "@openeoc/shared";
import { addMembership, createPerson } from "../auth/service.js";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { BlobStore } from "../files/service.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { readFirstWorksheet } from "../forms/xlsx-import.js";
import { runDueReports } from "../reports/job.js";
import { tablePdf } from "../reports/pdf.js";
import { nextRunAt } from "../reports/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";
import { fakeRelay, type SmtpSession } from "./smtp-relay.js";

/**
 * Saved reports against a real database: definitions and their row-level
 * rules, a grouped report's counts and totals, record and field rules
 * applied to the person running it, the CSV, Excel and PDF renderings, and a
 * scheduled run that emails its PDF to a fake relay and stores it in files.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let authorToken: string;
let outsiderToken: string;
let viewerToken: string;
let authorId: string;
let boardId: string;
let relay: Server;
let sessions: SmtpSession[];

/** Supplies: each member reads only their own records; viewers read all; the unit cost is for admins. */
const supplies = BoardTemplateSchema.parse({
  key: "supply_log",
  version: 1,
  title: "Supply log",
  fields: [
    { key: "item", label: "Item", type: "text", required: true },
    { key: "quantity", label: "Quantity", type: "number" },
    { key: "priority", label: "Priority", type: "enum", values: ["routine", "urgent"] },
    { key: "site", label: "Site", type: "enum", values: ["north", "south"] },
    { key: "unit_cost", label: "Unit cost", type: "number", read: "admin", write: "admin" },
  ],
  views: [{ key: "all", title: "All", columns: ["item"] }],
  recordAccess: { read: [{ kind: "creator" }, { kind: "role", roles: ["viewer"] }], edit: [{ kind: "creator" }] },
});

const request = (method: string, url: string, token: string, payload?: unknown) =>
  app.inject({ method: method as "GET", url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as object }) });

async function person(email: string, role: "member" | "viewer") {
  const id = await createPerson(admin, { email, displayName: email.split("@")[0]!, password: "report-test-password" });
  await addMembership(admin, id, seed.jurisdictionId, role);
  return { id, token: await tokenFor(app, email, "report-test-password") };
}

async function record(token: string, data: Record<string, unknown>): Promise<string> {
  const res = await request("POST", `/api/v1/boards/${boardId}/records`, token, data);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

const grouped = {
  columns: ["item", "quantity"],
  groupBy: ["priority", "site"],
  totals: [
    { field: "quantity", fn: "sum" }, { field: "quantity", fn: "avg" },
    { field: "quantity", fn: "min" }, { field: "quantity", fn: "max" },
  ],
  sorts: [{ field: "quantity", dir: "desc" }],
};

async function createReport(token: string, body: Record<string, unknown>) {
  return request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/reports`, token,
    { name: "Supplies by priority", boardId, ...body });
}

/** The text drawn by a PDF, in order, from its string operands. */
function pdfText(bytes: Buffer): string[] {
  const text = bytes.toString("latin1");
  return [...text.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]!.replace(/\\([\\()])/g, "$1"));
}

/** Check the file header, the cross-reference table against every object's offset, and each stream's length. */
function checkPdfStructure(bytes: Buffer): number {
  const text = bytes.toString("latin1");
  expect(text.startsWith("%PDF-1.4\n")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  expect(text.slice(start, start + 5)).toBe("xref\n");
  const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(start))!;
  expect(Number(first)).toBe(0);
  const entries = text.slice(start).split("\n").slice(2, 2 + Number(count));
  expect(entries[0]).toBe("0000000000 65535 f ");
  entries.slice(1).forEach((entry, i) => {
    const offset = Number(entry.slice(0, 10));
    expect(entry.endsWith(" 00000 n ")).toBe(true);
    expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
  expect(text).toContain(`/Size ${count} /Root 1 0 R`);
  for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const bodyStart = m.index + m[0].length;
    expect(text.slice(bodyStart + Number(m[1]), bodyStart + Number(m[1]) + 10)).toBe("\nendstream");
  }
  return (text.match(/\/Type \/Page /g) ?? []).length;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await admin`
    insert into board_templates (key, version, title, definition)
    values (${supplies.key}, ${supplies.version}, ${supplies.title}, ${admin.json(supplies as never)})`;
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  const author = await person("author@example.org", "member");
  authorId = author.id;
  authorToken = author.token;
  outsiderToken = (await person("outsider@example.org", "member")).token;
  viewerToken = (await person("viewer@example.org", "viewer")).token;
  boardId = (await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, adminToken,
    { templateKey: "supply_log" })).json().id as string;
  await record(authorToken, { item: "Sandbags", quantity: 100, priority: "routine", site: "north" });
  await record(authorToken, { item: "Water", quantity: 200, priority: "routine", site: "south" });
  const cots = await record(authorToken, { item: "Cots", quantity: 50, priority: "urgent", site: "north" });
  await record(authorToken, { item: "Generators", quantity: 3, priority: "urgent", site: "north" });
  const tarps = await record(authorToken, { item: "Tarps", quantity: 40, priority: "routine", site: "north" });
  expect((await request("POST", `/api/v1/boards/${boardId}/records/${tarps}/archive`, authorToken)).statusCode).toBe(200);
  await record(outsiderToken, { item: "=HYPERLINK(\"http://x\")", quantity: 7, priority: "urgent", site: "south" });
  expect((await request("PATCH", `/api/v1/boards/${boardId}/records/${cots}`, adminToken, { unit_cost: 85 })).statusCode).toBe(200);
  const fake = await fakeRelay({});
  ({ server: relay, sessions } = fake);
  const email = await request("PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-channels/email`, adminToken,
    { settings: { host: "127.0.0.1", port: fake.port, security: "none", from: "eoc@example.org" } });
  expect(email.statusCode, email.body).toBe(200);
}, 60_000);

afterAll(async () => {
  relay?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("report definitions", () => {
  it("lets writers create, members read and run, and only the owner or an admin change or delete", async () => {
    expect((await createReport(viewerToken, { definition: grouped })).statusCode).toBe(403);
    const created = await createReport(authorToken, { definition: grouped });
    expect(created.statusCode, created.body).toBe(201);
    const report = created.json();
    expect(report).toMatchObject({ name: "Supplies by priority", canEdit: true, schedule: null, nextRunAt: null });
    const listed = await request("GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/reports?limit=1`, viewerToken);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().reports.map((r: { id: string }) => r.id)).toEqual([report.id]);
    expect(listed.json().reports[0].canEdit).toBe(false);
    expect((await request("GET", `/api/v1/reports/${report.id}/output?format=pdf`, viewerToken)).statusCode).toBe(200);

    const renamed = { name: "Renamed", boardId, definition: grouped };
    expect((await request("PUT", `/api/v1/reports/${report.id}`, outsiderToken, renamed)).statusCode).toBe(403);
    expect((await request("PUT", `/api/v1/reports/${report.id}`, viewerToken, renamed)).statusCode).toBe(403);
    expect((await request("DELETE", `/api/v1/reports/${report.id}`, outsiderToken)).statusCode).toBe(403);
    const byAdmin = await request("PUT", `/api/v1/reports/${report.id}`, adminToken, renamed);
    expect(byAdmin.statusCode, byAdmin.body).toBe(200);
    expect(byAdmin.json()).toMatchObject({ name: "Renamed", owner: { personId: authorId } });

    // The second wall: an update outside the service touches no row for a non-owner.
    const [outsider] = await admin`select id from persons where email = 'outsider@example.org'`;
    const touched = await runtime.begin(async (tx) => {
      await tx`select set_config('app.person_id', ${outsider!.id as string}, true)`;
      return (await tx`update reports set name = 'Hijacked' where id = ${report.id as string}`).count;
    });
    expect(touched).toBe(0);

    expect((await request("DELETE", `/api/v1/reports/${report.id}`, authorToken)).statusCode).toBe(200);
    expect((await request("GET", `/api/v1/reports/${report.id}`, authorToken)).statusCode).toBe(404);
    const categories = await admin`select category from audit_events where subject_id = ${report.id as string} order by seq`;
    expect(categories.map((row) => row.category)).toEqual(["report.created", "report.updated", "report.deleted"]);
  });

  it("refuses a definition over fields the author cannot use", async () => {
    const bad = async (definition: unknown) => (await createReport(authorToken, { definition })).statusCode;
    expect(await bad({ columns: ["nope"] })).toBe(400);
    expect(await bad({ columns: ["unit_cost"] })).toBe(400);
    expect(await bad({ columns: ["item"], totals: [{ field: "item", fn: "sum" }] })).toBe(400);
    expect(await bad({ columns: ["item"], where: [{ field: "item", op: "gt", value: 3 }] })).toBe(400);
    expect(await bad({ columns: ["item"], groupBy: ["site", "site"] })).toBe(400);
  });
});

describe("running a report", () => {
  let reportId: string;
  let adminReportId: string;

  beforeAll(async () => {
    reportId = (await createReport(authorToken, { definition: grouped })).json().id as string;
    adminReportId = (await createReport(adminToken, {
      name: "Costs", definition: { columns: ["item", "quantity", "unit_cost"], sorts: [{ field: "item", dir: "asc" }] },
    })).json().id as string;
  });

  it("groups two levels and totals each group and all records", async () => {
    const res = await request("GET", `/api/v1/reports/${reportId}/output`, authorToken);
    expect(res.statusCode, res.body).toBe(200);
    const result = res.json();
    expect(result.omitted).toEqual([]);
    expect(result.rows.map((row: { item: string }) => row.item)).toEqual(["Sandbags", "Water", "Cots", "Generators"]);
    const sum = (g: { totals: Record<string, number> }) => g.totals["quantity:sum"];
    expect(result.groups.map((g: { level: number; values: string[]; count: number }) =>
      [g.level, g.values.join("/"), g.count, sum(g as never)])).toEqual([
      [1, "routine", 2, 300], [2, "routine/north", 1, 100], [2, "routine/south", 1, 200],
      [1, "urgent", 2, 53], [2, "urgent/north", 2, 53],
    ]);
    expect(result.groups[3].totals).toEqual({ "quantity:sum": 53, "quantity:avg": 26.5, "quantity:min": 3, "quantity:max": 50 });
    expect(result.total).toEqual({ count: 4, totals: { "quantity:sum": 353, "quantity:avg": 88.25, "quantity:min": 3, "quantity:max": 200 } });

    const preview = await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/reports/preview`, authorToken, {
      boardId, definition: { ...grouped, where: [{ field: "quantity", op: "gte", value: 50 }] },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().total.totals["quantity:sum"]).toBe(350);
    expect(preview.json().rows.map((row: { item: string }) => row.item)).toEqual(["Sandbags", "Water", "Cots"]);
  });

  it("leaves out a record and a column the rules keep from the person running it", async () => {
    const own = (await request("GET", `/api/v1/reports/${adminReportId}/output`, adminToken)).json();
    expect(own.omitted).toEqual([]);
    expect(own.rows.map((row: { item: string }) => row.item)).toEqual(
      ["=HYPERLINK(\"http://x\")", "Cots", "Generators", "Sandbags", "Water"]);
    expect(own.rows.find((row: { item: string }) => row.item === "Cots").unit_cost).toBe(85);

    const outsider = (await request("GET", `/api/v1/reports/${adminReportId}/output`, outsiderToken)).json();
    expect(outsider.omitted).toEqual(["unit_cost"]);
    expect(outsider.columns.map((c: { key: string }) => c.key)).toEqual(["item", "quantity"]);
    expect(outsider.rows).toEqual([{ item: "=HYPERLINK(\"http://x\")", quantity: 7 }]);
    const pdf = (await request("GET", `/api/v1/reports/${adminReportId}/output?format=pdf`, outsiderToken)).rawPayload;
    const lines = pdfText(pdf).join("\n");
    expect(lines).toContain("Left out because outsider cannot read them: unit_cost");
    expect(lines).not.toContain("Cots");
  });

  it("writes Excel that reads back, CSV with the formula guard, and a valid PDF with the totals", async () => {
    const xlsx = await request("GET", `/api/v1/reports/${reportId}/output?format=xlsx`, authorToken);
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers["content-disposition"]).toMatch(/^attachment; filename="Supplies-by-priority-\d{8}-\d{4}\.xlsx"$/);
    const sheet = readFirstWorksheet(xlsx.rawPayload);
    // People read the workbook and the PDF, so enum values show as labels; CSV keeps the stored codes.
    expect(sheet.slice(0, 4)).toEqual([
      { Priority: "Routine", Site: "North", Item: "Sandbags", Quantity: "100" },
      { Priority: "Routine", Site: "South", Item: "Water", Quantity: "200" },
      { Priority: "Urgent", Site: "North", Item: "Cots", Quantity: "50" },
      { Priority: "Urgent", Site: "North", Item: "Generators", Quantity: "3" },
    ]);
    expect(sheet.at(-1)).toEqual({ Priority: "All records", Site: "4", Item: "353", Quantity: "88.25" });
    expect(sheet).toContainEqual({ Priority: "Urgent / North", Site: "2", Item: "53", Quantity: "26.5" });
    const csv = (await request("GET", `/api/v1/reports/${reportId}/output?format=csv`, authorToken)).body.split("\r\n");
    expect(csv).toContain("routine,north,Sandbags,100");
    expect(csv.some((line) => line.startsWith("urgent / north,2,53,26.5,"))).toBe(true);

    const admins = await request("GET", `/api/v1/reports/${adminReportId}/output?format=csv`, adminToken);
    expect(admins.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(admins.body.split("\r\n")[0]).toBe("Item,Quantity,Unit cost");
    expect(admins.body).toContain("\"'=HYPERLINK(\"\"http://x\"\")\",7,");

    const pdf = await request("GET", `/api/v1/reports/${reportId}/output?format=pdf`, authorToken);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(checkPdfStructure(pdf.rawPayload)).toBe(1);
    const text = pdfText(pdf.rawPayload);
    expect(text[0]).toBe("Supplies by priority");
    expect(text).toEqual(expect.arrayContaining([
      "Item", "Quantity", "Priority: Routine (2 records)", "Site: North (1 record)", "Sandbags",
      "Total for Routine: 2 records; Quantity sum 300; Quantity average 150; Quantity minimum 100; Quantity maximum 200",
      "All records: 4 records; Quantity sum 353; Quantity average 88.25; Quantity minimum 3; Quantity maximum 200",
    ]));
    expect(text.indexOf("Total for North: 1 record; Quantity sum 100; Quantity average 100; Quantity minimum 100; Quantity maximum 100"))
      .toBeLessThan(text.indexOf("Total for Routine: 2 records; Quantity sum 300; Quantity average 150; Quantity minimum 100; Quantity maximum 200"));
  });

  it("breaks a long table across pages with the headings on every page", () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({ kind: "row" as const, cells: [`Row ${i}`, "Ünïcode – ok"] }));
    const bytes = Buffer.from(tablePdf({ title: "Long", subtitle: ["Sub"], headers: ["Name", "Note"], lines }));
    const pages = checkPdfStructure(bytes);
    expect(pages).toBeGreaterThan(3);
    const text = pdfText(bytes);
    expect(text.filter((t) => t === "Name")).toHaveLength(pages);
    expect(text.filter((t) => t === "Long")).toHaveLength(pages);
    expect(text).toContain(`Page ${pages} of ${pages}`);
    expect(text).toContain("Row 199");
    // WinAnsi: accented letters stay single bytes and the en dash is 0x96.
    expect(text).toContain(`Ünïcode ${String.fromCharCode(0x96)} ok`);
  });
});

describe("scheduled reports", () => {
  it("times a daily run in its time zone across a daylight saving change", () => {
    const daily = { kind: "daily" as const, time: "07:30", timeZone: "America/Los_Angeles" };
    expect(nextRunAt(daily, new Date("2026-03-07T20:00:00Z")).toISOString()).toBe("2026-03-08T14:30:00.000Z");
    expect(nextRunAt(daily, new Date("2026-03-08T15:00:00Z")).toISOString()).toBe("2026-03-09T14:30:00.000Z");
    expect(nextRunAt(daily, new Date("2026-01-10T15:29:00Z")).toISOString()).toBe("2026-01-10T15:30:00.000Z");
  });

  it("runs when due as its owner, emails the PDF, stores the file and records the run", async () => {
    const [contact] = await admin`
      insert into contacts (jurisdiction_id, name, emails, updated_by)
      values (${seed.jurisdictionId}, 'Duty officer', '{duty@example.org}', ${seed.adminId}) returning id`;
    const [mute] = await admin`
      insert into contacts (jurisdiction_id, name, updated_by)
      values (${seed.jurisdictionId}, 'No address', ${seed.adminId}) returning id`;
    const schedule = {
      cadence: { kind: "interval", minutes: 60 }, format: "pdf", emails: ["ops@example.org"],
      contactIds: [contact!.id, mute!.id], storeFile: true,
    };
    expect((await createReport(authorToken, { definition: grouped, schedule: { ...schedule, contactIds: [seed.adminId] } })).statusCode)
      .toBe(400);
    const created = await createReport(authorToken, { name: "Hourly supplies", definition: grouped, schedule });
    expect(created.statusCode, created.body).toBe(201);
    const report = created.json();
    const due = Date.parse(report.nextRunAt);
    expect(due - Date.now()).toBeGreaterThan(59 * 60_000);

    const store = new BlobStore(mkdtempSync(join(tmpdir(), "openeoc-reports-")));
    expect(await runDueReports(runtime, new Date(), { store, timeoutMs: 3000 })).toBe(0);
    const ranAt = new Date(due + 60_000);
    expect(await runDueReports(runtime, ranAt, { store, timeoutMs: 3000 })).toBe(1);
    // Claimed: the same instant finds nothing further due.
    expect(await runDueReports(runtime, ranAt, { store, timeoutMs: 3000 })).toBe(0);

    // The run queues one email per address; the delivery worker sends them with the stored file.
    expect(sessions.filter((s) => s.data.includes("Subject: Report: Hourly supplies"))).toHaveLength(0);
    const queued = await admin`
      select d.target, d.attachments, n.status from delivery_outbox d
      join notifications n on n.id = d.notification_id
      where d.kind = 'email' and n.title = 'Report: Hourly supplies' order by d.target`;
    expect(queued.map((q) => [q.target, q.status])).toEqual([["duty@example.org", "pending"], ["ops@example.org", "pending"]]);
    expect(queued[0]!.attachments).toEqual([
      expect.objectContaining({ contentType: "application/pdf", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]);
    expect((await new DeliveryWorker(runtime, { store, timeoutMs: 3000 }).drain()).delivered).toBe(2);

    const mails = sessions.filter((s) => s.data.includes("Subject: Report: Hourly supplies"));
    expect(mails.flatMap((s) => s.commands.filter((c) => c.startsWith("RCPT"))).sort())
      .toEqual(["RCPT TO:<duty@example.org>", "RCPT TO:<ops@example.org>"]);
    const data = mails[0]!.data;
    const boundary = /Content-Type: multipart\/mixed; boundary="([^"]+)"/.exec(data)![1]!;
    const parts = data.split(`--${boundary}`);
    expect(parts.at(-1)!.startsWith("--")).toBe(true);
    expect(parts).toHaveLength(4);
    const [textHead, textBody] = parts[1]!.split("\r\n\r\n");
    expect(textHead).toContain("Content-Type: text/plain; charset=utf-8");
    expect(Buffer.from(textBody!.replace(/\r\n/g, ""), "base64").toString("utf8")).toContain("4 records from the board Supply log");
    const [fileHead, fileBody] = parts[2]!.split("\r\n\r\n");
    expect(fileHead).toMatch(/Content-Type: application\/pdf; name="Hourly-supplies-\d{8}-\d{4}\.pdf"/);
    expect(fileHead).toMatch(/Content-Disposition: attachment; filename="Hourly-supplies-\d{8}-\d{4}\.pdf"/);
    expect(fileHead).toContain("Content-Transfer-Encoding: base64");
    const attached = Buffer.from(fileBody!.replace(/\r\n/g, ""), "base64");
    checkPdfStructure(attached);
    expect(pdfText(attached)).toContain("All records: 4 records; Quantity sum 353; Quantity average 88.25; Quantity minimum 3; Quantity maximum 200");

    const [run] = await admin`select * from report_runs where report_id = ${report.id as string}`;
    expect(run).toMatchObject({ run_by: authorId, row_count: 4, outcome: "queued" });
    expect(run!.detail.emails).toEqual([
      expect.objectContaining({ to: "ops@example.org", queued: true }),
      expect.objectContaining({ to: "duty@example.org", queued: true }),
    ]);
    const sent = await admin`select status from notifications where title = 'Report: Hourly supplies'`;
    expect(sent.map((n) => n.status)).toEqual(["delivered", "delivered"]);
    expect(run!.detail.contactsWithoutEmail).toEqual(["No address"]);
    const [file] = await admin`select name, content_type, uploaded_by from files where id = ${run!.detail.fileId as string}`;
    expect(file).toMatchObject({ content_type: "application/pdf", uploaded_by: authorId });
    expect(file!.name).toMatch(/^Hourly-supplies-\d{8}-\d{4}\.pdf$/);
    const [audit] = await admin`select person_id, payload from audit_events where category = 'report.ran'`;
    expect(audit).toMatchObject({ person_id: authorId, payload: { outcome: "queued", rows: 4, emailsQueued: 2 } });

    const detail = (await request("GET", `/api/v1/reports/${report.id}`, viewerToken)).json();
    expect(detail.runs).toHaveLength(1);
    expect(detail.runs[0]).toMatchObject({ rows: 4, outcome: "queued", ranAs: "author" });
    expect(Date.parse(detail.nextRunAt)).toBe(ranAt.getTime() + 60 * 60_000);
  });
});
