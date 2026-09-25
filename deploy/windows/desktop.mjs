import "./ts-loader.mjs";
import { X509Certificate, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { get as httpsGet } from "node:https";
import { createServer } from "node:net";
import { hostname, networkInterfaces } from "node:os";
import { Writable } from "node:stream";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PROFILE_DEFAULTS,
  matchesOwnedAppCommand,
  matchesOwnedBrowserCommand,
  profilePaths,
  validatePort,
  validateProfileName,
  validateProfilePlans,
} from "./lib/contracts.mjs";
import { desktopRuntimeConfig, registerStaticHost } from "./lib/static-host.mjs";
import { desktopBuildSourceFingerprint } from "./lib/build-fingerprint.mjs";
import { rotateIfLarger, rotatingLog } from "./lib/rotating-log.mjs";
import { backupBeforeMigrate, scheduledBackup, writeUpgradeReport } from "./lib/pre-upgrade-backup.mjs";
import {
  BACKUP_TASK,
  POSTGRES_INCLUDE,
  SERVICES,
  SID,
  firewallCommands,
  hostDefinitions,
  hostNames,
  hostPaths,
  isHostProfile,
} from "./lib/host.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(process.env.OPENEOC_DESKTOP_APP_ROOT ?? resolve(dirname(scriptPath), "../.."));
const prebuiltDesktop = process.env.OPENEOC_DESKTOP_PREBUILT === "1";
const outRoot = resolve(process.env.OPENEOC_DESKTOP_DATA_ROOT ?? resolve(repoRoot, "deploy/windows/out"));
const buildRoot = resolve(outRoot, "build");
const distRoot = resolve(process.env.OPENEOC_DESKTOP_DIST_ROOT ?? resolve(buildRoot, "app-dist"));
const buildStampPath = resolve(buildRoot, "build-stamp.json");
const publicRoot = resolve(process.env.OPENEOC_DESKTOP_PUBLIC_ROOT ?? resolve(repoRoot, "web/public"));
const pgDist = resolve(process.env.OPENEOC_PG_DIST ?? resolve(repoRoot, "deploy/test-runtime/out/pgsql"));
const pgBin = resolve(pgDist, "bin");
const powershell = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const caddyExe = resolve(process.env.OPENEOC_CADDY ?? resolve(repoRoot, "runtime/caddy/caddy.exe"));
const winswExe = resolve(process.env.OPENEOC_WINSW ?? resolve(repoRoot, "runtime/winsw/WinSW-x64.exe"));
// The North Coast Storm reference scenario's profiles: seeded as its people, who sign in with a password alone.
const NORTH_COAST_PROFILES = new Set(["demo", "host-demo"]);

