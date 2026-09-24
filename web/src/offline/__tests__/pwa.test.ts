import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { offlineShell, PRECACHE_PLACEHOLDER } from "../precache-plugin.js";

/**
 * The installable app's static contract: the manifest and its icons, the
 * precache list the build writes into the service worker, and the worker's
 * routing, byte-range and runtime-budget logic run against a fake Cache API.
 * The real browser walk is server/src/__tests__/pwa-browser.test.ts.
 */

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PUBLIC = join(WEB, "public");
const MB = 1024 * 1024;

interface Precache { version: string; files: string[] }
const call = (hook: unknown, thisArg: unknown, ...args: unknown[]) =>
  (hook as (this: unknown, ...rest: unknown[]) => unknown).call(thisArg, ...args);

function runBuild(bundle: Record<string, { type: "chunk"; code: string } | { type: "asset"; source: string }>) {
  const plugin = offlineShell();
  call(plugin.configResolved, plugin, { root: WEB, base: "./" });
  const emitted: Array<{ fileName: string; source: string }> = [];
  const context = { emitFile: (file: { fileName: string; source: string }) => emitted.push(file), error: (message: string) => { throw new Error(message); } };
  call(plugin.generateBundle, context, {}, bundle);
  const sw = emitted.find((file) => file.fileName === "sw.js")!.source;
  return { plugin, sw, precache: JSON.parse(/const PRECACHE = (\{.*?\});/.exec(sw)![1]!) as Precache };
}

const BUNDLE = {
  "index.html": { type: "asset" as const, source: "<!doctype html>" },
  "assets/index-a1.js": { type: "chunk" as const, code: "console.log('entry')" },
  "assets/BoardsSurface-b2.js": { type: "chunk" as const, code: "export const boards = 1" },
  "assets/CopMap-c3.css": { type: "asset" as const, source: ".map{}" },
};

class FakeCache {
  readonly entries = new Map<string, Response>();
  async put(url: string, response: Response) { this.entries.delete(url); this.entries.set(url, response); }
  async match(key: string | Request) { return this.entries.get(typeof key === "string" ? key : key.url)?.clone(); }
  async keys() { return [...this.entries.keys()].map((url) => new Request(url)); }
  async delete(url: string) { return this.entries.delete(url); }
}

/** Evaluate the worker script with a fake worker scope; returns its top-level functions and the fetch listener. */
function loadWorker(source: string, usage = 0) {
  const stores = new Map<string, FakeCache>();
  const open = async (name: string) => stores.get(name) ?? stores.set(name, new FakeCache()).get(name)!;
  const listeners = new Map<string, (event: unknown) => void>();
  const scope = {
    location: new URL("https://eoc.test/app/sw.js"),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
  };
  const context = createContext({
    self: scope, URL, Map, Set, Headers, Request, Response, fetch: () => Promise.reject(new TypeError("offline")),
    navigator: { storage: { estimate: async () => ({ usage, quota: 100 * MB }) } },
    caches: {
      open,
      match: async (url: string) => { for (const cache of stores.values()) { const hit = await cache.match(url); if (hit) return hit; } return undefined; },
    },
  });
  runInContext(source, context);
  return { worker: context as Record<string, (...args: unknown[]) => Promise<unknown>>, open, listeners };
}

