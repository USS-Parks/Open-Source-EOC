import { isAbsolute, resolve, win32 } from "node:path";

const acceptanceProfile = Object.freeze({ pgPort: 55442, httpPort: 8082, database: "openeoc_acceptance", synthetic: true });

export const PROFILE_DEFAULTS = Object.freeze({
  production: Object.freeze({ pgPort: 55440, httpPort: 8080, database: "openeoc", synthetic: false }),
  demo: Object.freeze({ pgPort: 55441, httpPort: 8081, database: "openeoc_demo", synthetic: true }),
  ...(process.env.OPENEOC_ENABLE_ACCEPTANCE_PROFILE === "1" ? { acceptance: acceptanceProfile } : {}),
});

export function validateProfileName(profile) {
  if (!Object.hasOwn(PROFILE_DEFAULTS, profile))
    throw new Error(`Profile must be one of: ${Object.keys(PROFILE_DEFAULTS).join(", ")}`);
  return profile;
}

export function validatePort(value, label) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error(`${label} must be an integer from 1024 through 65535`);
  return port;
}

export function profilePaths(outRoot, profile) {
  validateProfileName(profile);
  const root = resolve(outRoot, "profiles", profile);
  return Object.freeze({
    root,
    config: resolve(root, "profile.json"),
    pgData: resolve(root, "pgdata"),
    blobs: resolve(root, "blobs"),
    secrets: resolve(root, "secrets"),
    ownerPassword: resolve(root, "secrets", "postgres.password"),
    runtimePassword: resolve(root, "secrets", "app_runtime.password"),
    secretKey: resolve(root, "secrets", "envelope.key"),
    browser: resolve(root, "browser"),
    logs: resolve(root, "logs"),
    run: resolve(root, "run"),
    appPid: resolve(root, "run", "app.pid.json"),
    browserPid: resolve(root, "run", "browser.pid.json"),
  });
}

export function validateProfilePlans(plans) {
  const ports = new Map();
  const roots = new Set();
  for (const plan of plans) {
    validateProfileName(plan.profile);
    const pgPort = validatePort(plan.pgPort, `${plan.profile} PostgreSQL port`);
    const httpPort = validatePort(plan.httpPort, `${plan.profile} HTTP port`);
    if (pgPort === httpPort) throw new Error(`${plan.profile} PostgreSQL and HTTP ports must differ`);
    for (const [kind, port] of [["PostgreSQL", pgPort], ["HTTP", httpPort]]) {
      const prior = ports.get(port);
      if (prior) throw new Error(`${plan.profile} ${kind} port ${port} conflicts with ${prior}`);
      ports.set(port, `${plan.profile} ${kind}`);
    }
    const normalizedRoot = resolve(plan.root).toLowerCase();
    if (roots.has(normalizedRoot)) throw new Error(`Profile storage overlaps at ${plan.root}`);
    roots.add(normalizedRoot);
  }
  return true;
}

function normalizeCommand(value) {
  return String(value ?? "").replaceAll("\\", "/").toLowerCase();
}

function normalizeCommandPath(value) {
  const path = String(value ?? "");
  return normalizeCommand(isAbsolute(path) || win32.isAbsolute(path) ? path : resolve(path));
}

export function parseWindowsCommandLine(commandLine) {
  const args = [];
  let current = "";
  let quoted = false;
  for (const character of String(commandLine ?? "")) {
    if (character === '"') {
      quoted = !quoted;
    } else if (/\s/u.test(character) && !quoted) {
      if (current) args.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current) args.push(current);
  return args;
}

export function matchesOwnedAppCommand(commandLine, { scriptPath, profile }) {
  const args = parseWindowsCommandLine(commandLine).map(normalizeCommand);
  const script = normalizeCommandPath(scriptPath);
  return args.includes(script) && args.includes("serve") && args.includes(`--profile=${profile.toLowerCase()}`);
}

export function matchesOwnedBrowserCommand(commandLine, { userDataDir, url }) {
  const args = parseWindowsCommandLine(commandLine).map(normalizeCommand);
  const expectedDirectory = normalizeCommandPath(userDataDir);
  return args.includes(`--app=${normalizeCommand(url)}`) && args.includes(`--user-data-dir=${expectedDirectory}`);
}
