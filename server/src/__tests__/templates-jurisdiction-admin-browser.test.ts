import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * An administrator of a jurisdiction who is not an instance administrator
 * reaches Templates from the rail, creates a board from a published template
 * there, and is not offered publishing or customizing, which stay an
 * instance administrator's.
 */

const DIST = buildDir("templates-jurisdiction-admin-app");
let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let jurisdictionId: string;
const pageErrors: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  const id = await createPerson(admin, { email: "county.admin@example.org", displayName: "County Admin", password: "county-admin-password" });
  await addMembership(admin, id, jurisdictionId, "admin");
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("templates for a jurisdiction administrator", () => {
  it("creates a board from a published template without being offered publication", async () => {
    const page = await browser.newPage({ viewport: { width: 1586, height: 992 } });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("county.admin@example.org");
    await page.getByLabel("Password").fill("county-admin-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();
    await page.evaluate("location.hash = '#/templates'");
    const create = page.getByRole("region", { name: "Create a board from a published template" });
    await create.getByLabel("Published template").selectOption("shelters");
    await create.getByLabel("Board title").fill("County shelters");
    expect(await page.getByRole("button", { name: "Create template" }).count()).toBe(0);
    await create.getByRole("button", { name: "Create board" }).click();
    await expect.poll(async () => (await admin`select count(*)::int as n from boards where title = 'County shelters' and jurisdiction_id = ${jurisdictionId}`)[0]!.n).toBe(1);
    await page.evaluate("location.hash = '#/templates'");
    await create.waitFor();
    expect(await page.getByRole("button", { name: "Customize" }).count()).toBe(0);
    expect(pageErrors).toEqual([]);
  }, 120_000);
});
