import { createHmac } from "node:crypto";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Notification rules authored on the Administration screen: the allowlist
 * admits a local receiver, a webhook rule shows its signing secret once, a
 * board write is delivered by the worker with that secret's signature, and a
 * destination off the allowlist is refused with the server's message.
 */

const DIST = buildDir("notification-rules");
const SHOTS = shotDir("notification-rules");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let receiver: FastifyInstance;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let baseUrl: string;
let receiverUrl: string;
let token: string;
let jurisdictionId: string;
let boardId: string;
const received: Array<{ body: string; signature: string | undefined }> = [];
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  ({ jurisdictionId } = await seedIdentity(admin));
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  token = await login(app);
  const board = await app.inject({
    method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/boards`, headers: auth(token),
    payload: { templateKey: "activity_log" },
  });
  expect(board.statusCode, board.body).toBe(201);
  boardId = board.json().id as string;

  receiver = Fastify({ logger: false });
  receiver.removeContentTypeParser("application/json");
  receiver.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
  receiver.post("/hook", async (req) => {
    received.push({ body: req.body as string, signature: req.headers["x-openeoc-signature"] as string | undefined });
    return { ok: true };
  });
  receiverUrl = await listen(receiver);

  browser = await launchBrowser();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  page = await context.newPage();
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
  await context?.close();
  await browser?.close();
  await receiver?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("notification rules on the administration screen", () => {
  it("allowlists a receiver, shows the webhook secret once, delivers a signed board write and refuses an unlisted URL", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();
    await page.getByRole("button", { name: "Administration", exact: true }).click();
    await page.getByRole("tab", { name: "Notifications" }).click();

    // The allowlist starts empty; the admin adds the local receiver.
    await page.getByText("Never set.", { exact: false }).waitFor();
    await page.getByLabel("Allowed destinations").fill(`${receiverUrl}/`);
    await page.getByRole("button", { name: "Save allowlist" }).click();
    await page.getByText("Allowlist saved with 1 destination.").waitFor();
    expect(await page.getByLabel("Allowed destinations").inputValue()).toBe(receiverUrl);
    const [list] = await admin`select entries from notification_allowlists where jurisdiction_id = ${jurisdictionId}`;
    expect(list!.entries).toEqual([receiverUrl]);

    // A destination off the allowlist is refused with the server's reason.
    await page.getByLabel("Board", { exact: true }).selectOption({ label: "Activity Log" });
    await page.getByLabel("Channel kind", { exact: true }).selectOption("webhook");
    await page.getByLabel("Webhook URL", { exact: true }).fill("https://hooks.unlisted.example/h");
    await page.getByRole("button", { name: "Create rule" }).click();
    await page.getByRole("alert").filter({ hasText: "https://hooks.unlisted.example/h is not on this jurisdiction's notification allowlist" }).waitFor();
    expect(await page.getByLabel("Webhook signing secret").count()).toBe(0);
    expect((await admin`select count(*)::int as n from notification_rules`)[0]!.n).toBe(0);

    // The listed receiver is accepted; the secret appears once.
    await page.getByLabel("Webhook URL", { exact: true }).fill(`${receiverUrl}/hook`);
    await page.getByRole("button", { name: "Create rule" }).click();
    await page.getByText("Notification rule created.").waitFor();
    const secret = (await page.getByLabel("Webhook signing secret").textContent()) ?? "";
    expect(secret).toMatch(/^[0-9a-f]{48}$/);
    const [rule] = await admin`select board_id, event, channels, webhook_secret from notification_rules`;
    expect(rule).toMatchObject({ board_id: boardId, event: "record.created", webhook_secret: secret,
      channels: [{ kind: "webhook", url: `${receiverUrl}/hook` }] });
    await page.getByRole("button", { name: "Copy secret" }).click();
    await page.getByText("Secret copied.").waitFor();
    expect(await page.evaluate("navigator.clipboard.readText()")).toBe(secret);
    await page.screenshot({ path: join(SHOTS, "notification-rule-secret-light-1440.png"), fullPage: true });
    await page.getByRole("button", { name: "I have stored the secret" }).click();
    expect(await page.getByLabel("Webhook signing secret").count()).toBe(0);
    await page.getByRole("tab", { name: "People" }).click();
    await page.getByRole("tab", { name: "Notifications" }).click();
    await page.getByLabel("Allowed destinations").waitFor();
    expect(await page.getByText(secret).count()).toBe(0);

    // A board write queues the delivery; the worker sends it signed with that secret.
    const write = await app.inject({
      method: "POST", url: `/api/v1/boards/${boardId}/records`, headers: auth(token),
      payload: { entry: "Shelter opened at the high school" },
    });
    expect(write.statusCode, write.body).toBe(201);
    expect(received).toEqual([]);
    const pass = await new DeliveryWorker(runtime).drain();
    expect(pass.delivered).toBe(1);
    expect(received).toHaveLength(1);
    const delivery = received[0]!;
    expect(delivery.signature).toBe(`sha256=${createHmac("sha256", secret).update(delivery.body).digest("hex")}`);
    expect(JSON.parse(delivery.body)).toMatchObject({ event: "record.created", board: "activity_log",
      record: { entry: "Shelter opened at the high school" } });
    const [sent] = await admin`select status from notifications where channel = 'webhook'`;
    expect(sent!.status).toBe("delivered");

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 90_000);
});
