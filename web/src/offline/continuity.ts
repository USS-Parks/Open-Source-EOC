import type { TaskCompletionReceipt } from "@openeoc/shared";
import {
  type ContinuityScope,
  type FieldClient,
  RESTRICTED_SYNC_MESSAGE,
  type SyncAck,
  SyncTransportError,
} from "./field-client.js";
import type { OfflineStore } from "./store.js";
import {
  type TaskCompletionQueue,
  type TaskCompletionTransport,
} from "./task-completions.js";

export type ContinuityPhase =
  | "offline"
  | "queued"
  | "reconnecting"
  | "synced"
  | "conflict"
  | "failed"
  | "auth_required"
  | "restricted";

export interface ContinuitySnapshot {
  readonly scope: ContinuityScope;
  readonly phase: ContinuityPhase;
  readonly pendingBoardIds: readonly string[];
  readonly pendingTaskOperationIds: readonly string[];
  readonly conflicts: number;
  readonly lastError: string | null;
}

export interface ContinuityAdapters {
  /** Adapters may throw SyncTransportError, SessionExpiredError, or an error with an HTTP status. */
  readonly syncBoard: (boardId: string) => Promise<SyncAck | null>;
  readonly completeTask: TaskCompletionTransport;
}

interface StoredOutcome {
  readonly phase: ContinuityPhase;
  readonly conflicts: number;
  readonly lastError: string | null;
}

const outcomeKey = (scope: ContinuityScope): string =>
  `continuity-outcome:${scope.personId}:${scope.incidentId}`;

/**
 * One status adapter over the existing board and task queues. It never moves
 * commands between identity/incident scopes and does not remove failed work.
 */
export class ContinuityCoordinator {
  constructor(
    private readonly store: OfflineStore,
    private readonly fields: FieldClient,
    private readonly tasks: TaskCompletionQueue,
  ) {}

  async markOffline(scope: ContinuityScope): Promise<ContinuitySnapshot> {
    const previous = await this.outcome(scope);
    await this.save(scope, {
      phase: "offline",
      conflicts: previous?.conflicts ?? 0,
      lastError: null,
    });
    return this.snapshot(scope);
  }

  async snapshot(scope: ContinuityScope): Promise<ContinuitySnapshot> {
    const [pendingBoards, pendingTasks, stored] = await Promise.all([
      this.fields.pendingBoardIds(scope),
      this.tasks.pending(scope.personId, scope.incidentId),
      this.store.getMeta<StoredOutcome>(outcomeKey(scope)),
    ]);
    const phase = (!stored || stored.phase === "synced") &&
      (pendingBoards.length > 0 || pendingTasks.length > 0)
      ? "queued"
      : stored?.phase ?? "offline";
    return {
      scope,
      phase,
      pendingBoardIds: pendingBoards,
      pendingTaskOperationIds: pendingTasks.map((item) => item.operationId),
      conflicts: stored?.conflicts ?? 0,
      lastError: stored?.lastError ?? null,
    };
  }

  async reconnect(
    scope: ContinuityScope,
    adapters: ContinuityAdapters,
  ): Promise<{
    readonly snapshot: ContinuitySnapshot;
    readonly boardReceipts: readonly SyncAck[];
    readonly taskReceipts: readonly TaskCompletionReceipt[];
  }> {
    const previous = await this.outcome(scope);
    const retainedConflicts = previous?.conflicts ?? 0;
    await this.save(scope, {
      phase: "reconnecting",
      conflicts: retainedConflicts,
      lastError: null,
    });
    const boardReceipts: SyncAck[] = [];
    try {
      const queuedBoardOperations = await this.fields.pendingOperations(scope);
      // A restricted board is never served for sync; its work stays queued
      // and the other boards and tasks still deliver.
      const restricted = new Set<string>();
      for (const operation of queuedBoardOperations) {
        if (restricted.has(operation.boardId)) continue;
        try {
          const receipt = await adapters.syncBoard(operation.boardId);
          if (receipt) boardReceipts.push(receipt);
        } catch (error) {
          if (!(error instanceof SyncTransportError && error.code === "restricted")) throw error;
          restricted.add(operation.boardId);
        }
      }
      const taskReceipts = await this.tasks.flush(
        scope.personId,
        scope.incidentId,
        adapters.completeTask,
      );
      const conflicts = retainedConflicts +
        boardReceipts.reduce((total, receipt) => total + receipt.conflicts, 0);
      await this.save(scope, {
        phase: conflicts > 0 ? "conflict" : restricted.size > 0 ? "restricted" : "synced",
        conflicts,
        lastError: restricted.size > 0 ? RESTRICTED_SYNC_MESSAGE : null,
      });
      return { snapshot: await this.snapshot(scope), boardReceipts, taskReceipts };
    } catch (error) {
      const normalized = normalizeAdapterError(error);
      const phase = normalized.code === "auth_required"
        ? "auth_required"
        : normalized.code === "conflict"
          ? "conflict"
          : "failed";
      await this.save(scope, {
        phase,
        conflicts: retainedConflicts +
          boardReceipts.reduce((total, receipt) => total + receipt.conflicts, 0),
        lastError: normalized.message,
      });
      throw normalized;
    }
  }

  private async save(scope: ContinuityScope, outcome: StoredOutcome): Promise<void> {
    await this.store.setMeta(outcomeKey(scope), outcome);
  }

  private outcome(scope: ContinuityScope): Promise<StoredOutcome | null> {
    return this.store.getMeta<StoredOutcome>(outcomeKey(scope));
  }
}

function normalizeAdapterError(error: unknown): SyncTransportError {
  if (error instanceof SyncTransportError) return error;
  const candidate = error && typeof error === "object"
    ? error as { name?: unknown; message?: unknown; status?: unknown }
    : {};
  const message = typeof candidate.message === "string"
    ? candidate.message
    : "continuity operation failed";
  const status = typeof candidate.status === "number" ? candidate.status : null;
  if (candidate.name === "SessionExpiredError" || (status !== null && [401, 403, 404].includes(status))) {
    return new SyncTransportError("auth_required", message);
  }
  if (status === 409) return new SyncTransportError("conflict", message);
  return new SyncTransportError("failed", message);
}
