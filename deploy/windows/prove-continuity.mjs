import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const root = process.cwd();
const out = resolve(root, "deploy/test-runtime/out/85-proof");
mkdirSync(out, { recursive: true });
const profileRoot = resolve(root, "deploy/windows/out/profiles/acceptance");
const config = JSON.parse(readFileSync(join(profileRoot, "profile.json"), "utf8"));
const fixture = JSON.parse(readFileSync(join(profileRoot, "bootstrap.json"), "utf8"));
const requireServer = createRequire(resolve(root, "server/package.json"));
const postgres = requireServer("postgres");
const { chromium } = requireServer("playwright-core");
const password = readFileSync(join(profileRoot, "secrets/postgres.password"), "utf8").trim();
const db = postgres({ host: "127.0.0.1", port: config.pgPort, username: "postgres", password, database: config.database });
const base = "http://127.0.0.1:" + config.httpPort;
const checkpoint = join(out, "result.json");
if (process.argv[2] === "restart") {
  const prior = JSON.parse(readFileSync(checkpoint, "utf8"));
  const records = await db.unsafe("select id from board_records where id = $1", [prior.recordId]);
  const conflicts = await db.unsafe("select id from sync_conflicts where record_id = $1", [prior.conflictRecordId]);
  assert.equal(records.length, 1);
  assert.equal(conflicts.length, 1);
  const [task] = await db.unsafe("select status, completed_by from checklist_items where id = $1", [prior.taskId]);
  assert.equal(task.status, "completed");
  assert.equal(task.completed_by, prior.taskAttributedTo);
  prior.restartPreserved = true;
  writeFileSync(checkpoint, JSON.stringify(prior, null, 2));
  await db.end();
  console.log("85-PROOF restart preserved exact field record, conflict and attributed task completion.");
  process.exit(0);
}
const { build } = await import(pathToFileURL(resolve(root, "web/node_modules/vite/dist/node/index.js")).href);
const bundleRoot = join(out, "queue-bundle");
await build({ configFile: false, root: resolve(root, "web"), publicDir: false, logLevel: "silent",
  build: { outDir: bundleRoot, emptyOutDir: true,
    lib: { entry: resolve(root, "web/src/field/field-submissions.ts"), name: "ContinuityProof", formats: ["iife"], fileName: "queue" } } });
