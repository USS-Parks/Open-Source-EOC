#!/usr/bin/env node
// License hygiene gate (CLAUDE.md / execution contract item 11).
// Scans every installed package's declared license and fails on licenses
// that must not be vendored or embedded in this codebase, and on copyleft
// licenses no one has reviewed (VA10).
// LICENSE_SCAN_EXTRA may name an extra directory to scan (used by tests).

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Licenses that may never be vendored or embedded: network copyleft,
 * source-available and fair-code licenses. VA10 added the Functional Source
 * License (FSL), the Fair Use and Fair Core licenses, the Camunda License,
 * Carbone's community license and the Open WebUI license, the PolyForm
 * licenses, and the SPDX id Elastic-2.0 beside the words "Elastic License".
 */
export const DENY = /AGPL|SSPL|OSL-|Open Software License|BUSL|Business Source|Elastic License|Elastic-2\.0|Commons Clause|CC-BY-NC|Sustainable Use|Prosperity|Parity|PolyForm|FSL-\d|Functional Source|Fair Use License|FCL-\d|Fair Core License|Camunda License|Carbone Community|Open ?WebUI/i;

/**
 * Copyleft licenses allowed only after review: the package, its license and
 * how the project uses it are recorded in scripts/license-review.json.
 */
export const REVIEW = /\b(?:L?GPL|MPL)\b/i;

const REVIEWED = join(dirname(fileURLToPath(import.meta.url)), "license-review.json");

/**
 * How a declared license stands: "deny" when any part names a forbidden
 * license, "review" when every alternative of an OR is copyleft, else "ok".
 * A package under "MIT OR MPL-2.0" is taken under MIT and needs no review;
 * a forbidden name anywhere still denies, as before.
 */
export function classify(license) {
  if (DENY.test(license)) return "deny";
  const alternatives = license.replace(/[()]/g, " ").split(/\s+OR\s+/i);
  return alternatives.every((alternative) => REVIEW.test(alternative)) ? "review" : "ok";
}

/** The declared license, reading the file a "SEE LICENSE IN <file>" names. */
export function licenseOf(pkg, dir) {
  const raw = pkg.license ?? pkg.licenses;
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.map((l) => l.type ?? String(l)).join(" OR ");
  if (typeof raw === "object") return raw.type ?? null;
  if (typeof raw !== "string") return null;
  const pointer = /^SEE LICEN[CS]E IN (.+)$/i.exec(raw.trim());
  if (!pointer || !dir) return raw;
  const file = join(dir, pointer[1].trim());
  // The name of a license is in its first lines; the whole text is not needed.
  return existsSync(file) ? `${raw}: ${readFileSync(file, "utf8").slice(0, 2000)}` : raw;
}

/** Whether a package's reviewed entry still matches: a name, or a prefix ending in "*", and the same license. */
export function reviewedAs(reviews, name, license) {
  for (const [key, entry] of Object.entries(reviews)) {
    const matches = key.endsWith("*") ? name.startsWith(key.slice(0, -1)) : name === key;
    if (matches && entry.license === license) return entry;
  }
  return null;
}

function* packageJsons(root) {
  const pnpmDir = join(root, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return;
  for (const entry of readdirSync(pnpmDir)) {
    const nm = join(pnpmDir, entry, "node_modules");
    if (!existsSync(nm)) continue;
    for (const name of readdirSync(nm)) {
      if (name.startsWith(".")) continue;
      const scoped = name.startsWith("@") ? readdirSync(join(nm, name)).map((s) => join(name, s)) : [name];
      for (const p of scoped) {
        const pj = join(nm, p, "package.json");
        if (existsSync(pj)) yield pj;
      }
    }
  }
}

function main() {
  const roots = [process.cwd()];
  if (process.env.LICENSE_SCAN_EXTRA) roots.push(process.env.LICENSE_SCAN_EXTRA);
  const reviews = JSON.parse(readFileSync(REVIEWED, "utf8")).packages;

  const violations = [];
  const unreviewed = [];
  const unknown = [];
  let reviewed = 0;
  const seen = new Set();

  for (const root of roots) {
    const files = existsSync(join(root, "package.json")) && root !== process.cwd()
      ? [join(root, "package.json")]
      : [...packageJsons(root)];
    for (const file of files) {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      const id = `${pkg.name}@${pkg.version}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const lic = licenseOf(pkg, dirname(file));
      if (lic == null) { unknown.push(id); continue; }
      const verdict = classify(lic);
      if (verdict === "deny") violations.push(`${id}: ${lic.split("\n")[0]}`);
      else if (verdict === "review") {
        if (reviewedAs(reviews, pkg.name, lic)) reviewed += 1;
        else unreviewed.push(`${id}: ${lic.split("\n")[0]}`);
      }
    }
  }

  if (unknown.length > 0) {
    console.error(`license-scan: warning, ${unknown.length} package(s) declare no license: ${unknown.join(", ")}`);
  }
  let failed = false;
  if (violations.length > 0) {
    console.error("license-scan: FORBIDDEN licenses found:");
    for (const v of violations) console.error(`  ${v}`);
    console.error("license-scan: these licenses may not be vendored or embedded (see CONTRIBUTING.md).");
    failed = true;
  }
  if (unreviewed.length > 0) {
    console.error("license-scan: copyleft licenses not yet reviewed:");
    for (const v of unreviewed) console.error(`  ${v}`);
    console.error("license-scan: review each and record it in scripts/license-review.json (see CONTRIBUTING.md).");
    failed = true;
  }
  if (failed) process.exit(1);
  console.log(`license-scan: ok (${seen.size} package(s) checked, ${reviewed} reviewed copyleft)`);
}

// Run as a command, not when a test imports the classifier. Windows paths compare without case.
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
if (process.platform === "win32" ? invoked.toLowerCase() === self.toLowerCase() : invoked === self) main();
