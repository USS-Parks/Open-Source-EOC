#!/usr/bin/env node
// License hygiene gate (CLAUDE.md / execution contract item 11).
// Scans every installed package's declared license and fails on licenses
// that must not be vendored or embedded in this codebase.
// LICENSE_SCAN_EXTRA may name an extra directory to scan (used by tests).

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DENY = /AGPL|SSPL|OSL-|Open Software License|BUSL|Business Source|Elastic License|Commons Clause|CC-BY-NC|Sustainable Use|Prosperity|Parity/i;

function licenseOf(pkg) {
  const raw = pkg.license ?? pkg.licenses;
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((l) => l.type ?? String(l)).join(" OR ");
  if (typeof raw === "object") return raw.type ?? null;
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

const roots = [process.cwd()];
if (process.env.LICENSE_SCAN_EXTRA) roots.push(process.env.LICENSE_SCAN_EXTRA);

const violations = [];
const unknown = [];
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
    const lic = licenseOf(pkg);
    if (lic == null) unknown.push(id);
    else if (DENY.test(lic)) violations.push(`${id}: ${lic}`);
  }
}

if (unknown.length > 0) {
  console.error(`license-scan: warning, ${unknown.length} package(s) declare no license: ${unknown.join(", ")}`);
}
if (violations.length > 0) {
  console.error("license-scan: FORBIDDEN licenses found:");
  for (const v of violations) console.error(`  ${v}`);
  console.error("license-scan: these licenses may not be vendored or embedded (see CONTRIBUTING.md).");
  process.exit(1);
}
console.log(`license-scan: ok (${seen.size} package(s) checked)`);
