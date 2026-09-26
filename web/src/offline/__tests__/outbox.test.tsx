// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_CONNECTION, type FieldOperation, type FieldOperationReceipt } from "../../app/api/client.js";
import { lateReceipts, operationStamp, useFieldOutbox } from "../outbox.js";
import { openDeviceClear, openOfflineStore } from "../store.js";

afterEach(cleanup);

const personId = "11111111-1111-4111-8111-111111111111";
// Each test opens this person's store, without a device PIN, on a fresh browser store.
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  openDeviceClear(personId);
});
const incidentId = "22222222-2222-4222-8222-222222222222";

describe("the device outbox", () => {
  it("keeps an operation that got no answer, sends it once the connection returns, and remembers a late one", async () => {
    let connected = false;
    const answer = vi.fn(async (_incident: string, operation: FieldOperation): Promise<FieldOperationReceipt> =>
      operation.kind === "task"
        ? { operationId: operation.operationId, kind: "task", outcome: "late", lateSubmissionId: "late-1" }
        : { operationId: operation.operationId, kind: operation.kind, outcome: "applied", messageId: "message-1" });
    const client = {
      runFieldOperation: vi.fn(async (incident: string, operation: FieldOperation) => {
        if (!connected) throw new Error(NO_CONNECTION);
        return answer(incident, operation);
      }),
    };
    const delivered = vi.fn();
    const { result } = renderHook(() => useFieldOutbox(client, personId, incidentId, delivered));
    await waitFor(() => expect(result.current.ready).toBe(true));

    const message: FieldOperation = { kind: "message", ...operationStamp(), threadId: "thread-1", body: "Road open" };
    await act(async () => { expect(await result.current.send(message)).toBeNull(); });
    await waitFor(() => expect(result.current.pending).toHaveLength(1));
    expect(result.current.pending[0]).toMatchObject({ operationId: message.operationId, body: "Road open" });

    connected = true;
    await act(async () => { await result.current.flush(); });
    expect(result.current.pending).toEqual([]);
    expect(delivered).toHaveBeenCalledWith([expect.objectContaining({ operationId: message.operationId, outcome: "applied" })]);
    // The retry carried the id and queue time it was kept with.
    expect(client.runFieldOperation.mock.calls.at(-1)![1]).toEqual(message);

    const task: FieldOperation = { kind: "task", ...operationStamp(), task: { item: "Stage sandbags", category: "general" }, dependencyIds: [] };
    await act(async () => { expect(await result.current.send(task)).toMatchObject({ outcome: "late" }); });
    const store = await openOfflineStore();
    expect(await lateReceipts(store, { personId, incidentId })).toMatchObject([{ kind: "task", lateSubmissionId: "late-1" }]);
    store.close();
  });
});
