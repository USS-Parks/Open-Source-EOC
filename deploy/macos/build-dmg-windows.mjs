import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { MAP_DATA_FILES } from "../windows/lib/map-data.mjs";
import { writeIso } from "./lib/iso9660.mjs";

/**
 * The macOS disk image of the demo, built on Windows from the Windows setup's
 * stage, so both carry the same app: the server, the web build and the public
 * files, with the launcher from this checkout, Node for Apple silicon and
 * Intel from nodejs.org (checked against the SHA-256 Node publishes), and the
 * app bundle, READ-ME and Applications link a Mac disk image carries.
 * PostgreSQL with PostGIS comes from Postgres.app on the Mac, and the maps
 * and layers from the map data packet downloaded beside the image.
 * deploy/macos/build-app.sh builds the image with PostgreSQL inside it, on a
 * Mac.
 *
 *   node deploy/macos/build-dmg-windows.mjs [--stage=deploy/windows/out/installer-stage/app] [--out=deploy]
 */

const root = process.cwd();
const option = (name, fallback) => {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return resolve(match ? match.slice(name.length + 3) : fallback);
};
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const stage = option("stage", resolve(root, "deploy/windows/out/installer-stage/app"));
const out = option("out", resolve(root, "deploy"));
const inputs = resolve(root, "deploy/windows/out/runtime-inputs");
const nodeVersion = "v24.15.0";
const image = resolve(out, `Open-Source-EOC-${version}-macOS.dmg`);
if (existsSync(image)) throw new Error(`${image} already exists; it was not replaced`);
const staged = JSON.parse(readFileSync(resolve(stage, "desktop-install.json"), "utf8"));
if (staged.version !== version) throw new Error(`The stage is ${staged.version}, not ${version}; stage this version first`);

async function sha256Of(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

// Node for both Mac architectures, each checked against Node's published SHA-256.
const sums = readFileSync(resolve(inputs, "SHASUMS256.txt"), "utf8");
const work = mkdtempSync(resolve(tmpdir(), "openeoc-macos-"));
const tar = resolve(process.env.SystemRoot ?? "C:/Windows", "System32/tar.exe");
const runtimes = [];
try {
  for (const arch of ["arm64", "x64"]) {
    const name = `node-${nodeVersion}-darwin-${arch}.tar.gz`;
    const expected = sums.split(/\r?\n/).find((line) => line.endsWith(`  ${name}`))?.slice(0, 64);
    if (!expected) throw new Error(`SHASUMS256.txt has no ${name}`);
    const archive = resolve(inputs, name);
    if (!existsSync(archive)) {
      const response = await fetch(`https://nodejs.org/dist/${nodeVersion}/${name}`);
      if (!response.ok) throw new Error(`Downloading ${name}: HTTP ${response.status}`);
      writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    }
    const actual = await sha256Of(archive);
    if (actual !== expected) throw new Error(`${name} does not match its published SHA-256`);
    const folder = `node-${nodeVersion}-darwin-${arch}`;
    execFileSync(tar, ["-xzf", archive, "-C", work, `${folder}/bin/node`, `${folder}/LICENSE`]);
    runtimes.push({ arch, node: resolve(work, folder, "bin/node"), license: resolve(work, folder, "LICENSE") });
  }

  // The stage's app, less what is Windows only (its runtimes, launcher scripts
  // and runtime license texts) and what the map data packet carries.
  const packet = new Set(MAP_DATA_FILES.filter((path) => path.startsWith("basemap/")).map((path) => `web/public/${path}`));
  const skip = (path) => path === "runtime" || path === "licenses" || path === "tools" || path === "deploy/windows"
    || packet.has(path);
  const walk = (folder, prefix) => readdirSync(folder, { withFileTypes: true }).flatMap((item) => {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (skip(path)) return [];
    if (item.isDirectory()) return [{ name: item.name, type: "dir", children: walk(resolve(folder, item.name), path) }];
    return [{ name: item.name, type: "file", source: resolve(folder, item.name) }];
  });
  const launcherFiles = (folder, prefix) => readdirSync(folder, { withFileTypes: true }).flatMap((item) => {
    const path = resolve(folder, item.name);
    if (item.isDirectory()) return [{ name: item.name, type: "dir", children: launcherFiles(path, `${prefix}/${item.name}`) }];
    return [{ name: item.name, type: "file", source: path }];
  });
  const windowsLauncher = resolve(root, "deploy/windows");
  const app = walk(stage, "");
  const deployFolder = app.find((item) => item.name === "deploy");
  deployFolder.children.push({ name: "windows", type: "dir", children: [
    { name: "desktop.mjs", type: "file", source: resolve(windowsLauncher, "desktop.mjs") },
    { name: "ts-loader.mjs", type: "file", source: resolve(windowsLauncher, "ts-loader.mjs") },
    { name: "lib", type: "dir", children: launcherFiles(resolve(windowsLauncher, "lib"), "lib") },
  ] });
  app.push({ name: "runtime", type: "dir", children: runtimes.map(({ arch, node, license }) => ({
    name: `node-${arch}`, type: "dir", children: [
      { name: "bin", type: "dir", children: [{ name: "node", type: "file", source: node, mode: 0o100755 }] },
      { name: "LICENSE", type: "file", source: license },
    ],
  })) });

  const plist = readFileSync(resolve(root, "deploy/macos/Info.plist"), "utf8").replaceAll("@VERSION@", version);
  const tree = { type: "dir", children: [
    { name: "Open Source EOC.app", type: "dir", children: [{ name: "Contents", type: "dir", children: [
      { name: "Info.plist", type: "file", data: Buffer.from(plist) },
      { name: "MacOS", type: "dir", children: [{ name: "Open Source EOC", type: "file", mode: 0o100755, source: resolve(root, "deploy/macos/launcher.sh") }] },
      { name: "Resources", type: "dir", children: [{ name: "app", type: "dir", children: app }] },
    ] }] },
    { name: "Applications", type: "symlink", target: "/Applications" },
    { name: "READ-ME-FIRST.txt", type: "file", source: resolve(root, "deploy/macos/READ-ME-FIRST.txt") },
  ] };
  const written = await writeIso({ tree, output: image, volumeId: `Open Source EOC ${version}` });
  const sha256 = await sha256Of(image);
  writeFileSync(`${image}.sha256`, sha256);
  console.log(`DMG_READY file=${relative(root, image)} bytes=${statSync(image).size} sha256=${sha256} files=${written.files} directories=${written.directories}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
