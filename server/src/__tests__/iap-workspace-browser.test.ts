import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("p-iap-app");
const SHOTS = shotDir("p-iap");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function request(
  token: string,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({
    method,
    url,
    headers: auth(token),
    ...(payload === undefined ? {} : { payload }),
  });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response;
}

async function iapSurfaceBounds(target: Page): Promise<{
  readonly fits: boolean;
  readonly left: number;
  readonly right: number;
  readonly viewport: number;
}> {
  return target.evaluate(`(() => {
    const node = document.querySelector('.iap-workspace');
    if (!node) return { fits: false, left: -1, right: -1, viewport: innerWidth };
    const rect = node.getBoundingClientRect();
    return {
      fits: node.scrollWidth <= node.clientWidth && rect.left >= 0 && rect.right <= innerWidth,
      left: rect.left,
      right: rect.right,
      viewport: innerWidth,
    };
  })()`) as Promise<{ fits: boolean; left: number; right: number; viewport: number }>;
}

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);

  const token = await login(app);
  const incident = await request(
    token,
    "POST",
    `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    { templateKey: "wildfire", name: "Synthetic IAP Browser Exercise" },
  );
  incidentId = incident.json().incidentId as string;
  const now = Date.now();
  await request(token, "PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
    expectedRevision: 0,
    geometry: null,
    operationalPeriod: {
      label: "Operational Period Browser",
      startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
      endsAt: new Date(now + 5 * 60 * 60 * 1000).toISOString(),
    },
    reason: "Authoritative browser fixture period",
  });
  const detail = (await request(token, "GET", `/api/v1/incidents/${incidentId}`)).json();
  const planning = detail.positions.find((position: { key: string }) =>
    position.key === "planning_section_chief") as { id: string } | undefined;
  expect(planning?.id).toEqual(expect.any(String));
  await request(token, "POST", `/api/v1/positions/${planning!.id}/assignments`, {
    personId: seed.memberId,
  });

  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) {
      return route.continue();
    }
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html#/forms?incident=${incidentId}&period=1`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "ICS Forms and IAP Assembly", exact: true }).waitFor();
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("operational planning workspace presentation", () => {
  it("authors, approves, revises, and exports an exact IAP revision in responsive light and dark views", async () => {
    const periodPanel = page.getByRole("region", { name: "Authoritative planning period" });
    await periodPanel.waitFor({ state: "visible" });
    await periodPanel.getByText("Operational Period Browser", { exact: true }).waitFor({ state: "visible" });
    expect(await periodPanel.isVisible()).toBe(true);
    expect(await periodPanel.getByText("Operational Period Browser", { exact: true }).isVisible()).toBe(true);

    const createResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/incidents/${incidentId}/iap`) && response.request().method() === "POST"
      && response.status() === 201);
    const assemble = page.getByRole("button", { name: "Assemble draft IAP", exact: true });
    await assemble.focus();
    await page.keyboard.press("Enter");
    const draftId = ((await (await createResponse).json()) as { id: string }).id;
    await page.getByRole("button", { name: "Review draft in IAP workspace", exact: true }).click();
    await page.getByRole("heading", { name: "Incident Action Plans", exact: true }).waitFor();

    const plans = page.getByRole("region", { name: "Plans", exact: true });
    const planButton = plans.getByRole("button", { name: /Operational Period Browser.*In progress/i });
    await planButton.click();
    const detail = page.getByRole("region", { name: "Plan detail", exact: true });
    await detail.getByRole("heading", { name: "Operational Period Browser", exact: true }).waitFor();
    const editor = detail.getByRole("region", { name: "ICS-204 assignment editor", exact: true });
    await editor.getByLabel("Assignment 1 name").fill("Evacuation Group");
    await editor.getByLabel("Named supervisor authority").selectOption({
      label: "Planning Section Chief (planning_section_chief)",
    });
    await editor.getByLabel("Tactics, one per line").fill("Clear Zone A\nConfirm accessible transport");
    await editor.getByRole("button", { name: "Add resource", exact: true }).click();
    await editor.getByLabel("Resource name").fill("Accessible transport bus");
    await editor.getByLabel("Quantity").fill("2");
    await editor.getByLabel("Identifier").fill("BUS-12");
    await editor.getByLabel("Leader").fill("Morgan Lee");
    await editor.getByLabel("Resource notes").fill("Stage at the north collection point");
    const saveResponse = page.waitForResponse((response) =>
      response.url().includes("/ics-204") && response.request().method() === "PUT" && response.status() === 200);
    const save = editor.getByRole("button", { name: "Save ICS-204 assignments", exact: true });
    await save.focus();
    await page.keyboard.press("Enter");
    await saveResponse;
    expect(await editor.getByLabel("Resource name").inputValue()).toBe("Accessible transport bus");
    await editor.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "p-iap-light-editor.png"), fullPage: false });
    await page.getByRole("heading", { name: "Incident Action Plans", exact: true }).scrollIntoViewIfNeeded();
    expect((await iapSurfaceBounds(page)).fits).toBe(true);
    await page.screenshot({ path: join(SHOTS, "p-iap-light-wide.png"), fullPage: false });

    const submitResponse = page.waitForResponse((response) =>
      response.url().endsWith("/submit") && response.request().method() === "POST" && response.status() === 200);
    await detail.getByRole("button", { name: "Submit for approval", exact: true }).click();
    await submitResponse;
    const inApproval = detail.getByText("In approval", { exact: true });
    await inApproval.waitFor({ state: "visible" });
    expect(await inApproval.isVisible()).toBe(true);
    const approveResponse = page.waitForResponse((response) =>
      response.url().endsWith("/approve") && response.request().method() === "POST" && response.status() === 200);
    await detail.getByRole("button", { name: "Approve revision", exact: true }).click();
    await approveResponse;
    const approved = detail.getByText("Approved", { exact: true });
    await approved.waitFor({ state: "visible" });
    expect(await approved.isVisible()).toBe(true);
    await detail.getByText(/Submitted by Admin at/).waitFor({ state: "visible" });
    await detail.locator("p").filter({ hasText: /Approved by Admin at/ }).waitFor({ state: "visible" });

    const approvedEditor = detail.getByRole("region", { name: "ICS-204 assignment editor", exact: true });
    await approvedEditor.getByLabel("Assignment 1 name").fill("Night Evacuation Group");
    const revisionResponse = page.waitForResponse((response) =>
      response.url().endsWith("/revisions") && response.request().method() === "POST" && response.status() === 201);
    await approvedEditor.getByRole("button", { name: "Create draft revision", exact: true }).click();
    const successor = await revisionResponse;
    const successorId = (await successor.json()).id as string;
    expect(successorId).not.toBe(draftId);
    await detail.getByText(/Revision 2, content revision 1/).waitFor();
    expect(await detail.getByLabel("Assignment 1 name").inputValue()).toBe("Night Evacuation Group");

    const revisionOne = detail.getByRole("listitem").filter({ hasText: "Revision 1" });
    expect(await revisionOne.getByText(/Approved by Admin at/).isVisible()).toBe(true);
    const downloadEvent = page.waitForEvent("download");
    await revisionOne.getByRole("button", { name: "Download exact revision", exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toContain("revision-1.pdf");

    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.screenshot({ path: join(SHOTS, "p-iap-dark-wide.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    expect((await iapSurfaceBounds(page)).fits).toBe(true);
    const narrowEditor = detail.getByRole("region", { name: "ICS-204 assignment editor", exact: true });
    await narrowEditor.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "p-iap-dark-narrow-editor.png"), fullPage: false });
    const formsButton = page.getByRole("button", { name: "Open ICS forms", exact: true });
    await formsButton.focus();
    expect(await page.evaluate("document.activeElement?.textContent?.trim() === 'Open ICS forms'")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "p-iap-dark-narrow.png"), fullPage: true });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
