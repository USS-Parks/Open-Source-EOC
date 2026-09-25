import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { createRequire } from "node:module";
import { hostname, networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hostDefinitions, hostNames } from "./lib/host.mjs";
import { request, startLoopbackHost, stopChild, until } from "./lib/loopback-host.mjs";

/**
 * The network host without the system changes the setup program makes. A
 * host-demo profile is set up in a temporary data root; PostgreSQL starts from
 * the host's settings file; the server and Caddy start exactly as their
 * generated service definitions say, as this user and on the loopback address
 * with spare ports. The host is then reached over HTTPS with its own
 * certificate authority, by Node's TLS client and by Chromium, a person signs
 * in and the console opens, the backup task's command runs against the live
 * host, the backup is restored into a new database, and the server restarts
 * on the same data. Installing the services, the firewall rule, the task and
 * the trusted root is the setup program's part: Test-OpenEOCHost.ps1 checks it.
 *
 *   node deploy/windows/prove-host.mjs
 *
 * Needs the desktop build (-Action Build), the PostgreSQL test runtime and
 * Caddy (OPENEOC_CADDY, else the unpacked release under out/runtime-inputs).
 */

const root = process.cwd();
const out = resolve(root, "deploy/test-runtime/out/rd3-proof");
mkdirSync(out, { recursive: true });
const caddyExe = resolve(process.env.OPENEOC_CADDY ?? resolve(root, "deploy/windows/out/runtime-inputs/host-tools/caddy/caddy.exe"));
const pgDist = resolve(process.env.OPENEOC_PG_DIST ?? resolve(root, "deploy/test-runtime/out/pgsql"));
const distRoot = resolve(root, "deploy/windows/out/build/app-dist");
const publicRoot = resolve(root, "web/public");
for (const path of [caddyExe, resolve(pgDist, "bin/pg_ctl.exe"), resolve(distRoot, "index.html")])
  assert.ok(existsSync(path), `Missing: ${path}`);
const requireServer = createRequire(resolve(root, "server/package.json"));
const postgres = requireServer("postgres");
const { chromium } = requireServer("playwright-core");

const dataRoot = mkdtempSync(resolve(tmpdir(), "oeh-"));
const launcher = resolve(root, "deploy/windows/desktop.mjs");
const profile = "host-demo";
const result = { status: "running", dataRoot, startedAt: new Date().toISOString() };
let host = null;

function spki(pem) {
  const der = new X509Certificate(pem).publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("base64");
}

