import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Locator, Page, Route } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { hotp, totpStep } from "../auth/totp.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir, WEB_DIR } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";

/**
 * The integrated visual and accessibility review in a real browser. One
 * bounded set of representative screens (sign-in with two-step verification,
 * the console shell and navigation, Map, Overview, a board with record detail
 * and the record form, Resources, Incident Setup with the master view, Reports,
 * Mass Notification, Smart Forms capture, Administration and the update
 * notice) opens in the light and dark themes at 1440 and 390 pixels wide. Every
 * view runs axe from the installed axe-core with no serious or critical
 * violation and shows no sideways page scroll on a phone. By keyboard every
 * view reaches its named controls and every stop in its workspace, each stop
 * shows a focus ring of at least 3:1 and nothing traps focus; each view also
 * fits 720 pixels, the width of 1440 at 200 percent zoom. Long names, a
 * 500-row board, a server refusal, a lost network, empty lists, a slow load
 * and a form that fails to load are exercised, and the shell holds still on a
 * route change. Reduced motion and a higher-contrast preference close it.
 */

const DIST = buildDir("review-app");
const SHOTS = shotDir("review");
const AXE_SOURCE = readFileSync(join(WEB_DIR, "node_modules", "axe-core", "axe.min.js"), "utf8");
const WIDE = { width: 1440, height: 900 };
const ZOOMED = { width: 720, height: 900 };
const NARROW = { width: 390, height: 844 };

const LONG_INCIDENT = "Valley Complex Fire and Debris Flow Response for the North Coast Watershed Communities";
const LONG_BOARD = "Logistics staging and resource movement log for the combined north and south operational branches";
const LONG_TITLE = "Evacuation route closure at the Klamath River bridge approach pending a structural inspection by the county engineer and Caltrans District 1 after the overnight debris flow";
const LONG_TOKEN = "REF-2026-0924-KLAMATH-RIVER-BRIDGE-APPROACH-STRUCTURAL-INSPECTION-PENDING";
const LONG_MESSAGE = "Evacuation warning for the Klamath River corridor from the Highway 101 bridge to Weitchpec. "
  + "Residents in zones KR-4 through KR-9 should prepare to leave now, take medications, documents and pets, and follow "
  + "the posted detour through Bald Hills Road. Shelter is open at the Klamath Community Center and the Hoopa Neighborhood "
  + "Facility. Updates: https://example.org/alerts/klamath-river-corridor-evacuation-warning-2026-09-24-zone-kr-4-through-kr-9";
const NO_CONNECTION = "No connection to the server. Check the network connection and try again.";

const reviewLog = {
  key: "review_log",
  version: 1,
  title: "Review Log",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "status", label: "Status", type: "enum", values: ["open", "closed"], required: true },
    { key: "reference", label: "Reference", type: "text" },
  ],
  views: [{ key: "all", title: "All entries", columns: ["summary", "status", "reference"] }],
};

type Theme = "light" | "dark";
interface FocusProbe {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  readonly indicator: "none" | "outline" | "shadow";
  readonly ring: number | null;
  readonly detail: string;
}
interface Review {
  readonly view: string;
  readonly theme: Theme;
  readonly width: number;
  readonly serious: string[];
  readonly moderate: string[];
  readonly sideways: boolean;
  readonly animations: string[];
}
interface Walk {
  readonly view: string;
  readonly stops: number;
  readonly missing: string[];
  readonly unseen: string[];
  readonly weak: string[];
  readonly trap: string | null;
}

let admin: Sql;
let runtime: Sql;
let seeder: FastifyInstance;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let seed: SeedResult;
let incidentA: string;
let logBoard: string;
let firstRecord: string;
let roadsA: string;
let roadsB: string;
const reviews: Review[] = [];
const walks: Walk[] = [];
const zoomedSideways: string[] = [];
const shellBoxes: Record<string, string[]> = {};
const pageErrors: string[] = [];
const externalRequests: string[] = [];

