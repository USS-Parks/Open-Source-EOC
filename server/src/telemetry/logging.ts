import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { FastifyServerOptions } from "fastify";

const LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LEVELS)[number];

/** Where log lines go when not stdout: a rotating file, or a test buffer. */
export interface LogStream {
  write(line: string): void;
}

/**
 * OPENEOC_LOG_LEVEL wins. Otherwise the test runner is silent and every other
 * environment logs at info.
 */
export function logLevelFromEnv(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const value =
    env.OPENEOC_LOG_LEVEL || (env.NODE_ENV === "test" || env.VITEST ? "silent" : "info");
  if (!(LEVELS as readonly string[]).includes(value)) {
    throw new Error(`unsupported OPENEOC_LOG_LEVEL: ${value}`);
  }
  return value as LogLevel;
}

/** A request slower than this many milliseconds is logged as a warning. */
export function slowRequestMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.OPENEOC_SLOW_REQUEST_MS || 1000);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`unsupported OPENEOC_SLOW_REQUEST_MS: ${env.OPENEOC_SLOW_REQUEST_MS}`);
  }
  return value;
}

// Credentials never reach a log line, wherever they sit in a logged object.
const REDACT = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-peer-token"]',
  'req.headers["x-openeoc-desktop-token"]',
  'res.headers["set-cookie"]',
  "headers.authorization",
  "headers.cookie",
  'headers["x-peer-token"]',
  "password",
  "token",
  "accessToken",
  "resumeToken",
  "secret",
  "clientSecret",
  "outboundToken",
  "*.password",
  "*.token",
  "*.accessToken",
  "*.resumeToken",
  "*.secret",
  "*.clientSecret",
  "*.outboundToken",
  "err.parameters",
];

// A proxy's request id is kept only when it is short and plain, so a caller
// cannot inject log syntax or a megabyte of text through it.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function requestId(req: IncomingMessage): string {
  const incoming = req.headers["x-request-id"];
  return typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/**
 * Fastify's pino logger with redaction and request ids. Fastify's own two
 * lines per request are off; the telemetry hook writes one line per request
 * with the route, status and duration instead.
 */
export function loggingOptions(
  level: LogLevel,
  stream?: LogStream,
): Pick<FastifyServerOptions, "logger" | "genReqId" | "disableRequestLogging"> {
  return {
    logger: {
      level,
      redact: { paths: REDACT, censor: "[redacted]" },
      ...(stream ? { stream } : {}),
    },
    genReqId: requestId,
    disableRequestLogging: true,
  };
}
