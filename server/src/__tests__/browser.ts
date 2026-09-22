import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { chromium, type Browser, type LaunchOptions } from "playwright-core";
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

/** Build the web bundle into `dist` the way `vite build` does. */
export async function buildWeb(dist: string): Promise<void> {
  const { build } = await import("../../../web/node_modules/vite/dist/node/index.js");
  await build({ root: WEB_DIR, base: "./", publicDir: false, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
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
    const body = readFileSync(path);
    const type = TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";
    const range = request.headers.range;
    const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : body.length - 1;
      const slice = body.subarray(start, Math.min(end, body.length - 1) + 1);
      return reply.status(206).header("content-type", type).header("accept-ranges", "bytes")
        .header("content-range", `bytes ${start}-${start + slice.length - 1}/${body.length}`).send(slice);
    }
    return reply.header("content-type", type).header("accept-ranges", "bytes").send(body);
  });
}

/** Listen on a free loopback port and return the base URL. */
export async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

export function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
  return chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"], ...options });
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
