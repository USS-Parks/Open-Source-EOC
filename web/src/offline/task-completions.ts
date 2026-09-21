import { TaskCompletionReceiptSchema, type TaskCompletionReceipt } from "@openeoc/shared";
import type { OfflineStore } from "./store.js";

const TASK_QUEUE_PREFIX = "task-completions";

export interface QueuedTaskCompletion {
  readonly operationId: string;
  readonly taskId: string;
  readonly incidentId: string;
  readonly personId: string;
  readonly queuedAt: string;
}

export type TaskCompletionTransport = (
  operation: QueuedTaskCompletion,
) => Promise<unknown>;

function scopeKey(personId: string, incidentId: string): string {
  return `${TASK_QUEUE_PREFIX}:${personId}:${incidentId}`;
}

/**
 * Durable checklist-completion queue. A command is persisted before it is
 * returned to the caller and removed only after a matching server receipt.
 */
export class TaskCompletionQueue {
  private mutation = Promise.resolve();

  constructor(private readonly store: OfflineStore) {}

  async enqueue(input: {
    readonly taskId: string;
    readonly incidentId: string;
    readonly personId: string;
    readonly operationId?: string;
  }): Promise<QueuedTaskCompletion> {
    const operation: QueuedTaskCompletion = {
      operationId: input.operationId ?? crypto.randomUUID(),
      taskId: input.taskId,
      incidentId: input.incidentId,
      personId: input.personId,
      queuedAt: new Date().toISOString(),
    };
    await this.change(input.personId, input.incidentId, (pending) => {
      if (pending.some((item) => item.operationId === operation.operationId)) return pending;
      return [...pending, operation];
    });
    return operation;
  }

  async pending(personId: string, incidentId: string): Promise<QueuedTaskCompletion[]> {
    return (
      await this.store.getMeta<QueuedTaskCompletion[]>(scopeKey(personId, incidentId))
    ) ?? [];
  }

  /** Stop on the first transport failure; every unacknowledged command stays durable. */
  async flush(
    personId: string,
    incidentId: string,
    send: TaskCompletionTransport,
  ): Promise<TaskCompletionReceipt[]> {
    const receipts: TaskCompletionReceipt[] = [];
    for (const operation of await this.pending(personId, incidentId)) {
      const receipt = TaskCompletionReceiptSchema.parse(await send(operation));
      if (
        receipt.operationId !== operation.operationId ||
        receipt.taskId !== operation.taskId ||
        receipt.incidentId !== incidentId ||
        receipt.completedBy.personId !== personId
      ) {
        throw new Error("task completion receipt does not match the queued operation");
      }
      await this.change(personId, incidentId, (pending) =>
        pending.filter((item) => item.operationId !== operation.operationId));
      receipts.push(receipt);
    }
    return receipts;
  }

  private async change(
    personId: string,
    incidentId: string,
    update: (pending: QueuedTaskCompletion[]) => QueuedTaskCompletion[],
  ): Promise<void> {
    const run = this.mutation.then(async () => {
      const key = scopeKey(personId, incidentId);
      const current = (await this.store.getMeta<QueuedTaskCompletion[]>(key)) ?? [];
      await this.store.setMeta(key, update(current));
    });
    this.mutation = run.catch(() => undefined);
    return run;
  }
}
