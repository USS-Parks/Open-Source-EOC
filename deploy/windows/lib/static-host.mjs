import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".pbf": "application/x-protobuf",
  ".pmtiles": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

export const DOCUMENT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join("; ");

export function safeRelativePath(rawPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(rawPath ?? "")).replace(/^\/+/, "");
  } catch {
    throw new Error("invalid encoded path");
  }
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.includes(":"))
    throw new Error("invalid path");
  const segments = decoded === "" ? [] : decoded.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    throw new Error("invalid path segment");
  return segments.join("/");
}

export function resolveInside(root, relativePath) {
  const candidate = resolve(root, relativePath);
  const fromRoot = relative(resolve(root), candidate);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("path escaped root");
  return candidate;
}

/**
 * A static file from the web build, then the public files, then, for the map
 * folder alone, an installed map data packet (lib/map-data.mjs). The packet's
 * address index and manifest are never served.
 */
export function selectStaticFile({ rawPath, distRoot, publicRoot, mapDataRoot = null, acceptsHtml = false }) {
  const relativePath = safeRelativePath(rawPath);
  const requested = relativePath || "index.html";
  const distFile = resolveInside(distRoot, requested);
  if (existsSync(distFile) && statSync(distFile).isFile())
    return { file: distFile, relativePath: requested, index: requested === "index.html", fromDist: true };
  const publicFile = resolveInside(publicRoot, requested);
  if (existsSync(publicFile) && statSync(publicFile).isFile())
    return { file: publicFile, relativePath: requested, index: false, fromDist: false };
  if (mapDataRoot && requested.startsWith("basemap/")) {
    const mapFile = resolveInside(mapDataRoot, requested);
    if (existsSync(mapFile) && statSync(mapFile).isFile())
      return { file: mapFile, relativePath: requested, index: false, fromDist: false };
  }
  if (acceptsHtml && extname(requested) === "") {
    const indexFile = resolveInside(distRoot, "index.html");
    if (existsSync(indexFile) && statSync(indexFile).isFile())
      return { file: indexFile, relativePath: "index.html", index: true, fromDist: true };
  }
  return null;
}

/**
 * Cache rules for a static file. The build names every file under dist/assets
 * after its content hash, so those are cached for a year and never revalidated.
 * Everything else (the map archives, glyphs, overlays manifest) keeps its name
 * across installs, so the browser stores it but revalidates each use against a
 * strong validator; an unchanged file answers 304 with no body. ponytail: the
 * validator is size plus modification time, not a digest, because hashing the
 * 1.2 GB of archives would delay every start; a replaced archive changes both.
 * A Range request whose If-Range names an older validator gets the whole file,
 * so a map client never stitches ranges from two different archives.
 */
