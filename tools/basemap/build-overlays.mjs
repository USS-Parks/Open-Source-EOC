#!/usr/bin/env node
// Build source-backed California jurisdiction overlays in the offline toolchain. No npm dependencies.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URLSearchParams } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const out = resolve(process.argv[2] || join(here, "out"));
const work = join(out, "overlay-input");
const boundary = join(repo, "web/public/basemap/ca_state.geojson");
const schema = join(here, "overlays-schema.yml");
const java = process.env.OPENEOC_JAVA || (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java");
const ogr2ogr = process.env.OPENEOC_OGR2OGR || (process.env.GDAL_HOME ? join(process.env.GDAL_HOME, process.platform === "win32" ? "ogr2ogr.exe" : "ogr2ogr") : "ogr2ogr");
const ogrinfo = process.env.OPENEOC_OGRINFO || (process.env.GDAL_HOME ? join(process.env.GDAL_HOME, process.platform === "win32" ? "ogrinfo.exe" : "ogrinfo") : "ogrinfo");
const jar = process.env.OPENEOC_PLANETILER_JAR || join(out, "planetiler-0.9.0.jar");
const resume = process.env.OPENEOC_OVERLAY_RESUME === "1";
const clipVersion = 2;
const maxEnvelope = [-124.5, 32.5, -114.1, 42.01];
const bbox = (process.env.OPENEOC_OVERLAY_BBOX || maxEnvelope.join(",")).split(",").map(Number);
if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3] || bbox[0] < maxEnvelope[0] || bbox[1] < maxEnvelope[1] || bbox[2] > maxEnvelope[2] || bbox[3] > maxEnvelope[3]) {
  throw new Error("OPENEOC_OVERLAY_BBOX must be west,south,east,north within the California build envelope");
}
mkdirSync(work, { recursive: true });
const env = { ...process.env };
if (!env.PROJ_DATA && process.env.GDAL_HOME) env.PROJ_DATA = join(process.env.GDAL_HOME, "projlib");
if (!existsSync(boundary)) throw new Error(`Missing California clipping polygon: ${boundary}`);
if (!existsSync(jar)) throw new Error(`Missing Planetiler JAR: ${jar}`);

const sources = [
  {
    id: "roads_state", url: "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/SHN_Lines/FeatureServer/0",
    where: "1=1", oid: "OBJECTID", geometry: "line", fields: ["OBJECTID", "Route", "RouteS", "County", "District", "RouteType", "Direction", "PMRouteID"],
    attribution: "California Department of Transportation (Caltrans)",
    semantics: "Caltrans State Highway Network route segments. Route designation is not proof of legal title or maintenance responsibility."
  },
  {
    id: "roads_usfs", url: "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RoadBasic_01/MapServer/0",
    where: "jurisdiction = 'FS - FOREST SERVICE' AND primary_maintainer = 'FS - FOREST SERVICE'", oid: "objectid", geometry: "line",
    fields: ["objectid", "id", "name", "jurisdiction", "primary_maintainer", "route_status", "oper_maint_level", "county"],
    attribution: "USDA Forest Service, Enterprise Data Warehouse",
    semantics: "Forest Service road segments whose source jurisdiction and primary maintainer both identify the Forest Service."
  },
  {
    id: "roads_blm", url: "https://services1.arcgis.com/KbxwQRRfWyEYLgp4/arcgis/rest/services/BLM_Natl_GTLF_Public_Motorized_Roads/FeatureServer/3",
    where: "ADMIN_ST = 'CA' AND PLAN_ROUTE_DSGNTN_AUTH = 'BLM'", oid: "OBJECTID", geometry: "line",
    fields: ["OBJECTID", "ADMIN_ST", "PLAN_ROUTE_DSGNTN_AUTH", "PLAN_ASSET_CLASS", "PLAN_OHV_ROUTE_DSGNTN", "PLAN_ACCESS_RSTRCT", "ROUTE_PRMRY_NM", "EXSTNG_AUTH_CODE"],
    attribution: "Bureau of Land Management, National Ground Transportation Linear Features",
    semantics: "Public motorized routes in the BLM source with California administration and BLM route designation authority; legal title is not asserted."
  },
  {
    id: "roads_nps", url: "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Roads_Geographic/FeatureServer/0",
    where: "RDMAINTAINER = 'National Park Service'", oid: "OBJECTID", geometry: "line",
    fields: ["OBJECTID", "RDMAINTAINER", "RDNAME", "RDSTATUS", "RDCLASS", "RDSURFACE", "UNITCODE", "UNITNAME", "OPENTOPUBLIC"],
    attribution: "National Park Service, public Roads dataset",
    semantics: "Public NPS road segments whose source maintainer field names the National Park Service; the public dataset omits restricted roads."
  },
  {
    id: "land_ownership", url: "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/Public_Land_Ownership_view/FeatureServer/0",
    where: "1=1", oid: "OBJECTID", geometry: "polygon", fields: ["OBJECTID", "Own_Level", "Own_Agency", "Own_Group"],
    attribution: "CAL FIRE public land ownership view; compiled from CPAD, FWS, DOD, and BIA data",
    semantics: "Public land ownership polygons as classified by CAL FIRE. Own_Level and Own_Group are source values; gaps and source overlap are possible."
  }
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: out, env, encoding: "utf8", stdio: options.capture ? "pipe" : "inherit", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.error?.message || result.stderr || "see output above"}`);
  return result.stdout;
}

async function request(url, attempts = 4, options = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: globalThis.AbortSignal.timeout(90000), headers: { "User-Agent": "Open-Source-EOC-overlay-builder/1", ...options.headers } });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) throw new Error(`retryable HTTP ${response.status}`);
        throw new Error(`HTTP ${response.status} ${url}`);
      }
      const data = await response.json();
      if (data.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`);
      return data;
    } catch (error) {
      if (attempt === attempts || error.message.startsWith("ArcGIS") || (error.message.startsWith("HTTP 4") && !error.message.includes("429"))) throw error;
      await new Promise((done) => setTimeout(done, 1000 * 2 ** (attempt - 1)));
    }
  }
}

