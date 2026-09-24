import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The cross-boundary incident exercise as an operator walk in a real browser:
 * the owner activates a wildfire, draws its area and brings in a mutual-aid
 * partner; the partner signs in from a second browser, sees only that
 * incident, posts a field impact on the map and requests a resource; the owner
 * assigns a request to the partner, reconciles the COP and dashboard, publishes
 * the plan, revokes the partner and closes the incident. A second incident runs
 * alongside and never shows any of it.
 */

const DIST = buildDir("cross-boundary-app");
const SHOTS = shotDir("cross-boundary");
const AREA: ReadonlyArray<[string, string]> = [["-124.3", "40.6"], ["-123.8", "40.6"], ["-123.8", "41.1"], ["-124.3", "41.1"]];

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let ownerId: string;
let partnerId: string;
let partnerPersonId: string;
let incidentB: string;
let dashboardId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

/** "YYYY-MM-DDTHH:mm" in local time, for a datetime-local input. */
function localTime(offsetHours: number): string {
  const date = new Date(Date.now() + offsetHours * 3_600_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function openPage(email: string, password: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(`${email}: ${error.message}`));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

/** Open a section from the rail. */
function rail(page: Page, name: string): Promise<void> {
  return page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true }).click();
}

async function useDarkTheme(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
}

