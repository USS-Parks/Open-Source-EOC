#!/usr/bin/env node
// Render the map icon suite's contact sheet: all 40 icons in their shapes at
// 20, 24 and 32 px on light, dark and imagery-like backgrounds, a row drawn
// the way the map rasterizes them, and the easily confused pairs, captured
// with Chrome at device scale factors 1, 1.25 and 2.
//
//   node tools/icons/contact-sheet.mjs
//
// OPENEOC_SHOT_DIR sets where the HTML and PNG files go; OPENEOC_CHROMIUM
// names the browser when it is not at a usual path.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(import.meta.dirname, "../..");
const out = resolve(process.env.OPENEOC_SHOT_DIR ?? join(tmpdir(), "openeoc-icon-sheet"));

// The web sources import each other as ./name.js; Node strips the types but
// does not map .js to .ts, so this does.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && specifier.endsWith(".js")) return next(`${specifier.slice(0, -3)}.ts`, context);
      throw error;
    }
  },
});

const { ICON_IDS, GLYPHS } = await import(pathToFileURL(join(repo, "web/src/cop/symbols/glyphs.ts")).href);
const { composeIcon, shapeFor } = await import(pathToFileURL(join(repo, "web/src/cop/symbols/compose.ts")).href);
const { chromium } = createRequire(join(repo, "server/package.json"))("playwright-core");

// Provisional colors; the palette unit replaces them.
const LIFELINE_COLORS = {
  safety_security: "#1f4e9c",
  health_medical: "#c62839",
  energy: "#d98c00",
  communications: "#6a3fa0",
  transportation: "#4a5560",
  hazardous_materials: "#8a5a00",
  water_systems: "#1a8fbf",
};
const DISC_COLORS = {
  command_post: "#1f4e9c",
  shelter: "#009656",
  wildfire: "#c93100",
  structure_fire: "#c93100",
  landslide: "#6c4000",
  earthquake: "#6c4000",
  flooding: "#1f7ac0",
  tsunami: "#1f7ac0",
  hazmat_release: "#e89d00",
  road_block: "#c93100",
  damage_report: "#8335a8",
};
const colorFor = (id) => GLYPHS[id].lifeline ? LIFELINE_COLORS[GLYPHS[id].lifeline] : DISC_COLORS[id] ?? "#33475b";
const icon = (id, size) => composeIcon(id, shapeFor(id), colorFor(id), size);

const PAIRS = [
  ["hospital", "urgent_care", "ems_station"], ["school", "college"], ["water_treatment", "wastewater_treatment"],
  ["heliport", "helibase"], ["power_plant", "substation"], ["flooding", "tsunami"],
  ["hazmat_site", "hazmat_release"], ["structure_fire", "wildfire"],
];

const noise = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="5" seed="7"/>` +
  `<feColorMatrix values=".3 .35 0 0 -.12  .35 .4 0 0 -.1  .2 .25 0 0 -.1  0 0 0 0 1"/></filter><rect width="400" height="400" filter="url(#n)"/></svg>`,
);
const BACKGROUNDS = [
  ["light", "Light basemap", "#f2efe9"],
  ["dark", "Dark basemap", "#1c2127"],
  ["imagery", "Imagery", `url('data:image/svg+xml,${noise}') #3d4a2c`],
];

const cell = (id) =>
  `<figure><div class="sizes">${[20, 24, 32].map((s) => icon(id, s)).join("")}</div><figcaption>${id}</figcaption></figure>`;
const panel = ([key, title, background]) =>
  `<section id="${key}" class="panel ${key}" style="background:${background}"><h2>${title}</h2><div class="grid">${ICON_IDS.map(cell).join("")}</div></section>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Icon suite contact sheet</title><style>
body { margin: 0; font: 11px/1.3 system-ui, sans-serif; background: #fff; color: #222; }
h1 { font-size: 16px; margin: 12px 16px 4px; } h2 { font-size: 13px; margin: 0 0 8px; }
.panel { padding: 12px 16px; } .dark h2, .imagery h2, .dark figcaption, .imagery figcaption { color: #eee; }
.grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 10px 8px; }
figure { margin: 0; } .sizes { display: flex; align-items: center; gap: 6px; height: 34px; }
.sizes svg { display: block; } figcaption { margin-top: 2px; white-space: nowrap; }
.raster canvas { display: block; } .raster .row { display: flex; flex-wrap: wrap; gap: 8px; }
.pairs .row { display: flex; flex-wrap: wrap; gap: 18px; } .pair { display: flex; gap: 6px; padding: 6px; }
.detail .grid { grid-template-columns: repeat(10, 1fr); } .detail .sizes { height: 70px; }
</style></head><body><h1>Open Source EOC map icon suite: 40 icons at 20, 24 and 32 px</h1>
${BACKGROUNDS.map(panel).join("")}
<section id="raster" class="panel raster imagery" style="background:${BACKGROUNDS[2][2]}"><h2>As the map draws them: 24 px, rasterized at max(2, device ratio) and scaled</h2><div class="row" id="raster-row"></div></section>
<section id="pairs" class="panel pairs"><h2>Easily confused sets at 20 px, light and imagery</h2><div class="row">
${PAIRS.map((set) => `<div class="pair">${set.map((id) => icon(id, 20)).join("")}</div><div class="pair" style="background:${BACKGROUNDS[2][2]}">${set.map((id) => icon(id, 20)).join("")}</div>`).join("")}
</div></section>
<section id="detail" class="panel detail"><h2>Design review at 64 px</h2><div class="grid">${ICON_IDS.map((id) => `<figure><div class="sizes">${icon(id, 64)}</div><figcaption>${id}</figcaption></figure>`).join("")}</div></section>
<script>
const sources = ${JSON.stringify(ICON_IDS.map((id) => composeIcon(id, shapeFor(id), colorFor(id), 24, 1)))};
window.rasterDone = (async () => {
  const ratio = Math.max(2, devicePixelRatio);
  const row = document.getElementById("raster-row");
  for (const source of sources) {
    const image = new Image(24 * ratio, 24 * ratio);
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source.replace('width="24" height="24"', 'width="' + 24 * ratio + '" height="' + 24 * ratio + '"'));
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(24 * devicePixelRatio);
    canvas.height = canvas.width;
    canvas.style.width = canvas.style.height = "24px";
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    row.append(canvas);
  }
})();
</script></body></html>`;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "icons-contact-sheet.html"), html);

const executablePath = [
  process.env.OPENEOC_CHROMIUM,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((path) => path && existsSync(path));
if (!executablePath) throw new Error("no Chrome found; set OPENEOC_CHROMIUM");

const browser = await chromium.launch({ executablePath });
try {
  for (const dsf of [1, 1.25, 2]) {
    const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: dsf });
    await page.setContent(html);
    await page.evaluate(() => globalThis.rasterDone);
    const tag = String(dsf).replace(".", "_");
    await page.screenshot({ path: join(out, `icons-contact-sheet-${tag}x.png`), fullPage: true });
    for (const section of ["light", "dark", "imagery", "raster", "pairs", "detail"]) {
      await page.locator(`#${section}`).screenshot({ path: join(out, `icons-${section}-${tag}x.png`) });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`contact sheet written to ${out}`);
