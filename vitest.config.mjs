import { defineConfig } from "vitest/config";

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
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
