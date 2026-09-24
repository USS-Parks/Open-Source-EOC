import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";

// upgrade.sh, and the backup.sh and restore.sh it relies on, run against
// stand-ins for docker, curl and sleep placed first on PATH, so the order of
// their steps and their refusals are exercised with no Docker daemon, no
// image and no network. Runs under the workspace vitest, as install.test.mjs.

const here = dirname(fileURLToPath(import.meta.url));
// Git Bash on Windows; the bash on PATH there can be the WSL launcher.
const BASH = process.platform === "win32"
  ? resolve(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "../../../bin/bash.exe")
  : "bash";

const COMPLETE_DUMP = "--\n-- PostgreSQL database dump\n--\n\ncreate table t ();\n\n--\n-- PostgreSQL database dump complete\n--\n\n";

// FAKE_DUMP selects what pg_dump does: fail, print nothing, or a complete dump.
// A restart installs FAKE_NEW_VERSION as the version the health probe reports.
const DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_STATE/log"
case "$*" in
  *" pg_dump "*)
    case "\${FAKE_DUMP:-}" in
      fail) echo 'service "db" is not running' >&2; exit 1 ;;
      empty) ;;
      *) printf '%s' "$COMPLETE_DUMP" ;;
    esac ;;
  *" tar "*) printf 'blob bytes' ;;
  *" psql "*) cat > "$FAKE_STATE/psql-input" ;;
  "compose up -d") printf '%s' "\${FAKE_NEW_VERSION:-0.9.0}" > "$FAKE_STATE/version" ;;
esac
`;

const CURL = `#!/usr/bin/env bash
url="\${!#}"
echo "curl $url" >> "$FAKE_STATE/log"
case "$url" in
  */health) printf '{"status":"ok","version":"%s"}' "$(cat "$FAKE_STATE/version")" ;;
  */ready) [ -z "\${FAKE_NEVER_READY:-}" ] || exit 22; printf '{"status":"ready"}' ;;
  *) exit 7 ;;
