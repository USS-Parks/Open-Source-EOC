import {
  FieldClient,
  SyncTransportError,
  type ContinuityScope,
  type SyncAck,
} from "../offline/field-client.js";
import { openOfflineStore, type OfflineStore } from "../offline/store.js";
import { notifyOfflineQueueChange } from "../offline/queue-events.js";

export type FieldSubmissionPhase =
  | "ready"
  | "queued"
  | "syncing"
  | "synced"
  | "conflict"
  | "auth_required"
  | "failed";

export interface FieldSubmissionState {
  readonly phase: FieldSubmissionPhase;
  readonly pending: number;
  readonly receipt: SyncAck | null;
  /** Exact conflict acknowledgements retained for operator review. */
  readonly entries?: readonly RetainedFieldConflictEntry[];
  readonly message: string;
}

const READY: FieldSubmissionState = {
  phase: "ready",
  pending: 0,
  receipt: null,
  message: "Ready for a durable field submission.",
};

export interface RetainedFieldConflictEntry {
  readonly boardId: string;
  readonly operationId: string;
  readonly conflicts: number;
  readonly receipt: SyncAck;
}

interface LegacyRetainedFieldConflict {
  readonly conflicts: number;
  readonly receipt: SyncAck | null;
}

interface StoredRetainedFieldConflicts {
  readonly schema: 2;
  readonly entries: readonly RetainedFieldConflictEntry[];
  /** Earlier aggregate metadata has no board identity; preserve it on upgrade. */
  readonly legacy?: LegacyRetainedFieldConflict | undefined;
}

interface RetainedConflictState {
  readonly entries: readonly RetainedFieldConflictEntry[];
  readonly legacy: LegacyRetainedFieldConflict | null;
  readonly conflicts: number;
  readonly receipt: SyncAck | null;
}

const conflictKey = (scope: ContinuityScope): string =>
  `field-submission-conflict:${scope.personId}:${scope.incidentId}`;

/**
 * Production adapter over the VEOC-85 incident-scoped Yjs queue. The bearer
 * token enters only the live sync call; IndexedDB stores the immutable update,
 * person, incident, board and operation UUID, never the credential.
 */
export class FieldSubmissionQueue {
  private constructor(
    private readonly store: OfflineStore,
    private readonly fields: FieldClient,
  ) {}

  static async open(): Promise<FieldSubmissionQueue> {
    const store = await openOfflineStore();
    const origin = typeof location === "undefined" ? "" : location.origin;
    return new FieldSubmissionQueue(store, new FieldClient(store, origin));
  }

  /** Reuse an established scoped store and transport without copying queue state. */
  static from(store: OfflineStore, fields: FieldClient): FieldSubmissionQueue {
    return new FieldSubmissionQueue(store, fields);
  }

  async state(scope: ContinuityScope): Promise<FieldSubmissionState> {
    const [operations, conflict] = await Promise.all([
      this.fields.pendingOperations(scope),
      this.retainedConflicts(scope),
    ]);
    const pending = operations.length;
    if (conflict.conflicts > 0) return {
      phase: "conflict",
      pending,
      receipt: conflict.receipt,
      entries: conflict.entries,
      message: `${conflict.conflicts} field submission conflict${conflict.conflicts === 1 ? "" : "s"} retained for review.`,
    };
    return pending === 0 ? READY : {
      phase: "queued",
      pending,
      receipt: null,
      message: `${pending} field submission${pending === 1 ? "" : "s"} queued on this device.`,
    };
  }

  async enqueue(
    scope: ContinuityScope,
    boardId: string,
    recordId: string,
    data: Record<string, unknown>,
  ): Promise<FieldSubmissionState> {
    await this.fields.open(scope, boardId);
    await this.fields.edit(scope, boardId, recordId, data);
    notifyOfflineQueueChange(scope);
    return this.state(scope);
  }