/** What the keyboard is on: its name, the focus indicator and the ring's contrast with what surrounds it. */
const FOCUS_PROBE = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const parse = (value) => {
    const rgb = /rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/.exec(value);
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
    const srgb = /color\\(srgb\\s+([-\\d.e]+)\\s+([-\\d.e]+)\\s+([-\\d.e]+)(?:\\s*\\/\\s*([\\d.]+))?\\)/.exec(value);
    if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] === undefined ? 1 : Number(srgb[4])];
    return null;
  };
  const luminance = (color) => {
    const [r, g, b] = color.slice(0, 3).map((value) => {
      const c = Math.min(255, Math.max(0, value)) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  const backdrop = (start) => {
    for (let node = start; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color && color[3] >= 0.5) return color;
    }
    return [255, 255, 255, 1];
  };
  const style = getComputedStyle(el);
  const outlined = style.outlineStyle !== "none" && (parseFloat(style.outlineWidth) || 0) > 0;
  // The browser's own "auto" ring is two-toned for any background, so only a styled ring is measured.
  const ringColor = outlined && style.outlineStyle !== "auto" ? parse(style.outlineColor) : null;
  const behind = backdrop(parseFloat(style.outlineOffset) < 0 ? el : el.parentElement);
  const text = (value) => (value || "").replace(/\\s+/g, " ").trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  const name = text(el.getAttribute("aria-label"))
    || (labelledBy ? text(labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ")) : "")
    || text(el.labels && el.labels[0] ? el.labels[0].textContent : "")
    || text(el.textContent) || text(el.getAttribute("title")) || text(el.getAttribute("placeholder"));
  if (!el.dataset.reviewStop) {
    window.__reviewStops = (window.__reviewStops || 0) + 1;
    el.dataset.reviewStop = String(window.__reviewStops);
  }
  return {
    id: el.dataset.reviewStop,
    name: name.slice(0, 160),
    tag: el.tagName.toLowerCase(),
    indicator: outlined ? "outline" : style.boxShadow !== "none" ? "shadow" : "none",
    ring: ringColor ? Math.round(ratio(ringColor, behind) * 100) / 100 : null,
    detail: style.outlineStyle + " " + style.outlineWidth + " " + style.outlineColor + " on rgb(" + behind.slice(0, 3).join(", ") + ")",
  };
})()`;

/** The visible, enabled keyboard stops under a root, as stop ids (or a name for one the walk never reached). */
function tabStops(root: string): string {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(root)});
    if (!root) return [];
    const selector = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]';
    return [...root.querySelectorAll(selector)].filter((el) => {
      if (el.getAttribute("tabindex") === "-1") return false;
      if (el.closest("[inert], [hidden], [aria-hidden='true']")) return false;
      const details = el.parentElement?.closest("details");
      if (details && !details.open && !el.closest("summary")) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
    }).map((el) => el.dataset.reviewStop ?? "never reached: " + ((el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).replace(/\\s+/g, " ").trim().slice(0, 60)));
  })()`;
}

const SIDEWAYS = "document.documentElement.scrollWidth > document.documentElement.clientWidth";
/** Animations and transitions still running; the kit spinner only slows. */
const RUNNING = `document.getAnimations()
  .filter((a) => a.playState === "running" && Number(a.effect?.getTiming().duration ?? 0) > 1
    && !a.effect?.target?.classList?.contains("eoc-kit-spinner"))
  .map((a) => (a.animationName || a.transitionProperty || "animation") + " on " + (a.effect?.target?.className || a.effect?.target?.tagName))`;

async function runAxe(): Promise<{ serious: string[]; moderate: string[] }> {
  if (!(await page.evaluate("typeof window.axe === 'object'"))) await page.evaluate(AXE_SOURCE);
  const violations = await page.evaluate(`axe.run(document, { resultTypes: ["violations"] }).then((result) =>
    result.violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length,
      targets: v.nodes.slice(0, 4).map((n) => n.target.join(" ") + (n.any[0]?.data?.contrastRatio
        ? " " + n.any[0].data.fgColor + " on " + n.any[0].data.bgColor + " " + n.any[0].data.contrastRatio : "")) })))`) as
    Array<{ id: string; impact: string; targets: string[]; count: number }>;
  const line = (v: { id: string; count: number; targets: string[] }) => `${v.id} x${v.count}: ${v.targets.join(" | ")}`;
  return {
    serious: violations.filter((v) => v.impact === "serious" || v.impact === "critical").map(line),
    moderate: violations.filter((v) => v.impact !== "serious" && v.impact !== "critical").map(line),
  };
}

/** Settle fonts and two frames so the page is drawn before it is measured. */
async function settle(): Promise<void> {
  await page.evaluate("document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
}

async function review(view: string, theme: Theme, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await settle();
  const sideways = await page.evaluate(SIDEWAYS) as boolean;
  const animations = await page.evaluate(RUNNING) as string[];
  const { serious, moderate } = await runAxe();
  reviews.push({ view, theme, width: size.width, serious, moderate, sideways, animations });
  await page.screenshot({ path: join(SHOTS, `review-${view}-${theme}-${size.width}.png`), fullPage: false });
}

/**
 * Tab through a view from its first stop and record each stop, its ring,
 * whether the named controls came up, whether every stop under `root` was
 * reached and whether focus stuck. The walk starts at the skip link: it
 * clicks the product name and steps back by keyboard. Inside a modal dialog
 * it starts from the dialog's heading instead.
 */
async function tabWalk(view: string, reach: readonly string[], options: { start?: Locator; root?: string } = {}): Promise<Walk> {
  await page.setViewportSize(WIDE);
  await settle();
  if (options.start) {
    await options.start.click();
    await page.keyboard.press("Tab");
  } else {
    await page.locator(".eoc-shell-brand strong").click();
    await page.keyboard.press("Shift+Tab");
  }
  const stops = new Map<string, FocusProbe>();
  let previous = "";
  let repeats = 0;
  let trap: string | null = null;
  for (let step = 0; step < 200; step += 1) {
    const probe = await page.evaluate(FOCUS_PROBE) as FocusProbe | null;
    if (!probe) break;
    if (probe.id === previous) {
      repeats += 1;
      // A native date or time field takes one Tab per segment (month, day,
      // year, hour, minute, day period) before focus leaves it.
      const segmented = await page.evaluate(`(() => {
        const active = document.activeElement;
        return active instanceof HTMLInputElement && ["date", "time", "datetime-local", "month", "week"].includes(active.type);
      })()`) as boolean;
      if (repeats >= (segmented ? 7 : 2)) {
        trap = probe.name;
        break;
      }
    } else repeats = 0;
    previous = probe.id;
    stops.set(probe.id, probe);
    await page.keyboard.press("Tab");
  }
  const reached = [...stops.values()];
  const all = await page.evaluate(tabStops(options.root ?? "main")) as string[];
  const walk: Walk = {
    view,
    stops: reached.length,
    missing: reach.filter((name) => !reached.some((stop) => stop.name.includes(name))),
    unseen: all.filter((id) => !stops.has(id)),
    weak: reached.filter((stop) => stop.indicator === "none" || (stop.ring !== null && stop.ring < 3))
      .map((stop) => `${stop.tag} "${stop.name}": ${stop.ring ?? "no ring"} (${stop.detail})`),
    trap,
  };
  walks.push(walk);
  return walk;
}

function rail(name: string): Promise<void> {
  return page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true }).click();
}

