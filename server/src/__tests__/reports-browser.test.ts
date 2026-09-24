import { mkdtempSync, readFileSync } from "node:fs";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { BlobStore } from "../files/service.js";
import { readFirstWorksheet } from "../forms/xlsx-import.js";
import { runDueReports } from "../reports/job.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";
import { fakeRelay, type SmtpSession } from "./smtp-relay.js";

const DIST = buildDir("reports-app");
const SHOTS = shotDir("reports");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let browser: Browser;
let page: Page;
let baseUrl: string;
let relay: Server;
let sessions: SmtpSession[];
const pageErrors: string[] = [];
const externalRequests: string[] = [];

const supplies = {
  key: "report_supplies",
  version: 1,
  title: "Supply log",
  fields: [
    { key: "item", label: "Item", type: "text", required: true },
    { key: "quantity", label: "Quantity", type: "number" },
    { key: "priority", label: "Priority", type: "enum", values: ["routine", "urgent"] },
    { key: "site", label: "Site", type: "enum", values: ["north", "south"] },
  ],
  views: [{ key: "all", title: "All", columns: ["item", "quantity"] }],
};

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await admin`
    insert into board_templates (key, version, title, definition)
    values (${supplies.key}, 1, ${supplies.title}, ${admin.json(supplies as never)})`;
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  const token = await login(app);
  const boardId = (await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey: supplies.key })).id;
  for (const [item, quantity, priority, site] of [
    ["Sandbags", 100, "routine", "north"], ["Water", 200, "routine", "south"],
    ["Cots", 50, "urgent", "north"], ["Generators", 3, "urgent", "south"], ["Tarps", 40, "routine", "north"],
  ] as const) {
    await post(app, token, `/api/v1/boards/${boardId}/records`, { item, quantity, priority, site });
  }
  const fake = await fakeRelay({});
  ({ server: relay, sessions } = fake);
  const email = await app.inject({
    method: "PUT", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-channels/email`, headers: auth(token),
    payload: { settings: { host: "127.0.0.1", port: fake.port, security: "none", from: "eoc@example.org" } },
  });
  expect(email.statusCode).toBe(200);
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

async function download(name: string): Promise<Buffer> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name }).click();
  return readFileSync((await (await pending).path())!);
}

describe("reports screen", () => {
  it("builds a grouped report with a sum, previews, saves, downloads PDF and Excel, and schedules it", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();

    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await page.getByText("No reports yet.").waitFor();
    await page.getByRole("button", { name: "New report" }).click();
    const builder = page.getByRole("region", { name: "New report" });
    await builder.getByLabel("Report name").fill("Supplies by priority");
    await builder.getByLabel("Board", { exact: true }).selectOption({ label: "Supply log" });
    const columns = builder.getByRole("group", { name: "Columns" });
    await columns.getByRole("checkbox", { name: "Item" }).waitFor();
    await expect.poll(() => columns.getByRole("checkbox", { name: "Priority" }).isChecked()).toBe(true);
    await columns.getByRole("checkbox", { name: "Priority" }).uncheck();
    await columns.getByRole("checkbox", { name: "Site" }).uncheck();

    // Group by priority, then by site; the sum of quantity per group.
    await builder.getByText("Filter, sort and group").click();
    await builder.getByLabel(/^Group by/).selectOption("priority");
    await builder.getByRole("button", { name: "Apply" }).click();
    await builder.getByLabel("Then group by").selectOption("site");
    await builder.getByRole("button", { name: "Add total" }).click();
    const totals = builder.getByRole("table", { name: "Preview totals" });
    await totals.getByRole("row", { name: "All records 5 393" }).waitFor();
    await totals.getByRole("row", { name: "Routine 3 340" }).waitFor();
    await totals.getByRole("row", { name: "Urgent / South 1 3" }).waitFor();
    expect(await builder.getByRole("table", { name: "Preview rows" }).locator("thead th").allTextContents())
      .toEqual(["Priority", "Site", "Item", "Quantity"]);
    await page.screenshot({ path: join(SHOTS, "report-builder-light-1440.png"), fullPage: false });

    await builder.getByRole("button", { name: "Save report" }).click();
    const detail = page.getByRole("region", { name: "Report: Supplies by priority" });
    await detail.waitFor();
    await page.getByRole("listitem", { name: "Report Supplies by priority" }).waitFor();
    await detail.getByRole("button", { name: "Run", exact: true }).click();
    await detail.getByRole("table", { name: "Run totals" }).getByRole("row", { name: "All records 5 393" }).waitFor();

    const pdf = await download("Download PDF");
    expect(pdf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    const text = pdf.toString("latin1");
    expect(text).toContain("(Priority: Routine \\(3 records\\)) Tj");
    expect(text).toContain("(All records: 5 records; Quantity sum 393) Tj");
    const sheet = readFirstWorksheet(await download("Download Excel"));
    expect(sheet[0]).toEqual({ Priority: "Routine", Site: "North", Item: "Tarps", Quantity: "40" });
    expect(sheet.at(-1)).toEqual({ Priority: "All records", Site: "5", Item: "393" });

    // A daily schedule, emailed as a PDF.
    await detail.getByLabel("Runs", { exact: true }).selectOption("daily");
    await detail.getByLabel("Time of day").fill("06:30");
    await detail.getByLabel("Time zone").fill("America/Los_Angeles");
    await detail.getByLabel("Email addresses").fill("ops@example.org");
    await detail.getByRole("button", { name: "Save schedule" }).click();
    await detail.getByText("Schedule saved.").waitFor();
    await detail.getByText(/PDF daily at 06:30 \(America\/Los_Angeles\)\. Next run/).waitFor();
    await detail.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "report-detail-light-1440.png"), fullPage: false });

    const [saved] = await admin`select id, schedule, next_run_at from reports`;
    expect(saved!.schedule).toMatchObject({ cadence: { kind: "daily", time: "06:30" }, format: "pdf", emails: ["ops@example.org"] });
    const store = new BlobStore(mkdtempSync(join(tmpdir(), "openeoc-report-browser-")));
    expect(await runDueReports(runtime, new Date((saved!.next_run_at as Date).getTime() + 60_000), { store, timeoutMs: 3000 })).toBe(1);
    const mail = sessions.find((s) => s.commands.includes("RCPT TO:<ops@example.org>"))!;
    expect(mail.data).toMatch(/Content-Type: application\/pdf; name="Supplies-by-priority-\d{8}-\d{4}\.pdf"/);
    await detail.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Open Supplies by priority" }).click();
    await page.getByRole("list", { name: "Recent scheduled runs" }).getByText("Delivered").waitFor();

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Save schedule" }).waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "reports-dark-390.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 240_000);
});