describe("the installable app", () => {
  it("ships a standalone manifest whose three icons exist at their stated sizes", () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8")) as {
      name: string; display: string; start_url: string; scope: string;
      icons: Array<{ src: string; sizes: string; purpose: string }>;
    };
    expect(manifest.name).toBe("Open Source EOC");
    expect(manifest.display).toBe("standalone");
    // Relative, so the app installs from whatever path the host serves it under.
    expect([manifest.start_url, manifest.scope]).toEqual(["./", "./"]);
    expect(manifest.icons.map((icon) => icon.purpose)).toEqual(["any", "any", "maskable"]);
    for (const icon of manifest.icons) {
      const png = readFileSync(join(PUBLIC, icon.src));
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });

  it("precaches every built file and the offline map assets, never the large archives", () => {
    const { precache, sw } = runBuild(BUNDLE);
    expect(sw).not.toContain(PRECACHE_PLACEHOLDER);
    expect(precache.files).toEqual(expect.arrayContaining([
      "index.html", "assets/index-a1.js", "assets/BoardsSurface-b2.js", "assets/CopMap-c3.css",
      "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
      "fonts/Liberation Sans Regular/0-255.pbf", "napsg/sprite.png", "napsg/sprite@2x.json", "napsg/fire-station.png",
      "basemap/basemap.pmtiles",
    ]));
    expect(precache.files.filter((file) => file.endsWith(".pmtiles"))).toEqual(["basemap/basemap.pmtiles"]);
    expect(precache.files.some((file) => file.endsWith(".geojson") || file === "sw.js")).toBe(false);
    expect(new Set(precache.files).size).toBe(precache.files.length);
  });

  it("gives a changed build a new worker version and links the manifest from the page", () => {
    const first = runBuild(BUNDLE).precache.version;
    expect(runBuild(BUNDLE).precache.version).toBe(first);
    const changed = { ...BUNDLE, "assets/BoardsSurface-b2.js": { type: "chunk" as const, code: "export const boards = 2" } };
    expect(runBuild(changed).precache.version).not.toBe(first);
    const tags = call(runBuild(BUNDLE).plugin.transformIndexHtml, undefined);
    expect(tags).toEqual([expect.objectContaining({ tag: "link", attrs: { rel: "manifest", href: "./manifest.webmanifest" } })]);
  });

  it("lets the API, other origins and range reads of the large archives pass through the worker", () => {
    const { listeners } = loadWorker(runBuild(BUNDLE).sw);
    const handled = (url: string, init: RequestInit = {}, mode = "cors") => {
      let responded = false;
      const request = { url, mode, method: init.method ?? "GET", headers: new Headers(init.headers) };
      listeners.get("fetch")!({
        request,
        respondWith: (answer: Promise<Response>) => { responded = true; answer.catch(() => undefined); },
      });
      return responded;
    };
    expect(handled("https://eoc.test/api/v1/me")).toBe(false);
    expect(handled("https://tiles.example.org/1/2/3.png")).toBe(false);
    expect(handled("https://eoc.test/app/basemap/california.pmtiles", { headers: { range: "bytes=0-16383" } })).toBe(false);
    expect(handled("https://eoc.test/app/api-free.json", { method: "POST" })).toBe(false);
    expect(handled("https://eoc.test/app/basemap/basemap.pmtiles", { headers: { range: "bytes=0-16383" } })).toBe(true);
    expect(handled("https://eoc.test/app/", {}, "navigate")).toBe(true);
    expect(handled("https://eoc.test/app/assets/index-a1.js")).toBe(true);
  });

  it("answers a byte range of a precached file with exactly those bytes", async () => {
    const { worker, open } = loadWorker(readFileSync(join(PUBLIC, "sw.js"), "utf8"));
    const url = "https://eoc.test/app/basemap/basemap.pmtiles";
    await (await open("openeoc-precache-unbuilt")).put(url, new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])));
    const ranged = await worker.cachedRange!(new Request(url, { headers: { range: "bytes=2-5" } })) as Response;
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 2-5/10");
    expect([...new Uint8Array(await ranged.arrayBuffer())]).toEqual([2, 3, 4, 5]);
    const tail = await worker.cachedRange!(new Request(url, { headers: { range: "bytes=8-" } })) as Response;
    expect(tail.headers.get("content-range")).toBe("bytes 8-9/10");
    const past = await worker.cachedRange!(new Request(url, { headers: { range: "bytes=20-30" } })) as Response;
    expect(past.status).toBe(416);
  });

  it("keeps the runtime cache within 50 MB by dropping the oldest entries first", async () => {
    const { worker, open } = loadWorker(readFileSync(join(PUBLIC, "sw.js"), "utf8"));
    expect(worker.overBudget!(new Map([["a", 30], ["b", 30], ["c", 30]]), 60)).toEqual(["a"]);
    expect(worker.overBudget!(new Map([["a", 10], ["b", 10]]), 60)).toEqual([]);
    for (const name of ["t1", "t2", "t3", "t4", "t5", "t6"])
      await worker.remember!(`https://eoc.test/tiles/${name}.png`, new Response(new Uint8Array(12 * MB)));
    const runtime = await open("openeoc-runtime");
    expect([...runtime.entries.keys()].map((url) => url.slice(-6, -4))).toEqual(["t3", "t4", "t5", "t6"]);
    expect(runtime.entries.get("https://eoc.test/tiles/t6.png")!.headers.get("x-openeoc-bytes")).toBe(String(12 * MB));
  });

  it("stops runtime caching when the origin is near its storage quota", async () => {
    const { worker, open } = loadWorker(readFileSync(join(PUBLIC, "sw.js"), "utf8"), 95 * MB);
    await worker.remember!("https://eoc.test/tiles/t1.png", new Response("tile"));
    expect((await open("openeoc-runtime")).entries.size).toBe(0);
  });
});