/** Open or close the account menu, whatever state a re-render left it in. */
async function accountMenu(open: boolean): Promise<void> {
  const menu = page.locator("details.eoc-shell-account");
  if (await menu.evaluate((node) => (node as unknown as { open: boolean }).open) !== open) {
    await page.getByRole("button", { name: "Account menu" }).click();
  }
}

async function setTheme(theme: Theme): Promise<void> {
  await page.setViewportSize(WIDE);
  await accountMenu(true);
  const toggle = page.getByRole("button", { name: theme === "dark" ? "Use dark theme" : "Use light theme" });
  if (await toggle.isVisible()) await toggle.click();
  await page.locator(`.eoc-theme[data-theme="${theme}"]`).waitFor();
  await accountMenu(false);
}

/** Open the context drawer where the layout keeps it closed. */
async function openContext(): Promise<void> {
  const opener = page.getByRole("button", { name: "Open context" });
  if (await opener.isVisible()) await opener.click();
}

async function closeModalContext(): Promise<void> {
  const close = page.getByRole("dialog", { name: "Context" }).getByRole("button", { name: "Close context drawer" });
  if (await close.isVisible()) await close.click();
}

interface View {
  readonly key: string;
  readonly open: () => Promise<void>;
  readonly ready: () => Promise<void>;
  readonly reach: readonly string[];
  readonly narrow?: () => Promise<void>;
  readonly leave?: () => Promise<void>;
  readonly start?: () => Locator;
  readonly root?: string;
}

const boardHash = () => `#/board/${logBoard}?incident=${incidentA}&view=all`;
const recordDialog = () => page.getByRole("dialog", { name: `New ${LONG_BOARD} record` });
const goToBoard = async () => { await page.evaluate(`location.hash = ${JSON.stringify(boardHash())}`); };

