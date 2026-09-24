import { readFileSync } from "node:fs";
import type { Server } from "node:net";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { readFirstWorksheet } from "../forms/xlsx-import.js";
import { fixtureMessages } from "../notify/channels.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";
import { bodyOf, fakeRelay, type SmtpSession } from "./smtp-relay.js";

/**
 * The internal run of docs/WEBEOC-SIDE-BY-SIDE.md: one evaluator's walk through
 * the board, notification and reporting tasks in the script's order, on real
 * PostgreSQL through the real screens. Tasks the script answers with an
 * existing walk are not repeated here.
 */

const DIST = buildDir("webeoc-side-by-side-app");
const SHOTS = shotDir("webeoc-side-by-side");

/** A WebEOC board export: bookkeeping columns, then the board's own; the second row has a status the board refuses. */
const WEBEOC_EXPORT = Buffer.from([
  "dataid,prevdataid,entrydate,username,positionname,subscribername,name,status,capacity,occupied",
  "201,0,2026-09-20 14:05:00.000,jdoe,Shelter Branch,County EOC,Rio Dell Fire Hall,normal,60,12",
  "202,0,2026-09-20 14:10:00.000,jdoe,Shelter Branch,County EOC,Scotia Hall,open,40,5",
].join("\r\n"));

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let jurisdictionId: string;
let relay: Server;
let relayPort: number;
let sessions: SmtpSession[];
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  // Publishing a board template is an instance administrator's task.
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  ({ server: relay, port: relayPort, sessions } = await fakeRelay({}));
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
}, 180_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  relay?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

async function setTheme(theme: "light" | "dark"): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  const switcher = page.getByRole("button", { name: theme === "light" ? "Use light theme" : "Use dark theme" });
  if (await switcher.count()) await switcher.click();
  await page.getByRole("button", { name: "Account menu" }).click();
}

/** The light and dark 1440 captures taken where one module hands over to the next. */
async function boundary(module: string): Promise<void> {
  await page.screenshot({ path: join(SHOTS, `side-by-side-${module}-light-1440.png`), fullPage: false });
  await setTheme("dark");
  await page.screenshot({ path: join(SHOTS, `side-by-side-${module}-dark-1440.png`), fullPage: false });
  await setTheme("light");
}

async function download(scope: Locator | Page, name: string): Promise<{ name: string; bytes: Buffer }> {
  const pending = page.waitForEvent("download");
  await scope.getByRole("button", { name }).click();
  const file = await pending;
  return { name: file.suggestedFilename(), bytes: readFileSync((await file.path())!) };
}

async function recordId(name: string): Promise<string> {
  return (await admin`select id from board_records where data ->> 'name' = ${name}`)[0]!.id as string;
}

async function selectRecord(id: string): Promise<Locator> {
  const box = page.getByLabel(`Select record ${id}`);
  if (!await box.isChecked()) await box.click();
  await page.waitForURL((url) => url.hash.includes(`record=${id}`));
  const openContext = page.getByRole("button", { name: "Open context" });
  if (await openContext.isVisible()) await openContext.click();
  return page.getByRole("region", { name: "Selected record" });
}

async function editRecord(id: string, label: RegExp, change: (control: Locator) => Promise<void>): Promise<void> {
  const record = await selectRecord(id);
  await record.getByRole("button", { name: "Edit record" }).click();
  const form = page.getByRole("dialog", { name: "Edit Shelter status record" });
  await change(form.getByLabel(label));
  await form.getByRole("button", { name: "Save changes" }).click();
  await form.waitFor({ state: "hidden" });
}

/** The shelter names of the loaded rows, in table order. */
async function rowNames(): Promise<string[]> {
  return (await page.getByRole("main").locator("tbody tr td:nth-child(2)").allTextContents()).map((text) => text.trim());
}

async function addContact(name: string, email: string, phone: string): Promise<void> {
  await page.getByRole("button", { name: "Add contact" }).click();
  const form = page.getByRole("region", { name: "Add a contact" });
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByLabel("Email addresses").fill(email);
  await form.getByLabel("Phone numbers").fill(phone);
  await form.getByRole("button", { name: "Save contact" }).click();
  await page.getByText(`${name} saved.`).waitFor();
}