export function staticCaching({ relativePath, fromDist, size, mtimeMs, headers = {} }) {
  const etag = `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
  const lastModified = new Date(Math.floor(mtimeMs / 1000) * 1000).toUTCString();
  const cacheControl = fromDist && relativePath.startsWith("assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  const ifNoneMatch = String(headers["if-none-match"] ?? "");
  const notModified = ifNoneMatch !== ""
    && ifNoneMatch.split(",").some((tag) => {
      const value = tag.trim().replace(/^W\//, "");
      return value === "*" || value === etag;
    });
  const ifRange = headers["if-range"];
  const honorRange = ifRange === undefined || ifRange === etag || ifRange === lastModified;
  return { etag, lastModified, cacheControl, notModified, honorRange };
}

export function parseByteRange(header, size) {
  if (!header) return null;
  if (!Number.isSafeInteger(size) || size < 0) return { unsatisfiable: true };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return { unsatisfiable: true };
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || size === 0) return { unsatisfiable: true };
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? size - 1 : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start)
    return { unsatisfiable: true };
  return { start, end: Math.min(requestedEnd, size - 1) };
}

async function hashFile(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function verifiedBuildingsRelease(archivePath, sidecarPath, diagnostic) {
  if (!existsSync(sidecarPath)) return undefined;
  let metadata;
  try {
    const sidecar = statSync(sidecarPath);
    if (!sidecar.isFile() || sidecar.size > 4_096) throw new Error("sidecar must be a JSON file no larger than 4096 bytes");
    metadata = JSON.parse(readFileSync(sidecarPath, "utf8"));
  } catch (error) {
    diagnostic(`BUILDINGS_OVERTURE_METADATA_INVALID reason=${String(error?.message ?? error)}`);
    return undefined;
  }
  const release = typeof metadata?.release === "string" ? metadata.release.trim() : "";
  const expectedHash = typeof metadata?.archive_sha256 === "string" ? metadata.archive_sha256.toLowerCase() : "";
  const expectedBytes = metadata?.archive_bytes;
  if (!/^[a-z0-9._-]{1,64}$/i.test(release)
    || !/^[0-9a-f]{64}$/.test(expectedHash)
    || !Number.isSafeInteger(expectedBytes)
    || expectedBytes <= 0) {
    diagnostic("BUILDINGS_OVERTURE_METADATA_INVALID reason=release, archive_sha256, or archive_bytes is invalid");
    return undefined;
  }
  try {
    const archiveBytes = statSync(archivePath).size;
    if (archiveBytes !== expectedBytes) {
      diagnostic(`BUILDINGS_OVERTURE_METADATA_STALE reason=archive_bytes expected=${expectedBytes} actual=${archiveBytes}`);
      return undefined;
    }
    const actual = await hashFile(archivePath);
    if (actual.bytes !== expectedBytes || actual.sha256 !== expectedHash) {
      diagnostic(`BUILDINGS_OVERTURE_METADATA_STALE reason=archive_sha256 expected=${expectedHash} actual=${actual.sha256}`);
      return undefined;
    }
    return release;
  } catch (error) {
    diagnostic(`BUILDINGS_OVERTURE_METADATA_INVALID reason=${String(error?.message ?? error)}`);
    return undefined;
  }
}

export async function desktopRuntimeConfig(publicRoot, { diagnostic = (message) => console.warn(message), mapDataRoot = null } = {}) {
  const config = {};
  // A map file in the public files, or else in an installed map data packet.
  const located = (relativePath) => [publicRoot, mapDataRoot].filter(Boolean)
    .map((root) => resolve(root, relativePath)).find((path) => existsSync(path)) ?? null;
  const optional = [
    ["OPENEOC_BASEMAP_PMTILES_URL", "basemap/california.pmtiles"],
    ["OPENEOC_BUILDINGS_PMTILES_URL", "basemap/buildings.pmtiles"],
    ["OPENEOC_OVERLAYS_PMTILES_URL", "basemap/overlays.pmtiles"],
    ["OPENEOC_OVERLAYS_MANIFEST_URL", "basemap/overlays-manifest.json"],
  ];
  for (const [key, relativePath] of optional)
    if (located(relativePath)) config[key] = `/${relativePath.replaceAll("\\", "/")}`;
  // Offline raster archives: the map reads their zoom range and bounds from each archive's header.
  const rasters = [
    ["OPENEOC_IMAGERY", "basemap/north-coast-imagery.pmtiles", "Imagery: USDA NAIP via USGS The National Map"],
    ["OPENEOC_TERRAIN", "basemap/north-coast-terrain.pmtiles", "Elevation: USGS 3DEP"],
  ];
  for (const [prefix, relativePath, attribution] of rasters) {
    if (!located(relativePath)) continue;
    config[`${prefix}_TILE_URL`] = `pmtiles:///${relativePath}`;
    config[`${prefix}_ATTRIBUTION`] = attribution;
  }
  const buildings = located("basemap/buildings.pmtiles");
  if (buildings) {
    // The release file beside the archive it describes.
    const release = await verifiedBuildingsRelease(
      buildings,
      resolve(dirname(buildings), "buildings-overture.json"),
      diagnostic,
    );
    if (release) config.OPENEOC_BUILDINGS_OVERTURE_RELEASE = release;
  }
  if (existsSync(resolve(publicRoot, "fonts"))) config.OPENEOC_BASEMAP_GLYPHS_URL = "/fonts/{fontstack}/{range}.pbf";
  return config;
}

function runtimeScript(config) {
  const json = JSON.stringify(config).replaceAll("<", "\\u003c");
  return `globalThis.OPENEOC = Object.freeze(${json});\n`;
}

function documentHeaders(reply) {
  return reply
    .header("content-security-policy", DOCUMENT_CSP)
    .header("cache-control", "no-store")
    .header("accept-ranges", "bytes");
}

export function registerStaticHost(app, { distRoot, publicRoot, mapDataRoot = null, runtimeConfig }) {
  app.get("/runtime-config.js", async (_request, reply) =>
    documentHeaders(reply).type(TYPES[".js"]).send(runtimeScript(runtimeConfig)),
  );

  app.get("/*", async (request, reply) => {
    const rawPath = request.params["*"] ?? "";
    let selected;
    try {
      selected = selectStaticFile({
        rawPath,
        distRoot,
        publicRoot,
        mapDataRoot,
        acceptsHtml: String(request.headers.accept ?? "").includes("text/html"),
      });
    } catch {
      return reply.code(400).send("Invalid path");
    }
    if (!selected) return reply.code(404).send("Missing");

    const type = TYPES[extname(selected.file).toLowerCase()] ?? "application/octet-stream";
    if (selected.index) {
      const html = readFileSync(selected.file, "utf8");
      const tag = '<script src="/runtime-config.js"></script>';
      const body = html.includes("</head>") ? html.replace("</head>", `${tag}</head>`) : `${tag}${html}`;
      return documentHeaders(reply).type(TYPES[".html"]).send(body);
    }

    const { size, mtimeMs } = statSync(selected.file);
    const caching = staticCaching({ ...selected, size, mtimeMs, headers: request.headers });
    reply.type(type).header("accept-ranges", "bytes")
      .header("cache-control", caching.cacheControl)
      .header("etag", caching.etag)
      .header("last-modified", caching.lastModified);
    if (caching.notModified) return reply.code(304).send();
    const range = caching.honorRange ? parseByteRange(request.headers.range, size) : null;
    if (range && "unsatisfiable" in range)
      return reply.code(416).header("content-range", `bytes */${size}`).send();
    if (range) {
      const length = range.end - range.start + 1;
      return reply
        .code(206)
        .header("content-range", `bytes ${range.start}-${range.end}/${size}`)
        .header("content-length", String(length))
        .send(createReadStream(selected.file, range));
    }
    return reply.header("content-length", String(size)).send(createReadStream(selected.file));
  });
}