const views: readonly View[] = [
  {
    key: "map", open: () => rail("Map"),
    ready: async () => { await page.getByTestId("cop-map").waitFor(); await page.getByText("· common operating picture").waitFor(); },
    reach: ["Skip to workspace", "Selected incident", "Account menu", "Overview", "Add point"],
  },
  {
    key: "overview", open: () => rail("Dashboards"),
    ready: () => page.getByText("Closed roads").first().waitFor(),
    reach: ["Create saved view"],
  },
  {
    key: "boards", open: () => rail("Boards"),
    ready: () => page.getByRole("main").getByText(LONG_BOARD).waitFor(),
    reach: [`Open ${LONG_BOARD}`],
  },
  {
    key: "board", open: goToBoard,
    ready: () => page.getByRole("main").getByText(LONG_TITLE).first().waitFor(),
    reach: ["New record", "Filter Summary"],
  },
  {
    key: "record",
    open: async () => {
      await goToBoard();
      await page.getByRole("main").getByText(LONG_TITLE).first().waitFor();
      const box = page.getByLabel(`Select record ${firstRecord}`);
      if (!await box.isChecked()) await box.click();
      await page.waitForURL((url) => url.hash.includes(`record=${firstRecord}`));
      await openContext();
    },
    ready: async () => {
      const selected = page.getByRole("region", { name: "Selected record" });
      await selected.getByText(LONG_TOKEN).first().waitFor();
      await selected.evaluate((node) => (node as unknown as { scrollIntoView(): void }).scrollIntoView());
    },
    narrow: openContext,
    leave: closeModalContext,
    reach: ["Edit record", "Files for this record"],
  },
  {
    key: "record-form",
    open: async () => {
      await goToBoard();
      await page.getByRole("button", { name: "New record", exact: true }).click();
    },
    // The form is reviewed settled: its reference options loaded and Save enabled.
    ready: async () => {
      await recordDialog().getByLabel(/^Summary/).waitFor();
      await expect.poll(() => recordDialog().getByRole("button", { name: "Save record" }).isEnabled()).toBe(true);
    },
    leave: async () => { await page.keyboard.press("Escape"); await recordDialog().waitFor({ state: "hidden" }); },
    start: () => recordDialog().getByRole("heading").first(),
    root: '[role="dialog"]',
    reach: ["Summary", "Save record"],
  },
  {
    key: "resources", open: () => rail("Resources"),
    ready: () => page.getByRole("heading", { name: "Resource coordination" }).waitFor(),
    reach: ["Requested item", "Submit request"],
  },
  {
    key: "incident-setup", open: () => rail("Incident Setup"),
    ready: () => page.getByText("Incidents in this jurisdiction").first().waitFor(),
    reach: ["Incident name", "Activate"],
  },
  {
    key: "reports", open: () => rail("Reports"),
    ready: () => page.getByText("No reports yet.").waitFor(),
    reach: ["New report"],
  },
  {
    key: "mass-notification",
    open: async () => {
      await rail("Mass Notification");
      await page.getByLabel("Message", { exact: true }).fill(LONG_MESSAGE);
    },
    ready: () => page.getByLabel("Subject").waitFor(),
    reach: ["Subject", "Send notification"],
  },
  {
    key: "smart-forms", open: () => rail("Smart Forms"),
    ready: () => page.getByRole("region", { name: "Field report capture" }).waitFor(),
    reach: ["Queue field report"],
  },
  {
    key: "administration", open: () => rail("Administration"),
    ready: () => page.getByRole("heading", { name: "Administration", level: 2, exact: true }).waitFor(),
    reach: ["Add person"],
  },
];

const box = (selector: string) => page.evaluate(`(() => {
  const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
  return r ? [r.x, r.y, r.width, r.height].map(Math.round).join(",") : "missing";
})()`) as Promise<string>;

/** Every view in one theme, wide and as a phone; in the light theme also by keyboard, at 720 and for shell stability. */
async function pass(theme: Theme): Promise<void> {
  for (const view of views) {
    await page.setViewportSize(WIDE);
    await view.open();
    await view.ready();
    await review(view.key, theme, WIDE);
    if (theme === "light") {
      // The page header's width follows the context drawer, a saved per-layout preference; its height does not move.
      shellBoxes[view.key] = [await box(".eoc-shell-command"), await box(".eoc-shell-rail"),
        (await box(".eoc-shell-page-header")).split(",").filter((_, index) => index !== 2).join(",")];
      await tabWalk(view.key, view.reach, {
        ...(view.start ? { start: view.start() } : {}), ...(view.root ? { root: view.root } : {}),
      });
      await view.ready();
      await page.setViewportSize(ZOOMED);
      await settle();
      if (await page.evaluate(SIDEWAYS)) zoomedSideways.push(view.key);
    }
    await page.setViewportSize(NARROW);
    await view.narrow?.();
    await view.ready();
    await review(view.key, theme, NARROW);
    await view.leave?.();
    await page.setViewportSize(WIDE);
  }
}

