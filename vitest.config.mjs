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
// The real-browser walks. Each is one long scripted journey, so a single
// slow transition on a hosted runner fails the whole file; those files, and
// only those, get one retry there. Everything else keeps zero retries so a
// flaky database test is still reported as flaky.
const browserSuites = ["server/src/__tests__/*-browser.test.ts", "server/src/__tests__/*-e2e.test.ts"];

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
    // After the whole run, drop the throwaway t_<random> databases freshDb()
    // creates per file (it never drops them), so the local cluster does not
    // accumulate dead databases and slow Postgres startup and recovery fsync.
    globalSetup: ["./server/src/__tests__/globalSetup.ts"],
    projects: [
      { extends: true, test: { name: "browser", include: browserSuites, retry: process.env.CI ? 1 : 0 } },
      { extends: true, test: { name: "unit", exclude: [...configDefaults.exclude, "deploy/**/out/**", "deploy/windows/desktop.test.mjs", "deploy/windows/installer/installer.test.mjs", ...browserSuites] } },
    ],
  },
});
