import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAP_DATA_FILES, packMapData } from "../../deploy/windows/lib/map-data.mjs";

/**
 * Pack the map data packet: the maps and layers too large for the macOS app,
 * as the download beside its disk image. It takes the optional archives the
 * Windows setup stages and the address search index, with the notices that
 * carry their attribution and licenses, and writes
 * <out>/Open-Source-EOC-<version>-map-data.zip with its SHA-256 beside it.
 * Runs on Windows or macOS.
 *
 *   node tools/basemap/pack-map-data.mjs [--basemap=web/public/basemap]
 *     [--gazetteer=tools/basemap/out/gazetteer.tsv] [--out=deploy]
 */

const root = process.cwd();
const option = (name, fallback) => {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return resolve(match ? match.slice(name.length + 3) : fallback);
};
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const basemap = option("basemap", resolve(root, "web/public/basemap"));
const gazetteer = option("gazetteer", resolve(root, "tools/basemap/out/gazetteer.tsv"));
const out = option("out", resolve(root, "deploy"));
const name = `Open-Source-EOC-${version}-map-data`;
const folder = resolve(out, name);
const zip = `${folder}.zip`;
if (existsSync(zip)) throw new Error(`${zip} already exists; it was not replaced`);

const sources = Object.fromEntries(MAP_DATA_FILES.map((path) =>
  [path, path === "gazetteer.tsv" ? gazetteer : resolve(basemap, path.slice("basemap/".length))]));
rmSync(folder, { recursive: true, force: true });
const manifest = await packMapData({
  sources,
  folder,
  version,
  notices: [resolve(root, "deploy/windows/installer/THIRD-PARTY-NOTICES.txt"), resolve(root, "tools/basemap/MAP-DATA-READ-ME.txt")],
});
try {
  if (process.platform === "win32")
    execFileSync(resolve(process.env.SystemRoot ?? "C:/Windows", "System32/tar.exe"), ["-a", "-cf", zip, "-C", out, name], { stdio: "inherit" });
  else if (process.platform === "darwin")
    execFileSync("ditto", ["-c", "-k", "--keepParent", folder, zip], { stdio: "inherit" });
  else throw new Error("The map data packet is packed on Windows or macOS");
} finally {
  rmSync(folder, { recursive: true, force: true });
}

const hash = createHash("sha256");
for await (const chunk of createReadStream(zip)) hash.update(chunk);
const sha256 = hash.digest("hex");
writeFileSync(`${zip}.sha256`, sha256);
console.log(`MAP_DATA_READY file=${zip} bytes=${statSync(zip).size} sha256=${sha256} files=${manifest.files.length}`);
