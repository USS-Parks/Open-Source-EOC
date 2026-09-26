import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import { release, tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startLoopbackHost } from "./lib/loopback-host.mjs";
import { standInsReport, startStandIns } from "./lib/stand-ins.mjs";

/**
 * The system opens no connection outside this computer and its local
 * network. The network host profile with the North Coast Storm demo is set
 * up, started as its service definitions say (PostgreSQL, the server with its
 * delivery queue and scheduler, Caddy), walked end to end in Chromium over
 * HTTPS, and backed up, while four recorders watch:
 *
 * - every Node process the system starts (the setup step, the server, the
 *   backup) loads lib/net-recorder.mjs through NODE_OPTIONS and writes each
 *   TCP, TLS, DNS and UDP destination it asks for;
 * - a sampler lists, half a second after each sample ends, the TCP
 *   connections of every process descended from this proof and of the
 *   PostgreSQL server, which covers PostgreSQL and Caddy;
 * - Chromium writes its own network log of every request, with who started
 *   it: a page's requests are counted, and the browser's own services'
 *   requests are listed apart as the browser's;
 * - the page records every request it makes.
 *
 * Then the built web app and the server sources are scanned for outside
 * addresses. Writes AIR-GAP-REPORT.md at the repository root and exits
 * non-zero on any connection outside the machine and its local network.
 *
 *   node deploy/windows/prove-airgap.mjs [--stand-ins]
 *
 * With --stand-ins, every optional integration the host can reach is also
 * configured through its own API against a stand-in on this computer (an
 * SMTP relay, an HTTP SMS provider and then a gateway phone, webhook and ntfy
 * receivers, a GeoJSON feed server, and a second network host for
 * federation), taken through an outage and back around the walk, and the
 * report records what queued, what was delivered when its route returned,
 * what expired, what was resent and what reconciled. One webhook is left to
 * expire at the end of the shortest window the product allows, an hour, so
 * that run takes a little over an hour.
 *
 * Needs what prove-host.mjs needs: the desktop build, the PostgreSQL runtime
 * and Caddy.
 */

