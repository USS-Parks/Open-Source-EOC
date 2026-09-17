#!/usr/bin/env node
// Relative-link checker for tracked Markdown files. Verifies that every
// relative link target exists in the working tree. External links (http,
// https, mailto) are out of scope by design: this gate must pass air-gapped.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const files = execFileSync("git", ["ls-files", "*.md", "**/*.md"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const failures = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(LINK)) {
    const raw = match[1];
    if (/^(https?:|mailto:|#)/i.test(raw)) continue;
    const target = normalize(join(dirname(file), raw.split("#")[0]));
    if (target === "" || target === ".") continue;
    if (!existsSync(target)) failures.push(`${file}: broken link -> ${raw}`);
  }
}

if (failures.length > 0) {
  console.error("check-links: broken relative links found:");
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`check-links: ok (${files.length} markdown file(s) scanned)`);
