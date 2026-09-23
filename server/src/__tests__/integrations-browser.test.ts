import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The optional integrations' screens in a real browser with every
 * integration on. An administrator points collaboration at a local
 * Mattermost receiver, sets up the incident's channels and announces into
 * them; configures the meeting bridge, opens the incident bridge and
 * schedules a briefing; asks facilities to report and watches the request
 * close; and reads a tracked object's custody chain. With the integrations
 * off none of these controls appear.
 */
const DIST = buildDir("integrations-app");
const SHOTS = shotDir("integrations");
const TOKEN = "mattermost-bot-token-7731";
const SECRET = "jitsi-shared-secret-5520";

/** A Mattermost v4 receiver on loopback, the same fake the collaboration suite drives in memory. */
function mattermostReceiver() {
  const teams = new Map<string, string>();
  const channelIds = new Map<string, string>();
  const channels = new Map<string, { name: string; members: Set<string> }>();
  const users = new Map([["member@example.org", "u-member"]]);
  const posts: Array<{ channelId: string; message: string }> = [];
  const tokens = new Set<string>();
  let seq = 0;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += String(chunk); });
    req.on("end", () => {
      tokens.add(req.headers.authorization ?? "");
      const body = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
      const [, , a, b, c, d, e] = decodeURIComponent(new URL(req.url ?? "/", "http://receiver").pathname).split("/").filter(Boolean);
      const send = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const id = (prefix: string) => `${prefix}-${(seq += 1)}`;
      if (req.method === "POST" && a === "teams" && !b) {
        if (teams.has(body.name!)) return send(400, {});
        const team = id("team");
        teams.set(body.name!, team);
        return send(201, { id: team });
      }
      if (req.method === "GET" && a === "teams" && b === "name") return teams.has(c!) ? send(200, { id: teams.get(c!) }) : send(404, {});
      if (req.method === "POST" && a === "channels" && !b) {
        const key = `${body.team_id}:${body.name}`;
        if (channelIds.has(key)) return send(400, {});
        const channel = id("chan");
        channelIds.set(key, channel);
        channels.set(channel, { name: body.name!, members: new Set() });
        return send(201, { id: channel });
      }
      if (req.method === "GET" && a === "teams" && c === "channels" && d === "name") {
        const channel = channelIds.get(`${b}:${e}`);
        return channel ? send(200, { id: channel }) : send(404, {});
      }
      if (req.method === "GET" && a === "users" && b === "email") return users.has(c!) ? send(200, { id: users.get(c!) }) : send(404, {});
      if (a === "channels" && c === "members") {
        const channel = channels.get(b!);
        if (req.method === "GET") return send(200, [...(channel?.members ?? [])].map((user_id) => ({ user_id })));
        if (req.method === "POST") channel?.members.add(body.user_id!);
        else channel?.members.delete(d!);
        return send(200, {});
      }
      if (req.method === "POST" && a === "posts") {
        posts.push({ channelId: body.channel_id!, message: body.message! });
        return send(201, { id: id("post") });
      }
      return send(404, {});
    });
  });
  return { server, teams, channels, posts, tokens };
}

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let plainApp: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let plainUrl: string;
let receiverUrl: string;
let priorKey: string | undefined;
const receiver = mattermostReceiver();

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-integrations-key";
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const { jurisdictionId, memberId } = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await new Promise<void>((resolve) => receiver.server.listen(0, "127.0.0.1", resolve));
  const address = receiver.server.address();
  receiverUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  app = buildApp(runtime, { oidc: null, integrations: ["collab", "meetings", "facilities", "tracking"] });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  plainApp = buildApp(runtime, { oidc: null });
  serveStatic(plainApp, "/app", DIST);
  plainUrl = await listen(plainApp);

  // An incident whose commander is the member, a hospital, and a patient with a custody chain.
  const token = await login(app);
  const { incidentId } = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    { templateKey: "wildfire", name: "Klamath Flood" });
  const detail = (await app.inject({ method: "GET", url: `/api/v1/incidents/${incidentId as string}`, headers: auth(token) })).json() as {
    positions: Array<{ id: string; key: string }>;
  };
  const commander = detail.positions.find((p) => p.key === "incident_commander")!.id;
  await post(app, token, `/api/v1/positions/${commander}/assignments`, { personId: memberId });
  await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/facilities`,
    { name: "Klamath General", kind: "hospital", location: { lon: -124.02, lat: 41.52 } });
  const tracked = `/api/v1/jurisdictions/${jurisdictionId}/tracked-objects`;
  const { tag } = await post(app, token, tracked, { kind: "patient", label: "Adult male, blue jacket", station: "Triage A", agency: "County Fire" });
  await post(app, token, `${tracked}/scan`, { tag, custodyState: "in_transit", station: "Medic 4", agency: "County EMS", note: "Stable on departure" });
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await plainApp?.close();
  await new Promise((resolve) => receiver.server.close(resolve));
  await runtime?.end();
  await admin?.end();
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

async function signIn(url: string): Promise<{ page: Page; errors: string[]; external: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  const external: string[] = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const target = route.request().url();
    if (target.startsWith(url) || target.startsWith("data:") || target.startsWith("blob:")) return route.continue();
    external.push(target);
    return route.abort();
  });
  await page.goto(`${url}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).waitFor();
  return { page, errors, external };
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: theme === "light" ? "Use light theme" : "Use dark theme" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
}

