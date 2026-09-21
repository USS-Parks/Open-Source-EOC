import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

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

export function selectStaticFile({ rawPath, distRoot, publicRoot, acceptsHtml = false }) {
  const relativePath = safeRelativePath(rawPath);
  const requested = relativePath || "index.html";
  const distFile = resolveInside(distRoot, requested);
  if (existsSync(distFile) && statSync(distFile).isFile())
    return { file: distFile, relativePath: requested, index: requested === "index.html" };
  const publicFile = resolveInside(publicRoot, requested);
  if (existsSync(publicFile) && statSync(publicFile).isFile())
    return { file: publicFile, relativePath: requested, index: false };
  if (acceptsHtml && extname(requested) === "") {
    const indexFile = resolveInside(distRoot, "index.html");
    if (existsSync(indexFile) && statSync(indexFile).isFile())
      return { file: indexFile, relativePath: "index.html", index: true };
  }
  return null;
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

export function registerStaticHost(app, { distRoot, publicRoot, runtimeConfig }) {
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

    const size = statSync(selected.file).size;
    const range = parseByteRange(request.headers.range, size);
    reply.type(type).header("accept-ranges", "bytes");
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
