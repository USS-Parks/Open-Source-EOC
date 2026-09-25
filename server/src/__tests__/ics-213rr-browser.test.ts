import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The ICS 213RR on screen at the frames' 1586 by 992 and at 1534 by 790
 * (VA38). A request taken through acceptance, sourcing and assignment, with
 * a cost, prints its 213RR from the request's details with each block its
 * record holds; the planning section then starts it as a form of the
 * period from the request, adds the delivery location, and marks it ready.
 */

const DIST = buildDir("ics-213rr");
const SHOTS = shotDir("ics-213rr");
const RUNS = [
  { viewport: { width: 1586, height: 992 }, incident: "Klamath River Flood 1586" },
  { viewport: { width: 1534, height: 790 }, incident: "Klamath River Flood 1534" },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
const seeded = new Map<string, { incidentId: string; requestId: string; number: number }>();
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function call(token: string, method: "GET" | "POST" | "PUT", url: string, payload?: Record<string, unknown>) {
  const res = await app.inject({ method, url, headers: auth(token), ...(payload === undefined ? {} : { payload }) });
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json();
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
  const now = Date.now();
  for (const run of RUNS) {
    const { incidentId } = await call(token, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      { templateKey: "wildfire", name: run.incident });
    await call(token, "PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
      expectedRevision: 0,
      geometry: null,
      operationalPeriod: {
        label: "OP 1 Day",
        startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
        endsAt: new Date(now + 11 * 60 * 60 * 1000).toISOString(),
      },
      reason: "First operational period",
    });
    const { id: requestId } = await call(token, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/resource-requests`, {
      origin: "eoc", item: "Swift-water rescue team", quantity: 2, priority: "immediate", incidentId,
      neededBy: new Date(now + 3 * 60 * 60 * 1000).toISOString(),
    });
    await call(token, "POST", `/api/v1/resource-requests/${requestId}/transition`, { toState: "accepted" });
    await call(token, "POST", `/api/v1/resource-requests/${requestId}/transition`, { toState: "sourcing", note: "Asked the region" });
    const detail = await call(token, "GET", `/api/v1/incidents/${incidentId}`);
    const logistics = detail.positions.find((p: { key: string }) => p.key === "logistics_section_chief") as { id: string };
    await call(token, "POST", `/api/v1/resource-requests/${requestId}/assign`, { positionId: logistics.id });
    await call(token, "POST", `/api/v1/resource-requests/${requestId}/costs`, {
      category: "equipment", description: "Boat fuel", amountCents: 25_050, incurredAt: "2026-09-25",
    });
    const { number } = await call(token, "GET", `/api/v1/resource-requests/${requestId}`);
    seeded.set(run.incident, { incidentId: incidentId as string, requestId: requestId as string, number: number as number });
  }
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

async function signIn(viewport: { width: number; height: number }, hash: string): Promise<Page> {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html${hash}`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

const fits = (page: Page) => page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1") as Promise<boolean>;

describe("the ICS 213RR on screen", () => {
  for (const run of RUNS) {
    it(`prints a request's 213RR and keeps it as the period's form at ${run.viewport.width} by ${run.viewport.height}`, async () => {
      const { incidentId, requestId, number } = seeded.get(run.incident)!;
      const page = await signIn(run.viewport, `#/resources/${requestId}?incident=${incidentId}&period=1`);
      await page.getByRole("heading", { name: "History", exact: true }).waitFor();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Print ICS 213RR" }).click(),
      ]);
      expect(download.suggestedFilename()).toBe(`ics-213rr-req-${number}.pdf`);
      const pdf = await readFile((await download.path())!, "latin1");
      for (const text of [`(ICS-213RR Resource Request Message: REQ-${number}) Tj`, "(  9. Section Chief Approval) Tj",
        "(    Admin, ", "(  12. Name of Supplier/POC) Tj", "(    Logistics Section Chief, ", "(    Total: $250.50) Tj",
        "(  14. Approval Signature of Auth Logistics Rep) Tj"]) expect(pdf, text).toContain(text);
      await page.screenshot({ path: join(SHOTS, `request-213rr-${run.viewport.width}.png`) });

      // The planning section keeps it as a form of the period.
      await page.goto(`${baseUrl}/app/index.html#/forms?incident=${incidentId}&period=1`, { waitUntil: "load" });
      const panel = page.getByRole("region", { name: "ICS forms for this period" });
      await panel.getByText("No forms started for this period yet.").waitFor();
      await panel.getByLabel("Form to start").selectOption("ICS-213RR");
      await panel.getByLabel("Resource request").selectOption({ label: `REQ-${number} Swift-water rescue team (Assigned)` });
      await panel.getByRole("button", { name: "Start form" }).click();
      const form = panel.getByRole("form", { name: `Edit ICS 213RR: Resource Request Message, REQ-${number}` });
      expect(await form.getByLabel("3. Resource Request Number").inputValue()).toBe(`REQ-${number}`);
      expect(await form.getByLabel("17. Reply/Comments from Finance").inputValue()).toContain("Total: $250.50");
      await form.getByLabel("5. Requested Delivery/Reporting Location").fill("Weitchpec store, Highway 96");
      expect(await fits(page)).toBe(true);
      await page.screenshot({ path: join(SHOTS, `forms-213rr-${run.viewport.width}.png`) });
      await form.getByRole("button", { name: "Save and mark ready" }).click();
      await panel.getByText(`Saved ICS 213RR: Resource Request Message, REQ-${number} as version 2, ready.`).waitFor();
      await panel.getByRole("list", { name: "Forms for this period" })
        .getByRole("button", { name: new RegExp(`^ICS 213RR: Resource Request Message, REQ-${number}\\s*Ready`) }).waitFor();

      const [stored] = await admin`
        select label, status, version, resource_request_id, field_values ->> 'deliveryLocation' as location
        from ics_form_components where incident_id = ${incidentId}`;
      expect(stored).toMatchObject({ label: `REQ-${number}`, status: "ready", version: 2, resource_request_id: requestId, location: "Weitchpec store, Highway 96" });
      await page.context().close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