describe("WebEOC side-by-side evaluation, internal run", () => {
  it("walks the board, notification and reporting tasks in the script's order", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();

    // Task 1: a board from a template, composed on the Templates screen and published.
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    await page.getByRole("button", { name: "Create template" }).click();
    await page.getByRole("heading", { name: "Create board template" }).waitFor();
    await page.getByLabel("Board key", { exact: true }).fill("shelter_status");
    await page.getByLabel("Board title", { exact: true }).fill("Shelter status");
    for (const field of [
      { key: "name", label: "Shelter name", type: "text", required: true },
      { key: "status", label: "Status", type: "enum", enumId: "have.facility_operating_status", required: true },
      { key: "capacity", label: "Capacity", type: "number", required: false },
      { key: "occupied", label: "Occupied", type: "number", required: false },
    ]) {
      await page.getByLabel("Field key", { exact: true }).fill(field.key);
      await page.getByLabel("Field label", { exact: true }).fill(field.label);
      await page.getByLabel("Field type", { exact: true }).selectOption(field.type);
      if (field.enumId) await page.getByLabel("Enumeration", { exact: true }).selectOption(field.enumId);
      if (field.required) await page.getByLabel("Required", { exact: true }).check();
      await page.getByRole("button", { name: "Add field" }).click();
    }
    await page.getByRole("tab", { name: "Views" }).click();
    await page.getByLabel("View key", { exact: true }).fill("all");
    await page.getByLabel("View title", { exact: true }).fill("All shelters");
    const viewColumns = page.getByRole("group", { name: "View columns" });
    for (const key of ["name", "status", "capacity", "occupied"]) {
      await viewColumns.getByRole("checkbox", { name: key, exact: true }).check();
    }
    await page.getByRole("button", { name: "Add view" }).click();
    const created = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith(`/api/v1/jurisdictions/${jurisdictionId}/boards`));
    await page.getByRole("button", { name: "Publish and create board" }).click();
    expect((await created).status()).toBe(201);
    await page.getByRole("button", { name: "New record", exact: true }).waitFor();
    const [board] = await admin`select id, template_key, template_version from boards where title = 'Shelter status'`;
    expect(board).toMatchObject({ template_key: "shelter_status", template_version: 1 });
    const boardId = board!.id as string;
    // The console loads its board list once, so the new board is listed after a reload.
    await page.getByRole("button", { name: "Boards", exact: true }).click();
    await page.reload({ waitUntil: "load" });
    await page.getByRole("main").getByText("Shelter status").first().waitFor();
    await page.goto(`${baseUrl}/app/index.html#/board/${boardId}?view=all`);

    // Task 2: enter records through the board's input form.
    for (const [name, status, capacity, occupied] of [
      ["Eureka High School", "normal", "200", "120"],
      ["Arcata Community Center", "normal", "150", "40"],
      ["Fortuna Veterans Hall", "compromised", "80", "75"],
      ["McKinleyville Library", "normal", "50", "0"],
    ] as const) {
      await page.getByRole("button", { name: "New record", exact: true }).click();
      const form = page.getByRole("dialog", { name: "New Shelter status record" });
      await form.getByLabel(/^Shelter name/).fill(name);
      await form.getByLabel(/^Status/).selectOption(status);
      await form.getByLabel(/^Capacity/).fill(capacity);
      await form.getByLabel(/^Occupied/).fill(occupied);
      await form.getByRole("button", { name: "Save record" }).click();
      await form.waitFor({ state: "hidden" });
      await page.getByRole("main").locator("tbody").getByText(name, { exact: true }).waitFor();
    }

    // Task 3: edit a record.
    const arcata = await recordId("Arcata Community Center");
    await editRecord(arcata, /^Occupied/, (control) => control.fill("60"));
    await expect.poll(async () => (await admin`select data ->> 'occupied' as n from board_records where id = ${arcata}`)[0]!.n)
      .toBe("60");

    // Task 4: filter, sort and group a view on the server.
    await page.getByText("Filter, sort and group").click();
    await page.getByRole("button", { name: "Add condition" }).click();
    await page.getByLabel("Condition 1 field").selectOption("capacity");
    await page.getByLabel("Condition 1 operator").selectOption("gte");
    await page.getByLabel("Condition 1 value").fill("80");
    await page.getByRole("button", { name: "Add sort key" }).click();
    await page.getByLabel("Sort 1 field").selectOption("status");
    await page.getByRole("button", { name: "Add sort key" }).click();
    await page.getByLabel("Sort 2 field").selectOption("capacity");
    await page.getByLabel("Sort 2 direction").selectOption("desc");
    await page.getByLabel("Group by").selectOption("status");
    const refined = page.waitForResponse((response) => response.url().includes(`/api/v1/boards/${boardId}/views/all?`)
      && response.url().includes("groupBy=status") && response.url().includes("where="));
    await page.getByRole("button", { name: "Apply" }).click();
    await refined;
    const counts = page.getByRole("region", { name: "Group counts" });
    await counts.waitFor();
    expect(await counts.getByRole("listitem").allTextContents()).toEqual(["compromised 1", "normal 2"]);
    await expect.poll(() => rowNames()).toEqual(["Fortuna Veterans Hall", "Eureka High School", "Arcata Community Center"]);
    await page.getByRole("button", { name: "Clear" }).click();
    await expect.poll(async () => (await rowNames()).length).toBe(4);

    // Task 5: the kanban view, columns by status.
    const modes = page.getByRole("group", { name: "Show records as" });
    await modes.getByRole("button", { name: "Kanban" }).click();
    const column = (value: string) => page.locator(`section.board-kanban__column[data-value="${value}"]`);
    await expect.poll(() => column("normal").locator(".board-kanban__count").textContent()).toBe("3");
    expect(await column("compromised").locator(".board-kanban__count").textContent()).toBe("1");
    await modes.getByRole("button", { name: "List" }).click();

    // Task 6: export the view as CSV and Excel.
    const csv = await download(page, "Export CSV");
    expect(csv.name).toBe("all.csv");
    const lines = csv.bytes.toString("utf8").trim().split(/\r?\n/);
    expect(lines[0]).toBe("id,name,status,capacity,occupied");
    expect(lines).toHaveLength(5);
    const excel = await download(page, "Export Excel");
    expect(excel.name).toBe("all.xlsx");
    expect(readFirstWorksheet(excel.bytes)).toHaveLength(4);

    // Task 7: move a WebEOC board export into this board.
    await page.getByRole("button", { name: "Administration", exact: true }).click();
    await page.getByRole("tab", { name: "Records" }).click();
    const migration = page.getByRole("region", { name: "WebEOC migration" });
    await migration.getByLabel("Target board").selectOption({ label: "Shelter status" });
    await migration.getByLabel("WebEOC CSV export").setInputFiles({ name: "shelters.csv", mimeType: "text/csv", buffer: WEBEOC_EXPORT });
    await migration.getByText("2 rows read: 1 will be created, 0 already imported, 1 rejected.").waitFor();
    await migration.getByRole("button", { name: "Import 1 record" }).click();
    await migration.getByText("Imported 1 record. 1 row rejected, 0 already imported.").waitFor();
    const [imported] = await admin`
      select payload -> 'source' ->> 'dataid' as dataid, payload -> 'source' ->> 'positionname' as position
      from audit_events where category = 'board.record.created' and subject_id = ${await recordId("Rio Dell Fire Hall")}`;
    expect(imported).toEqual({ dataid: "201", position: "Shelter Branch" });

    // Task 8: the record's change history.
    await page.goto(`${baseUrl}/app/index.html#/board/${boardId}?view=all`);
    await page.getByRole("main").locator("tbody").getByText("Rio Dell Fire Hall", { exact: true }).waitFor();
    const detail = await selectRecord(arcata);
    await detail.getByRole("tab", { name: "Change history" }).click();
    const history = detail.getByRole("list", { name: "Record history" });
    await history.waitFor();
    const entries = await history.locator(":scope > li").allTextContents();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatch(/^Created · .* · Admin/);
    expect(entries[1]).toMatch(/^Updated · .* · AdminOccupied40 → 60$/);
    await boundary("boards");
    await detail.getByRole("tab", { name: "Record" }).click();

    // Task 10: email through a relay on this machine and SMS through the fixture provider.
    await page.getByRole("button", { name: "Administration", exact: true }).click();
    await page.getByRole("tab", { name: "Channels" }).click();
    await page.getByLabel("Relay host").fill("127.0.0.1");
    await page.getByLabel("Relay port").fill(String(relayPort));
    await page.getByLabel("Connection security").selectOption("none");
    await page.getByLabel("From address").fill("eoc@example.org");
    await page.getByRole("button", { name: "Save email settings" }).click();
    await page.getByText("Email settings saved.").waitFor();
    await page.getByLabel("Test email recipient").fill("duty@example.org");
    await page.getByRole("button", { name: "Send test email" }).click();
    await page.getByText(/Test message to duty@example\.org delivered: 250 2\.0\.0 Ok: queued as/).waitFor();
    const sms = page.getByRole("region", { name: "SMS", exact: true });
    await sms.getByLabel("SMS provider").selectOption("fixture");
    await sms.getByRole("button", { name: "Save SMS settings" }).click();
    await sms.getByText("SMS settings saved.").waitFor();
    await sms.getByLabel("Test phone number").fill("+17075550100");
    await sms.getByRole("button", { name: "Send test SMS" }).click();
    await sms.getByText(/recorded by the fixture provider \(fixture: not sent\)/).waitFor();

    // Task 11: a rule on a record change, by email and SMS.
    await page.getByRole("tab", { name: "Notifications" }).click();
    const rule = page.getByRole("region", { name: "Add a notification rule" });
    await rule.getByLabel("Board", { exact: true }).selectOption({ label: "Shelter status" });
    await rule.getByLabel("When", { exact: true }).selectOption("record.updated");
    await rule.getByLabel("Condition", { exact: true }).selectOption("changed_to");
    await rule.getByLabel("Field key", { exact: true }).fill("status");
    await rule.getByLabel("Value", { exact: true }).fill("closed");
    await rule.getByLabel("Channel kind", { exact: true }).selectOption("email");
    await rule.getByLabel("Email addresses, separated by commas", { exact: true }).fill("shelter-desk@example.org");
    await rule.getByRole("button", { name: "Add channel" }).click();
    await rule.getByLabel("Channel kind, channel 2", { exact: true }).selectOption("sms");
    await rule.getByLabel("Phone numbers in E.164 form, separated by commas, channel 2", { exact: true }).fill("+17075550199");
    await rule.getByRole("button", { name: "Create rule" }).click();
    await rule.getByText("Notification rule created.").waitFor();

    // The shelter closes on the board; the worker sends what the rule queued.
    await page.goto(`${baseUrl}/app/index.html#/board/${boardId}?view=all`);
    await page.getByRole("main").locator("tbody").getByText("McKinleyville Library", { exact: true }).waitFor();
    await editRecord(await recordId("McKinleyville Library"), /^Status/, (control) => control.selectOption("closed").then(() => undefined));
    expect((await new DeliveryWorker(runtime, { timeoutMs: 3000 }).drain()).delivered).toBe(2);
    const alert = sessions.find((s) => s.commands.includes("RCPT TO:<shelter-desk@example.org>"))!;
    expect(alert.data).toContain("Subject: shelter_status: record.updated");
    expect(bodyOf(alert.data)).toContain("shelter_status updated: McKinleyville Library");
    expect(fixtureMessages(jurisdictionId).find((m) => m.to === "+17075550199")?.body)
      .toBe("shelter_status updated: McKinleyville Library");
    await page.getByRole("button", { name: "Administration", exact: true }).click();
    await page.getByRole("tab", { name: "Channels" }).click();
    await page.getByRole("listitem", { name: "Fixture message to +17075550199" })
      .getByText("McKinleyville Library", { exact: false }).waitFor();

    // Task 12: contacts and a group in call-down order.
    await page.getByRole("button", { name: "Contacts", exact: true }).click();
    await addContact("Avery First", "avery@example.org", "+1 (707) 555-0101");
    await addContact("Bailey Second", "bailey@example.org", "+17075550102");
    await page.getByRole("button", { name: "New group" }).click();
    const group = page.getByRole("region", { name: "New group" });
    await group.getByLabel("Group name").fill("Shelter managers");
    for (let i = 0; i < 2; i += 1) await group.getByRole("button", { name: "Add to group" }).click();
    await group.getByRole("button", { name: "Save group" }).click();
    await page.getByText("Group Shelter managers saved.").waitFor();

    // Task 13: a mass notification to the group, with delivery receipts.
    await page.getByRole("button", { name: "Mass Notification", exact: true }).click();
    await page.getByLabel("Subject").fill("Shelter capacity check");
    await page.getByLabel("Message", { exact: true }).fill("Report open spaces at each shelter by 1800.");
    await page.getByLabel("Contact group").selectOption({ label: "Shelter managers (2)" });
    await page.getByRole("button", { name: "Send notification" }).click();
    await page.getByText("Shelter capacity check sent.").waitFor();
    const receipts = page.getByRole("region", { name: "Receipts: Shelter capacity check" });
    await receipts.getByText("Everyone at once").waitFor();
    expect((await new DeliveryWorker(runtime, { timeoutMs: 3000 }).drain()).delivered).toBe(4);
    await receipts.getByRole("button", { name: "Refresh receipts" }).click();
    for (const name of ["Avery First", "Bailey Second"]) {
      const receipt = receipts.getByRole("listitem", { name: `Receipt for ${name}` });
      await receipt.getByText(/250 2\.0\.0 Ok: queued as/).waitFor();
      await receipt.getByText("fixture: not sent").waitFor();
      await receipt.getByText("Not acknowledged").waitFor();
    }
    await receipts.scrollIntoViewIfNeeded();
    await boundary("notifications");

    // Task 15: a saved report with grouping and totals.
    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await page.getByText("No reports yet.").waitFor();
    await page.getByRole("button", { name: "New report" }).click();
    const builder = page.getByRole("region", { name: "New report" });
    await builder.getByLabel("Report name").fill("Shelter capacity by status");
    await builder.getByLabel("Board", { exact: true }).selectOption({ label: "Shelter status" });
    const columns = builder.getByRole("group", { name: "Columns" });
    await expect.poll(() => columns.getByRole("checkbox", { name: "Status" }).isChecked()).toBe(true);
    await columns.getByRole("checkbox", { name: "Status" }).uncheck();
    await builder.getByText("Filter, sort and group").click();
    await builder.getByLabel(/^Group by/).selectOption("status");
    await builder.getByRole("button", { name: "Apply" }).click();
    await builder.getByRole("button", { name: "Add total" }).click();
    await builder.getByRole("button", { name: "Add total" }).click();
    await builder.getByLabel("Total 2 field").selectOption("occupied");
    const totals = builder.getByRole("table", { name: "Preview totals" });
    await totals.getByRole("row", { name: "All records 5 540 267" }).waitFor();
    await totals.getByRole("row", { name: "normal 3 410 192" }).waitFor();
    await totals.getByRole("row", { name: "compromised 1 80 75" }).waitFor();
    await totals.getByRole("row", { name: "closed 1 50 0" }).waitFor();
    await builder.getByRole("button", { name: "Save report" }).click();
    const report = page.getByRole("region", { name: "Report: Shelter capacity by status" });
    await report.getByRole("button", { name: "Run", exact: true }).click();
    await report.getByRole("table", { name: "Run totals" }).getByRole("row", { name: "All records 5 540 267" }).waitFor();

    // Task 16: PDF and Excel output.
    const pdf = await download(report, "Download PDF");
    expect(pdf.bytes.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(pdf.bytes.toString("latin1")).toContain("(All records: 5 records; Capacity sum 540; Occupied sum 267) Tj");
    const sheet = readFirstWorksheet((await download(report, "Download Excel")).bytes);
    expect(sheet.some((row) => Object.values(row).includes("Rio Dell Fire Hall"))).toBe(true);
    expect(sheet.some((row) => Object.values(row).includes("All records"))).toBe(true);

    // Task 17: a daily schedule that emails the PDF.
    await report.getByLabel("Runs", { exact: true }).selectOption("daily");
    await report.getByLabel("Time of day").fill("07:00");
    await report.getByLabel("Time zone").fill("America/Los_Angeles");
    await report.getByLabel("Email addresses").fill("planning@example.org");
    await report.getByRole("button", { name: "Save schedule" }).click();
    await report.getByText("Schedule saved.").waitFor();
    await report.getByText(/PDF daily at 07:00 \(America\/Los_Angeles\)\. Next run/).waitFor();
    const [saved] = await admin`select schedule from reports where name = 'Shelter capacity by status'`;
    expect(saved!.schedule).toMatchObject({ cadence: { kind: "daily", time: "07:00" }, format: "pdf", emails: ["planning@example.org"] });
    await report.scrollIntoViewIfNeeded();
    await boundary("reports");

    await setTheme("dark");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Save schedule" }).waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "side-by-side-reports-dark-390.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 420_000);
});
