import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Workflow guards and per-state field permissions on screen (Veoci and air
 * gap VA15), at the frames' 1586 by 992 and at 1534 by 790: a member sees a
 * transition held back with the guard's reason, fills the field it needs,
 * takes the transition, and finds the field the new state locks read-only
 * in the edit form, with the reason.
 */

const DIST = buildDir("workflow-guards");
const SHOTS = shotDir("workflow-guards");
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;

const template = {
  key: "synthetic_damage_claims",
  version: 1,
  title: "Synthetic Damage Claims",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "amount", label: "Amount", type: "number" },
  ],
  views: [{ key: "all", title: "All claims", columns: ["summary", "amount"] }],
  workflow: {
    initialState: "draft",
    states: [
      { key: "draft", label: "Draft" },
      { key: "submitted", label: "Submitted", readOnlyFields: ["amount"] },
    ],
    transitions: [{
      key: "submit", label: "Submit claim", from: "draft", to: "submitted", allowedActors: ["writer"],
      guard: { conditions: [{ field: "amount", op: "gt", value: 0 }] },
    }],
  },
};

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let boardId: string;
let incidentId: string;
let memberToken: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const adminToken = await login(app);
  memberToken = await login(app, "member@example.org", "another-good-password");
  await post(app, adminToken, "/api/v1/templates", template);
  boardId = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey: template.key })).id as string;
  incidentId = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "daily_ops", name: "Culvert Claims Exercise",
  })).incidentId as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("workflow guards and read-only fields on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`holds a transition back until its guard holds and locks a field after it, at ${viewport.width} by ${viewport.height}`, async () => {
      const summary = `Culvert on Bald Hills Road ${viewport.width}`;
      const recordId = (await post(app, memberToken, `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`,
        { summary, amount: 0 })).id as string;
      const page = await browser.newPage({ viewport });
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        externalRequests.push(url);
        return route.abort();
      });
      await page.goto(`${baseUrl}/app/index.html#/board/${boardId}?incident=${incidentId}&view=all&record=${recordId}`);
      await page.getByLabel("Email").fill("member@example.org");
      await page.getByLabel("Password").fill("another-good-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("heading", { name: "Synthetic Damage Claims", exact: true }).waitFor();
      const openContext = page.getByRole("button", { name: "Open context" });
      if (await openContext.isVisible()) await openContext.click();
      const selected = page.getByRole("region", { name: "Selected record" });
      const workflow = selected.getByRole("region", { name: "Workflow" });
      const submit = workflow.getByRole("button", { name: "Submit claim" });
      await workflow.getByText("Not yet: Amount is more than 0").waitFor();
      expect(await submit.isDisabled()).toBe(true);
      await page.screenshot({ path: join(SHOTS, `guard-held-${viewport.width}.png`) });

      // Fill the amount; the guard now holds.
      await selected.getByRole("button", { name: "Edit record" }).click();
      const edit = page.getByRole("dialog", { name: "Edit Synthetic Damage Claims record" });
      await edit.getByRole("spinbutton", { name: "Amount" }).fill("48000");
      await edit.getByRole("button", { name: "Save changes" }).click();
      await edit.waitFor({ state: "hidden" });
      await workflow.getByText("Not yet: Amount is more than 0").waitFor({ state: "detached" });
      await submit.click();
      await workflow.getByText("Submitted", { exact: true }).waitFor();
      const [instance] = await admin`select state_key from board_workflow_instances where record_id = ${recordId}`;
      expect(instance!.state_key).toBe("submitted");

      // In Submitted, the amount is read-only; the summary is not.
      await page.reload();
      if (await openContext.isVisible()) await openContext.click();
      await selected.getByRole("button", { name: "Edit record" }).click();
      const locked = page.getByRole("dialog", { name: "Edit Synthetic Damage Claims record" });
      const amount = locked.getByRole("spinbutton", { name: "Amount" });
      await locked.getByText("Read-only while the record is Submitted.").waitFor();
      expect(await amount.isDisabled()).toBe(true);
      expect(await amount.inputValue()).toBe("48000");
      expect(await locked.getByRole("textbox", { name: /^Summary/ }).isDisabled()).toBe(false);
      await page.screenshot({ path: join(SHOTS, `read-only-${viewport.width}.png`) });
      await page.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
