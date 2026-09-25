import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("board-workflow-app");
const SHOTS = shotDir("board-workflow");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let memberPage: Page;
let adminPage: Page;
let baseUrl: string;
let boardId: string;
let incidentId: string;
let recordId: string;
let withdrawnId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

const template = {
  key: "synthetic_release_requests",
  version: 1,
  title: "Synthetic Release Requests",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "due_by", label: "Due by", type: "datetime" },
  ],
  views: [{ key: "all", title: "All requests", columns: ["summary", "due_by"] }],
  workflow: {
    initialState: "submitted",
    states: [
      { key: "submitted", label: "Submitted" },
      { key: "released", label: "Released to operations" },
      { key: "closed", label: "Closed", terminal: true },
    ],
    transitions: [
      {
        key: "release",
        label: "Release to operations",
        from: "submitted",
        to: "released",
        allowedActors: ["writer"],
        approvals: [{ key: "duty_officer", label: "Duty officer review", approver: { kind: "jurisdiction_admin" } }],
        due: { kind: "record_field", field: "due_by" },
        escalations: [{ key: "release_overdue", afterMinutes: 1 }],
      },
      { key: "close", label: "Close request", from: "released", to: "closed", allowedActors: ["writer"] },
    ],
  },
};

async function openPage(viewport = { width: 1440, height: 1000 }): Promise<Page> {
  const page = await browser.newPage({ viewport });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  return page;
}