function queryUrl(source, extra) {
  const params = new URLSearchParams({
    f: "json", where: source.where, geometry: bbox.join(","), geometryType: "esriGeometryEnvelope",
    inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", ...extra
  });
  return `${source.url}/query?${params}`;
}

function countFeatures(path) {
  const output = run(ogrinfo, ["-al", "-so", path], { capture: true });
  const count = output.match(/Feature Count: (\d+)/);
  if (!count) throw new Error(`Cannot read GDAL feature count for ${path}: ${output.slice(0, 500)}`);
  return Number(count[1]);
}

function emptyLineOrPolygonSource(path) {
  // Planetiler 0.9.0 cannot parse a zero-feature GeoJSON collection. A point
  // outside California is valid input but cannot enter line or polygon layers.
  writeFileSync(path, '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"_overlay_placeholder":true},"geometry":{"type":"Point","coordinates":[0,0]}}]}');
}

function clipProjected(sourcePath, targetPath) {
  const stateClipped = `${targetPath}.${process.pid}.state.geojson`;
  const temp = `${targetPath}.${process.pid}.tmp.geojson`;
  run(ogr2ogr, ["-f", "GeoJSON", stateClipped, sourcePath, "-clipdst", boundary]);
  run(ogr2ogr, ["-f", "GeoJSON", temp, stateClipped, "-clipdst", ...bbox.map(String)]);
  renameSync(temp, targetPath);
  unlinkSync(stateClipped);
  return countFeatures(targetPath);
}

function clip(sourcePath, targetPath, select, where) {
  const projected = `${targetPath}.${process.pid}.projected.geojson`;
  const args = ["-f", "GeoJSON", "-overwrite", projected, sourcePath, "-t_srs", "EPSG:4326", "-spat", ...bbox.map(String), "-spat_srs", "EPSG:4326", "-select", select.join(",")];
  if (where) args.push("-where", where);
  run(ogr2ogr, args);
  const count = clipProjected(projected, targetPath);
  unlinkSync(projected);
  return count;
}

