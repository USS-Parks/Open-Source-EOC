import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("board-records-app");
const SHOTS = shotDir("board-records");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let adminToken: string;
let incidentId: string;
let notesBoard: string;
let opsBoard: string;
const ids: Record<string, string> = {};
const pageErrors: string[] = [];
const externalRequests: string[] = [];
const pages: Page[] = [];

const notesTemplate = {
  key: "synthetic_depth_notes",
  version: 1,
  title: "Synthetic Depth Notes",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "status", label: "Status", type: "enum", values: ["open", "closed"], required: true },
    { key: "related", label: "Related note", type: "record_ref", targetBoardKey: "synthetic_depth_notes", labelField: "summary" },
  ],
  views: [{ key: "all", title: "All notes", columns: ["summary", "status"] }],
};

const opsTemplate = {
  key: "synthetic_depth_ops",
  version: 1,
  title: "Synthetic Depth Operations",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "status", label: "Status", type: "enum", values: ["open", "closed"], required: true },
    { key: "quantity", label: "Quantity", type: "number", required: true },
  ],
  views: [{ key: "all", title: "All work", columns: ["summary", "status", "quantity"] }],
};

async function openPage(email: string, password: string, hash: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  pages.push(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html${hash}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

/** The first column of each loaded row, in table order. */
async function rowSummaries(page: Page): Promise<string[]> {
  return (await page.getByRole("main").locator("tbody tr td:nth-child(2)").allTextContents()).map((text) => text.trim());
}

async function selectRecord(page: Page, recordId: string) {
  const box = page.getByLabel(`Select record ${recordId}`);
  if (!await box.isChecked()) await box.click();
  await page.waitForURL((url) => url.hash.includes(`record=${recordId}`));
  const openContext = page.getByRole("button", { name: "Open context" });
  if (await openContext.isVisible()) await openContext.click();
  return page.getByRole("region", { name: "Selected record" });
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  const writerId = await createPerson(admin, { email: "writer@example.org", displayName: "Writer", password: "writer-good-password" });
  await addMembership(admin, writerId, seed.jurisdictionId, "member");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  adminToken = await login(app);
  await post(app, adminToken, "/api/v1/templates", notesTemplate);
  await post(app, adminToken, "/api/v1/templates", opsTemplate);
  notesBoard = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey: notesTemplate.key })).id as string;
  opsBoard = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey: opsTemplate.key })).id as string;
  incidentId = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "daily_ops", name: "Synthetic Board Depth Exercise",
  })).incidentId as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${notesBoard}), (${incidentId}, ${opsBoard})`;
  for (const [summary, status, quantity] of [
    ["Shelter check", "closed", 1], ["Culvert survey", "open", 2], ["Bridge inspection", "open", 5],
    ["Debris removal", "closed", 7], ["Sandbag delivery", "open", 9],
  ] as const) {
    ids[summary] = (await post(app, adminToken, `/api/v1/boards/${opsBoard}/records?incidentId=${incidentId}`,
      { summary, status, quantity })).id as string;
  }
  const patched = await app.inject({ method: "PATCH", headers: auth(adminToken), payload: { quantity: 6 },
    url: `/api/v1/boards/${opsBoard}/records/${ids["Bridge inspection"]}?incidentId=${incidentId}` });
  expect(patched.statusCode, patched.body).toBe(200);

  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  for (const page of pages) await page.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("board records in depth", () => {
  it("restricts records and composes reference labels from the designer", async () => {
    const page = await openPage("admin@example.org", "correct-horse-battery", `#/board/${notesBoard}/design`);
    await page.getByRole("heading", { name: "Customize Synthetic Depth Notes" }).waitFor();
    const related = page.locator("details.board-designer__field").filter({ hasText: "related: record_ref" });
    await related.locator("summary").click();
    await related.getByLabel("related label fields").fill("summary, status");
    await page.getByRole("tab", { name: "Record access" }).click();
    await page.getByRole("button", { name: "Restrict individual records" }).click();
    expect(await page.getByLabel("Read: The record's creator").isChecked()).toBe(true);
    expect(await page.getByLabel("Read: Board members").isChecked()).toBe(false);
    await page.screenshot({ path: join(SHOTS, "board-records-access-designer.png"), fullPage: false });
    const upgraded = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith(`/api/v1/boards/${notesBoard}/upgrade`) && response.status() === 200);
    await page.getByRole("button", { name: "Publish and apply version 2" }).click();
    await upgraded;
    const published = await app.inject({ method: "GET", url: `/api/v1/templates/${notesTemplate.key}/versions/2`, headers: auth(adminToken) });
    expect(published.json()).toMatchObject({
      recordAccess: { read: [{ kind: "creator" }, { kind: "creator_position" }], edit: [{ kind: "creator" }, { kind: "creator_position" }] },
      fields: expect.arrayContaining([expect.objectContaining({ key: "related", labelFields: ["summary", "status"] })]),
    });

    const writerToken = await login(app, "writer@example.org", "writer-good-password");
    const memberToken = await login(app, "member@example.org", "another-good-password");
    await post(app, writerToken, `/api/v1/boards/${notesBoard}/records?incidentId=${incidentId}`, { summary: "Restricted note", status: "open" });
    await post(app, memberToken, `/api/v1/boards/${notesBoard}/records?incidentId=${incidentId}`, { summary: "Member note", status: "closed" });

    const hash = `#/board/${notesBoard}?incident=${incidentId}&view=all`;
    const member = await openPage("member@example.org", "another-good-password", hash);
    await member.getByRole("main").getByText("Member note", { exact: true }).waitFor();
    expect(await member.getByRole("main").getByText("Restricted note", { exact: true }).count()).toBe(0);
    await member.getByText(/Offline sync is unavailable for this board/).waitFor();
    await member.screenshot({ path: join(SHOTS, "board-records-restricted-member.png"), fullPage: false });

    const writer = await openPage("writer@example.org", "writer-good-password", hash);
    await writer.getByRole("main").getByText("Restricted note", { exact: true }).waitFor();
    expect(await writer.getByRole("main").getByText("Member note", { exact: true }).count()).toBe(0);
    await writer.getByRole("button", { name: "New record", exact: true }).click();
    const reference = writer.getByRole("dialog", { name: "New Synthetic Depth Notes record" })
      .getByRole("combobox", { name: /^Related note/ });
    await expect.poll(() => reference.locator("option").allTextContents()).toContain("Restricted note / open");
    expect(await reference.locator("option").allTextContents()).not.toContain("Member note / closed");
    await writer.screenshot({ path: join(SHOTS, "board-records-restricted-creator.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);

  it("filters, sorts and groups on the server, archives, restores, deletes and reads history", async () => {
    const page = await openPage("admin@example.org", "correct-horse-battery", `#/board/${opsBoard}?incident=${incidentId}&view=all`);
    await page.getByRole("main").getByText("Sandbag delivery", { exact: true }).waitFor();
    await page.getByText("Filter, sort and group").click();
    await page.getByRole("button", { name: "Add condition" }).click();
    await page.getByLabel("Condition 1 field").selectOption("quantity");
    await page.getByLabel("Condition 1 operator").selectOption("gte");
    await page.getByLabel("Condition 1 value").fill("2");
    await page.getByRole("button", { name: "Add sort key" }).click();
    await page.getByLabel("Sort 1 field").selectOption("status");
    await page.getByRole("button", { name: "Add sort key" }).click();
    await page.getByLabel("Sort 2 field").selectOption("quantity");
    await page.getByLabel("Sort 2 direction").selectOption("desc");
    await page.getByLabel("Group by").selectOption("status");
    const refined = page.waitForResponse((response) => response.url().includes(`/api/v1/boards/${opsBoard}/views/all?`)
      && response.url().includes("groupBy=status") && response.url().includes("where="));
    await page.getByRole("button", { name: "Apply" }).click();
    await refined;
    const counts = page.getByRole("region", { name: "Group counts" });
    await counts.waitFor();
    expect(await counts.getByRole("listitem").allTextContents()).toEqual(["Closed 1", "Open 3"]);
    await expect.poll(() => rowSummaries(page))
      .toEqual(["Debris removal", "Sandbag delivery", "Bridge inspection", "Culvert survey"]);
    await page.screenshot({ path: join(SHOTS, "board-records-refined-view.png"), fullPage: false });

    // An archived record leaves the default view, and with it the selection.
    const bridge = await selectRecord(page, ids["Bridge inspection"]!);
    const archived = page.waitForResponse((response) => response.url().endsWith(`/records/${ids["Bridge inspection"]}/archive`));
    await bridge.getByRole("button", { name: "Archive record" }).click();
    expect((await archived).status()).toBe(200);
    await expect.poll(() => rowSummaries(page)).toEqual(["Debris removal", "Sandbag delivery", "Culvert survey"]);
    await page.getByLabel("Archived records").selectOption("only");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => rowSummaries(page)).toEqual(["Bridge inspectionArchived"]);
    const archivedBridge = await selectRecord(page, ids["Bridge inspection"]!);
    await archivedBridge.getByText(/left out of default views until it is restored/).waitFor();
    await page.screenshot({ path: join(SHOTS, "board-records-archived-only.png"), fullPage: false });

    await archivedBridge.getByRole("tab", { name: "Change history" }).click();
    const history = archivedBridge.getByRole("list", { name: "Record history" });
    await history.waitFor();
    const entries = await history.locator(":scope > li").allTextContents();
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatch(/^Created · .* · Admin/);
    for (const change of ["Summaryempty → Bridge inspection", "Statusempty → Open", "Quantityempty → 5"]) {
      expect(entries[0]).toContain(change);
    }
    expect(entries[1]).toMatch(/^Updated · .* · AdminQuantity5 → 6$/);
    expect(entries[2]).toMatch(/^Archived · .* · Admin$/);
    await page.screenshot({ path: join(SHOTS, "board-records-history.png"), fullPage: false });
    await archivedBridge.getByRole("tab", { name: "Record" }).click();
    const restored = page.waitForResponse((response) => response.url().endsWith(`/records/${ids["Bridge inspection"]}/restore`));
    await archivedBridge.getByRole("button", { name: "Restore record" }).click();
    expect((await restored).status()).toBe(200);
    await expect.poll(() => rowSummaries(page)).toEqual([]);
    const restoredHistory = await app.inject({ method: "GET", headers: auth(adminToken),
      url: `/api/v1/boards/${opsBoard}/records/${ids["Bridge inspection"]}/history` });
    expect((restoredHistory.json().entries as Array<{ category: string }>).map((entry) => entry.category)).toEqual([
      "board.record.created", "board.record.updated", "board.record.archived", "board.record.restored",
    ]);

    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("main").getByText("Shelter check", { exact: true }).waitFor();
    const culvert = await selectRecord(page, ids["Culvert survey"]!);
    await culvert.getByRole("button", { name: "Delete record" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this record?" });
    expect(await confirm.textContent()).toMatch(/recorded in its history .* cannot be undone from this screen/);
    const deleted = page.waitForResponse((response) => response.request().method() === "DELETE"
      && response.url().endsWith(`/records/${ids["Culvert survey"]}`));
    await confirm.getByRole("button", { name: "Delete record" }).click();
    expect((await deleted).status()).toBe(200);
    await page.waitForURL((url) => !url.hash.includes("record="));
    await expect.poll(() => rowSummaries(page)).not.toContain("Culvert survey");
    const gone = await app.inject({ method: "GET", headers: auth(adminToken),
      url: `/api/v1/boards/${opsBoard}/records/${ids["Culvert survey"]}/detail` });
    expect(gone.statusCode).toBe(404);

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);

  it("exports a view and imports it back through the mapping step and a dry run", async () => {
    const page = await openPage("admin@example.org", "correct-horse-battery", `#/board/${opsBoard}?incident=${incidentId}&view=all`);
    await page.getByRole("main").getByText("Sandbag delivery", { exact: true }).waitFor();
    const csvDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const csvFile = await csvDownload;
    expect(csvFile.suggestedFilename()).toBe("all.csv");
    const exported = readFileSync((await csvFile.path())!, "utf8").trim().split(/\r?\n/);
    expect(exported[0]).toBe("id,summary,status,quantity");
    const rows = exported.slice(1);
    expect(rows.length).toBe((await rowSummaries(page)).length);
    const xlsxDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Excel" }).click();
    const xlsx = readFileSync((await (await xlsxDownload).path())!);
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");

    // The heading "Item name" matches no field, so the mapping step is needed;
    // the last row carries a quantity that is not a number.
    const file = (quantity: string) => ({
      name: "all.csv", mimeType: "text/csv",
      buffer: Buffer.from([`id,Item name,status,quantity`, ...rows, `,Generator refuel,open,${quantity}`].join("\r\n")),
    });
    await page.getByRole("button", { name: "Import records" }).click();
    const drawer = page.getByRole("dialog", { name: "Import Synthetic Depth Operations records" });
    await drawer.getByLabel("Spreadsheet file").setInputFiles(file("many"));
    const itemName = drawer.getByLabel("Field for column Item name");
    await itemName.waitFor();
    expect(await itemName.inputValue()).toBe("");
    expect(await drawer.getByLabel("Field for column id").inputValue()).toBe("");
    await itemName.selectOption("summary");
    await drawer.getByRole("button", { name: "Check file" }).click();
    const errors = drawer.getByRole("table", { name: "Row errors" });
    await drawer.getByText(`${rows.length + 1} rows read. 1 error; fix the file or the mapping and check again.`).waitFor();
    expect(await errors.locator("tbody tr").allTextContents()).toEqual([`${rows.length + 2}QuantityQuantity is not a number`]);
    expect(await drawer.getByRole("button", { name: "Import", exact: true }).isDisabled()).toBe(true);
    await page.screenshot({ path: join(SHOTS, "board-records-import-errors.png"), fullPage: false });

    await drawer.getByLabel("Spreadsheet file").setInputFiles(file("3"));
    const importButton = drawer.getByRole("button", { name: `Import ${rows.length + 1} records` });
    await importButton.waitFor();
    expect(await itemName.inputValue()).toBe("summary");
    const committed = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().includes(`/api/v1/boards/${opsBoard}/import?dryRun=false`));
    await importButton.click();
    expect((await committed).status()).toBe(201);
    await page.getByText(`Imported ${rows.length + 1} records.`).waitFor();
    await page.getByRole("main").getByText("Generator refuel", { exact: true }).waitFor();
    await expect.poll(async () => (await rowSummaries(page)).length).toBe(rows.length * 2 + 1);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(`(() => {
      const closeContext = document.querySelector('button[aria-label="Close context drawer"]');
      if (closeContext?.getClientRects().length) closeContext.click();
    })()`);
    await page.getByText("Filter, sort and group").click();
    await page.getByRole("button", { name: "Add condition" }).click();
    const geometry = await page.evaluate(`({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    })`) as { documentWidth: number; viewportWidth: number };
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    await page.screenshot({ path: join(SHOTS, "board-records-tools-narrow-dark.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
