import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

export const DESKTOP_BUILD_SOURCE_INPUTS = [
  // Help bundles the user guides and the position job aids.
  "docs/guides",
  "pnpm-lock.yaml",
  "shared/package.json",
  "shared/src",
  "tsconfig.base.json",
  "web/index.html",
  "web/package.json",
  "web/src",
  "web/vite.config.ts",
];

function collectFiles(path) {
  if (!existsSync(path)) throw new Error(`Build input is missing: ${path}`);
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => collectFiles(resolve(path, entry.name)));
}

export function desktopBuildSourceFingerprint(repoRoot) {
  const root = resolve(repoRoot);
  const hash = createHash("sha256");
  const files = DESKTOP_BUILD_SOURCE_INPUTS.flatMap((item) => collectFiles(resolve(root, item)));
  for (const file of files) {
    hash.update(relative(root, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return { hash: hash.digest("hex"), files: files.length };
}
