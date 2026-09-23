import type { TaskCompletionReceipt } from "@openeoc/shared";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { ContinuityCoordinator } from "../continuity.js";
import { FieldClient, RESTRICTED_SYNC_MESSAGE, SyncTransportError } from "../field-client.js";
import { openOfflineStore } from "../store.js";
import { TaskCompletionQueue } from "../task-completions.js";

const scope = {
  personId: "11111111-1111-4111-8111-111111111111",
  incidentId: "22222222-2222-4222-8222-222222222222",
};
const boardId = "33333333-3333-4333-8333-333333333333";
const taskId = "44444444-4444-4444-8444-444444444444";
const taskOperationId = "55555555-5555-4555-8555-555555555555";

function taskReceipt(): TaskCompletionReceipt {
  return {
    operationId: taskOperationId,
    taskId,
    incidentId: scope.incidentId,
    status: "completed",
    revision: 2,
    completedAt: "2026-09-21T12:00:00.000Z",
    completedBy: {
      personId: scope.personId,
      positionId: "66666666-6666-4666-8666-666666666666",
      organizationId: "77777777-7777-4777-8777-777777777777",
      participationId: null,
      title: "Incident Commander",
    },
  };
}

describe("offline continuity state adapter", () => {
  it("reconciles only the selected scope and retains an explicit conflict state", async () => {
    const store = await openOfflineStore(new IDBFactory(), "continuity-state");
    const fields = new FieldClient(store);
    const tasks = new TaskCompletionQueue(store);
    const coordinator = new ContinuityCoordinator(store, fields, tasks);
    await fields.open(scope, boardId);
    const boardOperation = await fields.edit(scope, boardId, "record-1", { status: "closed" });
    await tasks.enqueue({ ...scope, taskId, operationId: taskOperationId });
    expect(await coordinator.snapshot(scope)).toMatchObject({
      phase: "queued",
      pendingBoardIds: [boardId],
      pendingTaskOperationIds: [taskOperationId],
    });
    expect(await coordinator.snapshot({ ...scope, personId: "88888888-8888-4888-8888-888888888888" }))
      .toMatchObject({ pendingBoardIds: [], pendingTaskOperationIds: [] });

    const result = await coordinator.reconnect(scope, {
      syncBoard: (id) => fields.flush(scope, id, async (operation) => ({
        operationId: operation.operationId,
        seq: 7,
        conflicts: 1,
        exact: true,
      })),
      completeTask: async () => taskReceipt(),
    });
    expect(result.boardReceipts[0]?.operationId).toBe(boardOperation.operationId);
    expect(result.snapshot).toMatchObject({
      phase: "conflict",
      pendingBoardIds: [],
      pendingTaskOperationIds: [],
      conflicts: 1,
    });
    const noOp = await coordinator.reconnect(scope, {
      syncBoard: async () => null,
      completeTask: async () => taskReceipt(),
    });
    expect(noOp.snapshot).toMatchObject({
      phase: "conflict",
      pendingBoardIds: [],
      pendingTaskOperationIds: [],
      conflicts: 1,
    });
    store.close();
  });

  it("labels authorization recovery and does not clear either pending command", async () => {
    const store = await openOfflineStore(new IDBFactory(), "continuity-auth");
    const fields = new FieldClient(store);
    const tasks = new TaskCompletionQueue(store);
    const coordinator = new ContinuityCoordinator(store, fields, tasks);
    await fields.open(scope, boardId);
    await fields.edit(scope, boardId, "record-1", { status: "closed" });
    await tasks.enqueue({ ...scope, taskId, operationId: taskOperationId });
    await expect(coordinator.reconnect(scope, {
      syncBoard: async () => {
        throw new SyncTransportError("auth_required", "incident access expired");
      },
      completeTask: async () => taskReceipt(),
    })).rejects.toThrow("incident access expired");
    expect(await coordinator.snapshot(scope)).toMatchObject({
      phase: "auth_required",
      pendingBoardIds: [boardId],
      pendingTaskOperationIds: [taskOperationId],
    });
    store.close();
  });

  it("keeps a restricted board's work queued without asking for a new session and delivers the rest", async () => {
    const store = await openOfflineStore(new IDBFactory(), "continuity-restricted");
    const fields = new FieldClient(store);
    const tasks = new TaskCompletionQueue(store);
    const coordinator = new ContinuityCoordinator(store, fields, tasks);
    const openBoard = "99999999-9999-4999-8999-999999999999";
    await fields.open(scope, boardId);
    await fields.edit(scope, boardId, "record-1", { status: "closed" });
    await fields.open(scope, openBoard);
    await fields.edit(scope, openBoard, "record-2", { status: "closed" });
    await tasks.enqueue({ ...scope, taskId, operationId: taskOperationId });
    const synced: string[] = [];
    const result = await coordinator.reconnect(scope, {
      syncBoard: async (id) => {
        if (id === boardId) throw new SyncTransportError("restricted", RESTRICTED_SYNC_MESSAGE);
        synced.push(id);
        return fields.flush(scope, id, async (operation) => ({
          operationId: operation.operationId, seq: 3, conflicts: 0, exact: true,
        }));
      },
      completeTask: async () => taskReceipt(),
    });
    expect(synced).toEqual([openBoard]);
    expect(result.snapshot).toMatchObject({
      phase: "restricted",
      pendingBoardIds: [boardId],
      pendingTaskOperationIds: [],
      lastError: RESTRICTED_SYNC_MESSAGE,
    });
    store.close();
  });

  it("normalizes task API authentication failures and retains the queued task", async () => {
    const store = await openOfflineStore(new IDBFactory(), "continuity-task-auth");
    const fields = new FieldClient(store);
    const tasks = new TaskCompletionQueue(store);
    const coordinator = new ContinuityCoordinator(store, fields, tasks);
    await fields.open(scope, boardId);
    const boardOperation = await fields.edit(scope, boardId, "record-1", { status: "blocked" });
    await tasks.enqueue({ ...scope, taskId, operationId: taskOperationId });
    const expired = new Error("session expired") as Error & { status: number };
    expired.name = "ApiError";
    expired.status = 401;

    await expect(coordinator.reconnect(scope, {
      syncBoard: (id) => fields.flush(scope, id, async () => ({
        operationId: boardOperation.operationId,
        seq: 11,
        conflicts: 1,
        exact: true,
      })),
      completeTask: async () => { throw expired; },
    })).rejects.toMatchObject({ code: "auth_required" });
    expect(await coordinator.snapshot(scope)).toMatchObject({
      phase: "auth_required",
      pendingBoardIds: [],
      pendingTaskOperationIds: [taskOperationId],
      conflicts: 1,
    });
    store.close();
  });
});
