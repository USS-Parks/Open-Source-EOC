import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("admin-app");
const SHOTS = shotDir("admin");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let jurisdictionId: string;
let priorKey: string | undefined;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  // The signed JSON export needs the server key.
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-admin-export-key";
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  // An account that already exists in a neighbouring jurisdiction, and a mutual-aid guest.
  const karukId = await createJurisdiction(admin, "karuk", "Karuk Tribe OES");
  const liaisonId = await createPerson(admin, { email: "liaison@example.org", displayName: "Karuk Liaison", password: "liaison-good-password" });
  await addMembership(admin, liaisonId, karukId, "member");
  await createPerson(admin, { email: "mutualaid@example.org", displayName: "Mutual Aid", password: "mutual-aid-password" });
  app = buildApp(runtime, { oidc: null, integrations: ["meetings"] });
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
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

async function signIn(target: Page, email: string, password: string): Promise<void> {
  await target.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await target.getByLabel("Email").fill(email);
  await target.getByLabel("Password").fill(password);
  await target.getByRole("button", { name: "Sign in" }).click();
  await target.getByRole("button", { name: "Account menu" }).waitFor();
}

function localInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

describe("administration screen", () => {
  it("replaces curl for people, roles, positions, guest access, retention and export", async () => {
    await signIn(page, "admin@example.org", "correct-horse-battery");
    await page.getByRole("button", { name: "Administration", exact: true }).click();
    await page.getByRole("heading", { name: "Administration", level: 2, exact: true }).waitFor();

    // Create a person.
    await page.getByLabel("Name", { exact: true }).fill("Riley Planner");
    await page.getByLabel("Email", { exact: true }).fill("riley@example.org");
    await page.getByLabel("First password").fill("riley-first-password");
    await page.getByRole("button", { name: "Add person" }).click();
    await page.getByText("Riley Planner added as member.").waitFor();
    await page.getByRole("button", { name: "Riley Planner", exact: true }).waitFor();

    // Add a membership for an account from another jurisdiction.
    await page.getByLabel("Account", { exact: true }).selectOption("existing");
    await page.getByLabel("Role in this jurisdiction").selectOption("viewer");
    await page.getByLabel("Email", { exact: true }).fill("liaison@example.org");
    await page.getByRole("button", { name: "Add person" }).click();
    await page.getByText("liaison@example.org added as viewer.").waitFor();
    await page.getByRole("button", { name: "Karuk Liaison", exact: true }).waitFor();

    // Change a role.
    await page.getByRole("button", { name: "Riley Planner", exact: true }).click();
    await page.getByLabel("Role for Riley Planner").selectOption("admin");
    await page.getByRole("button", { name: "Save role" }).click();
    await page.getByText("Riley Planner is now administrator.").waitFor();
    await page.screenshot({ path: join(SHOTS, "admin-people-light-1440.png"), fullPage: false });
    const roles = await admin`
      select p.email, m.role from jurisdiction_memberships m join persons p on p.id = m.person_id
      where m.jurisdiction_id = ${jurisdictionId} order by p.email`;
    expect(roles.map((r) => `${r.email as string}:${r.role as string}`)).toEqual([
      "admin@example.org:admin", "liaison@example.org:viewer", "member@example.org:member", "riley@example.org:admin",
    ]);
    const added = await admin`
      select p.email from audit_events e join persons p on p.id = e.subject_id
      where e.category = 'membership.added' order by e.seq`;
    expect(added.map((r) => r.email)).toEqual(["riley@example.org", "liaison@example.org"]);

    // Add and assign a position.
    await page.getByRole("tab", { name: "Positions" }).click();
    await page.getByLabel("Position title").fill("Safety Officer");
    await page.getByLabel("Short code").fill("safety_officer");
    await page.getByRole("button", { name: "Add position" }).click();
    const card = page.getByRole("listitem", { name: "Safety Officer" });
    await card.getByText("Vacant").waitFor();
    await card.getByLabel("Person for Safety Officer").selectOption({ label: "Riley Planner" });
    await card.getByRole("button", { name: "Assign" }).click();
    await card.getByText("Held by Riley Planner").waitFor();
    await page.screenshot({ path: join(SHOTS, "admin-positions-light-1440.png"), fullPage: false });

    // Create and revoke a guest grant.
    await page.getByRole("tab", { name: "Guest access" }).click();
    await page.getByLabel("Guest account email").fill("mutualaid@example.org");
    await page.getByLabel("Access ends").fill(localInput(Date.now() + 2 * 86_400_000));
    await page.getByRole("button", { name: "Grant access" }).click();
    await page.getByText("Guest access granted to Mutual Aid.").waitFor();
    const grant = page.getByRole("listitem", { name: "Guest grant for Mutual Aid" });
    await grant.getByText("Read positions").waitFor();
    await page.screenshot({ path: join(SHOTS, "admin-guests-light-1440.png"), fullPage: false });
    await grant.getByRole("button", { name: "Revoke access for Mutual Aid" }).click();
    await grant.getByText("Revoked", { exact: true }).waitFor();
    const [revoked] = await admin`select scopes, revoked_at from guest_grants`;
    expect(revoked!.scopes).toEqual(["positions:read"]);
    expect(revoked!.revoked_at).not.toBeNull();

    // Set a retention period and download the audit trail.
    await page.getByRole("tab", { name: "Records" }).click();
    await page.getByLabel("Feed items (days)").fill("90");
    await page.getByRole("button", { name: "Save retention" }).click();
    await page.getByText("Retention periods saved.").waitFor();
    const periods = await admin`select data_class, retention_days from retention_policies`;
    expect(periods).toEqual([{ data_class: "feed_items", retention_days: 90 }]);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download audit CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("audit-export.csv");
    const csv = readFileSync((await download.path())!, "utf8");
    expect(csv.split("\r\n")[0]).toContain("category");
    expect(csv).toContain("membership.role.changed");
    expect(csv).toContain("retention.policy.updated");
    await page.getByText(/Audit trail downloaded as CSV/).waitFor();
    // The signed download verifies with the script the administrator guide publishes.
    const [signed] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download signed JSON" }).click(),
    ]);
    const guide = readFileSync(join(process.cwd(), "docs", "guides", "ADMIN.md"), "utf8");
    const verify = /```js\n([\s\S]*?)```/.exec(guide)![1]!;
    const verdict = execFileSync(process.execPath, ["--input-type=module", "-", (await signed.path())!], { input: verify });
    expect(verdict.toString().trim()).toBe("valid");
    await page.screenshot({ path: join(SHOTS, "admin-records-light-1440.png"), fullPage: false });

    // Deployment settings are shown, never changed, from the screen.
    await page.getByRole("tab", { name: "Deployment" }).click();
    const meetings = page.getByRole("listitem", { name: "Meetings and briefings" });
    await meetings.getByText("Enabled", { exact: true }).waitFor();
    await page.getByRole("listitem", { name: "Patient, evacuee and asset tracking" }).getByText("Not enabled").waitFor();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.screenshot({ path: join(SHOTS, "admin-deployment-dark-1440.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "People" }).click();
    await page.getByRole("button", { name: "Riley Planner", exact: true }).waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "admin-people-dark-390.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 180_000);

  it("hides Administration from an account that administers nothing", async () => {
    const member = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      await signIn(member, "member@example.org", "another-good-password");
      await member.getByRole("button", { name: "Templates", exact: true }).waitFor();
      expect(await member.getByRole("button", { name: "Administration", exact: true }).count()).toBe(0);
      await member.goto(`${baseUrl}/app/index.html#/admin`, { waitUntil: "load" });
      await member.getByText("Administration is available to administrators.").waitFor();
    } finally {
      await member.close();
    }
  }, 60_000);
});
