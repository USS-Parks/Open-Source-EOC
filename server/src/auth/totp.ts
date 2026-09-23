import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP) with the
 * parameters every common authenticator app assumes: HMAC-SHA-1, six
 * digits, a thirty-second step. Secrets travel as unpadded base32.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function toBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text.toUpperCase().replace(/[\s=-]/g, "")) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh 160-bit secret, the size RFC 4226 recommends for SHA-1. */
export function newTotpSecret(): string {
  return toBase32(randomBytes(20));
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

export function hotp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", fromBase32(secret)).update(message).digest();
  const offset = mac[mac.length - 1]! & 15;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function totp(secret: string, now = Date.now()): string {
  return hotp(secret, totpStep(now));
}

/**
 * The step a code belongs to, accepting one step of clock drift either way,
 * or null. Callers reject a step at or below the last one accepted, so a
 * code cannot be replayed.
 */
export function matchTotp(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(now);
  for (const step of [current - 1, current, current + 1]) {
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

/** The provisioning URI authenticator apps accept by QR code or manual entry. */
export function otpauthUri(secret: string, account: string, issuer = "OpenEOC"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}
