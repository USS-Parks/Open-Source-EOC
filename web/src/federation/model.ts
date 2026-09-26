/** Federation status as the web client reads it, and its display helpers. */

export interface SharedBoardStatus {
  readonly id: string;
  readonly boardId: string;
  readonly boardTitle: string;
  readonly canRead: boolean;
  readonly canWrite: boolean;
  readonly remoteBoardId: string | null;
  readonly pending: number;
  readonly oldestPendingAt: string | null;
  readonly nextAttemptAt: string | null;
  readonly lastError: string | null;
  readonly lastDeliveredAt: string | null;
}

export interface PeerStatus {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly endpointUrl: string | null;
  readonly tokenStored: boolean;
  /** The partner's recorded public key, by fingerprint; null until recorded, and its batches are refused until then. */
  readonly keyFingerprint: string | null;
  readonly boards: readonly SharedBoardStatus[];
}

export interface ReceivedBatch {
  readonly at: string;
  readonly peer: string;
  readonly boardId: string;
  readonly boardTitle: string | null;
  readonly updates: number;
  /** Records the batch deleted; batches received before deletions travelled carry 0. */
  readonly deletes: number;
  readonly conflicts: number;
  /** Imported from a batch file rather than pushed. */
  readonly byFile: boolean;
}

/** A file of signed batches for a partner with no network path (AG-04), and what it holds. */
export interface BatchExport {
  readonly file: unknown;
  readonly entries: number;
  /** Updates still waiting that are not in the file: past its size, or on a board with no receiving board. */
  readonly remaining: number;
}

/** What importing a partner's batch file did, with the receipt to carry back. */
export interface BatchImport {
  readonly batches: number;
  readonly alreadyImported: number;
  readonly updates: number;
  readonly deleted: number;
  readonly conflicts: number;
  readonly receipt: unknown;
}

/** What importing a partner's receipt did. */
export interface ReceiptImport {
  readonly batches: number;
  readonly delivered: number;
  readonly alreadyDelivered: number;
}

/** A plural in words: "1 update", "3 updates". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What a batch file import did, in words. */
export function importSummary(peer: string, result: BatchImport): string {
  const applied = result.batches - result.alreadyImported;
  if (applied === 0) return `This file from ${peer} was imported before; nothing changed. Export the receipt again if ${peer} did not get it.`;
  const parts = [count(result.updates, "update")];
  if (result.deleted) parts.push(`${result.deleted} deleted`);
  if (result.conflicts) parts.push(`${count(result.conflicts, "conflict")} reconciled`);
  const before = result.alreadyImported ? ` ${count(result.alreadyImported, "batch", "batches")} in it had been imported before.` : "";
  return `Imported ${count(applied, "batch", "batches")} from ${peer}: ${parts.join(", ")}.${before} Export the receipt and carry it back to ${peer}.`;
}

/** A name safe in a file name: letters and digits, the rest as single hyphens. */
export function fileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "partner";
}

/** This instance's public key; null while the server has no secret key to keep its private half. */
export interface InstanceIdentity {
  readonly publicKey: string;
  readonly fingerprint: string;
}

export interface FederationStatus {
  readonly identity: InstanceIdentity | null;
  readonly peers: readonly PeerStatus[];
  readonly received: readonly ReceivedBatch[];
}

/** How long something has waited, in words: "under a minute", "4 min", "2 h 5 min", "3 d". */
export function waitedFor(since: string, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - Date.parse(since)) / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  return `${Math.floor(minutes / 1440)} d`;
}

/** The push link in words, never the token. */
export function linkLabel(peer: Pick<PeerStatus, "endpointUrl" | "tokenStored">): string {
  if (peer.endpointUrl && peer.tokenStored) return `Pushing to ${peer.endpointUrl}`;
  return "Not linked; updates wait in the outbox or go by file";
}

export function accessLabel(board: Pick<SharedBoardStatus, "canRead" | "canWrite">): string {
  if (board.canRead && board.canWrite) return "Partner reads and writes";
  if (board.canWrite) return "Partner writes only";
  return board.canRead ? "Partner reads" : "No access";
}