async function shot(page: Page, region: string, name: string): Promise<void> {
  await page.getByRole("region", { name: region, exact: true }).evaluate((element) => (element as unknown as { scrollIntoView(): void }).scrollIntoView());
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, name) });
}

async function openIncidentSetup(page: Page): Promise<void> {
  // The rail folds away on a phone, so the route is opened directly.
  await page.evaluate("location.hash = '#/incidents'");
  await page.locator("li").filter({ hasText: "Klamath Flood" }).getByRole("button", { name: "Operational area" }).click();
  await page.getByRole("region", { name: "Klamath Flood: incident setup", exact: true }).waitFor();
}

describe("optional integration screens", () => {
  it("configures collaboration and meetings, runs the incident's channels, bridge and briefing, a status request and a custody chain", async () => {
    const { page, errors, external } = await signIn(baseUrl);

    // Collaboration backend: the token goes to the server and never comes back.
    await page.getByRole("button", { name: "Administration", exact: true }).click();
    await page.getByRole("tab", { name: "Deployment" }).click();
    const collab = page.getByRole("region", { name: "Collaboration channels", exact: true });
    await collab.getByText("No access token is stored.").waitFor();
    await collab.getByLabel("Chat server address").fill(receiverUrl);
    await collab.getByLabel("Access token").fill(TOKEN);
    await collab.getByLabel("Use this backend for incident channels").check();
    await collab.getByRole("button", { name: "Save collaboration settings" }).click();
    await collab.getByText("Collaboration settings saved.").waitFor();
    await collab.getByText(`Channels run on Mattermost at ${receiverUrl}.`).waitFor();
    await collab.getByText("An access token is stored. It is never shown; leave the field blank to keep it.").waitFor();
    expect(await collab.getByLabel("Access token").inputValue()).toBe("");
    const [backend] = await admin`select kind, base_url, enabled, token_envelope from collab_backends`;
    expect(backend).toMatchObject({ kind: "mattermost", base_url: receiverUrl, enabled: true });
    expect(String(backend!.token_envelope)).not.toContain(TOKEN);

    // Meeting bridge with a signing secret.
    const meetings = page.getByRole("region", { name: "Meeting bridge", exact: true });
    await meetings.getByLabel("Jitsi server address").fill("https://meet.example.org");
    await meetings.getByLabel("App id").fill("openeoc");
    await meetings.getByLabel("Token secret").fill(SECRET);
    await meetings.getByLabel("Offer meeting bridges for incidents").check();
    await meetings.getByRole("button", { name: "Save meeting settings" }).click();
    await meetings.getByText("Meeting settings saved.").waitFor();
    await meetings.getByText(/^A token secret is stored\. It is never shown/).waitFor();
    await shot(page, "Collaboration channels", "integrations-settings-light-1440.png");
    expect(await page.content()).not.toContain(TOKEN);
    expect(await page.content()).not.toContain(SECRET);

    // The incident's channels on the receiver, with the commander in the incident-wide channel.
    await openIncidentSetup(page);
    const channels = page.getByRole("region", { name: "Klamath Flood: collaboration channels", exact: true });
    await channels.getByText(/^Channels run on Mattermost/).waitFor();
    await channels.getByRole("button", { name: "Set up channels" }).click();
    const ready = channels.getByText(/^\d+ channels are ready on Mattermost\.$/);
    await ready.waitFor();
    expect(await ready.textContent()).toBe(`${receiver.channels.size} channels are ready on Mattermost.`);
    expect(receiver.channels.size).toBe(6);
    expect(receiver.teams.has("klamath-flood")).toBe(true);
    expect([...receiver.channels.values()].find((c) => c.name === "klamath-flood-all")?.members).toEqual(new Set(["u-member"]));
    expect(receiver.tokens).toEqual(new Set([`Bearer ${TOKEN}`]));
    await channels.getByLabel("Announcement").fill("Levee overtopping reported at Klamath Glen");
    await channels.getByRole("button", { name: "Post announcement" }).click();
    await channels.getByText("Announcement posted to Whole incident.").waitFor();
    expect(receiver.posts.map((p) => p.message)).toEqual(["Levee overtopping reported at Klamath Glen"]);

    // The incident bridge carries a signed join token; the briefing is scheduled for the holders.
    const bridge = page.getByRole("region", { name: "Klamath Flood: meetings and briefings", exact: true });
    await bridge.getByText("No bridge is open for this incident.").waitFor();
    await bridge.getByRole("button", { name: "Open bridge" }).click();
    await bridge.getByText("The whole incident bridge is open.").waitFor();
    const join = bridge.getByRole("link", { name: "Join the whole incident bridge" });
    expect(await join.getAttribute("href")).toMatch(/^https:\/\/meet\.example\.org\/eoc-[0-9a-f]{16}\?jwt=[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(await join.getAttribute("target")).toBe("_blank");
    await bridge.getByLabel("Briefing title").fill("Operational period briefing");
    await bridge.getByLabel("Starts", { exact: true }).fill("2026-09-24T08:00");
    await bridge.getByLabel("Briefing for").selectOption("operations");
    await bridge.getByRole("button", { name: "Schedule briefing" }).click();
    await bridge.getByText("Operational period briefing scheduled. The position holders are notified when it is due.").waitFor();
    await bridge.getByRole("table", { name: "Scheduled briefings" })
      .getByRole("row", { name: /^Operational period briefing Operations .* Not yet$/ }).waitFor();
    const briefings = await admin`select title, section, notified_at from briefings`;
    expect(briefings).toEqual([{ title: "Operational period briefing", section: "operations", notified_at: null }]);
    await shot(page, "Klamath Flood: collaboration channels", "integrations-incident-light-1440.png");

    // A status request, answered by the hospital's next report.
    await setTheme(page, "dark");
    await page.getByRole("button", { name: "Facilities", exact: true }).click();
    const requests = page.getByRole("region", { name: "Status requests", exact: true });
    await requests.getByLabel("Ask").selectOption("hospital");
    await requests.getByRole("button", { name: "Send status request" }).click();
    await requests.getByText("Request sent to 1 facility.").waitFor();
    const sent = requests.getByRole("listitem", { name: "Report your current status" });
    await sent.getByText("0 of 1 reported").waitFor();
    await sent.getByText("Waiting for Klamath General.").waitFor();
    await page.getByLabel("Facility", { exact: true }).selectOption({ label: "Klamath General" });
    await page.getByLabel("Operating status", { exact: true }).selectOption("normal");
    await page.getByRole("button", { name: "Report status" }).click();
    await page.getByText("Status for Klamath General reported as normal.").waitFor();
    await sent.getByText("All reported").waitFor();
    expect(await sent.getByText(/Waiting for/).count()).toBe(0);
    await shot(page, "Status requests", "integrations-status-requests-dark-1440.png");

    // A tracked object's custody chain, from the reunification inventory.
    await page.getByRole("button", { name: "Tracking", exact: true }).click();
    await page.getByRole("tab", { name: "Find & reunify" }).click();
    await page.getByRole("button", { name: "Custody chain" }).click();
    const chain = page.getByRole("region", { name: "Custody chain for Adult male, blue jacket", exact: true });
    const events = chain.getByRole("list", { name: "Custody events, oldest first" }).getByRole("listitem");
    await events.nth(1).waitFor();
    expect(await events.allTextContents()).toEqual([
      expect.stringMatching(/Registered.*Triage A · County Fire$/),
      expect.stringMatching(/In Transit.*Medic 4 · County EMS.*Stable on departure$/),
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await chain.waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await shot(page, "Custody chain for Adult male, blue jacket", "integrations-custody-chain-dark-390.png");
    await openIncidentSetup(page);
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await shot(page, "Klamath Flood: meetings and briefings", "integrations-meetings-dark-390.png");
    await setTheme(page, "light");

    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 240_000);

  it("shows none of these controls when the integrations are off", async () => {
    const { page, errors, external } = await signIn(plainUrl);
    await page.getByRole("button", { name: "Damage Assessment", exact: true }).waitFor();
    await page.waitForTimeout(500);
    expect(await page.getByRole("button", { name: "Facilities", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Tracking", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Administration", exact: true }).click();
    await page.getByRole("tab", { name: "Deployment" }).click();
    await page.getByRole("listitem", { name: "Collaboration channels" }).getByText("Not enabled").waitFor();
    expect(await page.getByRole("region", { name: "Collaboration channels", exact: true }).count()).toBe(0);
    expect(await page.getByRole("region", { name: "Meeting bridge", exact: true }).count()).toBe(0);
    await openIncidentSetup(page);
    await page.getByRole("region", { name: "Klamath Flood: participants", exact: true }).waitFor();
    expect(await page.getByRole("region", { name: "Klamath Flood: collaboration channels" }).count()).toBe(0);
    expect(await page.getByRole("region", { name: "Klamath Flood: meetings and briefings" }).count()).toBe(0);
    for (const control of ["Set up channels", "Post announcement", "Open bridge", "Schedule briefing"])
      expect(await page.getByRole("button", { name: control }).count()).toBe(0);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 120_000);
});