/** The closed-roads count the dashboard shows for an incident, read from its data response. */
async function closedRoads(page: Page, incidentId: string): Promise<number> {
  const response = page.waitForResponse((r) => r.url().includes(`/api/v1/dashboards/${dashboardId}/data?`)
    && r.url().includes(`incidentId=${incidentId}`) && r.status() === 200);
  await rail(page, "Dashboards");
  const snapshot = await (await response).json() as { widgets: Array<{ key: string; value: number }> };
  await page.getByText("Closed roads").first().waitFor();
  return snapshot.widgets.find((w) => w.key === "closed_roads")!.value;
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  ownerId = await createJurisdiction(admin, "valley-city", "Valley City EOC");
  partnerId = await createJurisdiction(admin, "valley-mutual-aid", "Valley Mutual Aid");
  const ownerAdmin = await createPerson(admin, { email: "city@example.org", displayName: "City Admin", password: "owner-good-password" });
  partnerPersonId = await createPerson(admin, { email: "coord@example.org", displayName: "Aid Coordinator", password: "coord-good-password" });
  await addMembership(admin, ownerAdmin, ownerId, "admin");
  await addMembership(admin, partnerPersonId, partnerId, "member");
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  const ownerToken = await login(app, "city@example.org", "owner-good-password");
  // The concurrent incident and the jurisdiction's status dashboard exist before the walk.
  incidentB = (await post(app, ownerToken, `/api/v1/jurisdictions/${ownerId}/incidents`,
    { templateKey: "wildfire", name: "Separate Flood" })).incidentId as string;
  dashboardId = (await post(app, ownerToken, `/api/v1/jurisdictions/${ownerId}/dashboards`, { templateKey: "eoc_status" })).id as string;
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("cross-boundary incident exercise in a real browser", () => {
  it("runs the shared incident from activation to closeout while the second incident stays isolated", async () => {
    // The owner activates the wildfire.
    const owner = await openPage("city@example.org", "owner-good-password");
    await rail(owner, "Incident Setup");
    await owner.getByLabel("Scenario template").selectOption("wildfire");
    await owner.getByLabel("Incident name").fill("Valley Complex Fire");
    const activation = owner.waitForResponse((r) => r.request().method() === "POST"
      && r.url().endsWith(`/jurisdictions/${ownerId}/incidents`));
    await owner.getByRole("button", { name: "Activate", exact: true }).click();
    expect((await activation).status()).toBe(201);
    const incidentA = (await (await activation).json()).incidentId as string;
    const incidentRow = owner.locator("li").filter({ hasText: "Valley Complex Fire" });

    // Expands the operational area and opens the first operational period.
    await incidentRow.getByRole("button", { name: "Operational area" }).click();
    const setup = owner.getByRole("region", { name: "Valley Complex Fire: incident setup", exact: true });
    const area = setup.getByRole("region", { name: "Valley Complex Fire: operational area", exact: true });
    for (const [longitude, latitude] of AREA) {
      await area.getByLabel("Longitude").fill(longitude);
      await area.getByLabel("Latitude").fill(latitude);
      await area.getByRole("button", { name: "Add coordinate" }).click();
    }
    await area.getByRole("button", { name: "Close boundary" }).click();
    await area.getByLabel("Operational period").fill("Operational Period 1");
    await area.getByLabel("Period starts").fill(localTime(-1));
    await area.getByLabel("Period ends").fill(localTime(11));
    await area.getByLabel("Reason for revision").fill("Initial fire perimeter");
    await area.getByRole("button", { name: "Save area revision" }).click();
    await area.getByText(/^Revision 1\./).waitFor();

    // Onboards the mutual-aid partner to this incident alone.
    await incidentRow.getByRole("button", { name: "Participants" }).click();
    const participants = setup.getByRole("region", { name: "Valley Complex Fire: participants", exact: true });
    await participants.getByLabel("Organization code").fill("valley-mutual-aid");
    await participants.getByLabel("Participant email").fill("coord@example.org");
    await participants.getByLabel("Incident position").fill("Mutual Aid Liaison");
    await participants.getByLabel("Incident role").selectOption("coordinator");
    await participants.getByLabel("Participation expires").fill("2099-09-21T20:00");
    await participants.getByLabel("Participation reason").fill("Joint response");
    const granted = owner.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/incidents/${incidentA}/participants`));
    await participants.getByRole("button", { name: "Add participant" }).click();
    const participantId = (await (await granted).json()).participant.id as string;
    await participants.getByText("Aid Coordinator", { exact: true }).waitFor();
    await owner.screenshot({ path: join(SHOTS, "cross-boundary-owner-setup-light-1440.png"), fullPage: false });

    // The partner loads its shelter dataset for the incident, as a feed push would.
    const partnerToken = await login(app, "coord@example.org", "coord-good-password");
    await post(app, partnerToken, `/api/v1/incidents/${incidentA}/data-packs`, {
      name: "Mutual aid shelters", organizationSlug: "valley-mutual-aid",
      datasets: [{ key: "statewide_shelters", name: "Mutual aid shelters", kind: "geojson",
        coverage: { type: "Polygon", coordinates: [[[-125, 32], [-114, 32], [-114, 42.1], [-125, 42.1], [-125, 32]]] },
        fieldMapping: { title: "name", sourceId: "id", geometry: "geometry" } }] });
    const [dataset] = await admin`
      select d.id from data_pack_datasets d join data_packs p on p.id = d.pack_id where p.incident_id = ${incidentA}`;
    const datasetId = dataset!.id as string;
    await post(app, partnerToken, `/api/v1/data-packs/datasets/${datasetId}/load`, { records: [
      { id: "shelter-fortuna", name: "Fortuna Veterans Hall", geometry: { type: "Point", coordinates: [-124.1, 40.8] } },
      { id: "shelter-rio-dell", name: "Rio Dell Fire Hall", geometry: { type: "Point", coordinates: [-124.0, 40.95] } },
      { id: "shelter-cal-expo", name: "Cal Expo", geometry: { type: "Point", coordinates: [-121.4, 38.6] } },
    ] }, 200);

    // The partner signs in from a second browser and sees only this incident.
    const partner = await openPage("coord@example.org", "coord-good-password");
    const partnerSelector = partner.getByLabel("Selected incident");
    await partnerSelector.getByRole("option", { name: "Valley Complex Fire", exact: true }).waitFor({ state: "attached" });
    expect(await partnerSelector.getByRole("option", { name: "Separate Flood" }).count()).toBe(0);
    await partnerSelector.selectOption(incidentA);
    await rail(partner, "Map");
    await partner.getByText("· common operating picture").waitFor();
    await partner.getByText("Mutual aid shelters").first().waitFor();

    // The partner posts a field impact on the map.
    await partner.getByRole("button", { name: "Add point" }).click();
    await partner.getByLabel("Map record board").selectOption({ label: "Valley Complex Fire: Road Closures" });
    await partner.getByLabel("Longitude").fill("-124.05");
    await partner.getByLabel("Latitude").fill("40.85");
    await partner.getByRole("button", { name: "Use coordinates" }).click();
    const impactPanel = partner.getByRole("region", { name: "New map record" });
    await impactPanel.getByLabel("Road").fill("SR-36 at Bridgeville");
    await impactPanel.getByLabel("Reason").fill("Fire across the roadway");
    await impactPanel.getByLabel("Status").selectOption("closed");
    const posted = partner.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/records?incidentId="));
    await impactPanel.getByRole("button", { name: "Save record" }).click();
    expect((await posted).status()).toBe(201);
    await partner.getByText("New map record").waitFor({ state: "hidden" });
    const [impact] = await admin`
      select incident_id, created_by from board_records where data ->> 'road' = 'SR-36 at Bridgeville'`;
    expect(impact).toMatchObject({ incident_id: incidentA, created_by: partnerPersonId });
    await partner.screenshot({ path: join(SHOTS, "cross-boundary-partner-cop-light-1440.png"), fullPage: false });

    // The partner requests cots; its own organization receives the request.
    await rail(partner, "Resources");
    await partner.getByRole("heading", { name: "Resource coordination" }).waitFor();
    await partner.getByLabel("Requested item").fill("Cots");
    await partner.getByLabel("Quantity").fill("200");
    const requested = partner.waitForResponse((r) => r.request().method() === "POST"
      && r.url().endsWith(`/jurisdictions/${partnerId}/resource-requests`));
    await partner.getByRole("button", { name: "Submit request" }).click();
    expect((await requested).status()).toBe(201);
    await partner.getByText("Receiving: Valley Mutual Aid").waitFor();

    // The owner assigns the engine request it receives on this incident to the partner as supplier.
    await owner.getByLabel("Selected incident").selectOption(incidentA);
    await rail(owner, "Resources");
    await owner.getByRole("heading", { name: "Resource coordination" }).waitFor();
    await owner.getByLabel("Requested item").fill("Engine strike team");
    await owner.getByLabel("Priority").selectOption("immediate");
    await owner.getByRole("button", { name: "Submit request" }).click();
    await owner.getByText("Submitted", { exact: true }).waitFor();
    for (const [state, label] of [["triaged", "Triaged"], ["sourcing", "Sourcing"]] as const) {
      await owner.getByLabel("Next state for Engine strike team").selectOption(state);
      await owner.getByRole("button", { name: "Advance", exact: true }).click();
      await owner.getByText(label, { exact: true }).first().waitFor();
    }
    await owner.getByLabel("Assignment for Engine strike team").selectOption(`participant:${participantId}`);
    await owner.getByRole("button", { name: "Assign and advance", exact: true }).click();
    await owner.getByText("Supplying: Valley Mutual Aid").waitFor();
    await owner.getByText("Owner: Aid Coordinator · Mutual Aid Liaison · Valley Mutual Aid").waitFor();

    // The owner checks the COP impact indicator and the dashboard against the partner's contributions.
    await rail(owner, "Map");
    const shelters = owner.getByTestId("impact-kpi-shelters");
    await shelters.waitFor();
    await owner.getByText("Map tools and saved views", { exact: true }).click();
    // "Zoom to extent" frames the features loaded so far. Until the partner's
    // shelter layer has loaded it frames only the road closure, where no
    // shelter is in view, so zoom again until the shelters are framed.
    const zoomToExtent = owner.getByRole("button", { name: "Zoom to extent" });
    await expect.poll(async () => {
      if (await shelters.getByText("2", { exact: true }).count()) return true;
      await zoomToExtent.click();
      return false;
    }, { timeout: 60_000, interval: 1_500 }).toBe(true);
    await owner.screenshot({ path: join(SHOTS, "cross-boundary-owner-cop-light-1440.png"), fullPage: false });
    expect(await closedRoads(owner, incidentA)).toBe(1);

    // The second incident shows none of it.
    await owner.getByLabel("Selected incident").selectOption(incidentB);
    expect(await closedRoads(owner, incidentB)).toBe(0);
    await rail(owner, "Resources");
    await owner.getByText("No resource requests in this scope.").waitFor();
    await owner.getByLabel("Selected incident").selectOption(incidentA);

    // The owner publishes the operational-period plan.
    await owner.evaluate((hash) => { (globalThis as unknown as { location: { hash: string } }).location.hash = hash; },
      `#/forms?incident=${incidentA}&period=1`);
    await owner.getByRole("heading", { name: "ICS Forms and IAP Assembly", exact: true }).waitFor();
    const assembled = owner.waitForResponse((r) => r.url().includes(`/api/v1/incidents/${incidentA}/iap`)
      && r.request().method() === "POST" && r.status() === 201);
    await owner.getByRole("button", { name: "Assemble draft IAP", exact: true }).click();
    await assembled;
    await owner.getByRole("button", { name: "Review draft in IAP workspace", exact: true }).click();
    await owner.getByRole("region", { name: "Plans", exact: true })
      .getByRole("button", { name: /Operational Period 1.*In progress/i }).click();
    const plan = owner.getByRole("region", { name: "Plan detail", exact: true });
    await plan.getByRole("button", { name: "Submit for approval", exact: true }).click();
    await plan.getByText("In approval", { exact: true }).waitFor();
    await plan.getByRole("button", { name: "Approve revision", exact: true }).click();
    await plan.getByText("Approved", { exact: true }).waitFor();
    await useDarkTheme(owner);
    await owner.screenshot({ path: join(SHOTS, "cross-boundary-owner-iap-dark-1440.png"), fullPage: false });

    // The owner revokes the partner; the partner's view loses the incident at once.
    await rail(owner, "Incident Setup");
    await incidentRow.getByRole("button", { name: "Participants" }).click();
    await participants.getByRole("button", { name: "End participation for Aid Coordinator" }).click();
    await participants.getByLabel("Reason for ending participation").fill("Assignment ended");
    await participants.getByRole("button", { name: "End participation", exact: true }).click();
    await participants.getByText(/Incident access has been revoked/i).waitFor();
    await rail(partner, "Map");
    await partner.getByText("No active incident").waitFor({ timeout: 15_000 });
    expect(await partner.getByText("Mutual aid shelters").count()).toBe(0);
    await partner.setViewportSize({ width: 390, height: 844 });
    expect(await partner.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await partner.screenshot({ path: join(SHOTS, "cross-boundary-partner-revoked-light-390.png"), fullPage: false });

    // The owner closes the incident; the second stays open.
    await incidentRow.getByRole("button", { name: "Close incident" }).click();
    await owner.getByText(/Closeout prevents new incident updates/i).waitFor();
    await owner.getByRole("button", { name: "Confirm closeout" }).click();
    await incidentRow.getByText("closed", { exact: true }).waitFor();
    await owner.screenshot({ path: join(SHOTS, "cross-boundary-owner-closed-dark-1440.png"), fullPage: false });
    const [states] = await admin`
      select (select closed_at from incidents where id = ${incidentA}) as a_closed,
             (select closed_at from incidents where id = ${incidentB}) as b_closed`;
    expect(states!.a_closed).not.toBeNull();
    expect(states!.b_closed).toBeNull();
    const partnerReadB = await app.inject({ method: "GET", url: `/api/v1/incidents/${incidentB}`, headers: auth(partnerToken) });
    expect(partnerReadB.statusCode).toBe(404);

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
    await partner.close();
    await owner.close();
  }, 300_000);
});
