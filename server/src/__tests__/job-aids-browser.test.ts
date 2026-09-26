import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Position job aids in the console's Help, at the frames' 1586 by 992 and at
 * 1534 by 790. A member acting as Planning Section Chief opens Help and reads
 * that aid, first and open; follows two of its steps on the ICS Forms screen
 * it names, by the labels the aid prints in bold; then, with the browser
 * offline after the app has loaded once, reloads and reads the aid again,
 * served from the service worker's precache. The built bundle carries every
 * aid file, and the worker's precache lists the file that holds them.
 */

const DIST = buildDir("job-aids");
const SHOTS = shotDir("job-aids");
const APP = "/aids-app";
const TRAINING = fileURLToPath(new URL("../../../docs/guides/training/", import.meta.url));
// Each width starts a form the period does not hold yet; one it holds opens instead of starting.
const RUNS = [
  { viewport: { width: 1586, height: 992 }, form: "ICS-202", editor: "Edit ICS 202: Incident Objectives" },
  { viewport: { width: 1534, height: 790 }, form: "ICS-208", editor: "Edit ICS 208: Safety Message/Plan" },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let incidentId: string;
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
  serveStatic(app, APP, DIST);
  const token = await login(app);
  ({ incidentId } = await call(token, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    { templateKey: "wildfire", name: "Job aid practice incident" }));
  const now = Date.now();
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
  const detail = await call(token, "GET", `/api/v1/incidents/${incidentId}`);
  const planning = detail.positions.find((p: { key: string }) => p.key === "planning_section_chief") as { id: string };
  await call(token, "POST", `/api/v1/positions/${planning.id}/assignments`, { personId: seed.memberId });
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

const fits = (page: Page) => page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1") as Promise<boolean>;

/** Open Help from the foot of the rail and return the acting position's aid. */
async function openAid(page: Page) {
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Help" });
  const aid = help.getByRole("tabpanel", { name: "Job aid: Planning Section Chief" });
  await aid.getByRole("heading", { name: "Job Aid: Planning Section Chief" }).waitFor();
  await help.getByText("The job aid for your acting position, Planning Section Chief.").waitFor();
  const tabs = help.getByRole("tablist", { name: "Job aids" }).getByRole("tab");
  expect(await tabs.first().textContent()).toBe("Planning Section Chief");
  expect(await tabs.first().getAttribute("aria-selected")).toBe("true");
  expect(await tabs.count()).toBe(readdirSync(TRAINING).filter((name) => name.startsWith("JOB-AID-")).length);
  return { help, aid };
}

/** The labels an aid's step prints in bold. */
const boldIn = async (step: ReturnType<Page["locator"]>) => step.locator("strong").allTextContents();

describe("position job aids in the console", () => {
  it("bundles every aid into the build, in a file the service worker precaches", () => {
    const precache = JSON.parse(/const PRECACHE = (\{.*?\});/.exec(readFileSync(join(DIST, "sw.js"), "utf8"))![1]!) as { files: string[] };
    const scripts = readdirSync(join(DIST, "assets")).filter((name) => name.endsWith(".js"))
      .map((name) => ({ name: `assets/${name}`, text: readFileSync(join(DIST, "assets", name), "utf8") }));
    for (const file of readdirSync(TRAINING).filter((name) => /^JOB-AID-.+\.md$/.test(name))) {
      const heading = readFileSync(join(TRAINING, file), "utf8").split(/\r?\n/)[0]!;
      const holders = scripts.filter((script) => script.text.includes(heading));
      expect(holders.length, file).toBeGreaterThan(0);
      expect(holders.some((script) => precache.files.includes(script.name)), file).toBe(true);
    }
  });

  for (const { viewport, form, editor } of RUNS) {
    it(`opens the Planning Section Chief's aid, follows it on screen and reads it offline, at ${viewport.width} by ${viewport.height}`, async () => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("request", (request) => {
        const url = request.url();
        if (!url.startsWith(baseUrl) && !url.startsWith("data:") && !url.startsWith("blob:")) externalRequests.push(url);
      });
      await page.goto(`${baseUrl}${APP}/index.html#/overview?incident=${incidentId}`, { waitUntil: "load" });
      await page.getByLabel("Email").fill("member@example.org");
      await page.getByLabel("Password").fill("another-good-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      const acting = page.getByLabel("Acting position");
      await acting.locator("option", { hasText: "Planning Section Chief" }).waitFor({ state: "attached" });
      await acting.selectOption({ label: "Planning Section Chief" });
      await page.locator('select[aria-label="Acting position"] option:checked', { hasText: "Planning Section Chief" })
        .waitFor({ state: "attached" });

      // Help opens on the acting position's aid.
      const { help, aid } = await openAid(page);
      expect(await fits(page)).toBe(true);
      await page.screenshot({ path: join(SHOTS, `job-aid-planning-${viewport.width}.png`) });
      const readPeriod = aid.getByRole("listitem").filter({ hasText: "ICS forms for this period" });
      const startForm = aid.getByRole("listitem").filter({ hasText: "Start each form." });
      const periodLabels = await boldIn(readPeriod);
      expect(periodLabels).toEqual(["Planning > ICS Forms", "Operational period revision", "ICS forms for this period"]);
      expect((await boldIn(startForm)).slice(0, 3)).toEqual(["Start each form.", "Form to start", "Start form"]);
      await help.getByRole("button", { name: "Close Help" }).click();

      // The steps, by the aid's own labels, on the screen they name.
      const [section = "", screen = ""] = periodLabels[0]!.split(" > ");
      await page.getByRole("navigation", { name: "Sections" }).getByRole("region", { name: section })
        .getByRole("button", { name: screen, exact: true }).click();
      await page.getByLabel("Operational period revision").selectOption({ label: "OP 1 Day · area revision 1" });
      const forms = page.getByRole("region", { name: "ICS forms for this period" });
      await forms.getByLabel("Form to start").selectOption(form);
      await forms.getByRole("button", { name: "Start form" }).click();
      await forms.getByRole("form", { name: editor }).getByText("Version 1, draft").waitFor();

      // Offline once the app has loaded: a reload opens the console from the precache and the aid with it.
      await page.goto(`${baseUrl}${APP}/index.html`, { waitUntil: "load" });
      await page.waitForFunction("navigator.serviceWorker.controller !== null", undefined, { timeout: 60_000 });
      await context.setOffline(true);
      const shell = await page.reload({ waitUntil: "load" });
      expect(shell?.fromServiceWorker()).toBe(true);
      await page.getByText("No connection · working offline").waitFor();
      const offline = await openAid(page);
      await offline.aid.getByRole("heading", { name: "Every operational period" }).waitFor();
      await page.screenshot({ path: join(SHOTS, `job-aid-planning-offline-${viewport.width}.png`) });
      await context.setOffline(false);
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