/** Milliseconds from pressing a map control to the camera's arrival, read off the readout it repaints on moveend. */
function cameraMove(label: string): Promise<number> {
  return page.evaluate(`(() => {
    const readout = document.querySelector('[data-testid="cop-readout"]');
    const button = [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute("aria-label") === ${JSON.stringify(label)});
    const started = performance.now();
    const arrived = new Promise((resolve) => {
      const observer = new MutationObserver(() => { observer.disconnect(); resolve(performance.now() - started); });
      observer.observe(readout, { childList: true, subtree: true, characterData: true });
    });
    button.click();
    return Promise.race([arrived, new Promise((resolve) => setTimeout(() => resolve(-1), 5000))]);
  })()`) as Promise<number>;
}

beforeAll(async () => {
  process.env.OPENEOC_SECRET_KEY ??= "test-only-review-browser-key";
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  await ensureStandardIncidentTemplates(admin);
  await admin`insert into board_templates (key, version, title, definition)
    values (${reviewLog.key}, 1, ${reviewLog.title}, ${admin.json(reviewLog as never)})`;
  // Seeding signs in without the second factor; the browser signs in with it.
  seeder = buildApp(runtime, { oidc: null, requireAdminMfa: false });
  app = buildApp(runtime, { oidc: null, requireAdminMfa: true });
  serveStatic(app, "/app", DIST);
  const token = await login(seeder);
  const j = seed.jurisdictionId;
  incidentA = (await post(seeder, token, `/api/v1/jurisdictions/${j}/incidents`, { templateKey: "wildfire", name: LONG_INCIDENT })).incidentId as string;
  const incidentB = (await post(seeder, token, `/api/v1/jurisdictions/${j}/incidents`, { templateKey: "wildfire", name: "Separate Flood" })).incidentId as string;
  const roads = await admin`
    select ib.incident_id, b.id from incident_boards ib join boards b on b.id = ib.board_id
    where b.template_key = 'road_closures' and ib.incident_id in (${incidentA}, ${incidentB})`;
  roadsA = roads.find((row) => row.incident_id === incidentA)!.id as string;
  roadsB = roads.find((row) => row.incident_id === incidentB)!.id as string;
  await post(seeder, token, `/api/v1/boards/${roadsA}/records?incidentId=${incidentA}`, {
    road: "Highway 169 at Klamath Glen", reason: "Debris flow across both lanes", status: "closed",
    location: { type: "Point", coordinates: [-123.98, 41.52] },
  });
  await post(seeder, token, `/api/v1/jurisdictions/${j}/dashboards`, { templateKey: "eoc_status" });

  logBoard = (await post(seeder, token, `/api/v1/jurisdictions/${j}/boards`, { templateKey: reviewLog.key, title: LONG_BOARD })).id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentA}, ${logBoard})`;
  for (let start = 1; start < 500; start += 25) {
    await Promise.all(Array.from({ length: Math.min(25, 500 - start) }, (_, offset) =>
      post(seeder, token, `/api/v1/boards/${logBoard}/records?incidentId=${incidentA}`,
        { summary: `Staging check ${String(start + offset).padStart(3, "0")}`, status: (start + offset) % 3 ? "open" : "closed" })));
  }
  // The long entry is the newest, so it heads the default view.
  firstRecord = (await post(seeder, token, `/api/v1/boards/${logBoard}/records?incidentId=${incidentA}`,
    { summary: LONG_TITLE, status: "open", reference: LONG_TOKEN })).id as string;

  const fieldBoard = (await post(seeder, token, `/api/v1/jurisdictions/${j}/boards`, { templateKey: "field_reports", title: "Field Reports" })).id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentA}, ${fieldBoard})`;
  await post(seeder, token, `/api/v1/jurisdictions/${j}/forms`, {
    key: "rapid_field_report", version: 1, title: "Rapid field report", boardTemplate: "field_reports",
    nodes: [
      { kind: "field", name: "summary", type: "text", label: "Summary", required: true },
      { kind: "field", name: "category", type: "select_one", label: "Category", required: true,
        choices: [{ name: "hazard", label: "Hazard" }, { name: "damage", label: "Damage" }] },
      { kind: "field", name: "location", type: "geopoint", label: "Location" },
    ],
  });
  await post(seeder, token, `/api/v1/jurisdictions/${j}/resource-requests`, {
    origin: "eoc", item: "Type 1 water tender for the Klamath Glen staging area and the Bald Hills Road detour", quantity: 2, incidentId: incidentA,
  });
  const sms = await seeder.inject({ method: "PUT", url: `/api/v1/jurisdictions/${j}/notification-channels/sms`,
    headers: auth(token), payload: { settings: { provider: "fixture" } } });
  expect(sms.statusCode, sms.body).toBe(200);

  baseUrl = await listen(app);
  browser = await launchBrowser();
  // Service workers stay off here so request routing sees every API call; the update notice has its own page.
  page = await browser.newPage({ viewport: WIDE, serviceWorkers: "block" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
}, 300_000);

