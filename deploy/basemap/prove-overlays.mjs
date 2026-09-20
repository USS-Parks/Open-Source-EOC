import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, URLSearchParams } from "node:url";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const base = new URL(process.argv[2] ?? "http://127.0.0.1:5173");
assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
const output = fileURLToPath(new URL("./out/proof-8/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const layers = ["roads_state", "roads_usfs", "roads_blm", "roads_nps", "roads_county", "land_ownership"];
const labels = ["State highways", "Federal roads: USFS", "Federal roads: BLM", "Federal roads: NPS", "County roads", "Public land ownership"];
const evidence = { capturedAt: new Date().toISOString(), browserVersion: browser.version(), views: [], checks: [] };
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const errors = [], external = [], ranges = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", (response) => { if (response.url().endsWith("overlays.pmtiles")) ranges.push(response.status()); });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base.origin || ["blob:", "data:"].includes(url.protocol)) return route.continue();
      external.push(url.href);
      return route.abort();
    });
    const url = new URL("/cop-demo/index.html", base);
    url.search = new URLSearchParams({ theme, bundled: "1", OPENEOC_MAP_BOUNDS: "-124.5,32.5,-114.1,42.01",
      OPENEOC_BASEMAP_PMTILES_URL: new URL("/basemap/california.pmtiles", base).href,
      OPENEOC_OVERLAYS_PMTILES_URL: new URL("/basemap/overlays.pmtiles", base).href }).toString();
    await page.goto(url.href);
    await page.waitForFunction(() => globalThis.__map?.isStyleLoaded(), null, { timeout: 60000 });
    assert(await page.evaluate(() => {
      const bounds = globalThis.__map.getBounds();
      return bounds.contains([-124.5, 32.5]) && bounds.contains([-114.1, 42.01]);
    }), "Initial view must include all California");
    await page.evaluate(() => {
      globalThis.__proofErrors = [];
      globalThis.__map.on("error", (event) => globalThis.__proofErrors.push(String(event.error)));
    });
    await page.getByText("Coverage unverified: source manifest unavailable", { exact: true }).first().waitFor({ state: "hidden" });
    for (const label of labels) await page.getByRole("checkbox", { name: label, exact: true }).check();
    for (const view of [
      { id: "california", center: [-119.3, 37.2], zoom: 6 },
      { id: "nevada-negative", center: [-115.5, 39.5], zoom: 10 },
      { id: "humboldt", center: [-123.8, 40.9], zoom: 10 },
      { id: "san-diego", center: [-117.1, 32.85], zoom: 10 },
    ]) {
      await page.evaluate((v) => v.id === "california"
        ? globalThis.__map.fitBounds([-124.5, 32.5, -114.1, 42.01], { padding: 24, duration: 0 })
        : globalThis.__map.jumpTo(v), view);
      await page.waitForFunction(() => globalThis.__map.loaded() && globalThis.__map.areTilesLoaded(), null, { timeout: 90000 });
      const camera = await page.evaluate(() => ({ center: globalThis.__map.getCenter().toArray(), zoom: globalThis.__map.getZoom() }));
      const counts = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id,
        globalThis.__map.queryRenderedFeatures({ layers: ["overlay-" + id] }).length])), layers);
      if (view.id === "nevada-negative") assert(Object.values(counts).every((count) => count === 0), "Nevada interior must not contain California overlays");
      else {
        assert(counts.roads_state > 0, view.id + " must render state highways at zoom " + camera.zoom);
        assert(counts.land_ownership > 0, view.id + " must render public land");
      }
      await page.screenshot({ path: output + "/" + view.id + "-" + theme + ".png" });
      evidence.views.push({ theme, ...view, ...camera, counts });
    }
    const hit = await page.evaluate(() => {
      const map = globalThis.__map;
      const canvas = map.getCanvas().getBoundingClientRect();
      for (let y = 80; y < canvas.height - 80; y += 24) {
        for (let x = 80; x < canvas.width - 80; x += 24) {
          if (map.queryRenderedFeatures([x, y]).some((f) => f.layer.id.startsWith("overlay-")))
            return { x: canvas.x + x, y: canvas.y + y };
        }
      }
    });
    assert(hit, "A visible overlay must be inspectable");
    await page.mouse.click(hit.x, hit.y);
    await page.locator(".maplibregl-popup-content table").waitFor();
    const popupFields = await page.locator(".maplibregl-popup-content th").count();
    assert(popupFields > 0);
    await page.getByRole("button", { name: "Close popup" }).click();
    // Every control changes only its own group.
    for (const [index, label] of labels.entries()) {
      await page.getByRole("checkbox", { name: label, exact: true }).uncheck();
      await page.waitForFunction(({ ids, index }) => ids.every((id, i) =>
        globalThis.__map.getLayoutProperty("overlay-" + id, "visibility") === (i === index ? "none" : "visible")), { ids: layers, index });
      await page.getByRole("checkbox", { name: label, exact: true }).check();
    }
    for (const label of labels) await page.getByRole("checkbox", { name: label, exact: true }).uncheck();
    await page.waitForFunction((ids) => ids.every((id) => globalThis.__map.getLayoutProperty("overlay-" + id, "visibility") === "none")
      && globalThis.__map.queryRenderedFeatures({ layers: ids.map((id) => "overlay-" + id) }).length === 0, layers);
    errors.push(...await page.evaluate(() => globalThis.__proofErrors));
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert(ranges.includes(206), "Overlay archive must support HTTP ranges");
    evidence.checks.push({ theme, initialCaliforniaExtent: true, independentToggles: true, hiddenFeatureCount: 0, popupFields, rangeStatuses: [...new Set(ranges)], errors, externalRequests: external });
    await context.close();
  }
  await writeFile(output + "/evidence.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
