import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, URLSearchParams } from "node:url";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const base = new URL(process.argv[2] ?? "http://127.0.0.1:5173");
assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
const regional = new URL("./out/proof-8-san-diego-pack/", import.meta.url);
const localUrl = (name) => new URL("/@fs/" + fileURLToPath(new URL(name, regional)).replaceAll("\\", "/"), base).href;
const archive = localUrl("overlays.pmtiles"), manifest = localUrl("overlays-manifest.json");
const output = fileURLToPath(new URL("./out/proof-8/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const evidence = { capturedAt: new Date().toISOString(), kind: "UI mode regression with a minimal style fixture and real regional archive", checks: [] };
let release;
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const errors = [], external = [], ranges = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", (response) => { if (response.url() === archive) ranges.push(response.status()); });
    const gate = new Promise((done) => { release = done; });
    const styleUrl = new URL("/__overlay_test_style.json", base).href;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin && !["blob:", "data:"].includes(url.protocol)) {
        external.push(url.href); return route.abort();
      }
      if (url.href === styleUrl) return route.fulfill({ json: { version: 8, sources: {}, layers: [
        { id: "background", type: "background", paint: { "background-color": theme === "dark" ? "#15191e" : "#f2f4f6" } },
      ] } });
      if (url.href === manifest) await gate;
      return route.continue();
    });
    const url = new URL("/cop-demo/index.html", base);
    url.search = new URLSearchParams({ theme, OPENEOC_BASEMAP_STYLE_URL: styleUrl,
      OPENEOC_OVERLAYS_PMTILES_URL: archive, OPENEOC_MAP_BOUNDS: "-117.3,32.7,-116.5,33.1" }).toString();
    await page.goto(url.href);
    await page.waitForFunction(() => globalThis.__map?.getLayer("overlay-roads_nps"));
    for (const name of ["Federal roads: NPS", "County roads"]) await page.getByRole("checkbox", { name, exact: true }).check();
    await page.waitForFunction(() => ["roads_nps", "roads_county"].every((id) => globalThis.__map.getLayoutProperty("overlay-" + id, "visibility") === "visible"));
    release();
    for (const name of ["Federal roads: NPS", "County roads"]) {
      const checkbox = page.getByRole("checkbox", { name, exact: true });
      await checkbox.waitFor();
      await page.waitForFunction((name) => [...globalThis.document.querySelectorAll("label")].some((label) => label.textContent.trim() === name && label.querySelector("input")?.disabled && !label.querySelector("input")?.checked), name);
      assert(await checkbox.isDisabled()); assert.equal(await checkbox.isChecked(), false);
    }
    await page.waitForFunction(() => ["roads_nps", "roads_county"].every((id) => globalThis.__map.getLayoutProperty("overlay-" + id, "visibility") === "none"));
    assert.equal(await page.getByRole("heading", { name: "Road jurisdiction and land ownership" }).count(), 0);
    await page.getByRole("checkbox", { name: "State highways", exact: true }).check();
    await page.waitForFunction(() => globalThis.__map.areTilesLoaded() && globalThis.__map.queryRenderedFeatures({ layers: ["overlay-roads_state"] }).length > 0);
    const count = await page.evaluate(() => globalThis.__map.queryRenderedFeatures({ layers: ["overlay-roads_state"] }).length);
    await page.screenshot({ path: output + "/custom-style-coverage-" + theme + ".png" });
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert(ranges.includes(206));
    evidence.checks.push({ theme, externalStyleOverlays: true, delayedUnavailableSelectionsCleared: true, renderedStateHighways: count, rangeStatuses: [...new Set(ranges)], errors, externalRequests: external });
    await context.close(); release = undefined;
  }
  await writeFile(output + "/mode-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally { release?.(); await browser.close(); }
