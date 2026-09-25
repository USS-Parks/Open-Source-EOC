import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Generous timeouts so database-heavy work never flakes under a loaded CI
 * runner: each test file migrates its own throwaway database, and a few
 * tests stand up a second one mid-test. This raises only the timeouts; test
 * discovery and the per-file `@vitest-environment` pragmas are unchanged.
 * The application's own latency is guarded separately (load.test.ts and the
 * hot-path latency check), so loosening these never hides a real regression.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "deploy/**/out/**", "deploy/windows/desktop.test.mjs", "deploy/windows/installer/installer.test.mjs"],
    // Hosted runners have limited CPU. Serialize files so multiple Chromium
    // suites never drive the UI at the same time; the load benchmark is run
    // separately by `pnpm check` so its latency stays useful.
    maxWorkers: process.env.CI ? 1 : undefined,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // The global teardown below may drop one database per test file; give it
    // room beyond the 10s default so a full run's cleanup never times out.
    teardownTimeout: 120_000,
    // Suites sign in as a seeded admin with a password alone. Admin MFA is
    // on by default in a deployment; the MFA suites turn it on explicitly.
    env: { OPENEOC_REQUIRE_ADMIN_MFA: "0" },
    // A worker that dies on a Node or V8 fatal error writes a diagnostic
    // report here, naming the error and its stacks. A worker crash on
    // Windows (exit 0xC0000409) prints nothing, so this is where its cause
    // is looked for; an abort from native code outside V8 leaves no report.
    execArgv: ["--report-on-fatalerror", `--report-directory=${fileURLToPath(new URL("./deploy/test-runtime/out/crash-reports", import.meta.url))}`],
    // After the whole run, drop the throwaway t_<random> databases freshDb()
    // creates per file (it never drops them), so the local cluster does not
    // accumulate dead databases and slow Postgres startup and recovery fsync.
    globalSetup: ["./server/src/__tests__/globalSetup.ts"],
    // No retries anywhere: the browser walks sign in inside the test body,
    // so a retried walk meets an already signed-in page and cannot recover,
    // and a retried database test would hide a real flake.
  },
});
