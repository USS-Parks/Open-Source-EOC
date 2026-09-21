import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { TaskCompletionReceipt } from "@openeoc/shared";
import { openOfflineStore } from "../store.js";
import { TaskCompletionQueue } from "../task-completions.js";

const ids = {
  incident: "11111111-1111-4111-8111-111111111111",
  task: "22222222-2222-4222-8222-222222222222",
  person: "33333333-3333-4333-8333-333333333333",
  otherPerson: "44444444-4444-4444-8444-444444444444",
  organization: "55555555-5555-4555-8555-555555555555",
  position: "66666666-6666-4666-8666-666666666666",
  operation: "77777777-7777-4777-8777-777777777777",
} as const;

function receipt(operationId: string = ids.operation): TaskCompletionReceipt {
  return {
    operationId,
    taskId: ids.task,
    incidentId: ids.incident,
    status: "completed",
    revision: 2,
    completedAt: "2026-09-21T12:00:00.000Z",
    completedBy: {
      personId: ids.person,
      positionId: ids.position,
      organizationId: ids.organization,
      participationId: null,
      title: "Incident Commander",
    },
  };
}

describe("offline task completion queue", () => {
  it("persists before send and survives an IndexedDB restart", async () => {
    const idb = new IDBFactory();
    const firstStore = await openOfflineStore(idb, "task-restart");
    const first = new TaskCompletionQueue(firstStore);
    await first.enqueue({
      taskId: ids.task,
      incidentId: ids.incident,
      personId: ids.person,
      operationId: ids.operation,
    });
    firstStore.close();

    const revivedStore = await openOfflineStore(idb, "task-restart");
    const revived = new TaskCompletionQueue(revivedStore);
    expect(await revived.pending(ids.person, ids.incident)).toMatchObject([
      { operationId: ids.operation, taskId: ids.task, personId: ids.person },
    ]);
    revivedStore.close();
  });

  it("keeps a lost acknowledgement and reconciles one server completion on retry", async () => {
    const idb = new IDBFactory();
    const store = await openOfflineStore(idb, "task-lost-ack");
    const queue = new TaskCompletionQueue(store);
    const operation = await queue.enqueue({
      taskId: ids.task,
      incidentId: ids.incident,
      personId: ids.person,
      operationId: ids.operation,
    });
    const authoritative = new Map<string, TaskCompletionReceipt>();
    await expect(queue.flush(ids.person, ids.incident, async (sent) => {
      authoritative.set(sent.operationId, receipt(sent.operationId));
      throw new Error("connection lost after commit");
    })).rejects.toThrow("connection lost after commit");
    expect(await queue.pending(ids.person, ids.incident)).toEqual([operation]);

    const reconciled = await queue.flush(ids.person, ids.incident, async (sent) =>
      authoritative.get(sent.operationId)!);
    expect(reconciled).toEqual([receipt()]);
    expect(authoritative.size).toBe(1);
    expect(await queue.pending(ids.person, ids.incident)).toEqual([]);
    store.close();
  });

  it("does not expose or remove another person's incident-scoped commands", async () => {
    const idb = new IDBFactory();
    const store = await openOfflineStore(idb, "task-scope");
    const queue = new TaskCompletionQueue(store);
    await queue.enqueue({
      taskId: ids.task,
      incidentId: ids.incident,
      personId: ids.person,
      operationId: ids.operation,
    });
    await queue.enqueue({
      taskId: ids.task,
      incidentId: ids.incident,
      personId: ids.otherPerson,
      operationId: "88888888-8888-4888-8888-888888888888",
    });
    expect(await queue.pending(ids.person, ids.incident)).toHaveLength(1);
    expect(await queue.pending(ids.otherPerson, ids.incident)).toHaveLength(1);
    await queue.flush(ids.person, ids.incident, async () => receipt());
    expect(await queue.pending(ids.person, ids.incident)).toEqual([]);
    expect(await queue.pending(ids.otherPerson, ids.incident)).toHaveLength(1);
    store.close();
  });
});
