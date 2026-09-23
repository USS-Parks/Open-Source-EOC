import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PROFILE_DEFAULTS,
  matchesOwnedAppCommand,
  matchesOwnedBrowserCommand,
  parseWindowsCommandLine,
  profilePaths,
  validatePort,
  validateProfileName,
  validateProfilePlans,
} from "./lib/contracts.mjs";
import {
  DOCUMENT_CSP,
  desktopRuntimeConfig,
  parseByteRange,
  resolveInside,
  safeRelativePath,
  selectStaticFile,
  staticCaching,
} from "./lib/static-host.mjs";
import { rotateIfLarger, rotatingLog } from "./lib/rotating-log.mjs";

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "openeoc-windows-"));
  const distRoot = resolve(root, "dist");
  const publicRoot = resolve(root, "public");
  mkdirSync(resolve(distRoot, "assets"), { recursive: true });
  mkdirSync(resolve(publicRoot, "basemap"), { recursive: true });
  writeFileSync(resolve(distRoot, "index.html"), "<html></html>");
  writeFileSync(resolve(distRoot, "assets/app.js"), "app");
  writeFileSync(resolve(publicRoot, "basemap/map.pmtiles"), "0123456789");
  return { root, distRoot, publicRoot };
}

test("static paths stay inside the approved build and public roots", () => {
  const files = fixture();
  try {
    assert.equal(safeRelativePath("assets/app.js"), "assets/app.js");
    assert.throws(() => safeRelativePath("../secret"), /invalid path segment/);
    assert.throws(() => safeRelativePath("%2e%2e/secret"), /invalid path segment/);
    assert.throws(() => safeRelativePath("C:%5csecret"), /invalid path/);
    assert.throws(() => resolveInside(files.distRoot, "../secret"), /escaped root/);

    const app = selectStaticFile({ rawPath: "assets/app.js", ...files });
    assert.equal(app.file, resolve(files.distRoot, "assets/app.js"));
    const basemap = selectStaticFile({ rawPath: "basemap/map.pmtiles", ...files });
    assert.equal(basemap.file, resolve(files.publicRoot, "basemap/map.pmtiles"));
    const spa = selectStaticFile({ rawPath: "incidents/current", ...files, acceptsHtml: true });
    assert.equal(spa.file, resolve(files.distRoot, "index.html"));
    assert.equal(selectStaticFile({ rawPath: "missing.js", ...files, acceptsHtml: true }), null);
  } finally {
    rmSync(files.root, { recursive: true, force: true });
  }
});

