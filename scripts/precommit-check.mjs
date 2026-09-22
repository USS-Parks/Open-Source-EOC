import { execFileSync } from "node:child_process";

const sourceFile = /\.(?:[cm]?[jt]sx?)$/i;
const rosterIdentifier = /\b(?:VEOC-\d+[A-Z0-9.-]*|D\d{2}|W\d+(?:\.\d+)?|M\d+|81c|P-[A-Z0-9][A-Z0-9-]*)\b/i;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function stagedBlob(path) {
  return git(["show", `:${path}`]);
}

function headBlob(path) {
  try {
    return execFileSync("git", ["show", `HEAD:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function addedLines(path) {
  return git(["diff", "--cached", "--unified=0", "--no-color", "--", path])
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
}

function isComment(line) {
  return /^\s*(?:\/\/|\/\*|\*|<!--)/.test(line);
}

function isTestTitle(line) {
  return /\b(?:describe|it|test)(?:\.(?:only|skip|todo))?\s*\(\s*["'`]/.test(line);
}

function quotedLineCount(text, quote) {
  return text.split(/\r?\n/).filter((line) => line.includes(quote)).length;
}

const files = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
  .split("\0")
  .filter(Boolean);
const failures = [];

for (const path of files.filter((candidate) => sourceFile.test(candidate))) {
  if (path !== "scripts/precommit-check.mjs") {
    for (const line of addedLines(path)) {
      if ((isComment(line) || isTestTitle(line)) && rosterIdentifier.test(line)) {
        failures.push(`${path}: roster identifier in shipped comment or test title: ${line.trim()}`);
      }
    }
  }

  const before = headBlob(path);
  if (before === null) continue;
  const after = stagedBlob(path);
  const oldDouble = quotedLineCount(before, '"');
  const oldSingle = quotedLineCount(before, "'");
  const newDouble = quotedLineCount(after, '"');
  const newSingle = quotedLineCount(after, "'");
  if (
    oldDouble >= 10 &&
    oldDouble >= oldSingle * 2 &&
    newSingle >= 10 &&
    newSingle >= newDouble * 2
  ) {
    failures.push(`${path}: staged TypeScript/JavaScript appears to flip the repository's double-quote style`);
  }
}

if (failures.length > 0) {
  console.error("pre-commit: staged-content checks failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`pre-commit: staged-content checks passed (${files.length} file(s))`);