const root = process.cwd();
const standIns = process.argv.includes("--stand-ins");
const out = resolve(root, `deploy/test-runtime/out/rd5-airgap${standIns ? "-stand-ins" : ""}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const distRoot = resolve(root, "deploy/windows/out/build/app-dist");
const publicRoot = resolve(root, "web/public");
const pgDist = resolve(process.env.OPENEOC_PG_DIST ?? resolve(root, "deploy/test-runtime/out/pgsql"));
const caddyExe = resolve(process.env.OPENEOC_CADDY ?? resolve(root, "deploy/windows/out/runtime-inputs/host-tools/caddy/caddy.exe"));
const chromeExe = process.env.OPENEOC_CHROMIUM ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
for (const path of [caddyExe, resolve(pgDist, "bin/pg_ctl.exe"), resolve(distRoot, "index.html"), chromeExe])
  assert.ok(existsSync(path), `Missing: ${path}`);
const { chromium } = createRequire(resolve(root, "server/package.json"))("playwright-core");

// Every Node process started from here on records its destinations.
const nodeRecord = resolve(out, "node-connections.jsonl");
writeFileSync(nodeRecord, "");
process.env.OPENEOC_NET_RECORD = nodeRecord;
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(resolve(root, "deploy/windows/lib/net-recorder.mjs")).href}`.trim();

/** Loopback, private, link-local and unique-local addresses stay on the machine or its network. */
function local(host) {
  const name = String(host).replace(/^\[|\]$/g, "").toLowerCase();
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  const version = isIP(name);
  if (version === 4) {
    const [a, b] = name.split(".").map(Number);
    return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (version === 6) return name === "::1" || name === "::" || /^(fe8|fe9|fea|feb|fc|fd)/.test(name) || name.startsWith("::ffff:127.");
  return false;
}

/** The run's phases in order, each with its start time. */
const phases = [];
const mark = (name) => phases.push({ name, at: new Date().toISOString() });
const phaseAt = (at) => phases.filter((entry) => entry.at <= at).at(-1)?.name ?? phases[0]?.name;

const dataRoot = mkdtempSync(resolve(tmpdir(), "oea-"));
// The federation partner, a second network host profile beside the first.
const partnerRoot = standIns ? mkdtempSync(resolve(tmpdir(), "oep-")) : null;

// The sampler: a PowerShell loop, on its own timer so it keeps sampling while
// the setup step blocks this process, listing half a second after each sample ends the TCP
// connections of this proof's process tree and of each PostgreSQL server
// named in a postmaster.pid.
const sampled = new Map();
const pidFiles = [dataRoot, partnerRoot].filter(Boolean)
  .map((dir) => `'${resolve(dir, "profiles", "host-demo", "pgdata", "postmaster.pid").replaceAll("'", "''")}'`);
const samplerScript = `
$ErrorActionPreference = 'SilentlyContinue'
$pidFiles = @(${pidFiles.join(", ")})
while ($true) {
  $procs = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name
  $roots = @(${process.pid})
  foreach ($pidFile in $pidFiles) { if (Test-Path -LiteralPath $pidFile) { $roots += [int](Get-Content -LiteralPath $pidFile -TotalCount 1) } }
  $ours = New-Object 'System.Collections.Generic.HashSet[int]'
  foreach ($r in $roots) { [void]$ours.Add($r) }
  do {
    $grew = $false
    foreach ($p in $procs) { if ($ours.Contains([int]$p.ParentProcessId) -and $ours.Add([int]$p.ProcessId)) { $grew = $true } }
  } while ($grew)
  $names = @{}
  foreach ($p in $procs) { if ($ours.Contains([int]$p.ProcessId)) { $names[[int]$p.ProcessId] = $p.Name } }
  $rows = @(Get-NetTCPConnection | Where-Object { $ours.Contains([int]$_.OwningProcess) -and $_.RemoteAddress -notin @('0.0.0.0', '::') } |
    ForEach-Object { @{ pid = [int]$_.OwningProcess; name = $names[[int]$_.OwningProcess]; remote = $_.RemoteAddress; port = [int]$_.RemotePort } })
  [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ t = (Get-Date).ToUniversalTime().ToString('o'); processes = $ours.Count; rows = $rows }))
  Start-Sleep -Milliseconds 500
}`;
mark("set up and first start");
const sampler = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", samplerScript], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
let samples = 0;
let processesWatched = 0;
let buffered = "";
sampler.stdout.on("data", (chunk) => {
  buffered += chunk;
  let newline;
  while ((newline = buffered.indexOf("\n")) >= 0) {
    const line = buffered.slice(0, newline).trim();
    buffered = buffered.slice(newline + 1);
    if (!line) continue;
    const sample = JSON.parse(line);
    samples += 1;
    processesWatched = Math.max(processesWatched, sample.processes);
    // One row per process and destination, with the phases it was seen in, kept as the samples come.
    for (const row of [].concat(sample.rows ?? [])) {
      const key = `${row.name} ${row.remote}:${row.port}`;
      const seen = sampled.get(key) ?? { ...row, phases: new Set(), count: 0 };
      seen.phases.add(phaseAt(sample.t));
      seen.count += 1;
      sampled.set(key, seen);
    }
  }
});

const result = { status: "running", startedAt: new Date().toISOString() };
const pageRequests = new Map();
const pageErrors = [];
let host = null;
let partner = null;
let drill = null;
let visited = [];
try {
  host = await startLoopbackHost({ root, dataRoot, out, distRoot, publicRoot, pgDist, caddyExe });
  if (standIns) {
    const partnerOut = resolve(out, "partner");
    mkdirSync(partnerOut, { recursive: true });
    partner = await startLoopbackHost({ root, dataRoot: partnerRoot, out: partnerOut, distRoot, publicRoot, pgDist, caddyExe });
    mark("stand-ins set up");
    drill = await startStandIns({ root, host, partner });
    await drill.configure();
    mark("the cut");
    await drill.cut();
  }
  mark("idle");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000));

  mark("North Coast walk");
  const spki = (pem) => createHash("sha256").update(new X509Certificate(pem).publicKey.export({ type: "spki", format: "der" })).digest("base64");
  const netlog = resolve(out, "chromium-netlog.json");
  const browser = await chromium.launch({
    executablePath: chromeExe,
    args: [
      `--ignore-certificate-errors-spki-list=${[spki(host.rootPem), spki(readFileSync(host.paths.intermediateCertificate))].join(",")}`,
      // The browser's own vendor services are the browser's, not the system's.
      "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-sync",
      `--log-net-log=${netlog}`, "--net-log-capture-mode=Default",
    ],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1534, height: 790 } });
    context.on("request", (request) => {
      const url = request.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      const origin = new URL(url).host;
      pageRequests.set(origin, (pageRequests.get(origin) ?? 0) + 1);
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(host.https, { waitUntil: "load" });
    await page.getByLabel("Email").fill("jordan.lee@humboldt.example");
    await page.getByLabel("Password").fill("north-coast-exercise");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();
    const sections = page.getByRole("navigation", { name: "Sections" }).getByRole("button");
    await sections.first().waitFor();
    // Each button in turn, named by its visible label; the theme switch is left alone.
    const count = await sections.count();
    for (let index = 0; index < count; index += 1) {
      const button = sections.nth(index);
      const label = ((await button.getAttribute("aria-label")) ?? (await button.innerText())).trim();
      if (!label || /theme$/i.test(label) || !(await button.isVisible())) continue;
      await button.click();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(750);
      await page.keyboard.press("Escape");
      visited.push(label);
    }
    // The map, zoomed in and out, so its tiles, glyphs and symbols load.
    await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Map", exact: true }).click();
    const map = page.getByTestId("cop-map");
    await map.waitFor();
    // The section change can replace the map element just after it shows; read its box once it holds still.
    let box = null;
    for (let tries = 0; !box && tries < 40; tries += 1) {
      box = await map.boundingBox();
      if (!box) await page.waitForTimeout(250);
    }
    assert.ok(box, "The map did not show");
    for (const delta of [-600, -600, 600, 600]) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(700);
    }
    await page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.screenshot({ path: resolve(out, "walk-end.png") });
    await context.close();
  } finally {
    await browser.close();
  }

  mark("backup");
  const backup = execFileSync(process.execPath, [resolve(root, "deploy/windows/desktop.mjs"), "backup", "--profile=host-demo"], { cwd: root, env: host.env, encoding: "utf8" });
  assert.match(backup, /BACKUP_WRITTEN profile=host-demo/);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  if (drill) {
    mark("routes return");
    await drill.restore();
    mark("SMS gateway");
    await drill.gateway();
    mark("webhook expiry and resend");
    await drill.expire();
  }
  mark("done");
  const integrations = drill ? await drill.summary() : null;

  // Chromium's own log: every request, by who started it. A page's request
  // names the page's origin as its initiator. The browser's own services
  // (updates, autofill, account sign-in) start theirs with no origin; they
  // are the browser's, not this system's, and are listed apart.
  const browserHosts = new Map();
  const vendorHosts = new Map();
  for (const request of netlogRequests(netlog)) {
    const hostname = new URL(request.url).hostname;
    const into = local(hostname) || /^(?:https?|wss?):\/\//.test(request.initiator ?? "") ? browserHosts : vendorHosts;
    into.set(hostname, (into.get(hostname) ?? 0) + 1);
  }
  // The sampler sees the browser's sockets but not who opened them; a page's
  // outside request would show in the log above with its origin.
  const vendorSockets = [...sampled.values()].filter((row) => row.name === "chrome.exe" && !local(row.remote));

  // The Node processes' own record.
  const nodeRows = readFileSync(nodeRecord, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const nodeTargets = new Map();
  for (const row of nodeRows) {
    const target = row.kind === "ipc" ? `pipe ${row.path}` : row.kind === "dns" ? `name ${row.host}` : `${row.kind} ${row.host}${row.port ? `:${row.port}` : ""}`;
    const entry = nodeTargets.get(target) ?? { kind: row.kind, host: row.host ?? null, count: 0, pids: new Set() };
    entry.count += 1;
    entry.pids.add(row.pid);
    nodeTargets.set(target, entry);
  }

  // The static scan of what ships.
  const scan = scanForOutsideAddresses([distRoot, resolve(root, "server/src"), resolve(root, "shared/src")]);

  const outside = [
    ...[...nodeTargets].filter(([, entry]) => entry.kind !== "ipc" && entry.host !== "connected" && !local(entry.host)).map(([target]) => `Node: ${target}`),
    ...[...sampled.values()].filter((row) => row.name !== "chrome.exe" && !local(row.remote)).map((row) => `${row.name}: ${row.remote}:${row.port}`),
    ...[...browserHosts.keys()].filter((name) => !local(name)).map((name) => `Chromium, a page's request: ${name}`),
    ...[...pageRequests.keys()].filter((origin) => !local(origin.replace(/:\d+$/, ""))).map((origin) => `Page: ${origin}`),
  ];
  Object.assign(result, {
    status: outside.length === 0 && pageErrors.length === 0 ? "passed" : "failed",
    outside, pageErrors, visited, phases,
    nodeRecords: nodeRows.length, nodeProcesses: new Set(nodeRows.map((row) => row.pid)).size,
    samples, processesWatched, sampledConnections: sampled.size,
    browserHosts: Object.fromEntries(browserHosts), vendorHosts: Object.fromEntries(vendorHosts), pageRequests: Object.fromEntries(pageRequests),
    scan: scan.summary,
    ...(integrations ? { integrations } : {}),
  });
  writeReport({ result, nodeTargets, sampled, browserHosts, vendorHosts, vendorSockets, pageRequests, scan, outside, integrations });
  if (result.status !== "passed") process.exitCode = 1;
} catch (error) {
  result.status = "failed";
  result.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  sampler.kill();
  if (drill) await drill.close();
  if (partner) await partner.stop();
  if (host) await host.stop();
  result.finishedAt = new Date().toISOString();
  writeFileSync(resolve(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: result.status, outside: result.outside, error: result.error, pageErrors: result.pageErrors }, null, 2));
  if (result.status === "passed") for (const dir of [dataRoot, partnerRoot].filter(Boolean)) rmSync(dir, { recursive: true, force: true });
}

