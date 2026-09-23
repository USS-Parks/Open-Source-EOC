import { z } from "zod";
import { AuthError } from "../auth/service.js";

/** Query parameters shared by every keyset-paged list. */
export const pageQuery = {
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
};

export interface PageRequest {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export const DEFAULT_PAGE_LIMIT = 100;

/**
 * Text form of a timestamptz column that keeps full microsecond precision, so
 * a cursor names the exact row boundary. A JavaScript Date keeps milliseconds
 * only, and rows written in the same millisecond would be skipped. Bind the
 * value back as `${at}::text::timestamptz`: a parameter the driver sees as a
 * timestamptz is serialized through Date and loses the microseconds.
 */
export const CURSOR_AT_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

const PART_CHECKS = {
  key: () => true,
  at: (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) && Number.isFinite(Date.parse(value)),
  id: (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  seq: (value: string) => /^\d{1,18}$/.test(value),
} as const;

/** An opaque keyset cursor: the sort key values of the last row returned. */
export function encodeCursor(parts: readonly string[]): string {
  return Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
}

/** Decode a cursor whose parts must match `kinds`, or reject it with a 400. */
export function decodeCursor(
  cursor: string | undefined,
  kinds: readonly (keyof typeof PART_CHECKS)[],
): string[] | null {
  if (cursor === undefined) return null;
  let parts: unknown = null;
  try {
    parts = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    // Falls through to the shape check below.
  }
  if (!Array.isArray(parts) || parts.length !== kinds.length ||
      !parts.every((part, index) => typeof part === "string" && PART_CHECKS[kinds[index]!](part)))
    throw new AuthError(400, "invalid page cursor");
  return parts as string[];
}
