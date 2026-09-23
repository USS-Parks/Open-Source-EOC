import {
  FieldClient,
  RESTRICTED_SYNC_MESSAGE,
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
  | "restricted"
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
const attachmentsKey = (scope: ContinuityScope): string =>
  `field-attachments:${scope.personId}:${scope.incidentId}`;
const attachmentBytesKey = (scope: ContinuityScope, id: string): string =>
  `field-attachment-bytes:${scope.personId}:${scope.incidentId}:${id}`;

/** One queued photo or audio file waits for its record, then uploads. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Device storage all queued attachments of one person and incident may hold. */
export const MAX_QUEUED_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export interface FieldAttachment {
  /** Question path the file answers; a repeat entry reads `repeat[0].question`. */
  readonly question: string;
  readonly file: File;
}

/** Metadata of a queued attachment; its bytes sit under their own key. */
interface QueuedAttachment {
  readonly id: string;
  readonly boardId: string;
  readonly recordId: string;
  readonly question: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Production adapter over the incident-scoped Yjs queue. The bearer
 * token enters only the live sync call; IndexedDB stores the immutable update,
 * person, incident, board and operation UUID, never the credential.
 */
export class FieldSubmissionQueue {
  private constructor(
    private readonly store: OfflineStore,
    private readonly fields: FieldClient,
    private readonly origin: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  static async open(): Promise<FieldSubmissionQueue> {
    const store = await openOfflineStore();
    const origin = typeof location === "undefined" ? "" : location.origin;
    return new FieldSubmissionQueue(store, new FieldClient(store, origin), origin, (...args) => fetch(...args));
  }

  /** Reuse an established scoped store and transport without copying queue state. */
  static from(
    store: OfflineStore,
    fields: FieldClient,
    origin = typeof location === "undefined" ? "" : location.origin,
    fetchImpl: typeof fetch = (...args) => fetch(...args),
  ): FieldSubmissionQueue {
    return new FieldSubmissionQueue(store, fields, origin, fetchImpl);
  }

  async state(scope: ContinuityScope): Promise<FieldSubmissionState> {
    const [operations, attachments, conflict] = await Promise.all([
      this.fields.pendingOperations(scope),
      this.attachments(scope),
      this.retainedConflicts(scope),
    ]);
    const pending = operations.length + attachments.length;
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
      message: `${queuedWork(operations.length, attachments.length)} queued on this device.`,
    };
  }

  /**
   * Queue one report and its photo and audio files. The files are stored
   * first, each under its own key, so a report is never queued with its files
   * missing; they upload once the record they belong to has synchronized.
   */
  async enqueue(
    scope: ContinuityScope,
    boardId: string,
    recordId: string,
    data: Record<string, unknown>,
    files: readonly FieldAttachment[] = [],
  ): Promise<FieldSubmissionState> {
    const prior = await this.attachments(scope);
    let total = prior.reduce((sum, item) => sum + item.size, 0);
    for (const { file } of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(`${file.name} is larger than the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB a queued attachment may be.`);
      }
      total += file.size;
    }
    if (total > MAX_QUEUED_ATTACHMENT_BYTES) {
      throw new Error(`Queued attachments would exceed the ${MAX_QUEUED_ATTACHMENT_BYTES / 1024 / 1024} MB this device holds; synchronize first.`);
    }
    const added: QueuedAttachment[] = [];
    try {
      for (const { question, file } of files) {
        const item: QueuedAttachment = {
          id: crypto.randomUUID(), boardId, recordId, question,
          name: file.name, contentType: file.type, size: file.size,
        };
        await this.store.setMeta(attachmentBytesKey(scope, item.id), await file.arrayBuffer());
        added.push(item);
      }
      if (added.length) await this.store.setMeta(attachmentsKey(scope), [...prior, ...added]);
      await this.fields.open(scope, boardId);
      await this.fields.edit(scope, boardId, recordId, data);
    } catch (error) {
      await this.store.setMeta(attachmentsKey(scope), prior).catch(() => undefined);
      for (const item of added) await this.store.setMeta(attachmentBytesKey(scope, item.id), null).catch(() => undefined);
      throw error;
    }
    notifyOfflineQueueChange(scope);
    return this.state(scope);
  }

  private async attachments(scope: ContinuityScope): Promise<QueuedAttachment[]> {
    return (await this.store.getMeta<QueuedAttachment[]>(attachmentsKey(scope))) ?? [];
  }

  /**
   * Upload the queued files whose records have reached the server, oldest
   * first. A file whose board still has queued work waits. A refused upload
   * stops the pass and stays queued with the server's reason.
   */
  private async uploadAttachments(scope: ContinuityScope, token: string): Promise<void> {
    const waiting = new Set((await this.fields.pendingOperations(scope)).map((item) => item.boardId));
    for (const item of await this.attachments(scope)) {
      if (waiting.has(item.boardId)) continue;
      const bytes = await this.store.getMeta<ArrayBuffer>(attachmentBytesKey(scope, item.id));
      if (bytes) {
        const form = new FormData();
        form.append("question", item.question);
        form.append("file", new Blob([bytes], { type: item.contentType }), item.name);
        const [method, url] = ["POST", `${this.origin}/api/v1/forms/records/${encodeURIComponent(item.recordId)}/attachments`];
        const response = await this.fetchImpl(url, { method, headers: { authorization: `Bearer ${token}` }, body: form }).catch(() => {
          throw new SyncTransportError("failed", `${item.name} could not be uploaded; it stays queued.`);
        });
        if (!response.ok) {
          const reason = await response.json().then((body: { error?: unknown }) => body.error, () => null);
          throw new SyncTransportError(
            response.status === 401 ? "auth_required" : "failed",
            `${item.name} was not uploaded${typeof reason === "string" ? `: ${reason}` : ""}. It stays queued.`,
          );
        }
      }
      await this.store.setMeta(attachmentsKey(scope),
        (await this.attachments(scope)).filter((queued) => queued.id !== item.id));
      await this.store.setMeta(attachmentBytesKey(scope, item.id), null);
      notifyOfflineQueueChange(scope);
    }
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
    if (operations.length === 0 && (await this.attachments(scope)).length === 0) return this.state(scope);
    const boardIds = [...new Set(operations.map((item) => item.boardId))];
    let last: SyncAck | null = null;
    let restricted = false;
    try {
      for (const boardId of boardIds) {
        try {
          while ((await this.fields.pendingOperations(scope)).some((item) => item.boardId === boardId)) {
            const receipt = await this.syncOne(scope, boardId, token);
            if (!receipt) break;
            last = receipt;
          }
        } catch (error) {
          // A restricted board is never synced; its reports stay queued and the other boards still deliver.
          if (!(error instanceof SyncTransportError && error.code === "restricted")) throw error;
          restricted = true;
        }
      }
      await this.uploadAttachments(scope, token);
      const remaining = await this.fields.pendingOperations(scope);
      const files = (await this.attachments(scope)).length;
      const pending = remaining.length + files;
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
      if (restricted) return { phase: "restricted", pending, receipt: last, message: RESTRICTED_SYNC_MESSAGE };
      return {
        phase: pending === 0 ? "synced" : "queued",
        pending,
        receipt: last,
        message: pending === 0
          ? `All field submissions synchronized${last ? ` at receipt ${last.seq}` : ""}.`
          : `${queuedWork(remaining.length, files)} remain queued.`,
      };
    } catch (error) {
      const pending = (await this.fields.pendingOperations(scope)).length + (await this.attachments(scope)).length;
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

function queuedWork(submissions: number, attachments: number): string {
  const reports = plural(submissions, "field submission");
  if (attachments === 0) return reports;
  return submissions === 0 ? plural(attachments, "attachment") : `${reports} and ${plural(attachments, "attachment")}`;
}
