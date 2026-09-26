import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskCompletionReceipt } from "@openeoc/shared";
import type { ApiClient } from "../api/client.js";
import { openOfflineStore, type OfflineStore } from "../../offline/store.js";
import { TaskCompletionQueue } from "../../offline/task-completions.js";

export interface TaskContinuity {
  readonly pendingCount: number;
  readonly ready: boolean;
  readonly error: string | null;
  readonly reconciled: readonly TaskCompletionReceipt[];
  complete(taskId: string): Promise<{ readonly receipt: TaskCompletionReceipt | null }>;
  reconcile(): Promise<readonly TaskCompletionReceipt[]>;
}

/**
 * The tasks surface uses the durable receipt queue directly: task completions
 * do not need the board-specific FieldClient used by ContinuityCoordinator.
 */
export function useTaskContinuity(
  client: ApiClient,
  incidentId: string | null,
  personId: string | null,
): TaskContinuity {
  const queue = useRef<TaskCompletionQueue | null>(null);
  const store = useRef<OfflineStore | null>(null);
  const [ready, setReady] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState<readonly TaskCompletionReceipt[]>([]);

  const refresh = useCallback(async () => {
    if (!queue.current || !incidentId || !personId) return;
    setPendingCount((await queue.current.pending(personId, incidentId)).length);
  }, [incidentId, personId]);

  const reconcile = useCallback(async (): Promise<readonly TaskCompletionReceipt[]> => {
    if (!queue.current || !incidentId || !personId) return [];
    try {
      setError(null);
      // A completion that reaches a closed incident goes to its administrators as a late submission.
      const receipts = await queue.current.flush(personId, incidentId, (operation) =>
        client.runFieldOperation(operation.incidentId, {
          kind: "task_completion", operationId: operation.operationId, queuedAt: operation.queuedAt,
          taskId: operation.taskId,
        }));
      await refresh();
      if (receipts.length) setReconciled(receipts);
      return receipts;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await refresh();
      return [];
    }
  }, [client, incidentId, personId, refresh]);

  useEffect(() => {
    let active = true;
    queue.current = null;
    store.current?.close();
    store.current = null;
    setReady(false); setPendingCount(0); setError(null); setReconciled([]);
    if (!incidentId || !personId) return;
    void openOfflineStore().then(async (offlineStore) => {
      if (!active) { offlineStore.close(); return; }
      store.current = offlineStore;
      queue.current = new TaskCompletionQueue(offlineStore);
      setReady(true);
      await refresh();
      if (navigator.onLine) await reconcile();
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
      store.current?.close();
      store.current = null;
      queue.current = null;
    };
  }, [incidentId, personId, reconcile, refresh]);

  useEffect(() => {
    const onOnline = () => { void reconcile(); };
    addEventListener("online", onOnline);
    return () => removeEventListener("online", onOnline);
  }, [reconcile]);

  const complete = useCallback(async (taskId: string) => {
    if (!queue.current || !incidentId || !personId) {
      throw new Error("Offline completion storage is not available for this session.");
    }
    const operation = await queue.current.enqueue({ taskId, incidentId, personId });
    await refresh();
    const receipts = await reconcile();
    return { receipt: receipts.find((receipt) => receipt.operationId === operation.operationId) ?? null };
  }, [incidentId, personId, reconcile, refresh]);

  return { pendingCount, ready, error, reconciled, complete, reconcile };
}
