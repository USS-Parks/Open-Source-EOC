import { resolve } from "node:path";
import { desktopBuildSourceFingerprint } from "../lib/build-fingerprint.mjs";

const repoRoot = process.argv[2];
if (!repoRoot) throw new Error("Usage: source-fingerprint.mjs <repository-root>");

const root = resolve(repoRoot);
const fingerprint = desktopBuildSourceFingerprint(root);
process.stdout.write(`${JSON.stringify({
  schema: 1,
  repoRoot: root,
  sourceHash: fingerprint.hash,
  sourceFiles: fingerprint.files,
})}\n`);
