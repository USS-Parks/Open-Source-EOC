import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// install.sh runs against stand-ins for docker and curl placed first on PATH,
// so its logic is exercised with no Docker daemon, no image and no network.
// Runs under the workspace vitest so the normal CI run covers it.

const here = dirname(fileURLToPath(import.meta.url));
const RELEASE = "https://release.example/basemap";
// Git Bash on Windows; the bash on PATH there can be the WSL launcher.
const BASH = process.platform === "win32"
  ? resolve(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "../../../bin/bash.exe")
  : "bash";

const DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_STATE/log"
case "$*" in
  *" bootstrap "*)
    printf '%s' "$OPENEOC_BOOTSTRAP_PASSWORD" > "$FAKE_STATE/admin"
    echo "Bootstrapped: instance admin chief@county.example administers jurisdiction county-oes (1)." ;;
  *" -tAc "*) if [ -f "$FAKE_STATE/admin" ]; then echo 1; fi ;;
  *" psql "*) cat > /dev/null ;;
esac
`;

const CURL = `#!/usr/bin/env bash
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -w|--retry|--resolve) shift ;;
    -*) ;;
    *) url="$1" ;;
  esac
  shift
done
echo "curl $url" >> "$FAKE_STATE/log"
case "$url" in
  ${RELEASE}/*) cp "$FAKE_RELEASE/\${url##*/}" "$out" 2>/dev/null || exit 22 ;;
  */api/v1/me) printf 401 ;;
  https://*) printf '<div id="root"></div>' ;;
