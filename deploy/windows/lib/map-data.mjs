import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * The map data packet: the maps and layers too large for an app bundle, as a
 * download beside it. It holds the optional archives the Windows setup
 * carries and the address search index, with a manifest naming each file's
 * size and SHA-256. Installed, it sits in the profile data folder, where the
 * static host serves its basemap folder and the server reads the index.
 */

/** Every file a packet may carry, as the Windows setup's optional map set has them. */
export const MAP_DATA_FILES = Object.freeze([
  "basemap/california.pmtiles",
  "basemap/buildings.pmtiles",
  "basemap/buildings-overture.json",
  "basemap/overlays.pmtiles",
  "basemap/overlays-manifest.json",
  "basemap/north-coast-imagery.pmtiles",
  "basemap/north-coast-terrain.pmtiles",
  "gazetteer.tsv",
]);
export const MAP_DATA_MANIFEST = "map-data.json";

async function sha256Of(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Write a packet folder from its source files: { "basemap/california.pmtiles": "C:/...", ... }. */
export async function packMapData({ sources, folder, version, notices = [] }) {
  if (existsSync(folder)) throw new Error(`Packet folder already exists: ${folder}`);
  const files = [];
  for (const path of MAP_DATA_FILES) {
    const source = sources[path];
    if (!source || !existsSync(source)) throw new Error(`Map data file is missing: ${path} (${source ?? "no source"})`);
    const target = resolve(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    files.push({ path, bytes: statSync(target).size, sha256: await sha256Of(target) });
  }
  for (const notice of notices) copyFileSync(notice, resolve(folder, notice.split(/[\\/]/).at(-1)));
  const manifest = { schema: 1, product: "Open Source EOC", version, createdAt: new Date().toISOString(), files };
  writeFileSync(resolve(folder, MAP_DATA_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Read a packet folder's manifest and check every file against it; throws on any difference. */
export async function verifyMapData(folder) {
  const manifestPath = resolve(folder, MAP_DATA_MANIFEST);
  if (!existsSync(manifestPath)) throw new Error(`Not a map data packet (no ${MAP_DATA_MANIFEST}): ${folder}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest?.schema !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0)
    throw new Error("The map data manifest is not a schema 1 packet");
  const seen = new Set();
  for (const entry of manifest.files) {
    if (!MAP_DATA_FILES.includes(entry?.path) || seen.has(entry.path))
      throw new Error(`The map data manifest names a file a packet may not carry: ${entry?.path}`);
    seen.add(entry.path);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[0-9a-f]{64}$/.test(String(entry.sha256)))
      throw new Error(`The map data manifest entry for ${entry.path} is invalid`);
    const file = resolve(folder, entry.path);
    if (!existsSync(file) || statSync(file).size !== entry.bytes)
      throw new Error(`${entry.path} is missing or not the size its manifest gives`);
    if (await sha256Of(file) !== entry.sha256) throw new Error(`${entry.path} does not match its manifest's SHA-256`);
  }
  return manifest;
}

/** The folder inside an unpacked download that holds the manifest: the folder itself or its one subfolder. */
function packetRoot(folder) {
  if (existsSync(resolve(folder, MAP_DATA_MANIFEST))) return folder;
  const entries = readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length === 1 && existsSync(resolve(folder, entries[0].name, MAP_DATA_MANIFEST))) return resolve(folder, entries[0].name);
  throw new Error(`No ${MAP_DATA_MANIFEST} in ${folder}`);
}

/**
 * Install a packet (a .zip, or its unpacked folder) at `target`. The files are
 * checked against the manifest before anything replaces the installed set,
 * and the installed set is swapped whole, so a failed install leaves the
 * previous maps in place. `unzip(zip, folder)` unpacks a .zip.
 */
export async function installMapData({ from, target, unzip }) {
  const source = resolve(String(from ?? ""));
  if (!existsSync(source)) throw new Error(`Map data not found: ${source}`);
  const staging = `${target}.${process.pid}.new`;
  const previous = `${target}.${process.pid}.old`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    let folder;
    if (statSync(source).isDirectory()) {
      folder = packetRoot(source);
    } else {
      const unpacked = resolve(staging, "unpacked");
      mkdirSync(unpacked);
      unzip(source, unpacked);
      folder = packetRoot(unpacked);
    }
    const manifest = await verifyMapData(folder);
    const ready = resolve(staging, "ready");
    // An unpacked download is moved into place; a folder the person gave is copied.
    const place = folder.startsWith(staging) ? renameSync : copyFileSync;
    for (const entry of manifest.files) {
      const to = resolve(ready, entry.path);
      mkdirSync(dirname(to), { recursive: true });
      place(resolve(folder, entry.path), to);
    }
    for (const name of readdirSync(folder)) {
      if (/\.txt$/i.test(name) && !manifest.files.some((entry) => entry.path === name)) copyFileSync(resolve(folder, name), resolve(ready, name));
    }
    copyFileSync(resolve(folder, MAP_DATA_MANIFEST), resolve(ready, MAP_DATA_MANIFEST));
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) renameSync(target, previous);
    renameSync(ready, target);
    rmSync(previous, { recursive: true, force: true });
    return { files: manifest.files.length, bytes: manifest.files.reduce((sum, entry) => sum + entry.bytes, 0), version: manifest.version };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
