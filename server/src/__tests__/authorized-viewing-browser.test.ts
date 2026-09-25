import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

const DIST = buildDir("authorized-viewing");
const SHOTS = shotDir("authorized-viewing");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let hostA: string;
let hostB: string;
let partnerId: string;
let ownerToken: string;
let incidentA: string;
let dashboardA: string;
let dashboardB: string;
let participantId: string;

async function activate(jurisdictionId: string, name: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    headers: auth(ownerToken),
    payload: { templateKey: "wildfire", name },
  });
  if (response.statusCode !== 201) throw new Error(`activation failed: ${response.body}`);
  return response.json().incidentId as string;
}

async function makeDashboard(jurisdictionId: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/dashboards`,
    headers: auth(ownerToken),
    payload: { templateKey: "eoc_status" },
  });
  if (response.statusCode !== 201) throw new Error(`dashboard failed: ${response.body}`);
  return response.json().id as string;
}

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  hostA = await createJurisdiction(admin, "browser-host-a", "Browser Host A");
  hostB = await createJurisdiction(admin, "browser-host-b", "Browser Host B");
  const partner = await createJurisdiction(admin, "browser-partner", "Browser Mutual Aid");
  const ownerId = await createPerson(admin, {
    email: "browser-owner@example.org",
    displayName: "Browser Owner",
    password: "browser-owner-password",
  });
  partnerId = await createPerson(admin, {
    email: "browser-viewer@example.org",
    displayName: "Browser Partner Viewer",
    password: "browser-viewer-password",
  });
  await addMembership(admin, ownerId, hostA, "admin");
  await addMembership(admin, ownerId, hostB, "admin");
  await addMembership(admin, partnerId, partner, "viewer");
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  ownerToken = await login(app, "browser-owner@example.org", "browser-owner-password");
  incidentA = await activate(hostA, "Authorized Host A Fire");
  await activate(hostB, "Unrelated Host B Flood");
  dashboardA = await makeDashboard(hostA);
  dashboardB = await makeDashboard(hostB);

  const grant = await app.inject({
    method: "POST",
    url: `/api/v1/incidents/${incidentA}/participants`,
    headers: auth(ownerToken),
    payload: {
      organizationSlug: "browser-partner",
      personEmail: "browser-viewer@example.org",
      incidentPositionTitle: "Mutual Aid Viewer",
      role: "viewer",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      reason: "Browser authorization proof",
    },
  });
  expect(grant.statusCode).toBe(201);
  participantId = grant.json().participant.id as string;

  const pack = await app.inject({
    method: "POST",
    url: `/api/v1/incidents/${incidentA}/data-packs`,
    headers: auth(ownerToken),
    payload: {
      name: "Browser operational geometry",
      organizationSlug: "browser-host-a",
      datasets: [{
        key: "browser_authorized_geometry",
        name: "Authorized Geometry",
        kind: "geojson",
        fieldMapping: { title: "title", sourceId: "id", geometry: "geometry" },
      }],
    },
  });
  expect(pack.statusCode).toBe(201);
  const datasetId = (await admin`
    select id from data_pack_datasets where key = 'browser_authorized_geometry'`)[0]!.id as string;
  expect((await app.inject({
    method: "POST",
    url: `/api/v1/data-packs/datasets/${datasetId}/load`,
    headers: auth(ownerToken),
    payload: { records: [{
      id: "browser-feature",
      title: "Partner-visible geometry",
      geometry: { type: "Point", coordinates: [-121.5, 38.5] },
    }] },
  })).statusCode).toBe(200);

  browser = await launchBrowser();
}, 120000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("authorized viewing in a real browser", () => {
  it("shows only the partner's host incident data and clears it after revocation", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const external: string[] = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:"))
        return route.continue();
      external.push(url);
      return route.abort();
    });
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("browser-viewer@example.org");
    await page.getByLabel("Password").fill("browser-viewer-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // The first console after sign-in waits for the incident list and the workspace, as other tests allow for.
    await page.locator("#main .eoc-shell-page-scope").getByText("Authorized Host A Fire", { exact: false }).waitFor({ timeout: 30_000 });
    await page.getByTestId("cop-map").waitFor({ timeout: 5000 });
    expect(await page.getByRole("option", { name: "Unrelated Host B Flood" }).count()).toBe(0);
    await page.getByText("Authorized Geometry").waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Dashboards", exact: true }).click();
    await page.getByText("EOC Status").first().waitFor({ timeout: 5000 });
    await page.getByText("Closed roads").waitFor({ timeout: 5000 });

    await page.evaluate((id) => {
      (globalThis as unknown as { location: { hash: string } }).location.hash = `#/dashboard/${id}`;
    }, dashboardB);
    await page.getByRole("alert").filter({ hasText: "dashboard not found" }).waitFor({ timeout: 5000 });
    // The previous dashboard unmounts after the refusal renders.
    await expect.poll(() => page.getByText("EOC Status").count(), { timeout: 5000 }).toBe(0);
    await page.evaluate((id) => {
      (globalThis as unknown as { location: { hash: string } }).location.hash = `#/dashboard/${id}`;
    }, dashboardA);
    await page.getByText("EOC Status").first().waitFor({ timeout: 5000 });

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentA}/participants/${participantId}/revoke`,
      headers: auth(ownerToken),
      payload: { reason: "Browser exercise complete" },
    });
    expect(revoked.statusCode).toBe(200);
    await page.getByText("EOC Status").first().waitFor({ state: "detached", timeout: 8000 });
    await page.getByText("No active incident").waitFor({ timeout: 8000 });
    expect(await page.getByText("Authorized Geometry").count()).toBe(0);
    await page.screenshot({ path: join(SHOTS, "authorized-viewing-revoked.png"), fullPage: true });
    expect(external).toEqual([]);
    await page.close();
  });
});
