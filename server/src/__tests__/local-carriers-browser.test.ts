import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { readDueSmsReplies } from "../contacts/carriers.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";
import { fixtureGateway, type FixtureGateway } from "./sms-gateway-fixture.js";

/**
 * Local carriers on screen (AG-05), at the frames' 1586 by 992 and at 1534
 * by 790: an administrator points the SMS channel at a gateway on the site
 * network (the fixture phone), a member sends a question by text, two
 * recipients answer by reply and the receipts count their answers, the third
 * is reached by voice from the printed call-down sheet and entered back, and
 * a stray text shows under Administration after reading replies now.
 */

const DIST = buildDir("local-carriers");
const SHOTS = shotDir("local-carriers");
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let seed: SeedResult;
let gateway: FixtureGateway;
let priorKey: string | undefined;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function signIn(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).waitFor();
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-carrier-key";
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  gateway = await fixtureGateway();
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  const token = await login(app);
  const ids: string[] = [];
  for (const [name, phone] of [["Avery First", "+17075550101"], ["Bailey Second", "+17075550102"], ["Cameron Third", "+17075550103"]]) {
    ids.push((await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/contacts`, { name, phones: [phone] })).id as string);
  }
  await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/contact-groups`, { name: "Duty officers", contactIds: ids });
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
  await browser?.close();
  await gateway?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("local carriers on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`texts through the site's gateway, reads the replies and enters the call-down sheet, at ${viewport.width} by ${viewport.height}`, async () => {
      const subject = `Levee watch ${viewport.width}`;
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

      // The SMS channel goes through the phone on the site network.
      await page.getByRole("button", { name: "Administration", exact: true }).click();
      await page.getByRole("tab", { name: "Channels" }).click();
      const sms = page.getByRole("region", { name: "SMS", exact: true });
      await sms.getByLabel("SMS provider").selectOption("gateway");
      await sms.getByLabel("Gateway address").fill(gateway.url);
      await sms.getByLabel("Gateway user name").fill(gateway.username);
      await sms.getByLabel("Gateway password").fill(gateway.password);
      await sms.getByRole("button", { name: "Save SMS settings" }).click();
      await sms.getByText("SMS settings saved.").waitFor();
      await sms.getByText(/Stored password fingerprint/).waitFor();
      await sms.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `gateway-${viewport.width}.png`) });

      // A question by text to the duty officers.
      await page.getByRole("button", { name: "Mass Notification", exact: true }).click();
      await page.getByLabel("Subject").fill(subject);
      await page.getByLabel("Message", { exact: true }).fill("Seepage at mile 4. Can you staff the levee tonight?");
      await page.getByLabel("Answers to ask for (optional), one per line, up to six").fill("Available\nNot available");
      await page.getByRole("checkbox", { name: "Duty officers (3)" }).check();
      await page.getByRole("group", { name: "Channels" }).getByRole("checkbox", { name: "Email" }).uncheck();
      await page.getByRole("button", { name: "Send notification" }).click();
      await page.getByText(`${subject} sent.`).waitFor();
      await new DeliveryWorker(runtime, { timeoutMs: 3000 }).drain();
      const texts = gateway.sent.filter((t) => t.text.startsWith(`${subject}:`));
      expect(texts).toHaveLength(3);
      expect(texts[0]!.text).toContain("Reply 1 for Available or 2 for Not available, or answer at");

      // Two answer by reply; the scheduler's job reads them from the phone.
      gateway.reply("+17075550101", "1");
      gateway.reply("+17075550102", "Not available");
      expect(await readDueSmsReplies(runtime, { warn: () => undefined })).toBe(2);
      const receipts = page.getByRole("region", { name: `Receipts: ${subject}` });
      await receipts.getByRole("button", { name: "Refresh receipts" }).click();
      await receipts.getByRole("listitem", { name: "Receipt for Avery First" }).getByText(/Answered Available by text reply/).waitFor();
      await receipts.getByRole("listitem", { name: "Receipt for Bailey Second" }).getByText(/Answered Not available by text reply/).waitFor();
      await receipts.getByRole("list", { name: "Text replies from Avery First" }).getByText(/“1”/).waitFor();
      expect(await receipts.locator('dl[aria-label="Answers"] > div').allTextContents())
        .toEqual(["Available1", "Not available1", "No answer yet1"]);
      await receipts.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `replies-${viewport.width}.png`) });

      // Cameron is reached by voice from the printed sheet.
      await page.evaluate("window.printed = 0; window.print = () => { window.printed += 1; }");
      await receipts.getByRole("button", { name: "Print call-down sheet" }).click();
      expect(await page.evaluate("window.printed")).toBe(1);
      await page.emulateMedia({ media: "print" });
      const paper = page.locator(".contacts-sheet-print");
      await paper.getByRole("heading", { name: `Call-down sheet: ${subject}`, includeHidden: true }).waitFor();
      expect(await paper.locator("tbody tr").count()).toBe(3);
      expect(await paper.locator("tbody tr").nth(0).locator("td").nth(3).textContent()).toBe("Answered Available by text reply");
      expect(await page.getByRole("button", { name: "Send notification" }).isVisible()).toBe(false);
      await page.screenshot({ path: join(SHOTS, `sheet-print-${viewport.width}.png`), fullPage: true });
      await page.emulateMedia({ media: "screen" });

      const sheet = receipts.getByRole("group", { name: "Enter from the call-down sheet" });
      await sheet.getByRole("checkbox", { name: "Reached Cameron Third" }).check();
      const now = new Date();
      await sheet.getByLabel("Time Cameron Third was reached").fill(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
      await sheet.getByLabel("Answer from Cameron Third").selectOption("Available");
      await sheet.getByRole("button", { name: "Enter acknowledgements" }).click();
      await sheet.getByText("1 acknowledgement entered from the call-down sheet.").waitFor();
      await receipts.getByRole("listitem", { name: "Receipt for Cameron Third" }).getByText(/Answered Available from the call-down sheet/).waitFor();
      await receipts.getByText(/Sent · 3 of 3 acknowledged/).waitFor();
      await sheet.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `sheet-entered-${viewport.width}.png`) });
      const [cameron] = await admin`
        select r.acknowledged_via, r.response from mass_notification_recipients r
        join mass_notifications m on m.id = r.mass_notification_id
        where m.subject = ${subject} and r.name = 'Cameron Third'`;
      expect(cameron).toMatchObject({ acknowledged_via: "sheet", response: "Available" });

      // A stray text shows under Administration after reading the phone now.
      gateway.reply("+15550001111", `wrong number ${viewport.width}`);
      await page.getByRole("button", { name: "Administration", exact: true }).click();
      await page.getByRole("tab", { name: "Channels" }).click();
      await sms.getByRole("button", { name: "Read replies now" }).click();
      await sms.getByText("Read 1 new reply: 0 recorded, 0 not one of the answers, 1 with no send to the number.").waitFor();
      const stray = sms.getByRole("list", { name: "Replies read from the gateway" }).getByRole("listitem", { name: "Reply from +15550001111" }).first();
      await stray.getByText(`“wrong number ${viewport.width}”`).waitFor();
      await stray.getByText("No send to this number").waitFor();
      await sms.getByRole("list", { name: "Replies read from the gateway" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `replies-admin-${viewport.width}.png`) });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
