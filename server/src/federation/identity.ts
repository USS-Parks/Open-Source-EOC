import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import type { Sql } from "../db/client.js";
import { AuthError } from "../auth/service.js";
import { decryptSecret, encryptSecret, hasSecretKey } from "../secrets/envelope.js";

/**
 * Signed peer identity (AG-03, ADR-0006). The instance holds one long-lived
 * Ed25519 key pair; its private key is stored envelope-encrypted under
 * OPENEOC_SECRET_KEY and made on first use. Every batch this instance pushes
 * is signed with it, and a partner applies the batch only when the signature
 * verifies under the public key its administrator recorded for this
 * instance. The peer token admits a request; the signature is the trust.
 */

/** Keeps a batch signature from being read as a signature over anything else the key signs. */
const BATCH_CONTEXT = "openeoc-federation-batch-v1\n";

export interface SignedBatch {
  readonly boardId: string;
  readonly updates: readonly string[];
  readonly deletes: readonly string[];
  /** Ed25519 over the context and the batch, base64. */
  readonly signature: string;
}

/** The bytes a batch signature covers: its receiving board, updates and deletions, in that order. */
function batchBytes(boardId: string, updates: readonly string[], deletes: readonly string[]): Buffer {
  return Buffer.from(BATCH_CONTEXT + JSON.stringify([boardId, updates, deletes]));
}

/** A public key's fingerprint: the SHA-256 of its DER encoding, in hex, as solution packages show theirs. */
function keyFingerprint(key: KeyObject): string {
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

/** The fingerprint of a stored PEM public key. */
export function pemFingerprint(pem: string): string {
  return keyFingerprint(createPublicKey(pem));
}

/**
 * Read a partner's public key as an administrator pasted it: a PEM Ed25519
 * public key. Returns it re-encoded, so the stored key has one spelling.
 */
export function parsePeerKey(pem: string): { pem: string; fingerprint: string } {
  let key: KeyObject;
  try {
    key = createPublicKey(pem.trim());
  } catch {
    throw new AuthError(400, "the partner key is not a PEM public key");
  }
  if (key.asymmetricKeyType !== "ed25519") throw new AuthError(400, "the partner key must be an Ed25519 public key");
  return { pem: key.export({ type: "spki", format: "pem" }).toString(), fingerprint: keyFingerprint(key) };
}

async function readIdentity(sql: Sql): Promise<{ publicKey: string; envelope: string } | null> {
  const [row] = await sql`select public_key, private_key_envelope from federation_identity`;
  return row ? { publicKey: row.public_key as string, envelope: row.private_key_envelope as string } : null;
}

/** This instance's key pair, made and stored the first time it is needed. */
async function ensureIdentity(sql: Sql): Promise<{ publicKey: string; envelope: string }> {
  const found = await readIdentity(sql);
  if (found) return found;
  if (!hasSecretKey()) {
    throw new AuthError(409, "server not provisioned for secret storage (OPENEOC_SECRET_KEY unset)");
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await sql`
    insert into federation_identity (public_key, private_key_envelope)
    values (${publicKey.export({ type: "spki", format: "pem" }).toString()},
            ${encryptSecret(privateKey.export({ type: "pkcs8", format: "pem" }).toString())})
    on conflict do nothing`;
  // Another request may have made it first; its key is the one kept.
  return (await readIdentity(sql))!;
}

/**
 * The public half of this instance's identity, for administrators to hand to
 * partners; null while the server has no secret key to protect the private half.
 */
export async function instancePublicKey(sql: Sql): Promise<{ publicKey: string; fingerprint: string } | null> {
  const identity = hasSecretKey() ? await ensureIdentity(sql) : await readIdentity(sql);
  if (!identity) return null;
  return { publicKey: identity.publicKey, fingerprint: pemFingerprint(identity.publicKey) };
}

/** Sign a batch for a partner's receiving board with this instance's key. */
export async function signBatch(
  sql: Sql,
  boardId: string,
  updates: readonly string[],
  deletes: readonly string[],
): Promise<SignedBatch> {
  const identity = await ensureIdentity(sql);
  const privateKey = createPrivateKey(decryptSecret(identity.envelope));
  const signature = sign(null, batchBytes(boardId, updates, deletes), privateKey).toString("base64");
  return { boardId, updates, deletes, signature };
}

/** Whether a batch's signature verifies under a partner's recorded public key. */
export function batchVerifies(
  publicKeyPem: string,
  boardId: string,
  updates: readonly string[],
  deletes: readonly string[],
  signature: string,
): boolean {
  try {
    return verify(null, batchBytes(boardId, updates, deletes), createPublicKey(publicKeyPem), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
