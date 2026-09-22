import type { FastifyReply } from "fastify";

/**
 * Security response headers. The API serves data, never
 * a document, so its Content-Security-Policy is the strictest possible
 * (`default-src 'none'`); the browser client is served by its own static
 * host with a document CSP (see deploy/README.md). The non-CSP headers are
 * safe on every response and are set for both.
 */
export function applySecurityHeaders(reply: FastifyReply, opts: { api: boolean }): void {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header("cross-origin-resource-policy", "same-origin");
  reply.header("cross-origin-opener-policy", "same-origin");
  reply.header("permissions-policy", "geolocation=(), camera=(), microphone=()");
  reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  if (opts.api) {
    reply.header(
      "content-security-policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
  }
}
