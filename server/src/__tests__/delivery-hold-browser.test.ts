import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The delivery hold on screen, at the frames' 1586 by 992 and at 1534 by 790:
 * an administrator sets how long webhooks wait for a route under Channels,
 * opens a delivery that expired in an outage, reads why, resends it, and
 * sees it go out once the target answers again.
 */

const DIST = buildDir("delivery-hold");
const SHOTS = shotDir("delivery-hold");
const HOUR = 3_600_000;
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let receiver: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let receiverUrl: string;
let token: string;
let jurisdictionId: string;
let boardId: string;
let down = true;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

/** Queue one webhook for a new record and let it expire in a simulated outage. */
async function expiredDelivery(entry: string): Promise<string> {
  const res = await app.inject({
    method: "POST", url: `/api/v1/boards/${boardId}/records`, headers: auth(token), payload: { entry },
  });
  expect(res.statusCode, res.body).toBe(201);
  down = true;
  const late = new DeliveryWorker(runtime, { baseDelayMs: 0, now: () => Date.now() + 73 * HOUR });
  expect(await late.drain()).toMatchObject({ expired: 1 });
  const [row] = await admin`
    select n.id from notifications n join delivery_outbox d on d.notification_id = n.id
    where d.status = 'expired' and n.status = 'failed' order by n.created_at desc limit 1`;
  return row!.id as string;
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).waitFor();
}

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
  receiver.post("/flaky", async (_req, reply) => (down ? reply.status(503).send("unreachable") : reply.send("ok")));
  receiverUrl = await listen(receiver);
  const allow = await app.inject({
    method: "PUT", url: `/api/v1/jurisdictions/${jurisdictionId}/notification-allowlist`, headers: auth(token),
    payload: { entries: [receiverUrl] },
  });
  expect(allow.statusCode, allow.body).toBe(200);
  const rule = await app.inject({
    method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/notification-rules`, headers: auth(token),
    payload: { boardId, event: "record.created", channels: [{ kind: "webhook", url: `${receiverUrl}/flaky` }] },
  });
  expect(rule.statusCode, rule.body).toBe(201);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await receiver?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("the delivery hold on screen", () => {
  for (const [index, viewport] of VIEWPORTS.entries()) {
    it(`sets a window, then resends an expired delivery that goes out, at ${viewport.width} by ${viewport.height}`, async () => {
      const noteId = await expiredDelivery(`outage ${index}`);
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        externalRequests.push(url);
        return route.abort();
      });
      await signIn(page);

      // Channels: how long webhooks wait for a route.
      const hours = index === 0 ? 12 : 24;
      await page.getByRole("button", { name: "Administration", exact: true }).click();
      await page.getByRole("tab", { name: "Channels" }).click();
      const panel = page.getByRole("list", { name: "How long messages wait for a route" });
      await panel.waitFor();
      await page.getByLabel("Webhooks: hours to wait").fill(String(hours));
      await page.getByRole("button", { name: "Save webhooks window" }).click();
      await page.getByText(`Webhooks now waits up to ${hours} hours for a route.`).waitFor();
      await panel.getByText(`Set to ${hours} hours`).waitFor();
      const [hold] = await admin`select hold_hours from delivery_hold_windows where kind = 'webhook'`;
      expect(hold!.hold_hours).toBe(hours);
      await page.screenshot({ path: join(SHOTS, `channels-hold-${viewport.width}.png`) });

      // The expired delivery says why, and an administrator resends it.
      await page.goto(`${baseUrl}/app/index.html#/alerts/${noteId}`, { waitUntil: "load" });
      const detail = page.locator(".notification-detail");
      await detail.waitFor();
      await detail.getByText("Expired, not sent: no route by", { exact: false }).waitFor();
      await detail.getByText("Last error: target responded 503", { exact: false }).waitFor();
      await page.screenshot({ path: join(SHOTS, `expired-${viewport.width}.png`) });
      await detail.getByRole("button", { name: "Resend" }).click();
      await detail.locator("dd").filter({ hasText: /^Queued$/ }).waitFor();
      const [queued] = await admin`
        select d.status, d.resent_from is not null as resent from delivery_outbox d
        where d.notification_id = ${noteId} order by d.created_at desc limit 1`;
      expect(queued).toMatchObject({ status: "pending", resent: true });

      // The target answers again; the resent delivery goes out.
      down = false;
      expect(await new DeliveryWorker(runtime, { baseDelayMs: 0 }).drain()).toMatchObject({ delivered: 1 });
      await page.reload({ waitUntil: "load" });
      await page.locator(".notification-detail").locator("dd").filter({ hasText: /^Delivered$/ }).waitFor();
      await page.screenshot({ path: join(SHOTS, `delivered-${viewport.width}.png`) });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    });
  }
});
