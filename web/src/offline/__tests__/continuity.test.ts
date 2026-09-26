import type { TaskCompletionReceipt } from "@openeoc/shared";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { ApiError, type FieldOperation } from "../../app/api/client.js";
import { ContinuityCoordinator } from "../continuity.js";
import { FieldClient, SyncTransportError } from "../field-client.js";
import { FieldOutbox } from "../outbox.js";
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

const noOperation = async (): Promise<never> => {
  throw new Error("no queued operation expected");
};

describe("offline continuity state adapter", () => {
  it("reconciles only the selected scope and retains an explicit conflict state", async () => {
    const store = await openOfflineStore(new IDBFactory(), "continuity-state");
    const fields = new FieldClient(store);
    const tasks = new TaskCompletionQueue(store);
    const coordinator = new ContinuityCoordinator(store, fields, tasks, new FieldOutbox(store));
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
      runOperation: noOperation,
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
      runOperation: noOperation,
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
    const coordinator = new ContinuityCoordinator(store, fields, tasks, new FieldOutbox(store));
    await fields.open(scope, boardId);
    await fields.edit(scope, boardId, "record-1", { status: "closed" });
    await tasks.enqueue({ ...scope, taskId, operationId: taskOperationId });
    await expect(coordinator.reconnect(scope, {
      syncBoard: async () => {
        throw new SyncTransportError("auth_required", "incident access expired");
      },
      completeTask: async () => taskReceipt(),
      runOperation: noOperation,
    })).rejects.toThrow("incident access expired");
    expect(await coordinator.snapshot(scope)).toMatchObject({
      phase: "auth_required",
      pendingBoardIds: [boardId],
      pendingTaskOperationIds: [taskOperationId],
    });
    store.close();
  });

  it("delivers the outbox, keeps a refused operation with its reason and counts late submissions", async () => {
    const store = await openOfflineStore(new IDBFactory(), "continuity-outbox");
    const fields = new FieldClient(store);
    const tasks = new TaskCompletionQueue(store);
    const outbox = new FieldOutbox(store);
    const coordinator = new ContinuityCoordinator(store, fields, tasks, outbox);
    const stamp = (operationId: string) => ({ operationId, queuedAt: "2026-09-25T10:00:00.000Z" });
    const message: FieldOperation = { kind: "message", ...stamp("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), threadId: boardId, body: "Slide at mile 12" };
    const task: FieldOperation = {
      kind: "task", ...stamp("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), task: { item: "Stage sandbags", category: "general" }, dependencyIds: [],
    };
    await outbox.enqueue(scope, message);
    await outbox.enqueue(scope, task);
    await tasks.enqueue({ ...scope, taskId, operationId: taskOperationId });
    expect(await coordinator.snapshot(scope)).toMatchObject({
      phase: "queued",
      pendingOperations: [{ kind: "message", refused: false }, { kind: "task", refused: false }],
    });
    const sent: string[] = [];
    const result = await coordinator.reconnect(scope, {
      syncBoard: async () => null,
      completeTask: async (operation) => ({
        operationId: operation.operationId, kind: "task_completion", outcome: "late", lateSubmissionId: "late-1",
      }),
      runOperation: async (operation) => {
        sent.push(operation.kind);
        if (operation.kind === "task") throw new ApiError(403, "adding a task requires incident owner admin");
        return { operationId: operation.operationId, kind: operation.kind, outcome: "late", lateSubmissionId: "late-2" };
      },
    });
    expect(sent).toEqual(["message", "task"]);
    expect(result.snapshot).toMatchObject({
      phase: "synced",
      pendingTaskOperationIds: [],
      pendingOperations: [{ kind: "task", refused: true }],
      lateSubmissions: 2,
    });
    expect((await outbox.pending(scope))[0]).toMatchObject({ refused: "adding a task requires incident owner admin" });
    // A refused operation is not sent again; it waits for the operator to discard it.
    await coordinator.reconnect(scope, { syncBoard: async () => null, completeTask: async () => taskReceipt(), runOperation: noOperation });
    await outbox.discard(scope, task.operationId);
    expect((await coordinator.snapshot(scope)).pendingOperations).toEqual([]);
    store.close();
  });

  it("normalizes task API authentication failures and retains the queued task", async () => {
    const store = await openOfflineStore(new IDBFactory(), "continuity-task-auth");
    const fields = new FieldClient(store);
    const tasks = new TaskCompletionQueue(store);
    const coordinator = new ContinuityCoordinator(store, fields, tasks, new FieldOutbox(store));
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
      runOperation: noOperation,
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