async function fetchArcgis(source) {
  const finalPath = join(work, `${source.id}.geojson`);
  const receiptPath = join(work, `${source.id}.source.json`);
  if (resume && existsSync(finalPath) && existsSync(receiptPath)) {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    if (receipt.bbox?.join(",") === bbox.join(",") && receipt.sourceUrl === source.url && receipt.query === source.where && receipt.sourceFields?.join(",") === source.fields.join(",") && receipt.count > 0 && countFeatures(finalPath) === receipt.count) {
      const actual = receipt.clipVersion === clipVersion ? receipt.count : clipProjected(finalPath, finalPath);
      if (!actual) emptyLineOrPolygonSource(finalPath);
      const updated = { ...receipt, available: actual > 0, count: actual, clipVersion,
        fetchedAt: receipt.fetchedAt || null, sourceArtifactModifiedAt: statSync(finalPath).mtime.toISOString(),
        validatedAt: new Date().toISOString() };
      writeFileSync(`${receiptPath}.partial`, JSON.stringify(updated));
      renameSync(`${receiptPath}.partial`, receiptPath);
      console.log(`${receipt.clipVersion === clipVersion ? "Reusing" : "Reclipped"} ${source.id}: ${actual} features`);
      return updated;
    }
  }
  console.log(`Fetching ${source.id}...`);
  const metadata = await request(`${source.url}?f=pjson`);
  if (metadata.advancedQueryCapabilities?.supportsPagination !== true) throw new Error(`${source.id}: pagination not supported`);
  const publishedFields = new Set(metadata.fields?.map((field) => field.name));
  for (const field of source.fields) if (!publishedFields.has(field)) throw new Error(`${source.id}: required source field ${field} missing`);
  const countResult = await request(queryUrl(source, { returnCountOnly: "true" }));
  if (!Number.isInteger(countResult.count) || countResult.count < 0) throw new Error(`${source.id}: invalid source count`);
  // Some ArcGIS services reject returnIdsOnly when no feature intersects the bbox.
  const idsResult = countResult.count === 0
    ? { objectIds: [], objectIdFieldName: source.oid }
    : await request(queryUrl(source, { returnIdsOnly: "true" }));
  const ids = idsResult.objectIds;
  if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id)) || new Set(ids).size !== ids.length || idsResult.objectIdFieldName?.toLowerCase() !== source.oid.toLowerCase()) {
    throw new Error(`${source.id}: invalid or duplicate object-ID snapshot`);
  }
  const expected = ids.length;
  if (countResult.count !== expected) console.warn(`${source.id}: count changed from ${countResult.count} to ${expected} while taking the object-ID snapshot`);
  ids.sort((a, b) => a - b);
  const pageSize = Math.min(Number(metadata.maxRecordCount) || 500, 500);
  const rawPath = join(work, `${source.id}.raw.geojson`);
  const stream = createWriteStream(rawPath, { encoding: "utf8" });
  stream.write('{"type":"FeatureCollection","features":[');
  const seen = new Set();
  let offset = 0;
  try {
    for (let start = 0; start < expected; start += pageSize) {
      const batch = ids.slice(start, start + pageSize);
      const params = new URLSearchParams({ f: "geojson", objectIds: batch.join(","), outFields: source.fields.join(","), outSR: "4326", returnGeometry: "true" });
      const page = await request(`${source.url}/query`, 4, { method: "POST", body: params,
        headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      if (page.type !== "FeatureCollection" || !Array.isArray(page.features) || page.features.length !== batch.length) throw new Error(`${source.id}: incomplete object-ID batch ${start}-${start + batch.length} (${page.features?.length}/${batch.length})`);
      const wanted = new Set(batch);
      for (const feature of page.features) {
        const id = feature.properties?.[source.oid];
        if (id == null || !wanted.has(id) || seen.has(id) || !feature.geometry) throw new Error(`${source.id}: duplicate/unexpected object ID or missing geometry at ${offset}: ${id}`);
        seen.add(id);
        if (!stream.write(`${offset ? "," : ""}${JSON.stringify(feature)}`)) await new Promise((done) => stream.once("drain", done));
        offset++;
      }
      if (seen.size !== start + batch.length) throw new Error(`${source.id}: object-ID batch omitted a feature at ${start}`);
      if (offset % 5000 < pageSize || offset === expected) console.log(`  ${offset}/${expected}`);
    }
    stream.end("]}");
    await new Promise((done, reject) => { stream.once("finish", done); stream.once("error", reject); });
  } catch (error) {
    stream.destroy();
    throw error;
  }
  if (seen.size !== expected) throw new Error(`${source.id}: count changed during pagination (${seen.size}/${expected})`);
  const actual = expected ? clip(rawPath, finalPath, source.fields) : 0;
  if (!actual) emptyLineOrPolygonSource(finalPath);
  unlinkSync(rawPath);
  const timestamp = new Date().toISOString();
  const receipt = { available: actual > 0, count: actual, sourceCount: expected, countAtStart: countResult.count, sourceUrl: source.url,
    attribution: source.attribution, semantics: source.semantics, coverage: "California state boundary within configured build extent",
    sourceCopyright: metadata.copyrightText || "", sourceFields: source.fields, query: source.where, bbox,
    pagination: "object-ID snapshot with bounded POST batches", clipVersion, fetchedAt: timestamp, validatedAt: timestamp };
  if (actual > 0) {
    writeFileSync(`${receiptPath}.partial`, JSON.stringify(receipt));
    renameSync(`${receiptPath}.partial`, receiptPath);
  }
  return receipt;
}

async function download(url, target) {
  if (resume && existsSync(target)) return;
  const partial = `${target}.partial`;
  const response = await fetch(url, { signal: globalThis.AbortSignal.timeout(120000), headers: { "User-Agent": "Mozilla/5.0 Open-Source-EOC-overlay-builder" } });
  if (!response.ok) throw new Error(`County download failed: HTTP ${response.status} ${url}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 200_000_000) throw new Error(`County source exceeds 200 MB download cap: ${url}`);
  let bytes = 0;
  const limit = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    done(bytes > 200_000_000 ? new Error(`County source exceeds 200 MB download cap: ${url}`) : null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(partial));
  if (statSync(partial).size > 200_000_000) throw new Error(`County source exceeds 200 MB download cap: ${url}`);
  renameSync(partial, target);
}

function countyConfig() {
  const configPath = process.env.OPENEOC_COUNTY_ROADS_CONFIG;
  const configs = configPath ? JSON.parse(readFileSync(resolve(configPath), "utf8")) : [{
    name: "Humboldt County", path: "https://www.humboldtgov.org/DocumentCenter/View/566",
    sourceUrl: "https://www.humboldtgov.org/276/GIS-Data-Download", attribution: "Humboldt County GIS",
    jurisdictionField: "JURIS", countyValues: ["COUNTY", "County"],
    fields: ["OBJECTID", "JURIS", "STREETNAME", "FULLRDNAME", "FUNCCLASS", "SOURCE", "LASTUPDATE"],
    fieldMap: { id: "OBJECTID", roadName: "FULLRDNAME", roadClass: "FUNCCLASS" },
    notes: "Humboldt County warns its planning GIS can be inaccurate by up to 400 feet in rural areas."
  }];
  if (!Array.isArray(configs) || configs.length > 58) throw new Error("County config must be an array of up to 58 sources");
  for (const config of configs) {
    if (!config.name || !config.path || !config.sourceUrl || !config.attribution || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.jurisdictionField) || !Array.isArray(config.countyValues) || !config.countyValues.length || !Array.isArray(config.fields) || !config.fields.includes(config.jurisdictionField) || config.fields.some((field) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) || !config.fieldMap || !["id", "roadName", "roadClass"].every((key) => config.fields.includes(config.fieldMap[key]))) {
      throw new Error("Each county source needs name, path, sourceUrl, attribution, jurisdictionField, countyValues, fields, and fieldMap with id/roadName/roadClass");
    }
  }
  return configs;
}

async function fetchCountyRoads() {
  const configs = countyConfig();
  const merged = { type: "FeatureCollection", features: [] };
  const coverage = [];
  const attributions = [];
  const urls = [];
  const sourceArtifacts = [];
  for (const [index, config] of configs.entries()) {
    console.log(`Converting county roads: ${config.name}`);
    let path = config.path;
    if (/^https:\/\//.test(path)) {
      const hash = createHash("sha256").update(path).digest("hex").slice(0, 16);
      path = join(work, `county-${hash}.zip`);
      await download(config.path, path);
    } else {
      path = resolve(path);
      if (!existsSync(path)) throw new Error(`Missing county source: ${path}`);
    }
    sourceArtifacts.push({ name: config.name, sourceArtifactModifiedAt: statSync(path).mtime.toISOString() });
    if (extname(path).toLowerCase() === ".zip") {
      const names = run("tar", ["-tf", path], { capture: true }).trim().split(/\r?\n/);
      const shapefiles = names.filter((name) => name.toLowerCase().endsWith(".shp"));
      if (shapefiles.length !== 1) throw new Error(`County ZIP must have exactly one .shp: ${path}`);
      path = `/vsizip/${path.replaceAll("\\", "/")}/${shapefiles[0]}`;
    }
    const fieldInfo = run(ogrinfo, ["-al", "-so", path], { capture: true });
    for (const field of config.fields) if (!new RegExp(`^${field}:`, "im").test(fieldInfo)) throw new Error(`${config.name}: required field ${field} missing`);
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const where = `${config.jurisdictionField} IN (${config.countyValues.map(quote).join(",")})`;
    const converted = join(work, `county-${index}.geojson`);
    const count = clip(path, converted, config.fields, where);
    const features = JSON.parse(readFileSync(converted, "utf8")).features;
    for (const feature of features) {
      const fields = feature.properties;
      fields.county_name = config.name;
      fields.county_jurisdiction = fields[config.jurisdictionField];
      fields.road_name = fields[config.fieldMap.roadName];
      fields.road_class = fields[config.fieldMap.roadClass];
      fields.source_object_id = fields[config.fieldMap.id];
      merged.features.push(feature);
    }
    coverage.push(`${config.name}: ${count} county-jurisdiction segments`);
    attributions.push(config.attribution);
    urls.push(config.sourceUrl);
  }
  const countyPath = join(work, "roads_county.geojson");
  if (merged.features.length) writeFileSync(countyPath, JSON.stringify(merged));
  else emptyLineOrPolygonSource(countyPath);
  return { available: merged.features.length > 0, count: merged.features.length, coverage: coverage.join("; ") || "No county road sources configured",
    sourceUrl: urls.join("; "), attribution: [...new Set(attributions)].join("; "),
    semantics: "County-jurisdiction roads only, selected from each configured source's explicit jurisdiction field. Coverage is limited to the named counties; this is not a statewide county-road inventory.",
    sourceNotes: configs.filter((config) => typeof config.notes === "string" && config.notes.length > 0).map((config) => ({ name: config.name, note: config.notes })),
    sourceFields: configs.map((config) => ({ name: config.name, fields: config.fields, jurisdictionField: config.jurisdictionField, countyValues: config.countyValues, fieldMap: config.fieldMap })),
    sourceArtifacts, validatedAt: new Date().toISOString() };
}

const layers = {};
const fetched = await Promise.allSettled(sources.map((source) => fetchArcgis(source)));
const failures = fetched.flatMap((result, index) => result.status === "rejected" ? [`${sources[index].id}: ${result.reason.message}`] : []);
if (failures.length) throw new Error(`Overlay source fetch failed:\n${failures.join("\n")}`);
for (const [index, source] of sources.entries()) layers[source.id] = fetched[index].value;
layers.roads_county = await fetchCountyRoads();
const output = join(out, "overlays.pmtiles");
const pendingOutput = join(out, `overlays.${process.pid}.pmtiles`);
run(java, ["-Xmx4g", "-jar", jar, "generate-custom", `--schema=${schema}`, `--output=${pendingOutput}`,
  `--bounds=${bbox.join(",")}`, "--minzoom=5", "--maxzoom=14", "--force"]);
if (!existsSync(pendingOutput) || statSync(pendingOutput).size === 0) throw new Error("Planetiler did not produce a PMTiles archive");
renameSync(pendingOutput, output);
const hash = createHash("sha256");
for await (const chunk of createReadStream(output)) hash.update(chunk);
const manifest = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), bbox, clipBoundary: "web/public/basemap/ca_state.geojson",
  archive: "overlays.pmtiles", archiveBytes: statSync(output).size, archiveSHA256: hash.digest("hex"),
  coverageNote: `${bbox.join(",") === maxEnvelope.join(",") ? "California state boundary" : "Configured California subextent"} for five state/federal layers. County road coverage is limited to configured county sources.`,
  rightsNote: "Source service metadata does not declare a reuse license. CAL FIRE's conditions of use warn that third-party copyrighted inputs may require permission before redistribution: https://www.fire.ca.gov/conditions-of-use",
  layers
};
const manifestPath = join(out, "overlays-manifest.json");
writeFileSync(`${manifestPath}.${process.pid}.partial`, `${JSON.stringify(manifest, null, 2)}\n`);
renameSync(`${manifestPath}.${process.pid}.partial`, manifestPath);
console.log(`Wrote ${output} (${manifest.archiveBytes} bytes) and overlays-manifest.json`);
