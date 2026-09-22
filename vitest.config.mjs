import process from "node:process";
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
    // Hosted runners have limited CPU. Capping file workers prevents several
    // Chromium suites from rebuilding and driving the UI at once; the load
    // benchmark is run separately by `pnpm check` so its latency stays useful.
    maxWorkers: process.env.CI ? 2 : undefined,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // The global teardown below may drop one database per test file; give it
    // room beyond the 10s default so a full run's cleanup never times out.
    teardownTimeout: 120_000,
    // After the whole run, drop the throwaway t_<random> databases freshDb()
    // creates per file (it never drops them), so the local cluster does not
    // accumulate dead databases and slow Postgres startup and recovery fsync.
    globalSetup: ["./server/src/__tests__/globalSetup.ts"],
  },
});
