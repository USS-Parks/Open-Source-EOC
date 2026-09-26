import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  NO_CONNECTION,
  type ApiClient,
  type FieldOperation,
  type FieldOperationReceipt,
} from "../app/api/client.js";
import type { ContinuityScope } from "./field-client.js";
import { notifyOfflineQueueChange, subscribeOfflineQueueChange } from "./queue-events.js";
import { openOfflineStore, type OfflineStore } from "./store.js";

/**
 * The device's outbox for messages and new tasks (AG-07). An operation is
 * stored before anything is sent, keeps its id and queue time for every
 * retry, and leaves only on the server's receipt; the server runs it once
 * under that id. One the server refuses stays, with its reason, until the
 * operator discards it, so it neither blocks the rest nor disappears.
 */

export type QueuedOperation = FieldOperation & { readonly refused?: string };

/** An operation the server kept as a late submission because its incident had closed. */
export interface LateReceipt {
  readonly kind: "board" | FieldOperation["kind"];
  readonly operationId: string;
  readonly lateSubmissionId: string;
  readonly at: string;
}

const outboxKey = (scope: ContinuityScope): string => `field-outbox:${scope.personId}:${scope.incidentId}`;
const lateKey = (scope: ContinuityScope): string => `late-receipts:${scope.personId}:${scope.incidentId}`;

/** No answer arrived at all, so the work waits on this device for the connection. */
export function noConnection(error: unknown): boolean {
  return error instanceof Error && !(error instanceof ApiError) && error.message === NO_CONNECTION;
}

export async function lateReceipts(store: OfflineStore, scope: ContinuityScope): Promise<LateReceipt[]> {
  return (await store.getMeta<LateReceipt[]>(lateKey(scope))) ?? [];
}

/** Remember that an operation went to the incident's administrators as a late submission. */
export async function keepLateReceipt(
  store: OfflineStore,
  scope: ContinuityScope,
  receipt: Omit<LateReceipt, "at">,
): Promise<void> {
  const kept = await lateReceipts(store, scope);
  if (kept.some((item) => item.operationId === receipt.operationId)) return;
  await store.setMeta(lateKey(scope), [...kept, { ...receipt, at: new Date().toISOString() }]);
}

export class FieldOutbox {
  private mutation = Promise.resolve();

  constructor(private readonly store: OfflineStore) {}

  async pending(scope: ContinuityScope): Promise<QueuedOperation[]> {
    return (await this.store.getMeta<QueuedOperation[]>(outboxKey(scope))) ?? [];
  }

  async enqueue(scope: ContinuityScope, operation: FieldOperation): Promise<void> {
    await this.change(scope, (list) =>
      list.some((item) => item.operationId === operation.operationId) ? list : [...list, operation]);
  }

  async discard(scope: ContinuityScope, operationId: string): Promise<void> {
    await this.change(scope, (list) => list.filter((item) => item.operationId !== operationId));
  }

  /**
   * Send each waiting operation in order. No answer, a lapsed session or a
   * server fault stops the pass with the rest kept; a refusal is kept with
   * its reason and the pass goes on.
   */
  async flush(
    scope: ContinuityScope,
    send: (operation: FieldOperation) => Promise<FieldOperationReceipt>,
  ): Promise<FieldOperationReceipt[]> {
    const receipts: FieldOperationReceipt[] = [];
    for (const { refused, ...operation } of await this.pending(scope)) {
      if (refused !== undefined) continue;
      let receipt: FieldOperationReceipt;
      try {
        receipt = await send(operation as FieldOperation);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status === 401 || error.status >= 500) throw error;
        const reason = error.message;
        await this.change(scope, (list) => list.map((item) =>
          item.operationId === operation.operationId ? { ...item, refused: reason } : item));
        continue;
      }
      if (receipt.outcome === "late") {
        await keepLateReceipt(this.store, scope, {
          kind: receipt.kind, operationId: receipt.operationId, lateSubmissionId: receipt.lateSubmissionId,
        });
      }
      await this.change(scope, (list) => list.filter((item) => item.operationId !== operation.operationId));
      receipts.push(receipt);
    }
    return receipts;
  }

  private change(scope: ContinuityScope, update: (list: QueuedOperation[]) => QueuedOperation[]): Promise<void> {
    const run = this.mutation.then(async () => {
      await this.store.setMeta(outboxKey(scope), update(await this.pending(scope)));
      notifyOfflineQueueChange(scope);
    });
    this.mutation = run.catch(() => undefined);
    return run;
  }
}