const bundle = readFileSync(join(bundleRoot, readdirSync(bundleRoot).find((name) => name.endsWith(".js"))), "utf8");
const [board] = await db.unsafe("select b.id from boards b join incident_boards ib on ib.board_id = b.id where ib.incident_id = $1 and b.template_key = 'field_reports' limit 1", [fixture.incidentId]);
assert.ok(board, "Cold setup must seed a usable field report board.");
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--disable-background-networking", "--disable-component-update", "--disable-default-apps"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const external = [];
const errors = [];
await context.route("**/*", async (route) => {
  const url = route.request().url();
  if (url === base + "/continuity-proof.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
  if (url.startsWith(base + "/") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
  external.push(url);
  return route.abort();
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(base, { waitUntil: "load" });
  await page.getByLabel("Email").fill("demo-admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Selected incident").selectOption(fixture.incidentId);
  await page.getByRole("button", { name: "Smart Forms", exact: true }).click();
  const form = page.getByRole("form", { name: "Field report form" });
  await form.waitFor();
  await context.setOffline(true);
  await form.getByLabel("Summary", { exact: false }).fill("SYNTHETIC cold setup offline report");
  await form.getByLabel("Category", { exact: false }).selectOption("hazard");
  await form.getByRole("button", { name: "Queue field report" }).click();
  await page.getByText(/durably queued on this device/i).waitFor();
  await context.setOffline(false);
  await page.reload({ waitUntil: "load" });
  const panel = page.getByRole("region", { name: "Offline continuity" });
  await panel.getByText("1 board draft saved locally.").waitFor();
  await panel.getByRole("button", { name: "Reconnect and reconcile" }).click();
  await panel.locator("header").getByText("No queued work", { exact: true }).waitFor();
  await page.getByText("Ready for a durable field submission.").waitFor();
  const [record] = await db.unsafe("select id, created_by from board_records where board_id = $1 and incident_id = $2 and data->>'summary' = $3", [board.id, fixture.incidentId, "SYNTHETIC cold setup offline report"]);
  assert.ok(record);
  assert.equal(record.created_by, fixture.adminId);
  const before = await db.unsafe("select count(*)::int as n from sync_updates where board_id = $1", [board.id]);
  await panel.getByRole("button", { name: "Reconnect and reconcile" }).click();
  await panel.locator("header").getByText("No queued work", { exact: true }).waitFor();
  const after = await db.unsafe("select count(*)::int as n from sync_updates where board_id = $1", [board.id]);
  assert.equal(after[0].n, before[0].n, "Reconciliation must not duplicate accepted work.");
  // Inject malformed data through the existing queue seam to exercise retained
  // server conflicts in the finished Console, without weakening form validation.
  await page.addScriptTag({ url: base + "/continuity-proof.js" });
  const conflictRecordId = await page.evaluate(async ({ personId, incidentId, boardId }) => {
    const queue = await globalThis.ContinuityProof.FieldSubmissionQueue.open();
    const id = globalThis.crypto.randomUUID();
    await queue.enqueue({ personId, incidentId }, boardId, id,
      { summary: "SYNTHETIC rejected field category", category: "invalid-category" });
    queue.close();
    return id;
  }, { personId: fixture.adminId, incidentId: fixture.incidentId, boardId: board.id });
  await panel.getByText("1 board draft saved locally.").waitFor();
  await panel.getByRole("button", { name: "Reconnect and reconcile" }).click();
  await panel.locator("header").getByText("Resolution required", { exact: true }).waitFor();
  const [conflict] = await db.unsafe("select origin_person from sync_conflicts where record_id = $1", [conflictRecordId]);
  assert.equal(conflict.origin_person, fixture.adminId);
  await page.reload({ waitUntil: "load" });
  await panel.locator("header").getByText("Resolution required", { exact: true }).waitFor();
  await page.screenshot({ path: join(out, "continuity-conflict-light.png"), fullPage: false });
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open context", exact: true }).click();
  await panel.locator("header").getByText("Resolution required", { exact: true }).waitFor();
  assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
  await page.screenshot({ path: join(out, "continuity-conflict-dark-390.png"), fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill("demo-operator@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Selected incident").selectOption(fixture.incidentId);
  const [task] = await db.unsafe("select c.id, c.item, c.position_id from checklist_items c join positions p on p.id = c.position_id where c.incident_id = $1 and p.key = 'operations_section_chief' and c.status = 'in_progress' limit 1", [fixture.incidentId]);
  assert.ok(task, "Cold setup provides assigned operational work.");
  await page.getByLabel("Acting position").selectOption(task.position_id);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  const taskRow = page.getByRole("row").filter({ hasText: task.item });
  await taskRow.getByRole("button", { name: "Complete", exact: true }).waitFor();
  await context.setOffline(true);
  await taskRow.getByRole("button", { name: "Complete", exact: true }).click();
  await page.getByText("1 completion queued locally.", { exact: false }).waitFor();
  await context.setOffline(false);
  await page.getByText("1 completion queued locally.", { exact: false }).waitFor({ state: "hidden" });
  const [completed] = await db.unsafe("select status, completed_by, completed_by_position from checklist_items where id = $1", [task.id]);
  assert.equal(completed.status, "completed");
  assert.equal(completed.completed_by, fixture.memberId);
  assert.equal(completed.completed_by_position, task.position_id);
  await page.screenshot({ path: join(out, "task-reconciled-dark.png"), fullPage: false });
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  const result = { status: "passed", incidentId: fixture.incidentId, boardId: board.id, recordId: record.id,
    conflictRecordId, taskId: task.id, taskAttributedTo: completed.completed_by,
    attributedTo: fixture.adminId, exactOnce: true, conflictRetained: true,
    externalRequests: external.length, pageErrors: errors.length, verifiedAt: new Date().toISOString() };
  writeFileSync(checkpoint, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await db.end();
}