  /**
   * Flush one board through the same receipt path used by field capture.
   * Callers that coordinate multiple queues must use this rather than
   * FieldClient.sync so a conflict keeps its exact board and operation.
   */
  async syncOne(scope: ContinuityScope, boardId: string, token: string): Promise<SyncAck | null> {
    const receipt = await this.fields.sync(scope, boardId, token);
    if (receipt && receipt.conflicts > 0) {
      if (!receipt.operationId) throw new Error("conflicting field acknowledgement has no operation id");
      await this.retainConflict(scope, {
        boardId,
        operationId: receipt.operationId,
        conflicts: receipt.conflicts,
        receipt,
      });
    }
    notifyOfflineQueueChange(scope);
    return receipt;
  }

  async sync(scope: ContinuityScope, token: string): Promise<FieldSubmissionState> {
    const operations = await this.fields.pendingOperations(scope);
    if (operations.length === 0) return this.state(scope);
    const boardIds = [...new Set(operations.map((item) => item.boardId))];
    let last: SyncAck | null = null;
    try {
      for (const boardId of boardIds) {
        while ((await this.fields.pendingOperations(scope)).some((item) => item.boardId === boardId)) {
          const receipt = await this.syncOne(scope, boardId, token);
          if (!receipt) break;
          last = receipt;
        }
      }
      const pending = (await this.fields.pendingOperations(scope)).length;
      const retained = await this.retainedConflicts(scope);
      if (retained.conflicts > 0) {
        return {
          phase: "conflict",
          pending,
          receipt: retained.receipt,
          entries: retained.entries,
          message: `${retained.conflicts} field submission conflict${retained.conflicts === 1 ? "" : "s"} retained for review.`,
        };
      }
      return {
        phase: pending === 0 ? "synced" : "queued",
        pending,
        receipt: last,
        message: pending === 0
          ? `All field submissions synchronized${last ? ` at receipt ${last.seq}` : ""}.`
          : `${pending} field submission${pending === 1 ? "" : "s"} remain queued.`,
      };
    } catch (error) {
      const pending = (await this.fields.pendingOperations(scope)).length;
      const code = error instanceof SyncTransportError ? error.code : "failed";
      return {
        phase: code,
        pending,
        receipt: last,
        message: error instanceof Error ? error.message : "Field synchronization failed.",
      };
    }
  }

  private async retainedConflicts(scope: ContinuityScope): Promise<RetainedConflictState> {
    const stored = await this.store.getMeta<StoredRetainedFieldConflicts | LegacyRetainedFieldConflict>(conflictKey(scope));
    if (!stored) return { entries: [], legacy: null, conflicts: 0, receipt: null };
    if ("entries" in stored && Array.isArray(stored.entries)) {
      const legacy = stored.legacy ?? null;
      const entries = stored.entries.filter((entry) => entry.boardId && entry.operationId && entry.conflicts > 0);
      return {
        entries,
        legacy,
        conflicts: entries.reduce((total, entry) => total + entry.conflicts, 0) + (legacy?.conflicts ?? 0),
        receipt: entries.length > 0 ? entries[entries.length - 1]!.receipt : legacy?.receipt ?? null,
      };
    }
    const legacy = stored as LegacyRetainedFieldConflict;
    return {
      entries: [],
      legacy,
      conflicts: legacy.conflicts,
      receipt: legacy.receipt,
    };
  }

  private async retainConflict(
    scope: ContinuityScope,
    entry: RetainedFieldConflictEntry,
  ): Promise<void> {
    const prior = await this.retainedConflicts(scope);
    const entries = [...prior.entries.filter((item) => item.boardId !== entry.boardId || item.operationId !== entry.operationId), entry];
    await this.store.setMeta(conflictKey(scope), {
      schema: 2,
      entries,
      ...(prior.legacy ? { legacy: prior.legacy } : {}),
    });
  }

  close(): void {
    this.store.close();
  }
}