function parseArgs(values) {
  const result = { action: values[0] ?? "status" };
  for (const value of values.slice(1)) {
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const [name, ...rest] = value.slice(2).split("=");
    result[name] = rest.length === 0 ? true : rest.join("=");
  }
  return result;
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJsonAtomic(path, value) {
  ensureDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function currentIdentity() {
  return execFileSync("whoami.exe", { encoding: "utf8", windowsHide: true }).trim();
}

function secureDirectory(path, grants = [`${currentIdentity()}:(OI)(CI)F`]) {
  ensureDirectory(path);
  execFileSync("icacls.exe", [path, "/inheritance:r", "/grant:r", ...grants], {
    stdio: "ignore",
    windowsHide: true,
  });
}

/**
 * A host folder: SYSTEM, Administrators and the administrator who set it up in
 * full, the services' LocalService account as given (M or RX), no one else.
 */
function hostGrants(localService) {
  return [
    `*${SID.system}:(OI)(CI)F`,
    `*${SID.administrators}:(OI)(CI)F`,
    `${currentIdentity()}:(OI)(CI)F`,
    `*${SID.localService}:(OI)(CI)${localService}`,
  ];
}

function randomPassword() {
  return randomBytes(36).toString("base64url");
}

function requiredFiles(kind) {
  const files = [
    resolve(repoRoot, "node_modules/typescript/lib/typescript.js"),
    resolve(publicRoot, "basemap/basemap.pmtiles"),
    resolve(publicRoot, "manifest.webmanifest"),
  ];
  if (!prebuiltDesktop) files.push(resolve(repoRoot, "web/node_modules/vite/dist/node/index.js"));
  if (kind === "database") {
    for (const executable of ["createdb.exe", "initdb.exe", "pg_ctl.exe", "pg_isready.exe"])
      files.push(resolve(pgBin, executable));
    files.push(resolve(pgDist, "share/extension/postgis.control"));
  }
  const missing = files.filter((path) => !existsSync(path));
  if (missing.length > 0)
    throw new Error(`Offline prerequisites are missing:\n${missing.map((path) => `- ${path}`).join("\n")}`);
}

function sourceFingerprint() {
  return desktopBuildSourceFingerprint(repoRoot);
}

function gitRevision() {
  try {
    return execFileSync("git.exe", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return "unavailable";
  }
}

async function buildWeb() {
  if (prebuiltDesktop) throw new Error("The installed desktop bundle is prebuilt and cannot be rebuilt in place");
  requiredFiles("build");
  const before = sourceFingerprint();
  const vite = await import(pathToFileURL(resolve(repoRoot, "web/node_modules/vite/dist/node/index.js")).href);
  ensureDirectory(buildRoot);
  await vite.build({
    root: resolve(repoRoot, "web"),
    publicDir: false,
    base: "./",
    build: { outDir: distRoot, emptyOutDir: true },
  });
  const after = sourceFingerprint();
  if (before.hash !== after.hash) throw new Error("Source changed during the desktop build; run Build again");
  writeJsonAtomic(buildStampPath, {
    schema: 1,
    revision: gitRevision(),
    sourceHash: after.hash,
    sourceFiles: after.files,
    builtAt: new Date().toISOString(),
    publicAssetsCopied: false,
  });
  console.log(`BUILD_READY revision=${gitRevision()} source=${after.hash.slice(0, 12)}`);
}

function buildFreshness() {
  if (prebuiltDesktop) {
    if (!existsSync(resolve(distRoot, "index.html")))
      return { fresh: false, reason: "installed desktop web bundle is missing" };
    return { fresh: true, stamp: { schema: 1, revision: "installed", prebuilt: true } };
  }
  if (!existsSync(resolve(distRoot, "index.html")) || !existsSync(buildStampPath))
    return { fresh: false, reason: "desktop build is missing" };
  const stamp = readJson(buildStampPath);
  const current = sourceFingerprint();
  if (stamp.sourceHash !== current.hash)
    return { fresh: false, reason: `desktop build is stale (${String(stamp.sourceHash).slice(0, 12)} != ${current.hash.slice(0, 12)})` };
  return { fresh: true, stamp };
}

function requireFreshBuild() {
  const status = buildFreshness();
  if (!status.fresh)
    throw new Error(`${status.reason}. Rebuild offline with: .\\deploy\\windows\\Open-Source-EOC.ps1 -Action Build`);
  return status.stamp;
}

function loadProfile(profile) {
  const paths = profilePaths(outRoot, profile);
  if (!existsSync(paths.config)) return { paths, config: null };
  const config = readJson(paths.config);
  const defaults = PROFILE_DEFAULTS[profile];
  if (config.schema !== 1 || config.profile !== profile || config.database !== defaults.database || config.synthetic !== defaults.synthetic)
    throw new Error(`Profile configuration is invalid: ${paths.config}`);
  validatePort(config.pgPort, `${profile} PostgreSQL port`);
  validatePort(config.httpPort, `${profile} HTTP port`);
  if (config.pgPort === config.httpPort) throw new Error(`Profile ${profile} uses the same PostgreSQL and HTTP port`);
  return { paths, config };
}

function configuredPlans(extra) {
  const plans = [];
  for (const profile of Object.keys(PROFILE_DEFAULTS)) {
    const loaded = loadProfile(profile);
    if (loaded.config)
      plans.push({ profile, pgPort: loaded.config.pgPort, httpPort: loaded.config.httpPort, root: loaded.paths.root });
  }
  if (extra && !plans.some((plan) => plan.profile === extra.profile)) plans.push(extra);
  return plans;
}

async function assertPortFree(port, label, host = "127.0.0.1") {
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", () => reject(new Error(`${label} port ${port} is already in use; no process was stopped`)));
    server.listen({ host, port, exclusive: true }, () => server.close(resolvePromise));
  });
}

function pgExecutable(name) {
  return resolve(pgBin, `${name}.exe`);
}

function pgEnvironment(password, config) {
  return {
    ...process.env,
    PATH: `${pgBin};${process.env.PATH ?? ""}`,
    PGHOST: "127.0.0.1",
    PGPORT: String(config.pgPort),
    PGUSER: "postgres",
    PGPASSWORD: password,
  };
}

function pgControl(paths, args, options = {}) {
  return execFileSync(pgExecutable("pg_ctl"), ["-D", paths.pgData, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

function pgIsRunning(paths) {
  try {
    pgControl(paths, ["status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function startPostgres(paths, config, ownerPassword) {
  if (pgIsRunning(paths)) return false;
  await assertPortFree(config.pgPort, `${config.profile} PostgreSQL`);
  const logPath = resolve(paths.logs, "postgres.log");
  rotateIfLarger(logPath);
  let started = false;
  try {
    pgControl(paths, ["-l", logPath, "-o", `-p ${config.pgPort} -h 127.0.0.1`, "-w", "start"], {
      env: pgEnvironment(ownerPassword, config),
      stdio: "ignore",
    });
    started = true;
    execFileSync(pgExecutable("pg_isready"), ["-h", "127.0.0.1", "-p", String(config.pgPort), "-d", "postgres"], {
      env: pgEnvironment(ownerPassword, config),
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch (error) {
    if (started && pgIsRunning(paths)) stopPostgres(paths);
    throw error;
  }
}

function stopPostgres(paths) {
  if (!pgIsRunning(paths)) return false;
  pgControl(paths, ["-m", "fast", "-w", "stop"], { stdio: "ignore" });
  return true;
}

/** A plain SQL dump of the profile database to a file, which restore replays. */
function pgDump(config, ownerPassword) {
  return (file) => execFileSync(pgExecutable("pg_dump"), ["--no-owner", "-f", file, "-d", config.database], {
    env: pgEnvironment(ownerPassword, config),
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
}

function databaseUrl(user, password, config) {
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${config.pgPort}/${config.database}`;
}

async function importServer(relativePath) {
  return import(pathToFileURL(resolve(repoRoot, relativePath)).href);
}

async function prepareDatabase(paths, config, { bootstrap = false, bootstrapInput = null, setRuntimePassword = false } = {}) {
  const ownerPassword = readFileSync(paths.ownerPassword, "utf8").trim();
  const runtimePassword = readFileSync(paths.runtimePassword, "utf8").trim();
  const [{ connect }, { migrate }, boards, incidents, dashboards] = await Promise.all([
    importServer("server/src/db/client.ts"),
    importServer("server/src/db/migrate.ts"),
    importServer("server/src/boards/service.ts"),
    importServer("server/src/incidents/service.ts"),
    importServer("server/src/dashboards/service.ts"),
  ]);
  const migrations = resolve(repoRoot, "server/migrations");
  const owner = connect({ url: databaseUrl("postgres", ownerPassword, config) });
  try {
    // A newer build migrates an existing database only after dumping it as it was.
    const [{ tracked }] = await owner`select to_regclass('public.schema_migrations') is not null as tracked`;
    const backup = backupBeforeMigrate({
      applied: tracked ? (await owner`select name from public.schema_migrations`).map((row) => row.name) : [],
      files: readdirSync(migrations).filter((file) => file.endsWith(".sql")),
      backupsDir: resolve(paths.root, "backups"),
      dump: pgDump(config, ownerPassword),
    });
    if (backup) console.log(`PRE_UPGRADE_BACKUP path=${backup}`);
    const applied = await migrate(owner, migrations);
    if (backup) console.log(`UPGRADE_REPORT path=${writeUpgradeReport({ backup, applied, migrationsDir: migrations, profile: config.profile })}`);
    if (setRuntimePassword)
      await owner.unsafe(`alter role app_runtime login password '${runtimePassword.replaceAll("'", "''")}'`);
    await boards.ensureStandardTemplates(owner);
    await incidents.ensureStandardIncidentTemplates(owner);
    await dashboards.ensureStandardDashboards(owner);
    if (!bootstrap) return null;
    if (NORTH_COAST_PROFILES.has(config.profile)) {
      // The seed runs the application, which keeps files and credentials as the served profile does.
      process.env.OPENEOC_DATA_DIR = paths.blobs;
      process.env.OPENEOC_SECRET_KEY ??= readFileSync(paths.secretKey, "utf8").trim();
      const result = await seedReferenceScenario(owner, config, runtimePassword);
      writeJsonAtomic(resolve(paths.root, "bootstrap.json"), {
        profile: config.profile,
        synthetic: true,
        login: "jordan.lee@humboldt.example",
        ...result,
      });
      return result;
    }
    if (config.synthetic) {
      const { ensureDemoData } = await importServer("server/src/demo/seed.ts");
      const result = await ensureDemoData(owner);
      writeJsonAtomic(resolve(paths.root, "bootstrap.json"), {
        profile: config.profile,
        synthetic: true,
        login: "demo-admin@example.org",
        ...result,
      });
      return result;
    }
    if (!bootstrapInput) throw new Error("Production bootstrap identity is required");
    // The same bootstrap the server's `bootstrap` command runs.
    const { bootstrapInstance } = await importServer("server/src/main.ts");
    const provisioned = await bootstrapInstance(owner, bootstrapInput);
    if (!provisioned.created) throw new Error("An instance admin already exists in this profile's database");
    writeJsonAtomic(resolve(paths.root, "bootstrap.json"), {
      profile: config.profile,
      synthetic: false,
      adminPersonId: provisioned.personId,
      jurisdictionId: provisioned.jurisdictionId,
      positions: provisioned.positions,
    });
    return provisioned;
  } finally {
    await owner.end();
  }
}

/**
 * The demo profile's dataset: the North Coast Storm reference scenario the
 * design frames show, written through the API as each of its people, then
 * placed on the scenario clock (09:42 on the most recent morning).
 */
async function seedReferenceScenario(owner, config, runtimePassword) {
  const [{ connect }, { buildApp }, { seedNorthCoast, placeOnScenarioClock }] = await Promise.all([
    importServer("server/src/db/client.ts"),
    importServer("server/src/app.ts"),
    importServer("server/src/demo/north-coast.ts"),
  ]);
  const runtime = connect({ url: databaseUrl("app_runtime", runtimePassword, config) });
  // Several hundred seeding requests are not the served profile's log.
  const quiet = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const app = buildApp(runtime, { oidc: null, requireAdminMfa: false, logStream: quiet });
  try {
    await app.ready();
    const scenario = await seedNorthCoast(app, owner);
    await placeOnScenarioClock(owner, scenario);
    return { jurisdictionId: scenario.jurisdictionId, incidentId: scenario.incidentId };
  } finally {
    await app.close();
    await runtime.end();
  }
}

async function productionBootstrap(args) {
  const password = process.env.OPENEOC_BOOTSTRAP_PASSWORD ?? "";
  delete process.env.OPENEOC_BOOTSTRAP_PASSWORD;
  const { bootstrapInput } = await importServer("server/src/main.ts");
  return bootstrapInput(args, password);
}

async function setupProfile(args) {
  requiredFiles("database");
  requireFreshBuild();
  const profile = validateProfileName(String(args.profile ?? "production"));
  const defaults = PROFILE_DEFAULTS[profile];
  const paths = profilePaths(outRoot, profile);
  const existing = loadProfile(profile).config;
  if (existing) {
    if (existing.state !== "ready")
      throw new Error(`Profile ${profile} is partial (${existing.state}); preserve it for diagnosis and do not reset it`);
    if (args["pg-port"] && Number(args["pg-port"]) !== existing.pgPort) throw new Error("Configured PostgreSQL port differs");
    if (args["http-port"] && Number(args["http-port"]) !== existing.httpPort) throw new Error("Configured HTTP port differs");
    console.log(`PROFILE_ALREADY_READY profile=${profile}`);
    return;
  }
  if (existsSync(paths.root) && readdirSync(paths.root).length > 0)
    throw new Error(`Profile directory exists without profile.json: ${paths.root}. It was not reset or deleted.`);

  const config = {
    schema: 1,
    profile,
    synthetic: defaults.synthetic,
    database: defaults.database,
    pgPort: validatePort(args["pg-port"] ?? defaults.pgPort, `${profile} PostgreSQL port`),
    httpPort: validatePort(args["http-port"] ?? defaults.httpPort, `${profile} HTTP port`),
    state: "initializing",
    createdAt: new Date().toISOString(),
  };
  validateProfilePlans(configuredPlans({ profile, pgPort: config.pgPort, httpPort: config.httpPort, root: paths.root }));
  await assertPortFree(config.pgPort, `${profile} PostgreSQL`);
  await assertPortFree(config.httpPort, `${profile} HTTP`);
  const productionInput = config.synthetic ? null : await productionBootstrap(args);

  for (const path of [paths.root, paths.pgData, paths.blobs, paths.browser, paths.logs]) ensureDirectory(path);
  // A host's services read the secrets as LocalService; a desktop profile's are its user's alone.
  const secretGrants = isHostProfile(profile) ? hostGrants("RX") : undefined;
  secureDirectory(paths.secrets, secretGrants);
  secureDirectory(paths.run, secretGrants);
  writeFileSync(paths.ownerPassword, `${randomPassword()}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  writeFileSync(paths.runtimePassword, `${randomPassword()}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  ensureSecretKey(paths);
  writeJsonAtomic(paths.config, config);

  try {
    execFileSync(pgExecutable("initdb"), [
      "-D", paths.pgData,
      "-U", "postgres",
      "--pwfile", paths.ownerPassword,
      "--auth-host=scram-sha-256",
      "--auth-local=scram-sha-256",
      "--encoding=UTF8",
    ], { env: pgEnvironment(readFileSync(paths.ownerPassword, "utf8").trim(), config), stdio: "ignore", windowsHide: true });
    await startPostgres(paths, config, readFileSync(paths.ownerPassword, "utf8").trim());
    execFileSync(pgExecutable("createdb"), ["-h", "127.0.0.1", "-p", String(config.pgPort), "-U", "postgres", config.database], {
      env: pgEnvironment(readFileSync(paths.ownerPassword, "utf8").trim(), config),
      stdio: "ignore",
      windowsHide: true,
    });
    await prepareDatabase(paths, config, { bootstrap: true, bootstrapInput: productionInput, setRuntimePassword: true });
    writeJsonAtomic(paths.config, { ...config, state: "ready", readyAt: new Date().toISOString() });
    console.log(`PROFILE_READY profile=${profile} synthetic=${config.synthetic} pg=127.0.0.1:${config.pgPort} http=http://127.0.0.1:${config.httpPort}`);
  } catch (error) {
    writeJsonAtomic(paths.config, { ...config, state: "failed", failedAt: new Date().toISOString(), failure: String(error?.message ?? error).replaceAll(/postgres:\/\/[^@]+@/g, "postgres://[redacted]@") });
    throw error;
  } finally {
    if (pgIsRunning(paths)) stopPostgres(paths);
    if (productionInput) productionInput.password = "";
  }
}

function processCommandLine(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const command = `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; [Console]::Out.Write($p.CommandLine)`;
    return execFileSync(powershell, ["-NoLogo", "-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    }).trim() || null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  return processCommandLine(pid) !== null;
}

function readPid(path) {
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

function removeOwnedStalePid(path, pid) {
  if (!pidAlive(pid) && existsSync(path)) unlinkSync(path);
}

async function ready(url, timeoutMs = 500) {
  try {
    const response = await fetch(`${url}/api/v1/ready`, { signal: globalThis.AbortSignal.timeout(timeoutMs) });
    return response.ok && (await response.json()).status === "ready";
  } catch {
    return false;
  }
}

async function waitReady(url, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await ready(url, 1_000)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Application did not become ready at ${url}; inspect the profile logs`);
}

function openBrowser(paths, config) {
  const url = `http://127.0.0.1:${config.httpPort}`;
  const existing = readPid(paths.browserPid);
  if (existing) {
    const commandLine = processCommandLine(existing.pid);
    if (commandLine && matchesOwnedBrowserCommand(commandLine, { userDataDir: paths.browser, url })) return existing.pid;
    if (!commandLine) removeOwnedStalePid(paths.browserPid, existing.pid);
    else throw new Error("Browser PID file does not own the running process; it was not stopped or replaced");
  }
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("Chrome or Edge is required to open the desktop window; use -NoBrowser for headless operation");
  const child = spawn(executable, [`--app=${url}`, `--user-data-dir=${paths.browser}`, "--no-first-run"], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  writeJsonAtomic(paths.browserPid, { pid: child.pid, userDataDir: paths.browser, startedAt: new Date().toISOString() });
  return child.pid;
}

function refuseHostProfile(profile) {
  if (isHostProfile(profile))
    throw new Error(`Profile ${profile} runs as Windows services; set it up with -Action HostInstall and manage it in Services`);
}

async function startProfile(args) {
  const profile = validateProfileName(String(args.profile ?? "production"));
  refuseHostProfile(profile);
  requiredFiles("database");
  requireFreshBuild();
  const { paths, config } = loadProfile(profile);
  if (!config) throw new Error(`Profile ${profile} is not configured; run Setup first`);
  if (config.state !== "ready") throw new Error(`Profile ${profile} is ${config.state}; it was not reset`);
  validateProfilePlans(configuredPlans());
  const url = `http://127.0.0.1:${config.httpPort}`;
  const prior = readPid(paths.appPid);
  if (prior) {
    const commandLine = processCommandLine(prior.pid);
    if (commandLine && matchesOwnedAppCommand(commandLine, { scriptPath, profile })) {
      await waitReady(url);
      if (!args["no-browser"]) openBrowser(paths, config);
      console.log(`PROFILE_ALREADY_RUNNING profile=${profile} url=${url}`);
      return;
    }
    if (!commandLine) removeOwnedStalePid(paths.appPid, prior.pid);
    else throw new Error("Application PID file does not own the running process; it was not stopped or replaced");
  }

  const ownerPassword = readFileSync(paths.ownerPassword, "utf8").trim();
  const postgresStarted = await startPostgres(paths, config, ownerPassword);
  try {
    await prepareDatabase(paths, config);
    await assertPortFree(config.httpPort, `${profile} HTTP`);
    const token = randomUUID();
    // Console output and crash traces; the server's own log is server.log.
    rotateIfLarger(resolve(paths.logs, "app.log"));
    rotateIfLarger(resolve(paths.logs, "app-error.log"));
    const stdout = openSync(resolve(paths.logs, "app.log"), "a");
    const stderr = openSync(resolve(paths.logs, "app-error.log"), "a");
    const child = spawn(process.execPath, [scriptPath, "serve", `--profile=${profile}`], {
      cwd: repoRoot,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stdout, stderr],
      env: { ...process.env, OPENEOC_DESKTOP_TOKEN: token },
    });
    closeSync(stdout);
    closeSync(stderr);
    child.unref();
    writeJsonAtomic(paths.appPid, { pid: child.pid, token, profile, scriptPath, startedAt: new Date().toISOString() });
    await waitReady(url);
    if (!args["no-browser"]) openBrowser(paths, config);
    console.log(`PROFILE_STARTED profile=${profile} url=${url} browser=${args["no-browser"] ? "no" : "yes"}`);
  } catch (error) {
    const record = readPid(paths.appPid);
    if (record) {
      const commandLine = processCommandLine(record.pid);
      if (commandLine && matchesOwnedAppCommand(commandLine, { scriptPath, profile })) process.kill(record.pid);
    }
    if (postgresStarted && pgIsRunning(paths)) stopPostgres(paths);
    throw error;
  }
}

function ensureSecretKey(paths) {
  if (existsSync(paths.secretKey)) return;
  writeFileSync(paths.secretKey, `${randomPassword()}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

/** Set up a new profile once, then open its loopback desktop application. */
async function launchProfile(args) {
  const profile = validateProfileName(String(args.profile ?? "production"));
  refuseHostProfile(profile);
  if (!loadProfile(profile).config) await setupProfile({ ...args, profile });
  await startProfile({ ...args, profile });
}

/**
 * Serve a ready profile on its loopback port. A desktop profile is started by
 * Start, which migrated it, and stops through an owned token. A host profile
 * is started by its service, so a service start is also the upgrade: the
 * database is dumped and migrated here first, and the service stops it.
 */
async function serveProfile(args, { service = false } = {}) {
  const profile = validateProfileName(String(args.profile ?? ""));
  if (service !== isHostProfile(profile))
    throw new Error(service ? `Only a host profile is served as a service, not ${profile}` : `Profile ${profile} is served by its Windows service`);
  const { paths, config } = loadProfile(profile);
  if (!config || config.state !== "ready") throw new Error(`Profile ${profile} is not ready`);
  requireFreshBuild();
  let token = "";
  if (!service) {
    token = process.env.OPENEOC_DESKTOP_TOKEN ?? "";
    delete process.env.OPENEOC_DESKTOP_TOKEN;
    if (!token) throw new Error("Desktop ownership token is missing");
  }
  if (service) await prepareDatabase(paths, config);
  process.env.OPENEOC_DATA_DIR = paths.blobs;
  // Offline address search: the gazetteer at the builder's output path, in a
  // checkout and in an install alike. Absent, search reports unavailable.
  const gazetteer = resolve(repoRoot, "tools/basemap/out/gazetteer.tsv");
  if (!process.env.OPENEOC_GAZETTEER_PATH && existsSync(gazetteer)) process.env.OPENEOC_GAZETTEER_PATH = gazetteer;
  // Credentials at rest (MFA secrets, connector credentials) are encrypted
  // with this profile's own key. Profiles created before the key existed get
  // one here.
  ensureSecretKey(paths);
  process.env.OPENEOC_SECRET_KEY ??= readFileSync(paths.secretKey, "utf8").trim();
  const runtimePassword = readFileSync(paths.runtimePassword, "utf8").trim();
  const [{ connect }, { buildApp }, { Scheduler }, { checkRuntimeRole }] = await Promise.all([
    importServer("server/src/db/client.ts"),
    importServer("server/src/app.ts"),
    importServer("server/src/scheduler/scheduler.ts"),
    importServer("server/src/main.ts"),
  ]);
  const runtimeUrl = databaseUrl("app_runtime", runtimePassword, config);
  const runtime = connect({ url: runtimeUrl });
  // Refuses, with no override, if app_runtime could bypass row-level security.
  await checkRuntimeRole(runtime, { OPENEOC_RUNTIME_URL: runtimeUrl });
  const app = buildApp(runtime, {
    oidc: null,
    logStream: rotatingLog(resolve(paths.logs, "server.log")),
    // The demo's synthetic accounts sign in with a password alone; production keeps two-step sign-in for administrators.
    ...(NORTH_COAST_PROFILES.has(config.profile) ? { requireAdminMfa: false } : {}),
  });
  const scheduler = new Scheduler(runtime, { lockUrl: runtimeUrl, logger: app.log });
  app.metrics.delivery = scheduler.delivery;
  app.metrics.scheduler = scheduler;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await scheduler.stop();
    await app.close();
    await runtime.end();
    const record = readPid(paths.appPid);
    if (record?.pid === process.pid && existsSync(paths.appPid)) unlinkSync(paths.appPid);
  };
  if (!service)
    app.post("/__desktop/stop", async (request, reply) => {
      if (request.headers["x-openeoc-desktop-token"] !== token) return reply.code(404).send("Missing");
      void reply.send({ status: "stopping" });
      globalThis.setImmediate(() => void close().then(() => process.exit(0)));
    });
  const runtimeConfig = await desktopRuntimeConfig(publicRoot);
  // A synthetic profile says so on every screen, beside the handling marking.
  if (config.synthetic) runtimeConfig.OPENEOC_SYNTHETIC_DATA = "1";
  // A host with its own certificate authority offers the root on the sign-in page.
  if (service && process.env.OPENEOC_TRUST_CERTIFICATE_URL)
    runtimeConfig.OPENEOC_TRUST_CERTIFICATE_URL = process.env.OPENEOC_TRUST_CERTIFICATE_URL;
  registerStaticHost(app, { distRoot, publicRoot, runtimeConfig });
  await app.listen({ host: "127.0.0.1", port: config.httpPort });
  scheduler.start();
  console.log(`DESKTOP_READY profile=${profile} url=http://127.0.0.1:${config.httpPort}`);
  process.on("SIGINT", () => void close().then(() => process.exit(0)));
  process.on("SIGTERM", () => void close().then(() => process.exit(0)));
}

async function stopOwnedBrowser(paths, config) {
  const record = readPid(paths.browserPid);
  if (!record) return false;
  const commandLine = processCommandLine(record.pid);
  if (!commandLine) {
    removeOwnedStalePid(paths.browserPid, record.pid);
    return false;
  }
  const url = `http://127.0.0.1:${config.httpPort}`;
  if (!matchesOwnedBrowserCommand(commandLine, { userDataDir: paths.browser, url }))
    throw new Error("Browser PID file does not own the running process; it was not stopped");
  execFileSync("taskkill.exe", ["/PID", String(record.pid), "/T"], { stdio: "ignore", windowsHide: true });
  if (existsSync(paths.browserPid)) unlinkSync(paths.browserPid);
  return true;
}

async function stopOwnedApp(paths, config) {
  const record = readPid(paths.appPid);
  if (!record) return false;
  const commandLine = processCommandLine(record.pid);
  if (!commandLine) {
    removeOwnedStalePid(paths.appPid, record.pid);
    return false;
  }
  if (!matchesOwnedAppCommand(commandLine, { scriptPath, profile: config.profile }))
    throw new Error("Application PID file does not own the running process; it was not stopped");
  const url = `http://127.0.0.1:${config.httpPort}`;
  let response;
  try {
    response = await fetch(`${url}/__desktop/stop`, {
      method: "POST",
      headers: { "x-openeoc-desktop-token": record.token },
      signal: globalThis.AbortSignal.timeout(2_000),
    });
  } catch {
    // Exact command-line ownership was established above; termination remains profile-bounded.
    process.kill(record.pid);
  }
  if (response && !response.ok)
    throw new Error(`Owned application rejected its stop token with HTTP ${response.status}; it was not terminated`);
  const end = Date.now() + 5_000;
  while (pidAlive(record.pid) && Date.now() < end)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  if (pidAlive(record.pid)) process.kill(record.pid);
  if (existsSync(paths.appPid)) unlinkSync(paths.appPid);
  return true;
}

async function stopProfile(args) {
  const profile = validateProfileName(String(args.profile ?? "production"));
  refuseHostProfile(profile);
  const { paths, config } = loadProfile(profile);
  if (!config) {
    console.log(`PROFILE_STOPPED configured=false profile=${profile} app=false postgres=false browser=false`);
    return;
  }
  const browserStopped = await stopOwnedBrowser(paths, config);
  const appStopped = await stopOwnedApp(paths, config);
  const postgresStopped = stopPostgres(paths);
  console.log(`PROFILE_STOPPED profile=${profile} app=${appStopped} postgres=${postgresStopped} browser=${browserStopped}`);
}

/** Dump the profile database and copy its file store, then remove backups past the kept days. */
async function backupProfile(args) {
  const profile = validateProfileName(String(args.profile ?? "production"));
  const { paths, config } = loadProfile(profile);
  if (!config || config.state !== "ready") throw new Error(`Profile ${profile} is not ready; nothing was backed up`);
  const ownerPassword = readFileSync(paths.ownerPassword, "utf8").trim();
  // A stopped profile's database is started for the dump and stopped after it.
  // ponytail: a profile started in those seconds loses its database when the
  // backup stops it; check for an owned app process here if that ever bites.
  const started = await startPostgres(paths, config, ownerPassword);
  try {
    const result = scheduledBackup({
      backupsDir: resolve(paths.root, "backups"),
      blobsDir: paths.blobs,
      dump: pgDump(config, ownerPassword),
      keepDays: Number(args["keep-days"] ?? 14),
    });
    console.log(`BACKUP_WRITTEN profile=${profile} database=${result.database} files=${result.files} removed=${result.removed.length}`);
  } finally {
    if (started) stopPostgres(paths);
  }
}

function elevated() {
  try {
    execFileSync("net.exe", ["session"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function runPowerShell(command) {
  return execFileSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; ${command}`], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function serviceExists(name) {
  try {
    execFileSync("sc.exe", ["query", name], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function deleteService(name) {
  if (serviceExists(name)) execFileSync("sc.exe", ["delete", name], { stdio: "ignore", windowsHide: true });
}

function stopHostServices() {
  // -Force also stops the server, which depends on PostgreSQL.
  runPowerShell("Get-Service -Name 'OpenSourceEOC-*' -ErrorAction SilentlyContinue | Stop-Service -Force");
}

function computerDnsName() {
  try {
    return runPowerShell("[Console]::Out.Write([System.Net.Dns]::GetHostEntry('').HostName)").trim();
  } catch {
    return "";
  }
}

function removeTrustedRoot(thumbprint) {
  if (!/^[0-9A-F]{40}$/.test(String(thumbprint))) throw new Error(`Certificate thumbprint is invalid: ${thumbprint}`);
  runPowerShell(`Remove-Item -LiteralPath 'Cert:\\LocalMachine\\Root\\${thumbprint}' -ErrorAction SilentlyContinue`);
}

function httpsReady(url, ca) {
  return new Promise((resolvePromise) => {
    const request = httpsGet(`${url}/api/v1/ready`, { ca, timeout: 2_000 }, (response) => {
      response.resume();
      resolvePromise(response.statusCode === 200);
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolvePromise(false));
  });
}

async function waitFor(check, timeoutMs, failure) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(failure);
}

/**
 * Set up this computer as the network host, or bring an existing host to this
 * build: the profile once, then the services, firewall rule, backup task and
 * trusted root, replaced on every run. The profile's data is never reset.
 */
async function hostInstall(args) {
  if (!elevated()) throw new Error("Setting up the host needs an administrator: run the setup program for all users, or an elevated PowerShell");
  requiredFiles("database");
  for (const [path, label] of [[caddyExe, "Caddy"], [winswExe, "WinSW"]])
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  const profile = validateProfileName(String(args.profile ?? "host"));
  if (!isHostProfile(profile)) throw new Error(`HostInstall takes the host or host-demo profile, not ${profile}`);
  const host = hostPaths(outRoot);
  const prior = existsSync(host.config) ? readJson(host.config) : null;
  if (prior && prior.profile !== profile)
    throw new Error(`This computer already hosts the ${prior.profile} profile; remove it with -Action HostRemove first`);
  const certificate = args.certificate
    ? { cert: resolve(String(args.certificate)), key: resolve(String(args["certificate-key"] ?? "")) }
    : null;
  if (certificate)
    for (const path of [certificate.cert, certificate.key])
      if (!existsSync(path)) throw new Error(`Certificate file is missing: ${path}`);

  stopHostServices();
  secureDirectory(outRoot, hostGrants("M"));
  if (!loadProfile(profile).config) await setupProfile({ ...args, profile });
  const { paths, config } = loadProfile(profile);
  if (config.state !== "ready") throw new Error(`Profile ${profile} is ${config.state}; it was not reset`);
  await assertPortFree(443, "HTTPS", "0.0.0.0");
  await assertPortFree(80, "HTTP", "0.0.0.0");

  const names = hostNames({
    hostname: hostname(),
    fqdn: computerDnsName(),
    interfaces: networkInterfaces(),
    extra: String(args["host-name"] ?? "").split(",").filter(Boolean),
  });
  const definitions = hostDefinitions({
    appRoot: repoRoot,
    dataRoot: outRoot,
    profile,
    profileRoot: paths.root,
    pgData: paths.pgData,
    pgPort: config.pgPort,
    httpPort: config.httpPort,
    names,
    nodeExecutable: process.execPath,
    caddyExecutable: caddyExe,
    distRoot,
    publicRoot,
    pgDist,
    certificate,
    powershell,
  });

  // PostgreSQL reads its port, loopback address and log folder from one included file.
  writeFileSync(resolve(paths.pgData, "openeoc-host.conf"), definitions.postgresSettings, "utf8");
  const postgresConf = resolve(paths.pgData, "postgresql.conf");
  if (!readFileSync(postgresConf, "utf8").includes(POSTGRES_INCLUDE)) appendFileSync(postgresConf, `\n${POSTGRES_INCLUDE}\n`, "utf8");
  ensureDirectory(host.root);
  writeFileSync(host.caddyfile, definitions.caddyfile, "utf8");
  secureDirectory(host.services, hostGrants("RX"));

  for (const id of Object.values(SERVICES)) deleteService(id);
  execFileSync(pgExecutable("pg_ctl"), definitions.postgresRegister, { stdio: "ignore", windowsHide: true });
  for (const [id, definition] of [[SERVICES.server, definitions.services.server], [SERVICES.caddy, definitions.services.caddy]]) {
    const wrapper = resolve(host.services, `${id}.exe`);
    copyFileSync(winswExe, wrapper);
    writeFileSync(resolve(host.services, `${id}.xml`), definition, "utf8");
    execFileSync(wrapper, ["install"], { stdio: "ignore", windowsHide: true });
  }
  runPowerShell(definitions.firewall.remove);
  runPowerShell(definitions.firewall.add);
  // Task Scheduler reads its definition as UTF-16.
  writeFileSync(host.backupTask, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(definitions.backupTask, "utf16le")]));
  execFileSync("schtasks.exe", ["/Create", "/TN", BACKUP_TASK, "/XML", host.backupTask, "/F"], { stdio: "ignore", windowsHide: true });

  runPowerShell(Object.values(SERVICES).map((id) => `Start-Service -Name '${id}'`).join("; "));
  await waitFor(() => ready(`http://127.0.0.1:${config.httpPort}`, 1_000), 180_000, `The host server did not become ready; see the logs in ${paths.logs}`);
  let rootThumbprint = null;
  if (!certificate) {
    await waitFor(() => existsSync(host.rootCertificate), 60_000, `Caddy did not create the certificate authority; see caddy.log in ${paths.logs}`);
    const root = readFileSync(host.rootCertificate);
    rootThumbprint = new X509Certificate(root).fingerprint.replaceAll(":", "");
    if (prior?.rootThumbprint && prior.rootThumbprint !== rootThumbprint) removeTrustedRoot(prior.rootThumbprint);
    // The host's own browsers trust it; other computers use the download on the sign-in page.
    runPowerShell(`Import-Certificate -FilePath '${host.rootCertificate.replaceAll("'", "''")}' -CertStoreLocation Cert:\\LocalMachine\\Root | Out-Null`);
    await waitFor(() => httpsReady("https://localhost", root), 60_000, `HTTPS did not answer on this host; see caddy.log in ${paths.logs}`);
  }
  writeJsonAtomic(host.config, {
    schema: 1,
    profile,
    names,
    publicUrl: definitions.publicUrl,
    certificate: certificate ? "agency" : "internal",
    rootThumbprint,
    appRoot: repoRoot,
    installedAt: new Date().toISOString(),
  });
  console.log(`HOST_READY profile=${profile} url=${definitions.publicUrl}`);
  for (const name of names.filter((name) => name !== "localhost" && name !== "127.0.0.1")) console.log(`HOST_ADDRESS https://${name}`);
}

/** Remove the host's services, firewall rule, backup task and trusted root. The data stays. */
async function hostRemove() {
  const host = hostPaths(outRoot);
  if (!existsSync(host.config)) {
    console.log("HOST_NOT_INSTALLED");
    return;
  }
  if (!elevated()) throw new Error("Removing the host needs an administrator");
  const record = readJson(host.config);
  stopHostServices();
  for (const id of Object.values(SERVICES)) deleteService(id);
  runPowerShell(firewallCommands({ caddyExecutable: caddyExe }).remove);
  try {
    execFileSync("schtasks.exe", ["/Delete", "/TN", BACKUP_TASK, "/F"], { stdio: "ignore", windowsHide: true });
  } catch {
    // The task was already gone.
  }
  if (record.rootThumbprint) removeTrustedRoot(record.rootThumbprint);
  renameSync(host.config, resolve(host.root, "host-removed.json"));
  console.log(`HOST_REMOVED profile=${record.profile} data=${outRoot}`);
}

async function profileStatus(args) {
  const profile = validateProfileName(String(args.profile ?? "production"));
  const { paths, config } = loadProfile(profile);
  if (!config) {
    console.log(JSON.stringify({ profile, configured: false }));
    return;
  }
  const appRecord = readPid(paths.appPid);
  const appCommand = appRecord ? processCommandLine(appRecord.pid) : null;
  const appOwned = Boolean(appRecord && appCommand && matchesOwnedAppCommand(appCommand, { scriptPath, profile }));
  const browserRecord = readPid(paths.browserPid);
  const browserCommand = browserRecord ? processCommandLine(browserRecord.pid) : null;
  const url = `http://127.0.0.1:${config.httpPort}`;
  const browserOwned = Boolean(browserRecord && browserCommand && matchesOwnedBrowserCommand(browserCommand, { userDataDir: paths.browser, url }));
  console.log(JSON.stringify({
    profile,
    configured: true,
    state: config.state,
    synthetic: config.synthetic,
    database: config.database,
    pgPort: config.pgPort,
    httpPort: config.httpPort,
    postgresRunning: pgIsRunning(paths),
    appOwned,
    browserOwned,
    ready: appOwned ? await ready(url, 1_000) : false,
    build: buildFreshness(),
    url,
  }, null, 2));
}

async function main() {
  if (process.platform !== "win32") throw new Error("The desktop launcher supports Windows only");
  const args = parseArgs(process.argv.slice(2));
  const action = String(args.action).toLowerCase();
  if (action === "build") return buildWeb();
  if (action === "setup") return setupProfile(args);
  if (action === "start") return startProfile(args);
  if (action === "launch") return launchProfile(args);
  if (action === "serve") return serveProfile(args);
  if (action === "host-serve") return serveProfile(args, { service: true });
  if (action === "hostinstall") return hostInstall(args);
  if (action === "hostremove") return hostRemove();
  if (action === "status") return profileStatus(args);
  if (action === "stop") return stopProfile(args);
  if (action === "backup") return backupProfile(args);
  throw new Error(`Unknown action: ${args.action}`);
}

main().catch((error) => {
  const message = String(error?.stack ?? error).replaceAll(/postgres:\/\/[^@\s]+@/g, "postgres://[redacted]@");
  console.error(message);
  process.exitCode = 1;
});
