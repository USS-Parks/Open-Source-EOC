// Browser proof for generated basemap artifacts; not deployed with the runtime.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../web/node_modules/vite/dist/node/index.js";

const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "../../web");
const publicDir = join(web, "public");
const archive = process.env.OPENEOC_H14_ARCHIVE;
const shotRoot = process.env.OPENEOC_SHOT_DIR;
const chrome = process.env.OPENEOC_CHROMIUM;
assert(archive && existsSync(archive), "OPENEOC_H14_ARCHIVE must name the local candidate PMTiles");
assert(shotRoot, "OPENEOC_SHOT_DIR is required");
assert(chrome && existsSync(chrome), "OPENEOC_CHROMIUM must name an installed browser");

const sample = {
  osmId: 22942679,
  overtureId: "93d4dafa-e3ea-41bf-b603-9e5cd38c390c",
  center: [-122.25319227442439, 37.82668328532536],
  use: "civic",
  subtype: "medical",
};
const output = join(shotRoot, "h14");
await mkdir(output, { recursive: true });

function sendFile(request, response, path) {
  const size = statSync(path).size;
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  response.statusCode = match ? 206 : 200;
  response.setHeader("accept-ranges", "bytes");
  response.setHeader("content-length", String(end - start + 1));
  if (match) response.setHeader("content-range", `bytes ${start}-${end}/${size}`);
  if (path.endsWith(".pmtiles")) response.setHeader("content-type", "application/octet-stream");
  else if (path.endsWith(".pbf")) response.setHeader("content-type", "application/x-protobuf");
  else if (path.endsWith(".json") || path.endsWith(".geojson")) response.setHeader("content-type", "application/json");
  else if (path.endsWith(".png")) response.setHeader("content-type", "image/png");
  else if (path.endsWith(".svg")) response.setHeader("content-type", "image/svg+xml");
  createReadStream(path, { start, end }).pipe(response);
}

const localAssets = {
  name: "h14-local-assets",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://local").pathname);
      if (pathname === "/h14/buildings.pmtiles") return sendFile(request, response, archive);
      const relative = normalize(pathname).replace(/^[/\\]+/, "");
      const candidate = resolve(publicDir, relative);
      if (candidate.startsWith(publicDir + "\\") && existsSync(candidate) && statSync(candidate).isFile()) {
        return sendFile(request, response, candidate);
      }
      return next();
    });
  },
};

const vite = await createServer({
  root: web,
  publicDir: false,
  logLevel: "error",
  plugins: [localAssets],
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await vite.listen();
const base = new URL(vite.resolvedUrls.local[0]);
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

const evidence = {
  release: "2026-08-19.0",
  archive,
  sample,
  externalRequests: [],
  themes: [],
};

function demoUrl(theme, withStatus) {
  const url = new URL("/cop-demo/index.html", base);
  url.searchParams.set("theme", theme);
  url.searchParams.set("bundled", "1");
  url.searchParams.set("OPENEOC_BUILDINGS_PMTILES_URL", new URL("/h14/buildings.pmtiles", base).href);
  url.searchParams.set("OPENEOC_BUILDINGS_OVERTURE_RELEASE", "2026-08-19.0");
  if (withStatus) {
    url.searchParams.set("board", "damage");
    url.searchParams.set("title", "Synthetic damage assessment");
  }
  return url;
}

async function stableCanvas(page, path) {
  let previous;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.evaluate(() => new Promise((done) => globalThis.requestAnimationFrame(
      () => globalThis.requestAnimationFrame(done),
    )));
    const current = await page.locator(".maplibregl-canvas").screenshot();
    const hash = createHash("sha256").update(current).digest("hex");
    if (hash === previous) {
      await writeFile(path, current);
      return hash;
    }
    previous = hash;
  }
  throw new Error("Map canvas did not settle across animation frames");
}

async function openMap(theme, withStatus) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  const ranges = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().endsWith("/h14/buildings.pmtiles")) ranges.push(response.status());
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base.origin && !["data:", "blob:"].includes(url.protocol)) {
      evidence.externalRequests.push(url.href);
      return route.abort();
    }
    if (url.pathname === "/api/v1/ogc/collections/damage/items") {
      return route.fulfill({
        contentType: "application/geo+json",
        body: JSON.stringify({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            id: "synthetic-h14-status",
            geometry: { type: "Point", coordinates: sample.center },
            properties: { name: "Synthetic H14 status", status: "closed" },
          }],
        }),
      });
    }
    return route.continue();
  });
  await page.goto(demoUrl(theme, withStatus).href);
  await page.waitForFunction(() => globalThis.__map?.isStyleLoaded(), null, { timeout: 60000 });
  await page.evaluate((center) => globalThis.__map.jumpTo({ center, zoom: 18 }), sample.center);
  await page.waitForFunction((osmId) => {
    const map = globalThis.__map;
    if (!map.isSourceLoaded("buildings")) return false;
    return map.queryRenderedFeatures({ layers: ["building-use"] })
      .some((feature) => feature.properties.osm_id === osmId);
  }, sample.osmId, { timeout: 60000 });
  if (withStatus) {
    await page.waitForFunction((osmId) => globalThis.__map.getFeatureState({
      source: "buildings", sourceLayer: "buildings", id: osmId,
    }).status === "critical", sample.osmId, { timeout: 60000 });
  }
  const inventory = await page.evaluate((osmId) => {
    const map = globalThis.__map;
    const feature = map.queryRenderedFeatures({ layers: ["building-use"] })
      .find((item) => item.properties.osm_id === osmId);
    return {
      featureId: feature?.id,
      properties: feature?.properties,
      state: map.getFeatureState({ source: "buildings", sourceLayer: "buildings", id: osmId }),
      attribution: globalThis.document.querySelector(".maplibregl-ctrl-attrib")?.textContent,
      legend: [...globalThis.document.querySelectorAll("h3")].map((node) => node.textContent),
    };
  }, sample.osmId);
  assert.equal(inventory.featureId, sample.osmId, "promoted feature ID changed");
  assert.equal(inventory.properties.class, "yes");
  assert.equal(inventory.properties.overture_use, sample.use);
  assert.equal(inventory.properties.overture_subtype, sample.subtype);
  assert.equal(inventory.properties.overture_id, sample.overtureId);
  assert.match(inventory.attribution, /Overture Maps Foundation/);
  assert.match(inventory.attribution, /2026-08-19\.0/);
  assert(inventory.legend.includes("Building use"), "Building use legend missing");
  if (withStatus) assert.equal(inventory.state.status, "critical");
  else assert.equal(inventory.state.status, undefined);
  assert(ranges.includes(206), "Candidate archive did not return an HTTP range response");
  const kind = withStatus ? "status-critical" : "type-civic";
  const hash = await stableCanvas(page, join(output, `h14-${kind}-${theme}.png`));
  assert.deepEqual(errors, [], "Browser or map errors");
  await context.close();
  return { kind, hash, ranges, inventory };
}

try {
  for (const theme of ["light", "dark"]) {
    const type = await openMap(theme, false);
    const status = await openMap(theme, true);
    assert.notEqual(type.hash, status.hash, "Operational status must change the rendered building canvas");
    evidence.themes.push({ theme, type, status });
  }
  assert.deepEqual(evidence.externalRequests, [], "Proof made an external request");
  await writeFile(join(output, "h14-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
  await vite.close();
}
