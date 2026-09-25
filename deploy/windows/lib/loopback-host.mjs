import { execFileSync, spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { parseWindowsCommandLine } from "./contracts.mjs";
import { POSTGRES_INCLUDE, hostDefinitions, hostPaths, parseWinswService } from "./host.mjs";

const tcpPort = () => new Promise((resolvePromise) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolvePromise(port));
  });
});

const udpFree = (port) => new Promise((resolvePromise) => {
  const socket = createSocket("udp4");
  socket.once("error", () => resolvePromise(false));
  socket.bind(port, "127.0.0.1", () => socket.close(() => resolvePromise(true)));
});

/** A spare loopback port; with `udp`, free for UDP too, as Caddy's HTTP/3 listener on the HTTPS port needs. */
export async function freePort({ udp = false } = {}) {
  for (;;) {
    const port = await tcpPort();
    if (!udp || await udpFree(port)) return port;
  }
}

export const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

export async function until(check, timeoutMs, failure) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(500);
  }
  throw new Error(failure);
}

export function request(get, url, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const call = get(url, { timeout: 5_000, ...options }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolvePromise({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    call.on("timeout", () => call.destroy(new Error("timeout")));
    call.on("error", reject);
  });
}

export async function stopChild(child) {
  // A process ended by a signal keeps a null exit code and sets its signal code.
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolvePromise) => child.once("exit", resolvePromise));
  child.kill();
  await exited;
}

/**
 * A network host profile run on this computer without the system changes the
 * setup program makes. The profile is set up in `dataRoot`; PostgreSQL starts
 * from the host's settings file; the server and Caddy start exactly as their
 * generated service definitions say, as this user and on the loopback address
 * with spare ports, so nothing listens on the network. The host proof and the
 * load proof both run on it. `serverEnv` adds settings to the server's own.
 */
export async function startLoopbackHost({ root, dataRoot, out, distRoot, publicRoot, pgDist, caddyExe, profile = "host-demo", serverEnv = {} }) {
  const children = [];
  const launcher = resolve(root, "deploy/windows/desktop.mjs");
  const pgCtl = resolve(pgDist, "bin/pg_ctl.exe");

  /** Start a process exactly as its WinSW definition says: executable, arguments, working folder and environment. */
  const startService = (definition, name, extraEnv = {}) => {
    const service = parseWinswService(definition);
    const log = resolve(out, `${name}.log`);
    writeFileSync(log, "");
    const child = spawn(service.executable, parseWindowsCommandLine(service.arguments), {
      cwd: service.workingDirectory,
      env: { ...process.env, ...service.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (chunk) => appendFileSync(log, chunk));
    child.stderr.on("data", (chunk) => appendFileSync(log, chunk));
    children.push(child);
    return child;
  };

  const pgPort = await freePort();
  const httpPort = await freePort();
  const httpsPort = await freePort({ udp: true });
  const redirectPort = await freePort();
  const env = {
    ...process.env,
    OPENEOC_DESKTOP_DATA_ROOT: dataRoot,
    OPENEOC_DESKTOP_PREBUILT: "1",
    OPENEOC_DESKTOP_DIST_ROOT: distRoot,
    OPENEOC_DESKTOP_PUBLIC_ROOT: publicRoot,
    OPENEOC_PG_DIST: pgDist,
  };
  const setupStarted = Date.now();
  const setup = execFileSync(process.execPath, [launcher, "setup", `--profile=${profile}`, `--pg-port=${pgPort}`, `--http-port=${httpPort}`], { cwd: root, env, encoding: "utf8" });
  const setupSeconds = Math.round((Date.now() - setupStarted) / 1000);
  const profileRoot = resolve(dataRoot, "profiles", profile);
  const pgData = resolve(profileRoot, "pgdata");
  const common = {
    appRoot: root, dataRoot, profile, profileRoot, pgData, pgPort, httpPort,
    nodeExecutable: process.execPath, caddyExecutable: caddyExe, distRoot, publicRoot, pgDist,
    powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  };

  const host = hostDefinitions({ ...common, names: ["localhost", "127.0.0.1"], httpsPort, redirectPort, bind: "127.0.0.1" });
  const paths = hostPaths(dataRoot);
  mkdirSync(paths.root, { recursive: true });
  writeFileSync(paths.caddyfile, host.caddyfile);
  writeFileSync(resolve(pgData, "openeoc-host.conf"), host.postgresSettings);
  appendFileSync(resolve(pgData, "postgresql.conf"), `\n${POSTGRES_INCLUDE}\n`);
  const stop = async () => {
    for (const child of children) if (child.exitCode === null) await stopChild(child);
    if (existsSync(resolve(pgData, "postmaster.pid"))) execFileSync(pgCtl, ["stop", "-D", pgData, "-m", "fast", "-w"], { stdio: "ignore" });
  };
  try {
    // As the PostgreSQL service starts it: the data folder alone, every setting from the file.
    execFileSync(pgCtl, ["start", "-D", pgData, "-w", "-t", "60"], { stdio: "ignore", windowsHide: true });
    const startServer = (name) => startService(host.services.server, name, serverEnv);
    const server = startServer("server");
    const caddy = startService(host.services.caddy, "caddy");
    await until(async () => (await request(httpGet, `http://127.0.0.1:${httpPort}/api/v1/ready`).catch(() => ({}))).status === 200, 180_000, "The server did not become ready");
    await until(() => existsSync(paths.rootCertificate) && existsSync(paths.intermediateCertificate), 60_000, "Caddy did not create its certificate authority");
    const rootPem = readFileSync(paths.rootCertificate);
    const https = `https://localhost:${httpsPort}`;
    await until(async () => (await request(httpsGet, `${https}/api/v1/ready`, { ca: rootPem }).catch(() => ({}))).status === 200, 60_000, "HTTPS did not answer");
    return {
      setup, setupSeconds, common, host, paths, profileRoot, pgData, pgPort, httpPort, httpsPort, redirectPort,
      env, https, rootPem, server, caddy, startServer,
      /** Stop every process this host started, and PostgreSQL. */
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
