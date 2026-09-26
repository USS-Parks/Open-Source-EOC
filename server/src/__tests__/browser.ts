import { createHash } from "node:crypto";
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { join, relative, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { chromium, type Browser, type LaunchOptions, type Page } from "playwright-core";
import { expect } from "vitest";

/**
 * Shared real-browser harness for the *-browser and *-e2e suites: one
 * Chromium lookup, one web bundle build, one static file route with byte
 * ranges (PMTiles), and the login and write helpers every suite needs.
 * Suites keep their own seeding and assertions; only the plumbing lives here.
 */

const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css",
  ".geojson": "application/geo+json",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".pmtiles": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

export const WEB_DIR = join(process.cwd(), "web");
export const PUBLIC_DIR = join(WEB_DIR, "public");

export function chromiumPath(): string {
  const candidates = [
    process.env["OPENEOC_CHROMIUM"],
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  throw new Error("no Chromium found; set OPENEOC_CHROMIUM");
}

/** Where a suite's web bundle is built. */
export function buildDir(name: string): string {
  const root = process.env["OPENEOC_TEST_BUILD_ROOT"];
  return root ? join(root, `${name}-dist`) : `/tmp/openeoc-${name}-dist`;
}

/** Where a suite writes its screenshots; created on first use. */
export function shotDir(name: string): string {
  const dir = process.env["OPENEOC_SHOT_DIR"] ?? `/tmp/openeoc-${name}-shots`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Everything the web bundle is built from; a change to any of these forces a rebuild. */
const BUNDLE_INPUTS = ["pnpm-lock.yaml", "shared/package.json", "shared/src", "web/index.html", "web/package.json", "web/src", "web/vite.config.ts"];
// The build writes the service worker from web/public/sw.js and precaches the manifest and icons.
BUNDLE_INPUTS.push("web/public/sw.js", "web/public/manifest.webmanifest", "web/public/icons");
// Help bundles the user guides and the position job aids from docs/guides.
BUNDLE_INPUTS.push("docs/guides");

function collectFiles(path: string): string[] {
  if (!existsSync(path)) throw new Error(`Build input is missing: ${path}`);
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => collectFiles(resolve(path, entry.name)));
}

/** Content hash of the bundle inputs, the same recipe the desktop installer uses. */
function bundleFingerprint(): string {
  const root = process.cwd();
  const hash = createHash("sha256");
  for (const file of BUNDLE_INPUTS.flatMap((item) => collectFiles(resolve(root, item)))) {
    hash.update(relative(root, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * Build the web bundle once per source state and share it across suites. The
 * first suite to arrive builds under a lock directory and writes a marker;
 * later suites, in this run or a later one on the same sources, reuse it.
 * Concurrent workers wait on the marker instead of building twice.
 */
async function ensureSharedBuild(): Promise<string> {
  const shared = buildDir(`shared-${bundleFingerprint()}`);
  const marker = join(shared, ".complete");
  if (existsSync(marker)) return shared;
  const lock = `${shared}.lock`;
  mkdirSync(join(shared, ".."), { recursive: true });
  try {
    mkdirSync(lock);
  } catch {
    // Another worker is building. Wait for its marker; a lock older than the
    // wait budget is treated as abandoned and the build proceeds here.
    for (let waited = 0; waited < 300_000; waited += 500) {
      if (existsSync(marker)) return shared;
      await sleep(500);
    }
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
  }
  try {
    const { build } = await import("../../../web/node_modules/vite/dist/node/index.js");
    await build({ root: WEB_DIR, base: "./", publicDir: false, logLevel: "silent", build: { outDir: shared, emptyOutDir: true } });
    expect(existsSync(join(shared, "index.html"))).toBe(true);
    writeFileSync(marker, new Date().toISOString());
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
  return shared;
}

/** Give a suite its own copy of the current web bundle at `dist`. */
export async function buildWeb(dist: string): Promise<void> {
  const shared = await ensureSharedBuild();
  rmSync(dist, { recursive: true, force: true });
  cpSync(shared, dist, { recursive: true });
  expect(existsSync(join(dist, "index.html"))).toBe(true);
}

/**
 * Serve the built bundle under `prefix` (for example "/app"), falling back to
 * web/public for basemap archives and glyphs, with byte-range responses so
 * PMTiles readers work exactly as they do against a production static host.
 */
export function serveStatic(app: FastifyInstance, prefix: string, dist: string, publicDir = PUBLIC_DIR): void {
  app.get(`${prefix}/*`, (request, reply) => {
    const relative = (request.params as { "*": string })["*"] || "index.html";
    const safe = relative.replaceAll("..", "");
    let path = join(dist, safe);
    if (!existsSync(path)) path = join(publicDir, safe);
    if (!existsSync(path)) return reply.status(404).send("missing");
    const type = TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";
    const range = request.headers.range;
    const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (match) {
      // Read only the requested bytes: basemap archives run to hundreds of megabytes.
      const size = statSync(path).size;
      const start = Number(match[1]);
      const end = Math.min(match[2] ? Number(match[2]) : size - 1, size - 1);
      const slice = Buffer.alloc(Math.max(0, end - start + 1));
      const fd = openSync(path, "r");
      try { readSync(fd, slice, 0, slice.length, start); } finally { closeSync(fd); }
      return reply.status(206).header("content-type", type).header("accept-ranges", "bytes")
        .header("content-range", `bytes ${start}-${start + slice.length - 1}/${size}`).send(slice);
    }
    return reply.header("content-type", type).header("accept-ranges", "bytes").send(readFileSync(path));
  });
}

/** Listen on a free loopback port and return the base URL. */
export async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

/**
 * Playwright's default wait is 30 seconds, tuned for a desktop. A hosted CI
 * runner renders the same transitions several times slower, so pages opened
 * through this harness wait longer there and unchanged elsewhere.
 */
const PAGE_TIMEOUT_MS = process.env["CI"] ? 90_000 : 30_000;

/**
 * Headless Chrome on a Mac without a real GPU (a CI runner) drives WebGL
 * through ANGLE on the virtual Metal device, where MapLibre's fragment
 * shaders fail to compile and the map never draws. SwiftShader, the software
 * renderer headless Chrome already uses on Linux, draws the same maps on
 * every machine the suite runs on.
 */
const WEBGL_ARGS: readonly string[] = process.platform === "darwin"
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  : [];

/**
 * The rail shows the core sections by default and every section when the
 * viewer asks. Walks reach every section from the rail, so their pages ask;
 * `coreRail` keeps the default for the captures and the rail's own test.
 */
const EVERY_SECTION = `try { localStorage.setItem("openeoc.navigation.allSections", "1"); } catch {}`;

export async function launchBrowser(options: LaunchOptions & { readonly coreRail?: boolean } = {}): Promise<Browser> {
  const { coreRail, ...launch } = options;
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox", ...WEBGL_ARGS], ...launch });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (contextOptions) => {
    const context = await newContext(contextOptions);
    // Pages of a context wait as long as pages opened with newPage below.
    context.setDefaultTimeout(PAGE_TIMEOUT_MS);
    context.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
    if (!coreRail) await context.addInitScript(EVERY_SECTION);
    return context;
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (pageOptions) => {
    const page = await newPage(pageOptions);
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
    return page;
  };
  return browser;
}

/**
 * Watch a page for what would explain a stall: console errors and warnings,
 * failed requests and a renderer crash. The report adds the page's own state,
 * read under a short limit so a hung page cannot hang the report. A sign-in
 * form that never appeared on the Windows runner left only a bare locator
 * timeout; this is what the next one prints instead.
 */
export function watchPage(page: Page): () => Promise<string> {
  const events: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") events.push(`console ${message.type()}: ${message.text()}`);
  });
  page.on("requestfailed", (request) => events.push(`failed ${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`));
  page.on("crash", () => events.push("the page crashed"));
  return async () => {
    const state = await Promise.race([
      page.evaluate(`({ ready: document.readyState, scripts: document.scripts.length,
        text: (document.body ? document.body.innerText : "").replace(/\\s+/g, " ").slice(0, 300) })`)
        .then((value) => {
          const s = value as { ready: string; scripts: number; text: string };
          return `readyState ${s.ready}, ${s.scripts} scripts, text "${s.text}"`;
        }, (error: unknown) => `the page did not answer: ${String(error)}`),
      sleep(5_000).then(() => "the page did not answer within 5 seconds"),
    ]);
    return `URL ${page.url()}; ${state}; ${events.length ? events.join("; ") : "no console errors, failed requests or crash"}`;
  };
}

/** Wait for the sign-in form; on a timeout, fail with where the page stood. */
export async function waitForSignIn(page: Page, report: () => Promise<string>): Promise<void> {
  try {
    await page.getByLabel("Email").waitFor();
  } catch (error) {
    throw new Error(`The sign-in form did not appear. ${error instanceof Error ? error.message : String(error)}\n${await report()}`, { cause: error });
  }
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Sign in through the API and return the bearer token; defaults to the seeded admin. */
export async function login(app: FastifyInstance, email = "admin@example.org", password = "correct-horse-battery"): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

/** POST as `token`, assert the status (201 by default), return the JSON body. */
export async function post(
  app: FastifyInstance,
  token: string,
  url: string,
  payload: Record<string, unknown>,
  status = 201,
): Promise<Record<string, unknown>> {
  const response = await app.inject({ method: "POST", url, headers: auth(token), payload });
  expect(response.statusCode, response.body).toBe(status);
  return response.json() as Record<string, unknown>;
}
