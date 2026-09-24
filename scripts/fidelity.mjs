// Runs the design fidelity harness and writes the side-by-side images to
// docs/design/fidelity. Needs the same database and Chromium settings as the
// browser suites (see deploy/test-runtime/README.md).
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const result = spawnSync(process.execPath, [
  join(root, "node_modules", "vitest", "vitest.mjs"), "run", "server/src/__tests__/fidelity-browser.test.ts",
], { cwd: root, stdio: "inherit", env: { ...process.env, OPENEOC_FIDELITY_DIR: join(root, "docs", "design", "fidelity") } });
process.exit(result.status ?? 1);
