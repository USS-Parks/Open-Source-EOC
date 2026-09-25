import "./ts-loader.mjs";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
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
import { backupBeforeMigrate, scheduledBackup } from "./lib/pre-upgrade-backup.mjs";

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

function secureDirectory(path) {
  ensureDirectory(path);
  const identity = currentIdentity();
  execFileSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `${identity}:(OI)(CI)F`], {
    stdio: "ignore",
    windowsHide: true,
  });
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

async function assertPortFree(port, label) {
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", () => reject(new Error(`${label} port ${port} is already in use; no process was stopped`)));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(resolvePromise));
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
    await migrate(owner, migrations);
    if (setRuntimePassword)
      await owner.unsafe(`alter role app_runtime login password '${runtimePassword.replaceAll("'", "''")}'`);
    await boards.ensureStandardTemplates(owner);
    await incidents.ensureStandardIncidentTemplates(owner);
    await dashboards.ensureStandardDashboards(owner);
    if (!bootstrap) return null;
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
  secureDirectory(paths.secrets);
  secureDirectory(paths.run);
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

async function startProfile(args) {
  requiredFiles("database");
  requireFreshBuild();
  const profile = validateProfileName(String(args.profile ?? "production"));
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
  if (!loadProfile(profile).config) await setupProfile({ ...args, profile });
  await startProfile({ ...args, profile });
}

async function serveProfile(args) {
  const profile = validateProfileName(String(args.profile ?? ""));
  const { paths, config } = loadProfile(profile);
  if (!config || config.state !== "ready") throw new Error(`Profile ${profile} is not ready`);
  requireFreshBuild();
  const token = process.env.OPENEOC_DESKTOP_TOKEN ?? "";
  delete process.env.OPENEOC_DESKTOP_TOKEN;
  if (!token) throw new Error("Desktop ownership token is missing");
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
  const app = buildApp(runtime, { oidc: null, logStream: rotatingLog(resolve(paths.logs, "server.log")) });
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
  app.post("/__desktop/stop", async (request, reply) => {
    if (request.headers["x-openeoc-desktop-token"] !== token) return reply.code(404).send("Missing");
    void reply.send({ status: "stopping" });
    globalThis.setImmediate(() => void close().then(() => process.exit(0)));
  });
  const runtimeConfig = await desktopRuntimeConfig(publicRoot);
  // A synthetic profile says so on every screen, beside the handling marking.
  if (config.synthetic) runtimeConfig.OPENEOC_SYNTHETIC_DATA = "1";
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