esac
`;

const dirs = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const posix = (path) => path.replaceAll("\\", "/");

/** A scratch install: the deploy scripts, an .env written by install.sh, and the stand-ins. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "openeoc-upgrade-"));
  dirs.push(dir);
  for (const sub of ["deploy", "bin", "state"]) mkdirSync(join(dir, sub));
  for (const script of ["upgrade.sh", "backup.sh", "restore.sh"]) copyFileSync(join(here, script), join(dir, "deploy", script));
  writeFileSync(join(dir, "deploy/.env"), 'OPENEOC_DOMAIN="eoc.county.example"\nOPENEOC_TLS="it@county.example"\n');
  writeFileSync(join(dir, "bin/docker"), DOCKER, { mode: 0o755 });
  writeFileSync(join(dir, "bin/curl"), CURL, { mode: 0o755 });
  writeFileSync(join(dir, "bin/sleep"), "#!/usr/bin/env bash\n", { mode: 0o755 });
  writeFileSync(join(dir, "state/version"), "0.9.0");
  return dir;
}

function run(dir, script, args = [], env = {}) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENEOC_")));
  const result = spawnSync(
    BASH,
    ["-c", 'export PATH="$(cygpath -u "$1" 2>/dev/null || printf %s "$1"):$PATH"; shift; exec bash "$@"', "_",
      posix(join(dir, "bin")), posix(join(dir, "deploy", script)), ...args],
    { encoding: "utf8", env: { ...inherited, FAKE_STATE: posix(join(dir, "state")), COMPLETE_DUMP, ...env } },
  );
  const log = join(dir, "state/log");
  return { status: result.status, out: `${result.stdout}${result.stderr}`, log: existsSync(log) ? readFileSync(log, "utf8") : "" };
}

const backups = (dir) => (existsSync(join(dir, "deploy/backups")) ? readdirSync(join(dir, "deploy/backups")) : []);

describe("upgrade.sh", () => {
  it("backs up before it rebuilds or restarts anything, then reports the new version and the backup", () => {
    const dir = setup();
    const up = run(dir, "upgrade.sh", [], { FAKE_NEW_VERSION: "0.9.1" });
    expect(up.status, up.out).toBe(0);

    const steps = ["exec -T db pg_dump", "exec -T api tar", "compose build", "compose up -d", "/api/v1/ready"]
      .map((step) => up.log.indexOf(step));
    expect(steps.every((at) => at >= 0), up.log).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);

    const files = backups(dir);
    const dump = files.find((name) => /^openeoc-\d{8}T\d{6}Z\.sql\.gz$/.test(name));
    expect(dump, files.join(", ")).toBeTruthy();
    expect(files).toContain(dump.replace(".sql.gz", ".blobs.tar.gz"));
    expect(gunzipSync(readFileSync(join(dir, "deploy/backups", dump))).toString()).toBe(COMPLETE_DUMP);
    expect(up.out).toContain("Running version: 0.9.0");
    expect(up.out).toContain(`Upgraded from 0.9.0 to 0.9.1. The backup taken before the upgrade is ./backups/${dump}`);
  });

  it("refuses to upgrade when the backup fails or yields an empty dump, and leaves no file that looks like a backup", () => {
    for (const [mode, message] of [
      ["fail", "The backup failed, so nothing was upgraded."],
      ["empty", "is empty or incomplete, so nothing was upgraded."],
    ]) {
      const dir = setup();
      const up = run(dir, "upgrade.sh", [], { FAKE_DUMP: mode });
      expect(up.status, mode).not.toBe(0);
      expect(up.out).toContain(message);
      expect(up.log).not.toContain("compose build");
      expect(up.log).not.toContain("compose up");
      if (mode === "fail") expect(backups(dir).filter((name) => name.endsWith(".gz"))).toEqual([]);
    }
  });

  it("names the backup to return to when the new version does not come up", () => {
    const dir = setup();
    const up = run(dir, "upgrade.sh", [], { FAKE_NEVER_READY: "1" });
    expect(up.status).not.toBe(0);
    expect(up.log).toContain("compose up -d");
    const dump = backups(dir).find((name) => name.endsWith(".sql.gz"));
    expect(up.out).toContain(`The API did not report ready. See: docker compose logs api. The backup taken before this upgrade is ./backups/${dump}`);
  });

  it("refuses an install whose .env predates the HTTPS front end", () => {
    const dir = setup();
    writeFileSync(join(dir, "deploy/.env"), "OPENEOC_DB_PASSWORD=x\n");
    const up = run(dir, "upgrade.sh");
    expect(up.status).not.toBe(0);
    expect(up.out).toContain("Run install.sh once");
    expect(up.log).not.toContain("pg_dump");
  });
});

describe("restore.sh", () => {
  it("refuses an incomplete dump before touching the database, and replays a complete one in one transaction", () => {
    const dir = setup();
    mkdirSync(join(dir, "deploy/backups"));
    const cut = join(dir, "deploy/backups/openeoc-cut.sql.gz");
    writeFileSync(cut, gzipSync(COMPLETE_DUMP.slice(0, 40)));
    const refused = run(dir, "restore.sh", [posix(cut), "--yes-drop-and-restore"]);
    expect(refused.status).toBe(2);
    expect(refused.out).toContain("is not a complete database dump; the current database was not changed");
    expect(refused.log).not.toContain("psql");

    const whole = join(dir, "deploy/backups/openeoc-whole.sql.gz");
    writeFileSync(whole, gzipSync(COMPLETE_DUMP));
    const restored = run(dir, "restore.sh", [posix(whole), "--yes-drop-and-restore"]);
    expect(restored.status, restored.out).toBe(0);
    expect(restored.log).toContain("exec -T db psql -v ON_ERROR_STOP=1 --single-transaction");
    expect(readFileSync(join(dir, "state/psql-input"), "utf8"))
      .toBe(`drop schema public cascade; create schema public;\n${COMPLETE_DUMP}`);
  });
});
