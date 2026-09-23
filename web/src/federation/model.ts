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
  readonly boards: readonly SharedBoardStatus[];
}

export interface ReceivedBatch {
  readonly at: string;
  readonly peer: string;
  readonly boardId: string;
  readonly boardTitle: string | null;
  readonly updates: number;
  readonly conflicts: number;
}

export interface FederationStatus {
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
  return "Not linked; updates wait in the outbox";
}

export function accessLabel(board: Pick<SharedBoardStatus, "canRead" | "canWrite">): string {
  if (board.canRead && board.canWrite) return "Partner reads and writes";
  if (board.canWrite) return "Partner writes only";
  return board.canRead ? "Partner reads" : "No access";
}
