import type { Sql } from "../db/client.js";
import { decryptSecret, encryptSecret } from "./envelope.js";

/**
 * Every column holding an envelope from encryptSecret, keyed by a uuid. A
 * new encrypted column must be added here, or rotation leaves it readable
 * only with the retired key.
 */
export const ENVELOPE_COLUMNS = [
  { table: "person_mfa", key: "person_id", column: "secret_envelope" },
  { table: "ipaws_config", key: "jurisdiction_id", column: "credential_envelope" },
  { table: "collab_backends", key: "jurisdiction_id", column: "token_envelope" },
  { table: "meeting_config", key: "jurisdiction_id", column: "secret_envelope" },
  { table: "peers", key: "id", column: "outbound_token" },
  { table: "federation_identity", key: "id", column: "private_key_envelope" },
] as const;

/**
 * Re-encrypt every envelope from `oldKey` to `newKey` in one transaction on
 * the owner connection. Each value is decrypted with the old key and the new
 * envelope is checked to decrypt back to it before it is written, so one
 * unreadable value rolls the whole rotation back and nothing is left half
 * rotated. Returns the number of values rotated per table.
 */
export async function rotateSecretKey(
  owner: Sql,
  oldKey: string,
  newKey: string,
): Promise<Record<string, number>> {
  if (!oldKey || !newKey) throw new Error("both the current and the new secret key are required");
  if (oldKey === newKey) throw new Error("the new secret key must differ from the current one");
  return (await owner.begin(async (tx) => {
    const counts: Record<string, number> = {};
    for (const { table, key, column } of ENVELOPE_COLUMNS) {
      const rows = await tx.unsafe(
        `select ${key} as id, ${column} as envelope from ${table}
         where ${column} is not null for update`,
      );
      for (const row of rows) {
        let plaintext: string;
        try {
          plaintext = decryptSecret(row.envelope as string, oldKey);
        } catch {
          throw new Error(`${table} ${String(row.id)} does not decrypt with the current key; nothing was rotated`);
        }
        const envelope = encryptSecret(plaintext, newKey);
        if (decryptSecret(envelope, newKey) !== plaintext)
          throw new Error(`${table} ${String(row.id)} did not verify under the new key; nothing was rotated`);
        await tx.unsafe(`update ${table} set ${column} = $1 where ${key} = $2::uuid`, [envelope, row.id as string]);
      }
      counts[table] = rows.length;
    }
    return counts;
  })) as Record<string, number>;
}
