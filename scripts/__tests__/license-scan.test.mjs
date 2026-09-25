import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { classify } from "../license-scan.mjs";

/**
 * VA10: the license gate refuses a package under each forbidden license,
 * holds copyleft for review, and passes a reviewed one. Each fixture is one
 * package.json the scan reads through LICENSE_SCAN_EXTRA, from an empty
 * working directory so the repository's own packages stay out of it.
 */

const SCAN = fileURLToPath(new URL("../license-scan.mjs", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "license-scan-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function scan(pkg, files = {}) {
  const dir = mkdtempSync(join(work, "pkg-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.0.0", ...pkg }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const cwd = join(work, "empty");
  mkdirSync(cwd, { recursive: true });
  const run = spawnSync(process.execPath, [SCAN], { cwd, env: { ...process.env, LICENSE_SCAN_EXTRA: dir }, encoding: "utf8" });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

const FORBIDDEN = {
  "functional-source": "FSL-1.1-MIT",
  "functional-source-words": "Functional Source License, Version 1.1, Apache 2.0 Future License",
  "fair-use": "Fair Use License 1.1",
  "fair-core": "FCL-1.0-MIT",
  "camunda": "Camunda License 1.0",
  "carbone": "Carbone Community License",
  "open-webui": "Open WebUI License",
  "polyform": "PolyForm-Noncommercial-1.0.0",
  "elastic": "Elastic-2.0",
  "agpl": "AGPL-3.0-only",
  "sspl": "SSPL-1.0",
  "business-source": "BUSL-1.1",
};

describe("license gate", () => {
  it("refuses a package under each forbidden license, naming it", () => {
    for (const [name, license] of Object.entries(FORBIDDEN)) {
      const result = scan({ name: `fixture-${name}`, license });
      expect(result.status, `${name}: ${result.output}`).toBe(1);
      expect(result.output).toContain("FORBIDDEN");
      expect(result.output).toContain(`fixture-${name}@1.0.0: ${license}`);
    }
  });

  it("reads the license file a package points to", () => {
    const result = scan({ name: "fixture-carbone-file", license: "SEE LICENSE IN LICENSE.md" },
      { "LICENSE.md": "# Carbone Community License (CCL)\n\nVersion 1.0\n" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("fixture-carbone-file@1.0.0: SEE LICENSE IN LICENSE.md: # Carbone Community License");
  });

  it("holds GPL, LGPL and MPL for review, and passes a reviewed package under its reviewed license only", () => {
    for (const license of ["GPL-3.0-only", "LGPL-2.1-or-later", "MPL-2.0"]) {
      const result = scan({ name: "fixture-copyleft", license });
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain(`copyleft licenses not yet reviewed:\n  fixture-copyleft@1.0.0: ${license}`);
    }
    // scripts/license-review.json records lightningcss's platform binaries under MPL-2.0.
    const reviewed = scan({ name: "lightningcss-win32-x64-msvc", license: "MPL-2.0" });
    expect(reviewed.status, reviewed.output).toBe(0);
    expect(reviewed.output).toContain("1 reviewed copyleft");
    const relicensed = scan({ name: "lightningcss-win32-x64-msvc", license: "GPL-3.0-only" });
    expect(relicensed.status).toBe(1);
  });

  it("passes permissive licenses and a copyleft one offered beside a permissive one", () => {
    for (const license of ["MIT", "Apache-2.0", "BlueOak-1.0.0", "(MIT OR GPL-3.0-or-later)", "MPL-2.0 OR Apache-2.0"]) {
      const result = scan({ name: "fixture-permissive", license });
      expect(result.status, `${license}: ${result.output}`).toBe(0);
    }
  });

  it("classifies each declared license", () => {
    expect(classify("AGPL-3.0-or-later")).toBe("deny");
    expect(classify("(MIT OR AGPL-3.0)")).toBe("deny");
    expect(classify("LGPL-3.0-only")).toBe("review");
    expect(classify("MIT AND MPL-2.0")).toBe("review");
    expect(classify("(GPL-2.0 OR MPL-1.1)")).toBe("review");
    expect(classify("GPL-2.0-with-classpath-exception")).toBe("review");
    expect(classify("Unlicense")).toBe("ok");
    expect(classify("ISC")).toBe("ok");
  });
});