test("single byte ranges are bounded for PMTiles and invalid ranges are refused", () => {
  assert.equal(parseByteRange(undefined, 10), null);
  assert.deepEqual(parseByteRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange("bytes=8-", 10), { start: 8, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-4", 10), { start: 6, end: 9 });
  assert.deepEqual(parseByteRange("bytes=8-50", 10), { start: 8, end: 9 });
  assert.deepEqual(parseByteRange("bytes=10-11", 10), { unsatisfiable: true });
  assert.deepEqual(parseByteRange("bytes=5-2", 10), { unsatisfiable: true });
  assert.deepEqual(parseByteRange("bytes=1-2,4-5", 10), { unsatisfiable: true });
});

test("hashed bundle files cache for a year and archives revalidate against a strong validator", () => {
  const archive = { relativePath: "basemap/california.pmtiles", fromDist: false, size: 769826123, mtimeMs: 1789000000123.4 };
  const plain = staticCaching(archive);
  assert.equal(plain.cacheControl, "no-cache");
  assert.match(plain.etag, /^"[0-9a-f]+-[0-9a-f]+"$/);
  assert.equal(plain.notModified, false);
  assert.equal(plain.honorRange, true);
  assert.equal(staticCaching({ ...archive, headers: { "if-none-match": plain.etag } }).notModified, true);
  assert.equal(staticCaching({ ...archive, headers: { "if-none-match": `"x", W/${plain.etag}` } }).notModified, true);
  assert.equal(staticCaching({ ...archive, headers: { "if-none-match": '"stale"' } }).notModified, false);
  // A replaced archive changes the validator, so a range tied to the old one gets the whole new file.
  const replaced = staticCaching({ ...archive, size: archive.size + 1 });
  assert.notEqual(replaced.etag, plain.etag);
  assert.equal(staticCaching({ ...archive, size: archive.size + 1, headers: { "if-range": plain.etag } }).honorRange, false);
  assert.equal(staticCaching({ ...archive, headers: { "if-range": plain.etag } }).honorRange, true);
  assert.equal(staticCaching({ ...archive, headers: { "if-range": plain.lastModified } }).honorRange, true);
  assert.equal(
    staticCaching({ relativePath: "assets/index-BQY7sQL7.js", fromDist: true, size: 3, mtimeMs: 1 }).cacheControl,
    "public, max-age=31536000, immutable",
  );
  // A public file that merely sits under an assets folder is not content hashed.
  assert.equal(staticCaching({ relativePath: "assets/logo.svg", fromDist: false, size: 3, mtimeMs: 1 }).cacheControl, "no-cache");
});

test("desktop building attribution requires metadata matching the installed archive", async (t) => {
  await t.test("matching metadata exposes the verified Overture release", async () => {
    const files = fixture();
    try {
      const archive = Buffer.from("verified-overture-buildings");
      writeFileSync(resolve(files.publicRoot, "basemap/buildings.pmtiles"), archive);
      writeFileSync(resolve(files.publicRoot, "basemap/buildings-overture.json"), JSON.stringify({
        release: "2026-08-19.0",
        archive_sha256: createHash("sha256").update(archive).digest("hex"),
        archive_bytes: archive.length,
      }));
      const diagnostics = [];
      const config = await desktopRuntimeConfig(files.publicRoot, { diagnostic: (message) => diagnostics.push(message) });
      assert.equal(config.OPENEOC_BUILDINGS_PMTILES_URL, "/basemap/buildings.pmtiles");
      assert.equal(config.OPENEOC_BUILDINGS_OVERTURE_RELEASE, "2026-08-19.0");
      assert.deepEqual(diagnostics, []);
    } finally {
      rmSync(files.root, { recursive: true, force: true });
    }
  });

  await t.test("a plain OSM archive remains available without an Overture claim", async () => {
    const files = fixture();
    try {
      writeFileSync(resolve(files.publicRoot, "basemap/buildings.pmtiles"), "plain-osm-buildings");
      const diagnostics = [];
      const config = await desktopRuntimeConfig(files.publicRoot, { diagnostic: (message) => diagnostics.push(message) });
      assert.equal(config.OPENEOC_BUILDINGS_PMTILES_URL, "/basemap/buildings.pmtiles");
      assert.equal(config.OPENEOC_BUILDINGS_OVERTURE_RELEASE, undefined);
      assert.deepEqual(diagnostics, []);
    } finally {
      rmSync(files.root, { recursive: true, force: true });
    }
  });

  await t.test("stale metadata omits the claim and reports the mismatch", async () => {
    const files = fixture();
    try {
      const archive = Buffer.from("changed-overture-buildings");
      writeFileSync(resolve(files.publicRoot, "basemap/buildings.pmtiles"), archive);
      writeFileSync(resolve(files.publicRoot, "basemap/buildings-overture.json"), JSON.stringify({
        release: "2026-08-19.0",
        archive_sha256: "0".repeat(64),
        archive_bytes: archive.length,
      }));
      const diagnostics = [];
      const config = await desktopRuntimeConfig(files.publicRoot, { diagnostic: (message) => diagnostics.push(message) });
      assert.equal(config.OPENEOC_BUILDINGS_PMTILES_URL, "/basemap/buildings.pmtiles");
      assert.equal(config.OPENEOC_BUILDINGS_OVERTURE_RELEASE, undefined);
      assert.equal(diagnostics.length, 1);
      assert.match(diagnostics[0], /BUILDINGS_OVERTURE_METADATA_STALE reason=archive_sha256/);
    } finally {
      rmSync(files.root, { recursive: true, force: true });
    }
  });
});

test("document CSP permits local MapLibre workers and fonts without external origins", () => {
  assert.match(DOCUMENT_CSP, /worker-src 'self' blob:/);
  assert.match(DOCUMENT_CSP, /font-src 'self' data:/);
  assert.match(DOCUMENT_CSP, /script-src 'self'/);
  assert.doesNotMatch(DOCUMENT_CSP, /https?:/);
  assert.doesNotMatch(DOCUMENT_CSP, /unsafe-eval/);
});

test("shipped desktop profiles have separate default ports, databases, and storage", () => {
  const root = resolve("C:/desktop/out");
  const plans = Object.entries(PROFILE_DEFAULTS).map(([profile, defaults]) => ({
    profile,
    pgPort: defaults.pgPort,
    httpPort: defaults.httpPort,
    root: profilePaths(root, profile).root,
  }));
  assert.equal(validateProfilePlans(plans), true);
  assert.deepEqual(Object.keys(PROFILE_DEFAULTS), ["production", "demo"]);
  assert.equal(new Set(plans.flatMap((plan) => [plan.pgPort, plan.httpPort])).size, 4);
  assert.equal(new Set(Object.values(PROFILE_DEFAULTS).map((item) => item.database)).size, 2);
  assert.notEqual(profilePaths(root, "demo").pgData, profilePaths(root, "production").pgData);
  assert.throws(() => profilePaths(root, "acceptance"), /Profile must be one of/);
});

test("acceptance profile requires the explicit test-runtime switch", () => {
  const contractsUrl = new URL("./lib/contracts.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `import { PROFILE_DEFAULTS, validateProfileName } from ${JSON.stringify(contractsUrl)}; validateProfileName("acceptance"); console.log(JSON.stringify(PROFILE_DEFAULTS.acceptance));`,
  ], {
    encoding: "utf8",
    env: { ...process.env, OPENEOC_ENABLE_ACCEPTANCE_PROFILE: "1" },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    pgPort: 55442,
    httpPort: 8082,
    database: "openeoc_acceptance",
    synthetic: true,
  });
});

test("invalid profile and conflicting port plans fail closed", () => {
  assert.throws(() => validateProfileName("test"), /Profile must be one of/);
  assert.throws(() => validatePort(80, "HTTP"), /1024/);
  assert.throws(
    () => validateProfilePlans([
      { profile: "production", pgPort: 55440, httpPort: 8080, root: "C:/one" },
      { profile: "demo", pgPort: 55441, httpPort: 8080, root: "C:/two" },
    ]),
    /conflicts/,
  );
});

test("PID ownership requires the exact launcher, profile, and browser data directory", () => {
  const script = "C:/Open Source EOC/deploy/windows/desktop.mjs";
  const appCommand = `"C:/Program Files/nodejs/node.exe" "${script}" serve --profile=production`;
  assert.equal(matchesOwnedAppCommand(appCommand, { scriptPath: script, profile: "production" }), true);
  assert.equal(matchesOwnedAppCommand(appCommand, { scriptPath: script, profile: "demo" }), false);
  assert.equal(matchesOwnedAppCommand(`${appCommand}-other`, { scriptPath: script, profile: "production" }), false);
  assert.equal(matchesOwnedAppCommand(`node "${script}-other" serve --profile=production`, { scriptPath: script, profile: "production" }), false);
  assert.equal(matchesOwnedAppCommand("node other.mjs serve --profile=production", { scriptPath: script, profile: "production" }), false);

  const browserDir = "C:/Open Source EOC/deploy/windows/out/profiles/production/browser";
  const url = "http://127.0.0.1:8080";
  const browserCommand = `chrome.exe --app=${url} --user-data-dir="${browserDir}"`;
  assert.deepEqual(parseWindowsCommandLine(browserCommand), ["chrome.exe", `--app=${url}`, `--user-data-dir=${browserDir}`]);
  assert.equal(matchesOwnedBrowserCommand(browserCommand, { userDataDir: browserDir, url }), true);
  assert.equal(matchesOwnedBrowserCommand(`${browserCommand}-other`, { userDataDir: browserDir, url }), false);
  assert.equal(matchesOwnedBrowserCommand(browserCommand, { userDataDir: browserDir, url: "http://127.0.0.1:8081" }), false);
});

test("stopping an unconfigured profile is an idempotent launcher operation", { skip: process.platform !== "win32" }, () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), "openeoc-stop-unconfigured-"));
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./desktop.mjs", import.meta.url)), "stop", "--profile=acceptance"], {
      encoding: "utf8",
      env: { ...process.env, OPENEOC_DESKTOP_DATA_ROOT: dataRoot, OPENEOC_ENABLE_ACCEPTANCE_PROFILE: "1" },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PROFILE_STOPPED configured=false profile=acceptance app=false postgres=false browser=false/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("server and launcher logs rotate by size and keep a bounded history", () => {
  const root = mkdtempSync(resolve(tmpdir(), "openeoc-logs-"));
  try {
    const path = resolve(root, "server.log");
    const log = rotatingLog(path, 20, 2);
    const [a, b, c, d, e, f] = ["a", "b", "c", "d", "e", "f"].map((ch) => `${ch.repeat(9)}\n`);
    for (const line of [a, b, c, d, e, f]) log.write(line);
    assert.equal(readFileSync(path, "utf8"), e + f);
    assert.equal(readFileSync(`${path}.1`, "utf8"), c + d);
    assert.equal(readFileSync(`${path}.2`, "utf8"), a + b);
    assert.equal(existsSync(`${path}.3`), false);

    const launcher = resolve(root, "app.log");
    writeFileSync(launcher, "small");
    rotateIfLarger(launcher, 10, 2);
    assert.equal(existsSync(`${launcher}.1`), false);
    writeFileSync(launcher, "larger than ten bytes");
    rotateIfLarger(launcher, 10, 2);
    assert.equal(existsSync(launcher), false);
    assert.equal(readFileSync(`${launcher}.1`, "utf8"), "larger than ten bytes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