async function signInToRecord(page: Page, email: string, password: string, record = recordId) {
  await page.goto(`${baseUrl}/app/index.html#/board/${boardId}?incident=${incidentId}&view=all&record=${record}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Synthetic Release Requests", exact: true }).waitFor();
  const openContext = page.getByRole("button", { name: "Open context" });
  if (await openContext.isVisible()) await openContext.click();
  return page.getByRole("region", { name: "Selected record" });
}

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
  const memberToken = await login(app, "member@example.org", "another-good-password");
  await post(app, adminToken, "/api/v1/templates", template);
  boardId = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, {
    templateKey: template.key,
  })).id as string;
  incidentId = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "daily_ops",
    name: "Synthetic Release Workflow Exercise",
  })).incidentId as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  // The member submits a request whose due time has already passed.
  recordId = (await post(app, memberToken, `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, {
    summary: "Generator fuel for the shelter",
    due_by: new Date(Date.now() - 60 * 60_000).toISOString(),
  })).id as string;
  withdrawnId = (await post(app, memberToken, `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, {
    summary: "Tarps for the fairgrounds",
  })).id as string;

  baseUrl = await listen(app);
  browser = await launchBrowser();
  memberPage = await openPage();
  adminPage = await openPage();
}, 120_000);

afterAll(async () => {
  await memberPage?.close();
  await adminPage?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("board record workflow", () => {
  it("requests, refuses self-approval, approves, flags overdue, escalates and keeps immutable history", async () => {
    const memberSelected = await signInToRecord(memberPage, "member@example.org", "another-good-password");
    const memberWorkflow = memberSelected.getByRole("region", { name: "Workflow" });
    await memberWorkflow.getByText("Submitted", { exact: true }).waitFor();
    expect(await memberWorkflow.textContent()).toContain("No workflow activity yet.");
    await memberWorkflow.getByRole("group", { name: "Available transitions" })
      .getByRole("button", { name: "Release to operations" }).click();
    const memberPending = memberWorkflow.getByRole("group", { name: "Awaiting approval" });
    await memberPending.waitFor();
    expect(await memberPending.textContent())
      .toContain("Duty officer review: 0 of 1 from Organization administrator");
    expect(await memberPending.textContent()).toContain("requested by Member");
    await memberPending.getByRole("button", { name: "Approve Duty officer review" }).click();
    await memberWorkflow.getByRole("alert").getByText("requester cannot approve this transition").waitFor();
    await memberWorkflow.scrollIntoViewIfNeeded();
    await memberPage.screenshot({ path: join(SHOTS, "board-workflow-member-pending-wide-light.png"), fullPage: false });

    const adminSelected = await signInToRecord(adminPage, "admin@example.org", "correct-horse-battery");
    const adminWorkflow = adminSelected.getByRole("region", { name: "Workflow" });
    const adminPending = adminWorkflow.getByRole("group", { name: "Awaiting approval" });
    await adminPending.waitFor();
    expect(await adminPending.textContent()).toContain("requested by Member");
    await adminPending.getByRole("button", { name: "Approve Duty officer review" }).click();
    await adminWorkflow.getByText("Released to operations", { exact: true }).waitFor();
    await adminWorkflow.getByText("Overdue", { exact: true }).waitFor();
    await adminWorkflow.getByText(/Release overdue, occurrence 1: scheduled for/).waitFor();
    expect(await adminWorkflow.getByRole("button", { name: "Escalate Release overdue" }).count()).toBe(0);

    // Move the completed transition two minutes into the past so its one-minute
    // escalation is due. History is append-only, so the guard is lifted only here.
    await admin`
      update board_workflow_instances set transitioned_at = transitioned_at - interval '2 minutes'
      where record_id = ${recordId}`;
    await admin`alter table board_workflow_history disable trigger board_workflow_history_immutable`;
    try {
      await admin`
        update board_workflow_history set created_at = created_at - interval '2 minutes'
        where record_id = ${recordId} and event_kind = 'transition_completed'`;
    } finally {
      await admin`alter table board_workflow_history enable trigger board_workflow_history_immutable`;
    }
    await adminPage.reload();
    const reloaded = adminPage.getByRole("region", { name: "Selected record" }).getByRole("region", { name: "Workflow" });
    await reloaded.getByRole("button", { name: "Escalate Release overdue" }).click();
    await reloaded.getByText(/Release overdue, occurrence 1: escalated/).waitFor();

    const history = reloaded.getByRole("list", { name: "Workflow history" });
    await expect.poll(() => history.getByRole("listitem").count()).toBe(4);
    const entries = await history.getByRole("listitem").allTextContents();
    expect(entries[0]).toContain("Member · Requested Release to operations: Submitted to Released to operations");
    expect(entries[1]).toContain("Admin · Approved Duty officer review for Release to operations");
    expect(entries[2]).toContain("Admin · Moved Submitted to Released to operations by Release to operations · Due");
    expect(entries[3]).toContain("Admin · Escalated Release overdue, occurrence 1 · Scheduled");
    expect(await history.locator("button, input, select, textarea, [contenteditable]").count()).toBe(0);
    await reloaded.getByRole("group", { name: "Available transitions" })
      .getByRole("button", { name: "Close request" }).waitFor();
    const [stored] = await admin`
      select count(*)::int as n from board_workflow_history where record_id = ${recordId}`;
    expect(stored!.n).toBe(4);

    await adminPage.getByRole("button", { name: "Account menu" }).click();
    await adminPage.getByRole("button", { name: "Use dark theme" }).click();
    await adminPage.getByRole("button", { name: "Account menu" }).click();
    await reloaded.scrollIntoViewIfNeeded();
    await adminPage.screenshot({ path: join(SHOTS, "board-workflow-admin-escalated-wide-dark.png"), fullPage: false });

    await adminPage.setViewportSize({ width: 390, height: 844 });
    await adminPage.evaluate(`(() => {
      const closeContext = document.querySelector('button[aria-label="Close context drawer"]');
      if (closeContext?.getClientRects().length) closeContext.click();
    })()`);
    await adminPage.getByRole("button", { name: "Open context" }).click();
    const drawer = adminPage.getByRole("dialog", { name: "Context" });
    const narrowWorkflow = drawer.getByRole("region", { name: "Workflow" });
    await narrowWorkflow.getByText("Overdue", { exact: true }).waitFor();
    await narrowWorkflow.scrollIntoViewIfNeeded();
    const geometry = await adminPage.evaluate(`({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    })`) as { documentWidth: number; viewportWidth: number };
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    await adminPage.screenshot({ path: join(SHOTS, "board-workflow-narrow-dark.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 180_000);

  it("rejects a request with a note, lets the requester cancel the next, and names each person", async () => {
    const member = await openPage({ width: 1586, height: 992 });
    const officer = await openPage({ width: 1534, height: 790 });
    try {
      const memberWorkflow = (await signInToRecord(member, "member@example.org", "another-good-password", withdrawnId))
        .getByRole("region", { name: "Workflow" });
      const release = () => memberWorkflow.getByRole("group", { name: "Available transitions" })
        .getByRole("button", { name: "Release to operations" }).click();
      await release();
      const memberPending = memberWorkflow.getByRole("group", { name: "Awaiting approval" });
      await memberPending.getByRole("button", { name: "Cancel request" }).waitFor();

      const officerWorkflow = (await signInToRecord(officer, "admin@example.org", "correct-horse-battery", withdrawnId))
        .getByRole("region", { name: "Workflow" });
      const officerPending = officerWorkflow.getByRole("group", { name: "Awaiting approval" });
      await officerPending.waitFor();
      expect(await officerPending.getByRole("button", { name: "Cancel request" }).count()).toBe(0);
      await officerPending.getByLabel("Note with a rejection or cancellation (optional)").fill("Needs a quantity first");
      await officerPending.getByRole("button", { name: "Reject request" }).click();
      await officerWorkflow.getByRole("list", { name: "Workflow history" })
        .getByText(/Admin · Rejected Release to operations; stays Submitted · Needs a quantity first/).waitFor();
      await officer.screenshot({ path: join(SHOTS, "board-workflow-rejected-1534.png"), fullPage: false });

      await member.reload();
      const reloaded = member.getByRole("region", { name: "Selected record" }).getByRole("region", { name: "Workflow" });
      const history = reloaded.getByRole("list", { name: "Workflow history" });
      await history.getByText(/Admin · Rejected Release to operations/).waitFor();
      await reloaded.getByRole("group", { name: "Available transitions" })
        .getByRole("button", { name: "Release to operations" }).click();
      await reloaded.getByRole("group", { name: "Awaiting approval" }).getByRole("button", { name: "Cancel request" }).click();
      await history.getByText(/Member · Cancelled the request for Release to operations; stays Submitted/).waitFor();
      await reloaded.getByText("Submitted", { exact: true }).waitFor();
      expect(await reloaded.getByRole("group", { name: "Awaiting approval" }).count()).toBe(0);
      await member.screenshot({ path: join(SHOTS, "board-workflow-cancelled-1586.png"), fullPage: false });

      const kinds = await admin`
        select event_kind from board_workflow_history where record_id = ${withdrawnId} order by sequence`;
      expect(kinds.map((row) => row.event_kind)).toEqual([
        "transition_requested", "transition_rejected", "transition_requested", "transition_cancelled",
      ]);
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    } finally {
      await member.close();
      await officer.close();
    }
  }, 180_000);
});