/** The URL requests in a Chromium network log, each with its initiator. */
function netlogRequests(path) {
  let text = readFileSync(path, "utf8").trim();
  // A browser that ended mid-write leaves the event list open.
  if (!text.endsWith("}")) text = `${text.replace(/,\s*$/, "")}]}`;
  const log = JSON.parse(text);
  const start = log.constants.logEventTypes.URL_REQUEST_START_JOB;
  return log.events.filter((event) => event.type === start && event.params?.url).map((event) => event.params);
}

/**
 * Every http(s) and ws(s) address written in the built web app and the
 * server and shared sources (tests excluded), each with where it appears. An
 * address in the code is not a connection; the recorders above are the proof.
 * The scan finds what could become one, for the report to account for.
 */
function scanForOutsideAddresses(roots) {
  const found = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== "__tests__" && name !== "node_modules") walk(path);
        continue;
      }
      if (![".js", ".mjs", ".ts", ".tsx", ".html", ".css", ".json", ".webmanifest"].includes(extname(name))) continue;
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/\b(?:https?|wss?):\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        const hostname = match[1].toLowerCase();
        if (local(hostname)) continue;
        const entry = found.get(hostname) ?? { files: new Set() };
        entry.files.add(relative(root, path).replaceAll("\\", "/"));
        found.set(hostname, entry);
      }
    }
  };
  for (const dir of roots) walk(dir);
  return {
    hosts: found,
    summary: Object.fromEntries([...found].map(([hostname, entry]) => [hostname, [...entry.files].sort()])),
  };
}