afterAll(async () => {
  // The review document cites this record of every check, moderate axe results included.
  writeFileSync(join(SHOTS, "review-results.json"), JSON.stringify({ reviews, walks, zoomedSideways, shellBoxes, pageErrors, externalRequests }, null, 2));
  await page?.close();
  await browser?.close();
  await app?.close();
  await seeder?.close();
  await runtime?.end();
  await admin?.end();
});

describe("integrated visual and accessibility review", () => {
  it("signs in with two-step verification by keyboard, in both themes and at both widths", async () => {
    // The first sign-in, with enrollment and its setup link, runs in the dark theme this device saved.
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.evaluate("localStorage.setItem('openeoc.theme', 'dark')");
    await page.reload({ waitUntil: "load" });
    await page.getByLabel("Email").waitFor();
    await review("sign-in", "dark", WIDE);
    await review("sign-in", "dark", NARROW);
    await page.setViewportSize(WIDE);
    await page.keyboard.press("Tab");
    expect(await page.evaluate("document.activeElement?.id") === await page.getByLabel("Email").getAttribute("id")).toBe(true);
    await page.keyboard.type("admin@example.org");
    await page.keyboard.press("Tab");
    await page.keyboard.type("correct-horse-battery");
    await page.keyboard.press("Enter");
    const key = page.getByLabel("Setup key");
    await key.waitFor();
    const secret = ((await key.textContent()) ?? "").replace(/\s/g, "");
    await review("mfa-enroll", "dark", WIDE);
    await review("mfa-enroll", "dark", NARROW);
    await page.setViewportSize(WIDE);
    await page.getByLabel("Authenticator code").fill(hotp(secret, totpStep()));
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Save your recovery codes", level: 1 }).waitFor();
    await review("mfa-recovery", "dark", WIDE);
    await review("mfa-recovery", "dark", NARROW);
    await page.setViewportSize(WIDE);
    await page.getByRole("button", { name: "I have stored these codes" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();

    // The second sign-in runs in the light theme, which the console saved.
    await setTheme("light");
    await accountMenu(true);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Email").waitFor();
    await review("sign-in", "light", WIDE);
    await review("sign-in", "light", NARROW);
    await page.setViewportSize(WIDE);
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByLabel("Password").press("Enter");
    await page.getByRole("heading", { name: "Two-step sign-in", level: 1 }).waitFor();
    await review("mfa-verify", "light", WIDE);
    await review("mfa-verify", "light", NARROW);
    await page.setViewportSize(WIDE);
    await page.getByLabel("Authenticator or recovery code").fill(hotp(secret, totpStep() + 1));
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Account menu" }).waitFor();
  }, 180_000);

  it("reviews every representative view in both themes, at both widths and by keyboard", async () => {
    const selector = page.getByLabel("Selected incident");
    await selector.locator(`option[value="${incidentA}"]`).waitFor({ state: "attached" });
    await selector.selectOption(incidentA);
    await pass("light");
    await setTheme("dark");
    await pass("dark");
    await setTheme("light");

    const [firstShell, ...otherShells] = Object.values(shellBoxes);
    expect({
      axe: reviews.filter((r) => r.serious.length).map((r) => `${r.view} ${r.theme} ${r.width}: ${r.serious.join("; ")}`),
      sideways: reviews.filter((r) => r.sideways).map((r) => `${r.view} ${r.theme} ${r.width}`),
      motion: reviews.filter((r) => r.animations.length).map((r) => `${r.view} ${r.theme} ${r.width}: ${r.animations.join("; ")}`),
      keyboard: walks.filter((w) => w.missing.length || w.unseen.length || w.weak.length || w.trap)
        .map((w) => `${w.view}: missing ${w.missing.join("; ")} unseen ${w.unseen.join("; ")} weak ${w.weak.join("; ")} trap ${w.trap ?? ""}`),
      zoomed: zoomedSideways,
      shell: otherShells.filter((boxes) => boxes.join("|") !== firstShell!.join("|")),
    }).toEqual({ axe: [], sideways: [], motion: [], keyboard: [], zoomed: [], shell: [] });
    expect(reviews).toHaveLength(10 + views.length * 4);
  }, 900_000);

  it("keeps another incident's boards out of the dock, the board list and the map", async () => {
    await page.setViewportSize(WIDE);
    await rail("Map");
    await page.getByTestId("cop-map").waitFor();
    const titles = await admin`select id, title from boards where id in (${roadsA}, ${roadsB})`;
    const titleA = titles.find((row) => row.id === roadsA)!.title as string;
    const titleB = titles.find((row) => row.id === roadsB)!.title as string;
    await openContext();
    const dockBoards = page.getByRole("region", { name: "Boards", exact: true });
    await dockBoards.getByText(titleA, { exact: true }).waitFor();
    expect(await dockBoards.getByText(titleB, { exact: true }).count()).toBe(0);
    const layers = page.getByRole("navigation", { name: "Map layers" });
    await layers.getByText(titleA, { exact: true }).waitFor();
    expect(await layers.getByText(titleB, { exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Add point" }).click();
    const boardChoice = page.getByLabel("Map record board");
    await boardChoice.locator(`option[value="${roadsA}"]`).waitFor({ state: "attached" });
    expect(await boardChoice.locator(`option[value="${roadsB}"]`).count()).toBe(0);
    await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
    await rail("Boards");
    await page.getByRole("main").getByText(titleA, { exact: true }).waitFor();
    expect(await page.getByRole("main").getByText(titleB, { exact: true }).count()).toBe(0);
  }, 120_000);

  it("says why the map's record panel is empty when the board's form fails to load", async () => {
    await rail("Map");
    await page.getByTestId("cop-map").waitFor();
    const refuse = (route: Route) => route.fulfill({
      status: 500, contentType: "application/json", body: JSON.stringify({ error: "board definition unavailable" }),
    });
    const formUrl = (url: URL) => url.pathname === `/api/v1/boards/${roadsA}`;
    await page.route(formUrl, refuse);
    await page.getByRole("button", { name: "Add point" }).click();
    await page.getByLabel("Map record board").selectOption(roadsA);
    await page.getByLabel("Longitude").fill("-123.9");
    await page.getByLabel("Latitude").fill("41.5");
    await page.getByRole("button", { name: "Use coordinates" }).click();
    const panel = page.getByRole("region", { name: "New map record" });
    await panel.getByRole("alert").filter({ hasText: /could not be loaded: board definition unavailable$/ }).waitFor();
    await review("map-form-failure", "light", WIDE);
    await page.unroute(formUrl, refuse);
    await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
  }, 120_000);

  it("shows a server refusal, a lost network, an empty list and a slow load plainly", async () => {
    await page.setViewportSize(WIDE);
    const requests = "**/api/v1/jurisdictions/*/resource-requests?**";
    await page.route(requests, (route) => route.request().method() === "GET"
      ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "not permitted to read resource requests" }) })
      : route.continue());
    await rail("Resources");
    await page.getByRole("main").getByText("not permitted to read resource requests").waitFor();
    await review("resources-refused", "light", WIDE);
    await page.unroute(requests);

    await rail("Map");
    await page.getByTestId("cop-map").waitFor();
    await page.context().setOffline(true);
    await rail("Reports");
    await page.getByRole("main").getByText(NO_CONNECTION).waitFor();
    await review("reports-offline", "light", WIDE);
    await page.context().setOffline(false);

    await rail("Map");
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const reports = "**/api/v1/jurisdictions/*/reports**";
    await page.route(reports, async (route) => { await held; await route.continue(); });
    await rail("Reports");
    await page.getByRole("main").getByText("Loading reports…").waitFor();
    await page.screenshot({ path: join(SHOTS, "review-reports-loading-light-1440.png") });
    release();
    await page.getByRole("main").getByText("No reports yet.").waitFor();
    await review("reports-empty", "light", WIDE);
    await page.unroute(reports);
  }, 120_000);

  it("switches the selector to an incident activated from Incident Setup", async () => {
    await rail("Incident Setup");
    await page.getByLabel("Scenario template").selectOption("wildfire");
    await page.getByLabel("Incident name").fill("Coastal Surge Exercise");
    const activation = page.waitForResponse((r) => r.request().method() === "POST"
      && r.url().endsWith(`/jurisdictions/${seed.jurisdictionId}/incidents`));
    await page.getByRole("button", { name: "Activate", exact: true }).click();
    const incidentC = (await (await activation).json()).incidentId as string;
    await expect.poll(() => page.getByLabel("Selected incident").inputValue()).toBe(incidentC);
    // The console has settled on the new incident, so its setup opens and stays open.
    await page.locator("li").filter({ hasText: "Coastal Surge Exercise" }).getByRole("button", { name: "Operational area" }).click();
    await page.getByRole("region", { name: "Coastal Surge Exercise: incident setup", exact: true }).waitFor();
    await page.getByRole("region", { name: "Coastal Surge Exercise: operational area", exact: true }).waitFor();
    await page.getByLabel("Selected incident").selectOption(incidentA);
  }, 120_000);

  it("shows the update notice for a waiting build in both themes, at both widths and by keyboard", async () => {
    const reviewPage = page;
    page = await browser.newPage({ viewport: WIDE });
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
      await page.waitForFunction("navigator.serviceWorker.controller !== null", undefined, { timeout: 60_000 });
      await page.getByLabel("Email").fill("member@example.org");
      await page.getByLabel("Password").fill("another-good-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("button", { name: "Account menu" }).waitFor();
      const worker = join(DIST, "sw.js");
      const current = /"version":"([^"]+)"/.exec(readFileSync(worker, "utf8"))![1]!;
      writeFileSync(worker, readFileSync(worker, "utf8").replace(`"version":"${current}"`, `"version":"${current}a"`));
      await page.evaluate("navigator.serviceWorker.getRegistration().then((registration) => registration.update())");
      const notice = page.getByRole("status", { name: "App update" });
      await notice.getByText("A new version is ready.").waitFor({ timeout: 60_000 });
      await review("update-notice", "light", WIDE);
      await review("update-notice", "light", NARROW);
      const walk = await tabWalk("update-notice", ["Later", "Reload"], { root: ".eoc-update-notice" });
      expect(walk).toMatchObject({ missing: [], unseen: [], weak: [], trap: null });
      await setTheme("dark");
      await review("update-notice", "dark", WIDE);
      await review("update-notice", "dark", NARROW);
      await page.setViewportSize(WIDE);
      await notice.getByRole("button", { name: "Later" }).click();
      await notice.waitFor({ state: "hidden" });
      expect(reviews.filter((r) => r.view === "update-notice" && (r.serious.length || r.sideways))).toEqual([]);
    } finally {
      await page.close();
      page = reviewPage;
    }
  }, 180_000);

  it("moves the map without animation when motion is reduced, and animates it otherwise", async () => {
    await page.setViewportSize(WIDE);
    await rail("Map");
    await page.getByTestId("cop-map").waitFor();
    await page.getByText("Map tools and saved views", { exact: true }).click();
    await page.getByLabel("Bookmark name").fill("Start view");
    await page.getByRole("button", { name: "Save view" }).click();
    await page.getByRole("button", { name: "Start view", exact: true }).waitFor();

    // Reduced: the zoom control and the bookmark's 600 ms flight both arrive in the same task as the press.
    const zoomed = await cameraMove("Zoom in");
    expect(zoomed).toBeGreaterThanOrEqual(0);
    expect(zoomed).toBeLessThan(150);
    const reduced = await cameraMove("Start view");
    expect(reduced).toBeGreaterThanOrEqual(0);
    expect(reduced).toBeLessThan(150);

    // Without the preference the same moves animate.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await cameraMove("Zoom in")).toBeGreaterThanOrEqual(150);
    expect(await cameraMove("Start view")).toBeGreaterThanOrEqual(500);
    await page.emulateMedia({ reducedMotion: "reduce" });
  }, 120_000);

  it("keeps every focus ring at 3:1 under a higher-contrast preference, and visible under forced colors", async () => {
    await page.emulateMedia({ reducedMotion: "reduce", contrast: "more" });
    for (const theme of ["light", "dark"] as const) {
      await setTheme(theme);
      await page.locator(`.eoc-theme[data-contrast="more"][data-theme="${theme}"]`).waitFor();
      for (const view of [views[0]!, views[6]!]) {
        await view.open();
        await view.ready();
        await review(`${view.key}-more-contrast`, theme, WIDE);
        const walk = await tabWalk(`${view.key}-more-contrast-${theme}`, view.reach);
        expect(walk.weak, `${view.key} ${theme}`).toEqual([]);
        expect(walk.stops).toBeGreaterThan(20);
      }
    }
    expect(reviews.filter((r) => r.view.endsWith("-more-contrast") && r.serious.length)).toEqual([]);

    await page.emulateMedia({ reducedMotion: "reduce", contrast: "no-preference", forcedColors: "active" });
    await setTheme("light");
    await rail("Map");
    await views[0]!.ready();
    await page.screenshot({ path: join(SHOTS, "review-map-forced-colors-1440.png") });
    const forced = await tabWalk("map-forced-colors", views[0]!.reach);
    expect(forced.missing).toEqual([]);
    // System colors replace the theme's here, so the ring is only required to show.
    expect(walks.at(-1)!.weak.filter((line) => line.includes("no ring"))).toEqual([]);
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 300_000);
});
