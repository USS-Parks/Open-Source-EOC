#!/usr/bin/env node
// First-load JavaScript budget for the web client. Builds the bundle without
// web/public (the map archives are served as static files, not bundled), then
// sums the entry chunk and every chunk it imports statically, gzipped: the
// JavaScript a browser must load before the sign-in screen can paint. Chunks
// behind a dynamic import load on demand and are listed but not counted.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET_BYTES = 300_000;
const web = fileURLToPath(new URL("../web/", import.meta.url));
const { build } = await import("../web/node_modules/vite/dist/node/index.js");
const outDir = mkdtempSync(join(tmpdir(), "openeoc-bundle-budget-"));

try {
  await build({ root: web, publicDir: false, logLevel: "warn", build: { outDir, emptyOutDir: true, manifest: true } });
  const manifest = JSON.parse(readFileSync(join(outDir, ".vite", "manifest.json"), "utf8"));
  const firstLoad = new Set();
  const visit = (key) => {
    if (firstLoad.has(key)) return;
    firstLoad.add(key);
    for (const child of manifest[key].imports ?? []) visit(child);
  };
  visit("index.html");
  const gzipped = (file) => gzipSync(readFileSync(join(outDir, file))).length;
  const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
  let total = 0;
  console.log("First load (counted):");
  for (const key of firstLoad) {
    const size = gzipped(manifest[key].file);
    total += size;
    console.log(`  ${manifest[key].file}  ${kb(size)}`);
  }
  console.log("On demand (not counted):");
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!firstLoad.has(key) && chunk.file.endsWith(".js")) console.log(`  ${chunk.file}  ${kb(gzipped(chunk.file))}`);
  }
  console.log(`First-load JavaScript: ${kb(total)} gzipped (budget ${kb(BUDGET_BYTES)})`);
  if (total > BUDGET_BYTES) {
    console.error("First-load JavaScript is over budget.");
    process.exitCode = 1;
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
