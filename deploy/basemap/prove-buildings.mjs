import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, URLSearchParams } from "node:url";

// Run against the Vite testbed after serving both locally built archives.
// Uses the existing server Playwright dependency and installed Chrome.
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const base = new URL(process.argv[2] ?? "http://127.0.0.1:5173");
assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Use a local testbed");
const output = fileURLToPath(new URL("./out/proof-9b/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.OPENEOC_CHROMIUM
    ? { executablePath: process.env.OPENEOC_CHROMIUM }
    : { channel: "chrome" }),
  args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const evidence = { capturedAt: new Date().toISOString(), themes: [], statusJoin: "Skipped: requires live board records and PostgreSQL" };
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    const external = [];
    const ranges = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.url().includes(".pmtiles")) ranges.push({ url: response.url(), status: response.status() });
    });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base.origin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
      external.push(url.href);
      return route.abort();
    });
    const url = new URL("/cop-demo/index.html", base);
    url.search = new URLSearchParams({
      theme,
      bundled: "1",
      OPENEOC_BASEMAP_PMTILES_URL: new URL("/basemap/california.pmtiles", base).href,
      OPENEOC_BUILDINGS_PMTILES_URL: new URL("/basemap/buildings.pmtiles", base).href,
    }).toString();
    await page.goto(url.href);
    await page.waitForFunction(() => globalThis.__map?.isStyleLoaded(), null, { timeout: 60000 });
    await page.evaluate(() => {
      globalThis.__proofErrors = [];
      globalThis.__map.on("error", (event) => globalThis.__proofErrors.push(String(event.error)));
      globalThis.__map.jumpTo({ center: [-124.1637, 40.8021], zoom: 15 });
    });
    await page.waitForFunction(() => globalThis.__map.loaded() && globalThis.__map.areTilesLoaded()
      && globalThis.__map.queryRenderedFeatures({ layers: ["building-use"] }).length > 0,
    null, { timeout: 60000 });
    assert(await page.getByRole("heading", { name: "Building use", exact: true }).isVisible());
    const inventory = await page.evaluate(() => {
      const map = globalThis.__map;
      const features = [...new Map(map.queryRenderedFeatures({ layers: ["building-use"] })
        .map((feature) => [feature.id, feature])).values()];
      const classes = {};
      for (const feature of features) classes[feature.properties.class] = (classes[feature.properties.class] ?? 0) + 1;
      return { count: features.length, classes, idsValid: features.every((feature) => feature.id === feature.properties.osm_id),
        attribution: globalThis.document.querySelector(".maplibregl-ctrl-attrib")?.textContent };
    });
    assert(inventory.idsValid, "Footprint IDs must be promoted from osm_id");
    assert(inventory.classes.yes > 0, "Untyped footprints must be present");
    assert(Object.keys(inventory.classes).some((tag) => ["house", "residential", "apartments"].includes(tag)), "Residential footprints must be present");
    assert(Object.keys(inventory.classes).some((tag) => ["commercial", "retail", "office"].includes(tag)), "Commercial footprints must be present");
    assert(inventory.attribution.includes("OpenStreetMap"), "OSM attribution must be present");
    await page.screenshot({ path: output + "/buildings-eureka-" + theme + ".png" });
    await page.getByRole("checkbox", { name: "Buildings", exact: true }).uncheck();
    await page.waitForFunction(() => ["building", "building-use", "building-outline"]
      .every((id) => globalThis.__map.getLayoutProperty(id, "visibility") === "none")
      && globalThis.__map.queryRenderedFeatures({ layers: ["building", "building-use", "building-outline"] }).length === 0);
    await page.screenshot({ path: output + "/buildings-hidden-" + theme + ".png" });
    await page.getByRole("checkbox", { name: "Buildings", exact: true }).check();
    await page.waitForFunction(() => globalThis.__map.queryRenderedFeatures({ layers: ["building-use"] }).length > 0);
    errors.push(...await page.evaluate(() => globalThis.__proofErrors));
    assert.deepEqual(errors, [], "Browser and map errors");
    assert.deepEqual(external, [], "Proof must make no external requests");
    for (const archive of ["california.pmtiles", "buildings.pmtiles"]) {
      assert(ranges.some((response) => response.url.endsWith(archive) && response.status === 206), "Missing HTTP range response: " + archive);
    }
    evidence.themes.push({ theme, ...inventory, toggleOff: "passed", toggleOn: "passed", errors, external, rangeResponses: ranges.length });
    await context.close();
  }
  await writeFile(output + "/evidence.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}
