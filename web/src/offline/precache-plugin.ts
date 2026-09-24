import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

/**
 * Build step for the installed web app. It links the web app manifest from
 * the page and writes web/public/sw.js into the bundle with its precache list
 * filled in: every file the build emitted (the shell and each code-split
 * chunk) plus the files under web/public listed below. The list's version is
 * a digest of all their contents, so any change makes a new worker.
 */

/** The web/public files the app needs offline. The large map archives are read by byte range and never listed. */
const PUBLIC_PRECACHE = [
  /^manifest\.webmanifest$/,
  /^icons\/[^/]+\.png$/,
  /^fonts\/[^/]+\/[^/]+\.pbf$/,
  /^napsg\/[^/]+\.png$/,
  /^napsg\/sprite(@2x)?\.json$/,
  /^basemap\/basemap\.pmtiles$/,
];

export const PRECACHE_PLACEHOLDER = '{ version: "unbuilt", files: [] }';

export function offlineShell(): Plugin {
  let root = "";
  let base = "/";
  return {
    name: "openeoc-offline-shell",
    enforce: "post",
    configResolved(config) {
      root = config.root;
      base = config.base;
    },
    transformIndexHtml: () => [
      { tag: "link", attrs: { rel: "manifest", href: `${base}manifest.webmanifest` }, injectTo: "head" },
    ],
    generateBundle(_options, bundle) {
      const publicDir = join(root, "public");
      const publicFiles = readdirSync(publicDir, { recursive: true, encoding: "utf8" })
        .map((path) => path.replaceAll("\\", "/"))
        .filter((path) => PUBLIC_PRECACHE.some((pattern) => pattern.test(path)))
        .sort();
      const built = Object.keys(bundle).sort();
      const template = readFileSync(join(publicDir, "sw.js"), "utf8");
      if (!template.includes(PRECACHE_PLACEHOLDER)) this.error("web/public/sw.js has lost its precache placeholder");
      const digest = createHash("sha256").update(template);
      for (const file of built) {
        const output = bundle[file]!;
        digest.update(`${file}\0`).update(output.type === "chunk" ? output.code : output.source);
      }
      for (const file of publicFiles) digest.update(`${file}\0`).update(readFileSync(join(publicDir, file)));
      const files = [...new Set(["index.html", ...built, ...publicFiles])];
      const precache = JSON.stringify({ version: digest.digest("hex").slice(0, 16), files });
      this.emitFile({ type: "asset", fileName: "sw.js", source: template.replace(PRECACHE_PLACEHOLDER, () => precache) });
    },
  };
}