export interface FieldOutboxState {
  readonly ready: boolean;
  readonly pending: readonly QueuedOperation[];
  readonly error: string | null;
  /** Send now when connected; with no connection, keep it on the device. Null when it was kept. */
  send(operation: FieldOperation): Promise<FieldOperationReceipt | null>;
  flush(): Promise<readonly FieldOperationReceipt[]>;
  discard(operationId: string): Promise<void>;
}

/**
 * The outbox for one person and incident, delivered when the device comes
 * back online. `onDelivered` hears each receipt a delivery brought back.
 */
export function useFieldOutbox(
  client: Pick<ApiClient, "runFieldOperation">,
  personId: string | null,
  incidentId: string | null,
  onDelivered?: (receipts: readonly FieldOperationReceipt[]) => void,
): FieldOutboxState {
  const box = useRef<{ outbox: FieldOutbox; store: OfflineStore; scope: ContinuityScope } | null>(null);
  const delivered = useRef(onDelivered);
  useEffect(() => { delivered.current = onDelivered; }, [onDelivered]);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<readonly QueuedOperation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const current = box.current;
    if (current) setPending(await current.outbox.pending(current.scope));
  }, []);

  const flush = useCallback(async (): Promise<readonly FieldOperationReceipt[]> => {
    const current = box.current;
    if (!current) return [];
    try {
      setError(null);
      const receipts = await current.outbox.flush(current.scope, (operation) =>
        client.runFieldOperation(current.scope.incidentId, operation));
      if (receipts.length) delivered.current?.(receipts);
      return receipts;
    } catch (reason) {
      if (!noConnection(reason)) setError(reason instanceof Error ? reason.message : String(reason));
      return [];
    } finally {
      await refresh().catch(() => undefined);
    }
  }, [client, refresh]);

  useEffect(() => {
    setReady(false); setPending([]); setError(null);
    if (!personId || !incidentId || typeof indexedDB === "undefined") return;
    const scope = { personId, incidentId };
    let active = true;
    let unsubscribe = () => {};
    void openOfflineStore().then(async (store) => {
      if (!active) { store.close(); return; }
      box.current = { outbox: new FieldOutbox(store), store, scope };
      unsubscribe = subscribeOfflineQueueChange(scope, () => void refresh());
      setReady(true);
      await refresh();
      if (navigator.onLine) await flush();
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    const online = () => void flush();
    addEventListener("online", online);
    return () => {
      active = false;
      unsubscribe();
      removeEventListener("online", online);
      box.current?.store.close();
      box.current = null;
    };
  }, [flush, incidentId, personId, refresh]);

  const send = useCallback(async (operation: FieldOperation): Promise<FieldOperationReceipt | null> => {
    const current = box.current;
    if (!current) throw new Error("This device's outbox is not available.");
    const keep = async () => {
      await current.outbox.enqueue(current.scope, operation);
      return null;
    };
    if (!navigator.onLine) return keep();
    try {
      const receipt = await client.runFieldOperation(current.scope.incidentId, operation);
      if (receipt.outcome === "late") {
        await keepLateReceipt(current.store, current.scope, {
          kind: receipt.kind, operationId: receipt.operationId, lateSubmissionId: receipt.lateSubmissionId,
        });
        notifyOfflineQueueChange(current.scope);
      }
      return receipt;
    } catch (reason) {
      if (noConnection(reason)) return keep();
      throw reason;
    }
  }, [client]);

  const discard = useCallback(async (operationId: string) => {
    const current = box.current;
    if (current) await current.outbox.discard(current.scope, operationId);
  }, []);

  return { ready, pending, error, send, flush, discard };
}

/** A new operation id and queue time for work about to be sent or kept. */
export function operationStamp(): { readonly operationId: string; readonly queuedAt: string } {
  return { operationId: crypto.randomUUID(), queuedAt: new Date().toISOString() };
}
