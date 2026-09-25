import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { backupBeforeMigrate, scheduledBackup, writeUpgradeReport } from "./lib/pre-upgrade-backup.mjs";
import { caddyfile, commandLine, hostDefinitions, hostNames, parseWinswService } from "./lib/host.mjs";
import { connectionAdvice, hostAddress } from "./lib/connect.mjs";

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

test("desktop configures the offline imagery and elevation archives it finds", async () => {
  const files = fixture();
  try {
    writeFileSync(resolve(files.publicRoot, "basemap/north-coast-imagery.pmtiles"), "imagery");
    const config = await desktopRuntimeConfig(files.publicRoot);
    assert.equal(config.OPENEOC_IMAGERY_TILE_URL, "pmtiles:///basemap/north-coast-imagery.pmtiles");
    assert.match(config.OPENEOC_IMAGERY_ATTRIBUTION, /NAIP/);
    assert.equal(config.OPENEOC_TERRAIN_TILE_URL, undefined);
  } finally {
    rmSync(files.root, { recursive: true, force: true });
  }
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
  assert.deepEqual(Object.keys(PROFILE_DEFAULTS), ["production", "demo", "host", "host-demo"]);
  assert.equal(new Set(plans.flatMap((plan) => [plan.pgPort, plan.httpPort])).size, 8);
  assert.equal(new Set(Object.values(PROFILE_DEFAULTS).map((item) => item.database)).size, 4);
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

test("a newer build backs up an existing profile database before migrating it, and a failed or empty backup stops it", () => {
  const backupsDir = mkdtempSync(resolve(tmpdir(), "openeoc-pre-upgrade-"));
  try {
    const files = ["0001_baseline.sql", "0102_sync_snapshots.sql"];
    const dumped = [];
    const dump = (path) => {
      dumped.push(path);
      writeFileSync(path, "PGDMP");
    };
    const now = new Date("2026-09-23T18:04:05.678Z");
    assert.equal(backupBeforeMigrate({ applied: [], files, backupsDir, dump, now }), null);
    assert.equal(backupBeforeMigrate({ applied: files, files, backupsDir, dump, now }), null);
    assert.deepEqual(dumped, []);

    const path = backupBeforeMigrate({ applied: ["0001_baseline.sql"], files, backupsDir, dump, now });
    assert.equal(path, resolve(backupsDir, "pre-upgrade-20260923T180405Z.sql"));
    assert.deepEqual(dumped, [path]);

    const pending = { applied: ["0001_baseline.sql"], files, backupsDir, now: new Date("2026-09-24T00:00:00Z") };
    assert.throws(() => backupBeforeMigrate({ ...pending, dump: () => { throw new Error("pg_dump exited with 1"); } }), /pg_dump exited with 1/);
    assert.throws(() => backupBeforeMigrate({ ...pending, dump: (file) => writeFileSync(file, "") }), /missing or empty; the database was not migrated/);
  } finally {
    rmSync(backupsDir, { recursive: true, force: true });
  }
});

test("an upgrade report beside the dump names each migration applied with what it changes, and the way back", () => {
  const root = mkdtempSync(resolve(tmpdir(), "openeoc-upgrade-report-"));
  try {
    const migrationsDir = resolve(root, "migrations");
    mkdirSync(migrationsDir);
    writeFileSync(resolve(migrationsDir, "0138_request_acceptance.sql"), "-- Receipt is not acceptance.\n-- Triaged requests become accepted.\nalter table x add column y int;\n");
    writeFileSync(resolve(migrationsDir, "0139_quiet.sql"), "create table z (id int);\n");
    const backup = resolve(root, "pre-upgrade-20260925T010203Z.sql");
    const path = writeUpgradeReport({ backup, applied: ["0138_request_acceptance.sql", "0139_quiet.sql"], migrationsDir, profile: "production", now: new Date("2026-09-25T01:02:03Z") });
    assert.equal(path, resolve(root, "pre-upgrade-20260925T010203Z.txt"));
    const report = readFileSync(path, "utf8");
    assert.match(report, /^Open Source EOC upgrade of the production profile, 2026-09-25T01:02:03.000Z/);
    assert.match(report, /0138_request_acceptance.sql\n {2}Receipt is not acceptance.\n {2}Triaged requests become accepted.\n/);
    assert.match(report, /0139_quiet.sql\n {2}No description at the head of the migration.\n/);
    assert.match(report, /"Go back" section of docs\/guides\/UPGRADE.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a scheduled backup dumps the database and copies the file store, then removes only its own backups past the kept days", () => {
  const root = mkdtempSync(resolve(tmpdir(), "openeoc-scheduled-backup-"));
  try {
    const backupsDir = resolve(root, "backups");
    const blobsDir = resolve(root, "blobs");
    mkdirSync(resolve(blobsDir, "ab"), { recursive: true });
    writeFileSync(resolve(blobsDir, "ab/abcdef"), "stored file");
    writeFileSync(resolve(blobsDir, ".upload-in-progress"), "partial");
    mkdirSync(resolve(backupsDir, "openeoc-20260901T000000Z.blobs"), { recursive: true });
    const earlier = ["openeoc-20260901T000000Z.sql", "openeoc-20260920T000000Z.sql", "pre-upgrade-20260801T000000Z.sql", "notes.txt"];
    for (const name of earlier) writeFileSync(resolve(backupsDir, name), "x");
    const now = new Date("2026-09-23T02:30:00Z");
    const dump = (path) => writeFileSync(path, "-- PostgreSQL database dump complete\n");

    for (const failing of [() => { throw new Error("pg_dump exited with 1"); }, (path) => writeFileSync(path, "")]) {
      assert.throws(() => scheduledBackup({ backupsDir, blobsDir, dump: failing, now }), /no backup was written and none was removed/);
      assert.deepEqual(readdirSync(backupsDir).sort(), [...earlier, "openeoc-20260901T000000Z.blobs"].sort());
    }
    assert.throws(() => scheduledBackup({ backupsDir, blobsDir, dump, keepDays: 0, now }), /whole number/);

    const result = scheduledBackup({ backupsDir, blobsDir, dump, now });
    assert.equal(result.database, resolve(backupsDir, "openeoc-20260923T023000Z.sql"));
    assert.equal(readFileSync(resolve(result.files, "ab/abcdef"), "utf8"), "stored file");
    // On the store's own volume the backup links the stored file rather than copying it.
    assert.equal(statSync(resolve(result.files, "ab/abcdef")).ino, statSync(resolve(blobsDir, "ab/abcdef")).ino);
    assert.equal(statSync(resolve(blobsDir, "ab/abcdef")).nlink, 2);
    assert.equal(existsSync(resolve(result.files, ".upload-in-progress")), false);
    assert.deepEqual(result.removed.sort(), ["openeoc-20260901T000000Z.blobs", "openeoc-20260901T000000Z.sql"]);
    assert.deepEqual(readdirSync(backupsDir).sort(), [
      "notes.txt",
      "openeoc-20260920T000000Z.sql",
      "openeoc-20260923T023000Z.blobs",
      "openeoc-20260923T023000Z.sql",
      "pre-upgrade-20260801T000000Z.sql",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backing up a profile that is not set up changes nothing", { skip: process.platform !== "win32" }, () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), "openeoc-backup-unconfigured-"));
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./desktop.mjs", import.meta.url)), "backup", "--profile=acceptance"], {
      encoding: "utf8",
      env: { ...process.env, OPENEOC_DESKTOP_DATA_ROOT: dataRoot, OPENEOC_ENABLE_ACCEPTANCE_PROFILE: "1" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Profile acceptance is not ready; nothing was backed up/);
    assert.deepEqual(readdirSync(dataRoot), []);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("a network host's address is its HTTPS origin, or plain HTTP to this computer alone", () => {
  assert.equal(hostAddress(" https://eoc.county.example/sign-in?x=1 "), "https://eoc.county.example");
  assert.equal(hostAddress("https://eoc.county.example:8443"), "https://eoc.county.example:8443");
  assert.equal(hostAddress("http://127.0.0.1:8084"), "http://127.0.0.1:8084");
  assert.throws(() => hostAddress("http://eoc.county.example"), /over HTTPS/);
  assert.throws(() => hostAddress("https://user:secret@eoc.county.example"), /no user name or password/);
  assert.throws(() => hostAddress("eoc.county.example"), /Not a web address/);
});

test("a failed connection check says what to do, by cause", () => {
  const origin = "https://eoc.county.example";
  const untrusted = connectionAdvice({ cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } }, origin);
  assert.equal(untrusted[0], `CONNECT_UNTRUSTED url=${origin}`);
  assert.match(untrusted.join(" "), /\/trust\/openeoc-root\.crt[\s\S]*Thumbprint[\s\S]*Trusted Root Certification Authorities/);
  assert.equal(connectionAdvice({ cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" } }, origin)[0], `CONNECT_WRONG_NAME url=${origin}`);
  assert.equal(connectionAdvice({ cause: { code: "ECONNREFUSED" } }, origin)[0], `CONNECT_UNREACHABLE url=${origin}`);
  assert.equal(connectionAdvice({ name: "TimeoutError" }, origin)[0], `CONNECT_UNREACHABLE url=${origin}`);
  assert.equal(connectionAdvice(new Error("something else"), origin), null);
});

test("connecting keeps the host's address, reports a ready host and explains one that does not answer", { skip: process.platform !== "win32" }, async () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), "openeoc-connect-"));
  const { createServer } = await import("node:http");
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/api/v1/ready" ? 200 : 404).end();
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}`;
  const connect = (...args) => new Promise((done) => {
    execFile(process.execPath, [fileURLToPath(new URL("./desktop.mjs", import.meta.url)), "connect", "--no-browser", ...args],
      { encoding: "utf8", env: { ...process.env, OPENEOC_DESKTOP_DATA_ROOT: dataRoot } },
      (error, stdout, stderr) => done({ status: error?.code ?? 0, stdout, stderr }));
  });
  try {
    const first = await connect(`--url=${url}/any/path`);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, new RegExp(`CONNECT_READY url=${url}`));
    assert.equal(JSON.parse(readFileSync(resolve(dataRoot, "connect.json"), "utf8")).url, url);
    // Later opens use the kept address.
    const again = await connect();
    assert.match(again.stdout, new RegExp(`CONNECT_READY url=${url}`));
    await new Promise((done) => server.close(done));
    const down = await connect();
    assert.equal(down.status, 2);
    assert.match(down.stdout, new RegExp(`CONNECT_UNREACHABLE url=${url}`));
    const refused = await connect("--url=http://eoc.county.example");
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /over HTTPS/);
  } finally {
    server.close();
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

test("the host is reached by its computer name, DNS name, added names and IPv4 addresses", () => {
  const interfaces = {
    Ethernet: [{ family: "IPv4", address: "192.168.1.20", internal: false }, { family: "IPv6", address: "fe80::1", internal: false }],
    "Wi-Fi": [{ family: "IPv4", address: "169.254.10.4", internal: false }, { family: "IPv4", address: "10.0.0.7", internal: false }],
    Loopback: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
  };
  assert.deepEqual(
    hostNames({ hostname: "EOC-HOST", fqdn: "eoc-host.county.local", interfaces, extra: ["eoc.county.gov"] }),
    ["eoc-host", "eoc-host.county.local", "eoc.county.gov", "192.168.1.20", "10.0.0.7", "localhost", "127.0.0.1"],
  );
  assert.deepEqual(hostNames({ hostname: "EOC_HOST", fqdn: "EOC_HOST", interfaces: {} }), ["localhost", "127.0.0.1"]);
  assert.throws(() => hostNames({ hostname: "eoc", extra: ["eoc.county.gov { respond hi }"] }), /not a host name/);
});

test("host definitions run PostgreSQL, the server and Caddy as LocalService behind HTTPS with the host's own authority", () => {
  const input = {
    appRoot: "C:\\Program Files\\Open Source EOC\\app",
    dataRoot: "C:\\ProgramData\\Open Source EOC",
    profile: "host",
    profileRoot: "C:\\ProgramData\\Open Source EOC\\profiles\\host",
    pgData: "C:\\ProgramData\\Open Source EOC\\profiles\\host\\pgdata",
    pgPort: 55443,
    httpPort: 8083,
    names: ["eoc-host", "192.168.1.20", "localhost", "127.0.0.1"],
    nodeExecutable: "C:\\Program Files\\Open Source EOC\\app\\runtime\\node\\node.exe",
    caddyExecutable: "C:\\Program Files\\Open Source EOC\\app\\runtime\\caddy\\caddy.exe",
    distRoot: "C:\\Program Files\\Open Source EOC\\app\\web\\dist",
    publicRoot: "C:\\Program Files\\Open Source EOC\\app\\web\\public",
    pgDist: "C:\\Program Files\\Open Source EOC\\app\\runtime\\pgsql",
    powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  };
  const host = hostDefinitions(input);
  assert.equal(host.publicUrl, "https://eoc-host");

  const server = parseWinswService(host.services.server);
  assert.equal(server.id, "OpenSourceEOC-Server");
  assert.equal(server.executable, input.nodeExecutable);
  assert.equal(server.arguments, '"C:\\Program Files\\Open Source EOC\\app\\deploy\\windows\\desktop.mjs" host-serve --profile=host');
  assert.equal(server.workingDirectory, input.appRoot);
  assert.deepEqual(server.env, {
    OPENEOC_DESKTOP_PREBUILT: "1",
    OPENEOC_DESKTOP_DATA_ROOT: input.dataRoot,
    OPENEOC_DESKTOP_DIST_ROOT: input.distRoot,
    OPENEOC_DESKTOP_PUBLIC_ROOT: input.publicRoot,
    OPENEOC_PG_DIST: input.pgDist,
    OPENEOC_TRUST_PROXY: "127.0.0.1",
    OPENEOC_PUBLIC_URL: "https://eoc-host",
    OPENEOC_TRUST_CERTIFICATE_URL: "/trust/openeoc-root.crt",
  });
  for (const definition of [host.services.server, host.services.caddy]) {
    assert.match(definition, /<serviceaccount>\s*<domain>NT AUTHORITY<\/domain>\s*<user>LocalService<\/user>\s*<\/serviceaccount>/);
    assert.match(definition, /<startmode>Automatic<\/startmode>/);
    assert.match(definition, /<onfailure action="restart" delay="10 sec" \/>/);
    assert.match(definition, /<logpath>C:\\ProgramData\\Open Source EOC\\profiles\\host\\logs<\/logpath>/);
  }
  assert.match(host.services.server, /<depend>OpenSourceEOC-PostgreSQL<\/depend>/);
  const caddy = parseWinswService(host.services.caddy);
  assert.equal(caddy.executable, input.caddyExecutable);
  assert.equal(caddy.arguments, 'run --config "C:\\ProgramData\\Open Source EOC\\host\\Caddyfile" --adapter caddyfile');
  assert.equal(caddy.env.XDG_DATA_HOME, "C:\\ProgramData\\Open Source EOC\\host\\caddy");

  const sites = host.caddyfile.split("\n").find((line) => line.startsWith("https://"));
  assert.equal(sites, "https://eoc-host, https://192.168.1.20, https://localhost, https://127.0.0.1 {");
  for (const line of ["admin off", "persist_config off", "skip_install_trust", "tls internal", "reverse_proxy 127.0.0.1:8083",
    "handle /trust/openeoc-root.crt {", "rewrite * /pki/authorities/local/root.crt", 'root "C:/ProgramData/Open Source EOC/host/caddy"'])
    assert.ok(host.caddyfile.includes(line), line);
  assert.doesNotMatch(host.caddyfile, /default_bind/);

  assert.match(host.backupTask, /<UserId>S-1-5-19<\/UserId>/);
  assert.match(host.backupTask, /<DaysInterval>1<\/DaysInterval>/);
  assert.ok(host.backupTask.replaceAll("&quot;", '"').includes('-File "C:\\Program Files\\Open Source EOC\\app\\deploy\\windows\\Open-Source-EOC.ps1" -Action Backup -Profile host'));
  assert.match(host.firewall.add, /-Direction Inbound -Action Allow -Protocol TCP -LocalPort 80,443 -Program 'C:\\Program Files\\Open Source EOC\\app\\runtime\\caddy\\caddy\.exe' -Profile Any/);
  assert.match(host.firewall.remove, /Get-NetFirewallRule -Name 'OpenSourceEOC-Host'/);
  assert.deepEqual(host.postgresRegister, ["register", "-N", "OpenSourceEOC-PostgreSQL", "-U", "NT AUTHORITY\\LocalService", "-D", input.pgData, "-S", "auto", "-w", "-t", "120"]);
  assert.match(host.postgresSettings, /^listen_addresses = '127\.0\.0\.1'$/m);
  assert.match(host.postgresSettings, /^port = 55443$/m);
  assert.match(host.postgresSettings, /^log_directory = 'C:\/ProgramData\/Open Source EOC\/profiles\/host\/logs'$/m);

  const agency = hostDefinitions({ ...input, certificate: { cert: "C:\\certs\\eoc.pem", key: "C:\\certs\\eoc.key" } });
  assert.ok(agency.caddyfile.includes('tls "C:/certs/eoc.pem" "C:/certs/eoc.key"'));
  assert.doesNotMatch(agency.caddyfile, /tls internal|\/trust\//);
  assert.equal(parseWinswService(agency.services.server).env.OPENEOC_TRUST_CERTIFICATE_URL, undefined);
  assert.throws(() => hostDefinitions({ ...input, profile: "production" }), /Not a host profile/);
});

test("host definitions refuse values that would change their meaning", () => {
  assert.throws(() => commandLine(['a"b']), /cannot contain a quote/);
  assert.equal(commandLine(["run", "C:\\a b\\c", ""]), 'run "C:\\a b\\c" ""');
  const base = { names: ["localhost"], upstreamPort: 8083, storage: "C:/s", logFile: "C:/l/caddy.log", caName: "Open Source EOC localhost" };
  assert.throws(() => caddyfile({ ...base, storage: 'C:/s" }' }), /cannot contain quotes, braces or line breaks/);
  const loopback = caddyfile({ ...base, httpsPort: 9443, httpPort: 9080, bind: "127.0.0.1" });
  assert.match(loopback, /^\tdefault_bind 127\.0\.0\.1$/m);
  assert.match(loopback, /^https:\/\/localhost:9443 \{$/m);
  const escaped = hostDefinitions({
    appRoot: "C:\\R&D\\app", dataRoot: "C:\\data", profile: "host-demo", profileRoot: "C:\\data\\profiles\\host-demo", pgData: "C:\\p",
    pgPort: 55444, httpPort: 8084, names: ["localhost"], nodeExecutable: "C:\\R&D\\app\\node.exe", caddyExecutable: "C:\\c.exe",
    distRoot: "C:\\d", publicRoot: "C:\\u", pgDist: "C:\\g", powershell: "C:\\ps.exe",
  });
  assert.match(escaped.services.server, /<executable>C:\\R&amp;D\\app\\node\.exe<\/executable>/);
  assert.equal(parseWinswService(escaped.services.server).executable, "C:\\R&D\\app\\node.exe");
});

test("a host profile is never started or stopped as a desktop profile, and removing no host changes nothing", { skip: process.platform !== "win32" }, () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), "openeoc-host-"));
  const launcher = fileURLToPath(new URL("./desktop.mjs", import.meta.url));
  try {
    for (const action of ["start", "stop", "launch"]) {
      const result = spawnSync(process.execPath, [launcher, action, "--profile=host"], { encoding: "utf8", env: { ...process.env, OPENEOC_DESKTOP_DATA_ROOT: dataRoot } });
      assert.equal(result.status, 1, action);
      assert.match(result.stderr, /runs as Windows services; set it up with -Action HostInstall/);
    }
    const removed = spawnSync(process.execPath, [launcher, "hostremove"], { encoding: "utf8", env: { ...process.env, OPENEOC_DESKTOP_DATA_ROOT: dataRoot } });
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /HOST_NOT_INSTALLED/);
    assert.deepEqual(readdirSync(dataRoot), []);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
