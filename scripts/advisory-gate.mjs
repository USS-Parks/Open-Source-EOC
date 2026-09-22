import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const severityRank = { low: 1, moderate: 2, high: 3, critical: 4 };
const allowlist = JSON.parse(
  readFileSync(new URL("../security/advisory-allowlist.json", import.meta.url), "utf8"),
);
const accepted = new Map(allowlist.advisories.map((entry) => [entry.id, entry]));

for (const entry of accepted.values()) {
  if (!entry.id || !entry.package || !entry.reason || !entry.expires) {
    throw new Error("advisory allowlist entries require id, package, reason, and expires");
  }
  if (new Date(`${entry.expires}T23:59:59Z`) < new Date()) {
    throw new Error(`advisory allowlist entry ${entry.id} expired on ${entry.expires}`);
  }
}

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) {
  throw new Error("run the advisory gate through pnpm so npm_execpath identifies the pinned CLI");
}
const audit = spawnSync(
  process.execPath,
  [pnpmCli, "audit", "--audit-level=high", "--json"],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
if (audit.error) throw audit.error;

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stderr);
  throw new Error("pnpm audit did not return a JSON report");
}

const advisories = Object.values(report.advisories ?? {}).filter(
  (advisory) => (severityRank[advisory.severity] ?? 0) >= severityRank.high,
);
const unapproved = [];
const allowed = [];
for (const advisory of advisories) {
  const identifiers = [
    advisory.github_advisory_id,
    ...(advisory.cves ?? []),
    String(advisory.id),
  ].filter(Boolean);
  const entry = identifiers.map((id) => accepted.get(id)).find(Boolean);
  if (entry && entry.package === advisory.module_name) {
    allowed.push(`${entry.id} (${entry.package}, expires ${entry.expires})`);
  } else {
    unapproved.push(
      `${advisory.github_advisory_id ?? advisory.id} ${advisory.module_name} ${advisory.severity}`,
    );
  }
}

if (unapproved.length > 0) {
  console.error("advisory-gate: unapproved high or critical advisories:");
  for (const advisory of unapproved) console.error(`  - ${advisory}`);
  process.exit(1);
}
if (audit.status !== 0 && advisories.length === 0) {
  process.stderr.write(audit.stderr);
  throw new Error(`pnpm audit failed with exit code ${audit.status}`);
}

console.log(
  `advisory-gate: ok (${advisories.length} high/critical; ${allowed.length} time-bounded exception(s))`,
);
for (const item of allowed) console.log(`  accepted: ${item}`);