esac
`;

const FIRST = {
  OPENEOC_DOMAIN: "eoc.county.example",
  OPENEOC_ACME_EMAIL: "it@county.example",
  OPENEOC_ADMIN_EMAIL: "chief@county.example",
  OPENEOC_ADMIN_NAME: "County Chief",
  OPENEOC_JURISDICTION_SLUG: "county-oes",
  OPENEOC_JURISDICTION_NAME: "County OES",
  OPENEOC_BASEMAP_URL: RELEASE,
};

const dirs = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const posix = (path) => path.replaceAll("\\", "/");
const read = (dir, path) => readFileSync(join(dir, path), "utf8");

/** A scratch deploy directory with the stand-ins and a release of `files`, whose SHA256SUMS lists `listed`. */
function setup(files = {}, listed = files) {
  const dir = mkdtempSync(join(tmpdir(), "openeoc-install-"));
  dirs.push(dir);
  for (const sub of ["deploy", "bin", "state", "release"]) mkdirSync(join(dir, sub));
  copyFileSync(join(here, "install.sh"), join(dir, "deploy/install.sh"));
  writeFileSync(join(dir, "bin/docker"), DOCKER, { mode: 0o755 });
  writeFileSync(join(dir, "bin/curl"), CURL, { mode: 0o755 });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, "release", name), body);
  const sums = Object.entries(listed).map(([name, body]) => `${createHash("sha256").update(body).digest("hex")}  ${name}\n`);
  if (sums.length > 0) writeFileSync(join(dir, "release/SHA256SUMS"), sums.join(""));
  return dir;
}

function install(dir, env) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENEOC_")));
  const run = spawnSync(
    BASH,
    ["-c", 'export PATH="$(cygpath -u "$1" 2>/dev/null || printf %s "$1"):$PATH"; exec bash "$2"', "_",
      posix(join(dir, "bin")), posix(join(dir, "deploy/install.sh"))],
    {
      encoding: "utf8",
      env: { ...inherited, FAKE_STATE: posix(join(dir, "state")), FAKE_RELEASE: posix(join(dir, "release")), ...env },
    },
  );
  const log = join(dir, "state/log");
  return { status: run.status, out: `${run.stdout}${run.stderr}`, log: existsSync(log) ? readFileSync(log, "utf8") : "" };
}

describe("install.sh", () => {
  it("installs once without printing a secret and changes nothing on a re-run", () => {
    const dir = setup({ "california.pmtiles": "street tiles", "gazetteer.tsv": "places" });
    const first = install(dir, FIRST);
    expect(first.status, first.out).toBe(0);

    const env = read(dir, "deploy/.env");
    const password = read(dir, "deploy/admin-password.txt").trim();
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(read(dir, "state/admin")).toBe(password);
    const secrets = ["OPENEOC_DB_PASSWORD", "OPENEOC_SECRET_KEY", "OPENEOC_RUNTIME_PASSWORD"]
      .map((key) => new RegExp(`^${key}=(\\S{20,})$`, "m").exec(env)?.[1]);
    for (const secret of [...secrets, password]) {
      expect(secret).toBeTruthy();
      expect(first.out).not.toContain(secret);
    }
    expect(first.log).not.toContain(password);
    expect(env).toContain('OPENEOC_DOMAIN="eoc.county.example"');
    expect(env).toContain('OPENEOC_TLS="it@county.example"');
    expect(read(dir, "deploy/basemap/california.pmtiles")).toBe("street tiles");
    expect(read(dir, "deploy/basemap/gazetteer.tsv")).toBe("places");
    expect(read(dir, "deploy/basemap/runtime-config.js")).toBe(
      'globalThis.OPENEOC = Object.freeze({"OPENEOC_BASEMAP_PMTILES_URL":"/basemap/california.pmtiles"});\n',
    );
    expect(first.log).toContain(
      "docker compose run --rm -T -e OPENEOC_BOOTSTRAP_PASSWORD api tsx server/src/main.ts bootstrap --admin-email=chief@county.example",
    );
    expect(first.log).toContain("docker compose up -d\n");
    expect(first.out).toContain("Sign in at https://eoc.county.example");

    writeFileSync(join(dir, "state/log"), "");
    const again = install(dir, { OPENEOC_BASEMAP_URL: RELEASE });
    expect(again.status, again.out).toBe(0);
    expect(read(dir, "deploy/.env")).toBe(env);
    expect(read(dir, "deploy/admin-password.txt").trim()).toBe(password);
    expect(again.log).not.toContain("bootstrap");
    expect(again.log).not.toContain(RELEASE);
    expect(again.out).toContain("the first-administrator step is skipped");
  });

  it("refuses an archive that does not match its checksum and starts nothing", () => {
    const dir = setup({ "california.pmtiles": "substituted" }, { "california.pmtiles": "street tiles" });
    const run = install(dir, FIRST);
    expect(run.status).not.toBe(0);
    expect(run.out).toContain(`california.pmtiles from ${RELEASE} does not match its SHA-256 checksum`);
    expect(existsSync(join(dir, "deploy/basemap/california.pmtiles"))).toBe(false);
    expect(existsSync(join(dir, "deploy/basemap/california.pmtiles.part"))).toBe(false);
    expect(run.log).not.toContain("docker compose up");
  });

  it("stops before starting anything without a host name, a certificate choice or a clean checksum list", () => {
    const dir = setup();
    writeFileSync(join(dir, "release/SHA256SUMS"), `${"0".repeat(64)}  ../../etc/passwd\n`);
    const runs = [
      [install(dir, { ...FIRST, OPENEOC_DOMAIN: "" }), "Set OPENEOC_DOMAIN"],
      [install(dir, { ...FIRST, OPENEOC_DOMAIN: "eoc.example } evil {" }), "OPENEOC_DOMAIN must be a host name"],
      [install(dir, { ...FIRST, OPENEOC_ACME_EMAIL: "" }), "Choose the certificate"],
      [install(dir, FIRST), "is not '<sha256>  <file name>'; refusing it"],
    ];
    for (const [run, message] of runs) {
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(message);
      expect(run.log).not.toContain("docker compose up");
    }
    expect(existsSync(join(dir, "deploy/admin-password.txt"))).toBe(false);
  });

  it("installs a supplied certificate pair and falls back to the bundled basemap", () => {
    const dir = setup();
    writeFileSync(join(dir, "cert.pem"), "CERT");
    writeFileSync(join(dir, "key.pem"), "KEY");
    const run = install(dir, {
      ...FIRST,
      OPENEOC_ACME_EMAIL: "",
      OPENEOC_BASEMAP_URL: "",
      OPENEOC_TLS_CERT: posix(join(dir, "cert.pem")),
      OPENEOC_TLS_KEY: posix(join(dir, "key.pem")),
    });
    expect(run.status, run.out).toBe(0);
    expect(read(dir, "deploy/tls/cert.pem")).toBe("CERT");
    expect(read(dir, "deploy/tls/key.pem")).toBe("KEY");
    expect(read(dir, "deploy/.env")).toContain('OPENEOC_TLS="/etc/openeoc/tls/cert.pem /etc/openeoc/tls/key.pem"');
    expect(read(dir, "deploy/basemap/runtime-config.js")).toBe("globalThis.OPENEOC = Object.freeze({});\n");
    expect(run.out).toContain("the map shows the bundled basemap");
  });

  it("serves the bundle and the archives with the static host's cache rules", () => {
    const caddy = readFileSync(join(here, "Caddyfile"), "utf8");
    expect(caddy).toContain('header /assets/* Cache-Control "public, max-age=31536000, immutable"');
    expect(caddy).toContain("header @document Cache-Control no-store");
    expect(caddy).toMatch(/handle \/runtime-config\.js \{[^}]*Cache-Control no-store/);
    expect(caddy).toMatch(/handle @archives \{[^}]*Cache-Control no-cache[^}]*file_server/);
    expect(caddy).not.toMatch(/^\s*encode\b/m);
  });
});
