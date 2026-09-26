import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Allowlisted CORS. Off by default: with no configured origins the
 * API answers same-origin only, which is the tested reverse-proxy topology.
 * When OPENEOC_CORS_ORIGINS is set (comma-separated), only those exact
 * origins are echoed back, never a wildcard, so a browser client hosted on a
 * different origin can call the API without opening it to every site. Auth is
 * a bearer header, not a cookie, so credentialed CORS is deliberately not
 * enabled.
 */

const CONFIGURED = (process.env["OPENEOC_CORS_ORIGINS"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// x-esri-authorization carries the token an ArcGIS web client sends to the FeatureServer view (VC-26).
const ALLOW_HEADERS = "authorization, content-type, x-peer-token, x-feed-token, x-intake-token, x-esri-authorization";
const ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

export function corsOriginAllowed(origin: string, allowed: readonly string[] = CONFIGURED): boolean {
  return allowed.includes(origin);
}

/**
 * Apply CORS headers for an allowed origin and answer preflight. Returns
 * true when the request was a preflight that has been fully handled, so the
 * caller can stop processing it.
 */
export function applyCors(
  req: FastifyRequest,
  reply: FastifyReply,
  allowed: readonly string[] = CONFIGURED,
): boolean {
  const origin = req.headers.origin;
  if (typeof origin === "string" && corsOriginAllowed(origin, allowed)) {
    reply.header("access-control-allow-origin", origin);
    reply.header("vary", "Origin");
    reply.header("access-control-allow-methods", ALLOW_METHODS);
    reply.header("access-control-allow-headers", ALLOW_HEADERS);
    reply.header("access-control-max-age", "600");
  }
  if (req.method === "OPTIONS") {
    reply.code(204).send();
    return true;
  }
  return false;
}
