import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STANDARD_TEMPLATES } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { generateSigningKeyPair } from "../boards/package.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { signSolutionPackage } from "../data-packs/solution.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * VA11 in a real browser: on a fresh profile an administrator imports a
 * signed solution package through the designer's Import tab and reads what it
 * created, part by part; the same package changed after signing is refused
 * with the reason and imports nothing.
 */

const DIST = buildDir("solution-package-app");
const SHOTS = shotDir("solution-package");
const publisher = generateSigningKeyPair();
const keyDir = mkdtempSync(join(tmpdir(), "openeoc-solution-keys-"));

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let priorKeys: string | undefined;

const shelters = STANDARD_TEMPLATES.find((template) => template.key === "shelters")!;
const signed = signSolutionPackage({
  publisher: "Klamath River Test Region",
  name: "Tribal EOC starter",
  version: "2026.1",
  contents: {
    boardTemplates: [{ ...shelters, key: "tribal_shelter_log", version: 1, title: "Tribal shelter log" }],
    incidentTemplates: [{
      key: "tribal_flood", title: "River flood", positions: ["incident_commander", "tribal_liaison"],
      positionTitles: { tribal_liaison: "Tribal Liaison" }, boards: ["tribal_shelter_log"],
      checklists: [{ position: "incident_commander", items: ["Open the EOC"] }],
    }],
    forms: [{ key: "shelter_count", version: 1, title: "Shelter count", boardTemplate: "tribal_shelter_log",
      nodes: [{ kind: "field", name: "name", type: "text", label: "Shelter" }] }],
    dashboardTemplates: [{ key: "tribal_overview", version: 1, title: "Flood overview",
      widgets: [{ kind: "tile", key: "open_shelters", title: "Shelters", board: "tribal_shelter_log" }] }],
    reportTemplates: [{ key: "shelter_daily", version: 1, title: "Daily shelter count", board: "tribal_shelter_log",
      definition: { columns: ["name", "occupancy"] } }],
    ruleTemplates: [{ key: "new_shelter_notice", version: 1, title: "A shelter opens", board: "tribal_shelter_log",
      event: "record.created", channels: [{ kind: "position", position: "incident_commander", via: ["inapp"] }] }],
  },
}, publisher.privateKeyPem);

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  writeFileSync(join(keyDir, "publishers.pem"), `${publisher.publicKeyPem}\n`);
  priorKeys = process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS;
  process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS = join(keyDir, "publishers.pem");
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  if (priorKeys === undefined) delete process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS;
  else process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS = priorKeys;
  rmSync(keyDir, { recursive: true, force: true });
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

async function openImport(width: number, height: number): Promise<{ page: Page; errors: string[]; external: string[] }> {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    external.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html#/templates`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Create template" }).click();
  await page.getByRole("tab", { name: "Import" }).click();
  return { page, errors, external };
}

const file = (name: string, value: unknown) => ({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });

describe("signed solution package import", () => {
  it("imports each part of a signed package from the designer and refuses one changed after signing", async () => {
    const { page, errors, external } = await openImport(1586, 992);
    await page.getByLabel("Signed solution package").setInputFiles(file("tribal-starter.json", signed));
    const line = page.getByRole("list", { name: "Imported definitions" }).getByText(/^Package Tribal EOC starter 2026\.1/);
    await line.waitFor();
    expect(await line.textContent()).toBe(`Package Tribal EOC starter 2026.1 from Klamath River Test Region, signed with key ${
      (await admin`select key_fingerprint from solution_packages`)[0]!.key_fingerprint.slice(0, 16)}. Created board templates `
      + "tribal_shelter_log version 1; incident templates tribal_flood; forms shelter_count version 1; dashboard templates "
      + "tribal_overview version 1; report templates shelter_daily version 1; rule templates new_shelter_notice version 1.");
    await page.screenshot({ path: join(SHOTS, "solution-package-imported-1586.png"), fullPage: false });

    const tampered = structuredClone(signed);
    tampered.contents.ruleTemplates[0]!.title = "A shelter opens, changed";
    tampered.contents.reportTemplates[0]!.key = "shelter_weekly";
    await page.getByLabel("Signed solution package").setInputFiles(file("tampered.json", tampered));
    await page.getByRole("alert").getByText("tampered.json: the signature does not match the contents: the package was changed after it was signed").waitFor();
    expect(await admin`select 1 from report_templates where key = 'shelter_weekly'`).toHaveLength(0);
    expect((await admin`select count(*)::int as n from solution_packages`)[0]!.n).toBe(1);
    await page.screenshot({ path: join(SHOTS, "solution-package-refused-1586.png"), fullPage: false });
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 120_000);

  it("imports the same package again at 1534 by 790 and says everything was already here", async () => {
    const { page, errors, external } = await openImport(1534, 790);
    await page.getByLabel("Signed solution package").setInputFiles(file("tribal-starter.json", signed));
    await page.getByRole("list", { name: "Imported definitions" })
      .getByText(/Nothing new\. 6 items were already here\.$/).waitFor();
    await page.screenshot({ path: join(SHOTS, "solution-package-again-1534.png"), fullPage: false });
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 120_000);
});
