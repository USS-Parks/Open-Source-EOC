import "./ts-loader.mjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, relative, resolve } from "node:path";
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
import { registerStaticHost } from "./lib/static-host.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "../..");
const outRoot = resolve(repoRoot, "deploy/windows/out");
const buildRoot = resolve(outRoot, "build");
const distRoot = resolve(buildRoot, "app-dist");
const buildStampPath = resolve(buildRoot, "build-stamp.json");
const publicRoot = resolve(repoRoot, "web/public");
const pgDist = resolve(process.env.OPENEOC_PG_DIST ?? resolve(repoRoot, "deploy/test-runtime/out/pgsql"));
const pgBin = resolve(pgDist, "bin");
const powershell = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const SOURCE_INPUTS = [
  "pnpm-lock.yaml",
  "shared/package.json",
  "shared/src",
  "tsconfig.base.json",
  "web/index.html",
  "web/package.json",
  "web/src",
  "web/vite.config.ts",
];

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
    resolve(repoRoot, "web/node_modules/vite/dist/node/index.js"),
    resolve(publicRoot, "basemap/basemap.pmtiles"),
    resolve(publicRoot, "manifest.webmanifest"),
  ];
  if (kind === "database") {
    for (const executable of ["createdb.exe", "initdb.exe", "pg_ctl.exe", "pg_isready.exe"])
      files.push(resolve(pgBin, executable));
    files.push(resolve(pgDist, "share/extension/postgis.control"));
  }
  const missing = files.filter((path) => !existsSync(path));
  if (missing.length > 0)
    throw new Error(`Offline prerequisites are missing:\n${missing.map((path) => `- ${path}`).join("\n")}`);
}

function collectFiles(path) {
  if (!existsSync(path)) throw new Error(`Build input is missing: ${path}`);
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => collectFiles(resolve(path, entry.name)));
}

function sourceFingerprint() {
  const hash = createHash("sha256");
  const files = SOURCE_INPUTS.flatMap((item) => collectFiles(resolve(repoRoot, item)));
  for (const file of files) {
    hash.update(relative(repoRoot, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return { hash: hash.digest("hex"), files: files.length };
}

function gitRevision() {
  try {
    return execFileSync("git.exe", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return "unavailable";
  }
}

async function buildWeb() {
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
  const owner = connect({ url: databaseUrl("postgres", ownerPassword, config) });
  try {
    await migrate(owner, resolve(repoRoot, "server/migrations"));
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
    const auth = await importServer("server/src/auth/service.ts");
    const { provisionJurisdiction } = await importServer("server/src/auth/authz.ts");
    const personId = await auth.createPerson(owner, {
      email: bootstrapInput.email,
      displayName: bootstrapInput.displayName,
      password: bootstrapInput.password,
    });
    await owner`update persons set is_instance_admin = true where id = ${personId}`;
    const actor = await auth.principalForPerson(owner, personId);
    const provisioned = await provisionJurisdiction(owner, actor, {
      slug: bootstrapInput.jurisdictionSlug,
      name: bootstrapInput.jurisdictionName,
      adminPersonId: personId,
    });
    writeJsonAtomic(resolve(paths.root, "bootstrap.json"), {
      profile: config.profile,
      synthetic: false,
      adminPersonId: personId,
      jurisdictionId: provisioned.jurisdictionId,
      positions: provisioned.positions,
    });
    return provisioned;
  } finally {
    await owner.end();
  }
}

function productionBootstrap(args) {
  const password = process.env.OPENEOC_BOOTSTRAP_PASSWORD ?? "";
  delete process.env.OPENEOC_BOOTSTRAP_PASSWORD;
  const input = {
    email: String(args["admin-email"] ?? "").trim().toLowerCase(),
    displayName: String(args["admin-name"] ?? "").trim(),
    jurisdictionSlug: String(args["jurisdiction-slug"] ?? "").trim(),
    jurisdictionName: String(args["jurisdiction-name"] ?? "").trim(),
    password,
  };
  if (!/^\S+@\S+\.\S+$/.test(input.email)) throw new Error("Production admin email is required");
  if (!input.displayName) throw new Error("Production admin display name is required");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.jurisdictionSlug))
    throw new Error("Jurisdiction slug must use lowercase letters, numbers, and single hyphens");
  if (!input.jurisdictionName) throw new Error("Jurisdiction name is required");
  if (input.password.length < 12) throw new Error("Production admin password must contain at least 12 characters");
  return input;
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
  const productionInput = config.synthetic ? null : productionBootstrap(args);

  for (const path of [paths.root, paths.pgData, paths.blobs, paths.browser, paths.logs]) ensureDirectory(path);
  secureDirectory(paths.secrets);
  secureDirectory(paths.run);
  writeFileSync(paths.ownerPassword, `${randomPassword()}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  writeFileSync(paths.runtimePassword, `${randomPassword()}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
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

function runtimeConfig() {
  const config = {};
  const optional = [
    ["OPENEOC_BASEMAP_PMTILES_URL", "basemap/california.pmtiles"],
    ["OPENEOC_BUILDINGS_PMTILES_URL", "basemap/buildings.pmtiles"],
    ["OPENEOC_OVERLAYS_PMTILES_URL", "basemap/overlays.pmtiles"],
    ["OPENEOC_OVERLAYS_MANIFEST_URL", "basemap/overlays-manifest.json"],
  ];
  for (const [key, relativePath] of optional)
    if (existsSync(resolve(publicRoot, relativePath))) config[key] = `/${relativePath.replaceAll("\\", "/")}`;
  if (existsSync(resolve(publicRoot, "fonts"))) config.OPENEOC_BASEMAP_GLYPHS_URL = "/fonts/{fontstack}/{range}.pbf";
  return config;
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

async function serveProfile(args) {
  const profile = validateProfileName(String(args.profile ?? ""));
  const { paths, config } = loadProfile(profile);
  if (!config || config.state !== "ready") throw new Error(`Profile ${profile} is not ready`);
  requireFreshBuild();
  const token = process.env.OPENEOC_DESKTOP_TOKEN ?? "";
  delete process.env.OPENEOC_DESKTOP_TOKEN;
  if (!token) throw new Error("Desktop ownership token is missing");
  process.env.OPENEOC_DATA_DIR = paths.blobs;
  const runtimePassword = readFileSync(paths.runtimePassword, "utf8").trim();
  const [{ connect }, { buildApp }] = await Promise.all([
    importServer("server/src/db/client.ts"),
    importServer("server/src/app.ts"),
  ]);
  const runtime = connect({ url: databaseUrl("app_runtime", runtimePassword, config) });
  const app = buildApp(runtime, { oidc: null });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
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
  registerStaticHost(app, { distRoot, publicRoot, runtimeConfig: runtimeConfig() });
  await app.listen({ host: "127.0.0.1", port: config.httpPort });
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
  if (!config) throw new Error(`Profile ${profile} is not configured`);
  const browserStopped = await stopOwnedBrowser(paths, config);
  const appStopped = await stopOwnedApp(paths, config);
  const postgresStopped = stopPostgres(paths);
  console.log(`PROFILE_STOPPED profile=${profile} app=${appStopped} postgres=${postgresStopped} browser=${browserStopped}`);
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
  if (action === "serve") return serveProfile(args);
  if (action === "status") return profileStatus(args);
  if (action === "stop") return stopProfile(args);
  throw new Error(`Unknown action: ${args.action}`);
}

main().catch((error) => {
  const message = String(error?.stack ?? error).replaceAll(/postgres:\/\/[^@\s]+@/g, "postgres://[redacted]@");
  console.error(message);
  process.exitCode = 1;
});