function writeReport({ result, nodeTargets, sampled, browserHosts, vendorHosts, vendorSockets, pageRequests, scan, outside, integrations }) {
  const commit = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
  const dirty = (() => { try { return execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).trim() ? " with uncommitted changes" : ""; } catch { return ""; } })();
  const table = (rows) => rows.length ? rows : ["| (none) | | |"];
  const steps = [
    `**Set up and first start:** the step the setup program runs after copying files (\`desktop.mjs setup\`), which creates a PostgreSQL cluster, migrates it and seeds the scenario; then PostgreSQL from the host settings file, the server with its delivery queue and scheduler, and Caddy with the host's own certificate authority, each started as its generated service definition says, on the loopback address with spare ports.${integrations ? " A second host profile, the federation partner, was set up and started beside it the same way." : ""}`,
    ...(integrations ? [
      "**Stand-ins set up:** each optional integration pointed at a stand-in on this computer through the host's own API, and one record sent with every route up (see [Integrations on local stand-ins](#integrations-on-local-stand-ins)).",
      "**The cut:** every stand-in and the partner host's server stopped; then a mass notification and a record that fires a rule, so email, SMS, a webhook, a push and a federation update wait for their routes.",
    ] : []),
    "**Idle:** ten seconds with nobody signed in, while the scheduler and delivery queue run.",
    `**North Coast walk:** Chromium over HTTPS, trusting the host's authority by its keys: Jordan Lee signs in and opens every section in the rail (${result.visited.length}: ${result.visited.join(", ")}), zooms the map in and out, opens the notifications panel and the account menu.`,
    "**Backup:** the scheduled backup task's command against the running host.",
    ...(integrations ? [
      "**Routes return:** the relay, the SMS provider, the push receiver, the feed server and the partner host come back; the webhook receiver stays down.",
      "**SMS gateway:** SMS switched to a gateway phone on the site network that is off, a send, the phone on, and replies read back from it.",
      "**Webhook expiry and resend:** the webhook queued at the cut expires at the end of its window, its receiver comes back, and the administrator resends it.",
    ] : []),
  ];
  const lines = [
    "# Air gap: connections the system makes",
    "",
    `Run ${result.startedAt}, from commit \`${commit}\`${dirty}, on Windows ${release()}. Written by \`deploy/windows/prove-airgap.mjs${integrations ? " --stand-ins" : ""}\`; the raw records are in \`${relative(root, out).replaceAll("\\", "/")}/\`.`,
    `Result: **${result.status === "passed" ? "PASS" : "FAIL"}**, ${outside.length === 0 ? "no connection outside this computer and its local network" : `${outside.length} destinations outside this computer and its local network`}, and ${result.pageErrors.length} page errors.`,
    "",
    "## What ran",
    "",
    "The network host profile with the North Coast Storm demo (`host-demo`), in phases:",
    "",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Installing with the setup program was not part of the run: its file copy has no network step, and the services, firewall rule and trusted root it adds change this computer's settings, which a session does not do. Basho's unplugged run covers the installed system.",
    "",
    ...(integrations ? standInsReport(integrations) : []),
    "## The recorders",
    "",
    `- **Node processes** (the setup step, the server, the backup): every TCP and TLS connection, name lookup and UDP datagram they asked for, recorded inside each process through \`lib/net-recorder.mjs\`. ${result.nodeRecords} records from ${result.nodeProcesses} processes.`,
    `- **Connection sampler:** half a second after each sample ends, the TCP connections of every process descended from the proof (the Node processes, Caddy, Chromium${integrations ? ", the proof itself with its stand-ins" : ""}) and of the PostgreSQL server${integrations ? "s and their" : " and its"} backends. ${result.samples} samples, up to ${result.processesWatched} processes at once.`,
    "- **Chromium's network log:** every request the browser made, with who started it. A request a page started names the page's origin, and every one is counted. The browser's own services (updates, autofill, account sign-in) start theirs with no origin; they belong to the browser, not to this system, an agency's own browser policy governs them, and they are listed apart below. The flags that switch those services off were set and do not stop them all.",
    "- **The page:** every request the console made.",
    "",
    "Limits: without administrator rights a session cannot trace UDP destinations of processes other than Node, or attribute lookups the Windows DNS client makes on a process's behalf. PostgreSQL and Caddy are configured with only loopback and local names, and Node's lookups are recorded in-process.",
    "",
    "## Destinations",
    "",
    "| Recorder | Destination | Count |",
    "|---|---|---|",
    ...table([
      ...[...nodeTargets].sort((a, b) => b[1].count - a[1].count).map(([target, entry]) => `| Node | ${target} | ${entry.count} |`),
      ...[...sampled.values()].map((row) => `| Sampler, ${row.name} | ${row.remote}:${row.port} (${[...row.phases].join(", ")}) | ${row.count} |`),
      ...[...browserHosts].map(([name, count]) => `| Chromium log, a page's request | ${name} | ${count} |`),
      ...[...pageRequests].map(([origin, count]) => `| Page | ${origin} | ${count} |`),
    ]),
    "",
    "## Outside addresses written in the code",
    "",
    `None is contacted in the run above. Each is text: documentation and attribution links a person may follow, schema and namespace identifiers, example values in help text, error messages from bundled libraries, and addresses of optional integrations and catalog sources an administrator must configure and switch on (IPAWS, feeds, catalog data sources, federation peers). ${integrations ? "Here the integrations point at stand-ins on this computer and none of these addresses is configured, so none is contacted" : "With none configured, as here, none is contacted"}; on an air-gapped network any that is configured fails without affecting the rest.`,
    "",
    "| Host | Where |",
    "|---|---|",
    ...[...scan.hosts].sort((a, b) => a[0].localeCompare(b[0])).map(([hostname, entry]) => `| ${hostname} | ${[...entry.files].sort().slice(0, 4).join(", ")}${entry.files.size > 4 ? `, and ${entry.files.size - 4} more` : ""} |`),
    "",
    "## The browser's own requests",
    "",
    "Chromium reached these for its own services while it ran, in requests no page started. They are not the system's connections and are not counted above.",
    "",
    ...(vendorHosts.size || vendorSockets.length ? [
      ...[...vendorHosts].map(([name, count]) => `- ${name} (${count} request${count === 1 ? "" : "s"})`),
      ...vendorSockets.map((row) => `- socket ${row.remote}:${row.port} (${[...row.phases].join(", ")})`),
    ] : ["None."]),
    "",
    "## Outside connections",
    "",
    ...(outside.length ? outside.map((line) => `- ${line}`) : ["None."]),
    "",
  ];
  writeFileSync(resolve(root, "AIR-GAP-REPORT.md"), lines.join("\n"));
}