try {
  host = await startLoopbackHost({ root, dataRoot, out, distRoot, publicRoot, pgDist, caddyExe, profile });
  const { common, env, httpsPort, paths, pgPort, profileRoot, redirectPort, rootPem, https } = host;
  assert.match(host.setup, /PROFILE_READY profile=host-demo synthetic=true/);
  result.setupSeconds = host.setupSeconds;
  assert.ok(readdirSync(resolve(profileRoot, "logs")).some((name) => /^postgres-\w+\.log$/.test(name)), "PostgreSQL logs to the profile's folder");

  // The definitions setup renders, for this machine's names as the host would use them.
  const production = hostDefinitions({ ...common, names: hostNames({ hostname: hostname(), interfaces: networkInterfaces() }) });
  writeFileSync(resolve(out, "Caddyfile.production"), production.caddyfile);
  writeFileSync(resolve(out, "OpenSourceEOC-Server.xml"), production.services.server);
  writeFileSync(resolve(out, "OpenSourceEOC-Caddy.xml"), production.services.caddy);
  writeFileSync(resolve(out, "backup-task.xml"), production.backupTask);
  execFileSync(caddyExe, ["validate", "--config", resolve(out, "Caddyfile.production"), "--adapter", "caddyfile"], {
    env: { ...process.env, XDG_DATA_HOME: resolve(out, "validate"), XDG_CONFIG_HOME: resolve(out, "validate") },
    encoding: "utf8",
  });
  result.productionCaddyfileValid = true;
  result.productionNames = production.names;

  const rootCertificate = new X509Certificate(rootPem);
  result.authority = { subject: rootCertificate.subject, validTo: rootCertificate.validTo, sha256: rootCertificate.fingerprint256 };

  // Verified against the host's root, by name and by address (no server name sent), and refused without it.
  for (const url of [`${https}/api/v1/ready`, `https://127.0.0.1:${httpsPort}/api/v1/ready`]) {
    const response = await request(httpsGet, url, { ca: rootPem });
    assert.equal(response.status, 200, url);
    assert.equal(JSON.parse(response.body).status, "ready");
  }
  await assert.rejects(request(httpsGet, `${https}/api/v1/ready`), /self-signed|unable to verify|certificate/i);
  result.httpsVerifiedByRoot = true;

  const trust = await request(httpsGet, `${https}/trust/openeoc-root.crt`, { ca: rootPem });
  assert.equal(trust.status, 200);
  assert.equal(trust.headers["content-type"], "application/x-x509-ca-cert");
  assert.ok(trust.body.equals(rootPem), "The trust download is the host's root certificate");
  const redirect = await request(httpGet, `http://127.0.0.1:${redirectPort}/`);
  assert.ok([301, 302, 307, 308].includes(redirect.status), `redirect status ${redirect.status}`);
  // On spare ports Caddy's redirect names no port; on the host, 80 goes to 443, which needs none.
  assert.match(redirect.headers.location, /^https:\/\/127\.0\.0\.1(:\d+)?\/$/);
  result.trustDownload = true;
  result.httpRedirect = redirect.headers.location;

  // Chromium trusting the host's authority by its keys, with no change to this computer's trust store.
  const keys = [spki(rootPem), spki(readFileSync(paths.intermediateCertificate))].join(",");
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    args: [`--ignore-certificate-errors-spki-list=${keys}`, "--disable-background-networking", "--disable-component-update", "--disable-default-apps"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1586, height: 992 }, acceptDownloads: true });
    const external = [];
    const errors = [];
    const sockets = [];
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(`${https}/`) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      external.push(url);
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("websocket", (socket) => sockets.push(socket.url()));
    const response = await page.goto(https, { waitUntil: "load" });
    assert.equal(response.status(), 200);
    const security = await response.securityDetails();
    result.browserTls = { protocol: security?.protocol, issuer: security?.issuer };
    await page.getByText("Trust this server").click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download the certificate" }).click()]);
    assert.equal(download.suggestedFilename(), "open-source-eoc-root.crt");
    assert.ok(readFileSync(await download.path()).equals(rootPem), "The sign-in page's download is the root certificate");
    await page.screenshot({ path: join(out, "sign-in-trust.png") });
    await page.getByLabel("Email").fill("jordan.lee@humboldt.example");
    await page.getByLabel("Password").fill("north-coast-exercise");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();
    await page.getByText("North Coast", { exact: false }).filter({ visible: true }).first().waitFor();
    await until(() => sockets.some((url) => url.startsWith(`wss://localhost:${httpsPort}/`)), 30_000, "No live sync socket through HTTPS");
    await page.screenshot({ path: join(out, "console-over-https.png") });
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    result.browser = { signedIn: true, liveSocket: sockets.find((url) => url.startsWith("wss://")), externalRequests: external.length, pageErrors: errors.length };
  } finally {
    await browser.close();
  }

  // Edge too, the other browser the app window opens in, at the scaled laptop size.
  const edge = await chromium.launch({
    executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    args: [`--ignore-certificate-errors-spki-list=${keys}`, "--disable-background-networking", "--disable-component-update", "--disable-default-apps"],
  });
  try {
    const page = await (await edge.newContext({ viewport: { width: 1534, height: 790 } })).newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(https, { waitUntil: "load" });
    assert.equal(response.status(), 200);
    await page.getByLabel("Email").fill("jordan.lee@humboldt.example");
    await page.getByLabel("Password").fill("north-coast-exercise");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();
    await page.screenshot({ path: join(out, "console-over-https-edge.png") });
    assert.deepEqual(errors, []);
    result.edge = { signedIn: true, pageErrors: errors.length };
  } finally {
    await edge.close();
  }

  // The installed app connecting to the host: checked against this computer's
  // trust store, which does not hold the host's authority, then with it added,
  // as installing the downloaded certificate does.
  const connectRoot = mkdtempSync(resolve(tmpdir(), "oec-"));
  try {
    const connect = (extraEnv) => spawnSync(process.execPath, ["--use-system-ca", launcher, "connect", "--no-browser", `--url=${https}`],
      { cwd: root, env: { ...process.env, OPENEOC_DESKTOP_DATA_ROOT: connectRoot, ...extraEnv }, encoding: "utf8" });
    const untrusted = connect({});
    assert.equal(untrusted.status, 2, untrusted.stdout + untrusted.stderr);
    assert.match(untrusted.stdout, /^CONNECT_UNTRUSTED url=https:\/\/localhost:\d+$/m);
    writeFileSync(resolve(connectRoot, "root.pem"), rootPem);
    const trusted = connect({ NODE_EXTRA_CA_CERTS: resolve(connectRoot, "root.pem") });
    assert.equal(trusted.status, 0, trusted.stdout + trusted.stderr);
    assert.match(trusted.stdout, /^CONNECT_READY url=https:\/\/localhost:\d+$/m);
    result.connect = { untrusted: "CONNECT_UNTRUSTED", trusted: "CONNECT_READY" };
  } finally {
    rmSync(connectRoot, { recursive: true, force: true });
  }

  // The backup task's command, against the running host; then the backup restored into a new database.
  const backup = execFileSync(process.execPath, [launcher, "backup", `--profile=${profile}`], { cwd: root, env, encoding: "utf8" });
  const dump = /BACKUP_WRITTEN profile=host-demo database=(\S+) files=(\S+)/.exec(backup);
  assert.ok(dump, backup);
  const ownerPassword = readFileSync(resolve(profileRoot, "secrets/postgres.password"), "utf8").trim();
  const pgEnv = { ...process.env, PGHOST: "127.0.0.1", PGPORT: String(pgPort), PGUSER: "postgres", PGPASSWORD: ownerPassword };
  execFileSync(resolve(pgDist, "bin/createdb.exe"), ["restore_check"], { env: pgEnv, stdio: "ignore" });
  execFileSync(resolve(pgDist, "bin/psql.exe"), ["-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-d", "restore_check", "-f", dump[1]], { env: pgEnv, stdio: "ignore" });
  const count = async (database) => {
    const sql = postgres({ host: "127.0.0.1", port: pgPort, username: "postgres", password: ownerPassword, database });
    try {
      const [row] = await sql`select (select count(*) from incidents)::int as incidents, (select count(*) from board_records)::int as records, (select count(*) from persons)::int as persons`;
      return row;
    } finally {
      await sql.end();
    }
  };
  const live = await count("openeoc_host_demo");
  const restored = await count("restore_check");
  assert.deepEqual(restored, live);
  assert.ok(live.incidents > 0 && live.records > 0);
  result.backup = { database: dump[1], files: dump[2], restoredCounts: restored };

  // A service restart: the server migrates on start and keeps the data.
  await stopChild(host.server);
  host.startServer("server-restart");
  await until(async () => (await request(httpsGet, `${https}/api/v1/ready`, { ca: rootPem }).catch(() => ({}))).status === 200, 180_000, "The server did not come back");
  assert.deepEqual(await count("openeoc_host_demo"), live);
  result.restartKeptData = true;

  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (host) await host.stop();
  result.finishedAt = new Date().toISOString();
  writeFileSync(resolve(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "passed") rmSync(dataRoot, { recursive: true, force: true });
}
