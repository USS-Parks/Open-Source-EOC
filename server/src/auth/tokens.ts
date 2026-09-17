import { createHash, randomBytes } from "node:crypto";

/**
 * Bearer tokens are 256-bit random values; only their SHA-256 lands in the
 * database, so a database read never yields a usable credential.
 */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
