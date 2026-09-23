import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Envelope encryption for credentials at rest (INV-7). A single
 * server key, OPENEOC_SECRET_KEY, wraps per-secret AES-256-GCM ciphertexts.
 * The key stays in deployment config; adding a new secret (e.g. an IPAWS
 * COG credential) is a runtime write, so a jurisdiction can be provisioned
 * with no redeploy. If the server key is absent, secret storage fails
 * closed rather than persisting anything readable.
 */

const FORMAT = "v1";

export class SecretKeyMissing extends Error {
  constructor() {
    super("OPENEOC_SECRET_KEY is not set; secret storage is unavailable");
  }
}

/** Whether the server is provisioned to store secrets at all. */
export function hasSecretKey(): boolean {
  return Boolean(process.env.OPENEOC_SECRET_KEY);
}

function key(raw = process.env.OPENEOC_SECRET_KEY): Buffer {
  if (!raw) throw new SecretKeyMissing();
  // Accept any-length operator input; derive a stable 256-bit key from it.
  return createHash("sha256").update(raw, "utf8").digest();
}

/**
 * Encrypt a UTF-8 secret to a self-describing "v1:iv:tag:ciphertext" blob.
 * `rawKey` defaults to OPENEOC_SECRET_KEY; key rotation passes both keys.
 */
export function encryptSecret(plaintext: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Decrypt a blob produced by {@link encryptSecret}. */
export function decryptSecret(blob: string, rawKey?: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT) throw new Error("malformed secret envelope");
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const ct = Buffer.from(parts[3]!, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(rawKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * A short, non-reversible fingerprint of a secret, safe to display so an
 * operator can confirm which credential is configured without revealing it.
 */
export function fingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex").slice(0, 12);
}
