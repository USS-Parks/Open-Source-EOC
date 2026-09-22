// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedStateRecord, SavedStateWrite } from "@openeoc/shared";
import { createOperationalTableViewState } from "../table.js";
import {
  tableViewStateKey,
  useOperationalTableViews,
  type TableViewPersistence,
} from "../table-saved-views.js";

afterEach(cleanup);

const state = createOperationalTableViewState([
  { id: "name", width: 200 },
  { id: "status", width: 140 },
]);

function record(options: {
  readonly key: string;
  readonly tableId: string;
  readonly schema?: string;
  readonly label?: string;
  readonly revision?: number;
  readonly incidentId?: string;
}): SavedStateRecord {
  const now = "2026-09-21T00:00:00.000Z";
  return {
    incidentId: options.incidentId ?? "incident-a",
    kind: "table_view",
    key: options.key,
    schemaVersion: 1,
    revision: options.revision ?? 1,
    payload: {
      tableId: options.tableId,
      tableSchema: options.schema ?? "v1",
      label: options.label ?? options.key,
      view: {
        density: state.density,
        columnOrder: [...state.columnOrder],
        columnWidths: { ...state.columnWidths },
        pinned: { ...state.pinned },
        sort: null,
        filters: {},
        pageSize: state.pageSize,
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

function persistence(overrides: Partial<TableViewPersistence> = {}): TableViewPersistence {
  return {
    listTableViewStates: vi.fn(async () => ({ states: [], nextCursor: null })),
    getTableViewState: vi.fn(async () => { throw new Error("not found"); }),
    saveTableViewState: vi.fn(async (incidentId: string, key: string, input: SavedStateWrite) => ({
      ...record({ key, tableId: String(input.payload.tableId), incidentId }),
      payload: input.payload,
      revision: input.expectedRevision + 1,
    })),
    deleteTableViewState: vi.fn(async () => undefined),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("table saved views", () => {
  it("continues paged SEAM results until it finds the exact table and schema", async () => {
    const list = vi.fn(async (_incidentId: string, options?: { cursor?: string }) => options?.cursor
      ? { states: [record({ key: "priority:mine", tableId: "priority", label: "Mine" })], nextCursor: null }
      : { states: [record({ key: "other:first", tableId: "other" })], nextCursor: "other:first" });
    const store = persistence({ listTableViewStates: list });
    const { result } = renderHook(() => useOperationalTableViews({
      persistence: store,
      personId: "person-a",
      incidentId: "incident-a",
      tableId: "priority",
      tableSchema: "v1",
      onApply: () => undefined,
    }));
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.views.map((view) => view.id)).toEqual(["mine"]);
  });

  it("never shows a previous person's views while the new scope loads", async () => {
    const second = deferred<{ states: readonly SavedStateRecord[]; nextCursor: null }>();
    const list = vi.fn(async (_incidentId: string) => {
      if (list.mock.calls.length === 1) return { states: [record({ key: "priority:mine", tableId: "priority" })], nextCursor: null };
      return second.promise;
    });
    const store = persistence({ listTableViewStates: list });
    const options = (personId: string) => ({
      persistence: store,
      personId,
      incidentId: "incident-a",
      tableId: "priority",
      tableSchema: "v1",
      onApply: () => undefined,
    });
    const { result, rerender } = renderHook(({ personId }) => useOperationalTableViews(options(personId)), {
      initialProps: { personId: "person-a" },
    });
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    rerender({ personId: "person-b" });
    expect(result.current.views).toEqual([]);
    expect(result.current.status).toBe("loading");
    second.resolve({ states: [], nextCursor: null });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.views).toEqual([]);
  });

  it("invalidates a pending save when account or incident scope changes", async () => {
    const pending = deferred<SavedStateRecord>();
    const save = vi.fn(() => pending.promise);
    const store = persistence({ saveTableViewState: save });
    const makeOptions = (personId: string, incidentId: string) => ({
      persistence: store,
      personId,
      incidentId,
      tableId: "priority",
      tableSchema: "v1",
      onApply: () => undefined,
    });
    const { result, rerender } = renderHook(
      ({ personId, incidentId }) => useOperationalTableViews(makeOptions(personId, incidentId)),
      { initialProps: { personId: "person-a", incidentId: "incident-a" } },
    );
    await waitFor(() => expect(result.current.status).toBe("idle"));
    const saving = result.current.save("mine", "Mine", state);
    await waitFor(() => expect(result.current.status).toBe("saving"));
    rerender({ personId: "person-b", incidentId: "incident-b" });
    expect(result.current.views).toEqual([]);
    pending.resolve(record({ key: "priority:mine", tableId: "priority", incidentId: "incident-a" }));
    await expect(saving).resolves.toBe(false);
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.views).toEqual([]);
  });

  it("keeps the prior saved revision and current table state after a CAS conflict", async () => {
    const existing = record({ key: "priority:mine", tableId: "priority", label: "Mine", revision: 4 });
    const store = persistence({
      listTableViewStates: vi.fn(async () => ({ states: [existing], nextCursor: null })),
      saveTableViewState: vi.fn(async () => { throw Object.assign(new Error("stale revision"), { status: 409 }); }),
    });
    const { result } = renderHook(() => useOperationalTableViews({
      persistence: store,
      personId: "person-a",
      incidentId: "incident-a",
      tableId: "priority",
      tableSchema: "v1",
      onApply: () => undefined,
    }));
    await waitFor(() => expect(result.current.status).toBe("idle"));
    const draft = { ...state, density: "comfortable" as const, filters: { status: "Open" } };
    let saved = true;
    await act(async () => {
      saved = await result.current.save("mine", "Mine", draft);
    });
    expect(saved).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("conflict"));
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0]?.revision).toBe(4);
    expect(result.current.views[0]?.view.density).toBe("compact");
    expect(draft.density).toBe("comfortable");
  });

  it("persists view settings without transient page or selection state and applies at page one", async () => {
    const save = vi.fn(async (incidentId: string, key: string, input: SavedStateWrite) => ({
      ...record({ key, tableId: "priority", incidentId, label: "Field view" }),
      payload: input.payload,
    }));
    const applied = vi.fn();
    const store = persistence({ saveTableViewState: save });
    const { result } = renderHook(() => useOperationalTableViews({
      persistence: store,
      personId: "person-a",
      incidentId: "incident-a",
      tableId: "priority",
      tableSchema: "v1",
      onApply: applied,
    }));
    await waitFor(() => expect(result.current.status).toBe("idle"));
    let saved = false;
    await act(async () => {
      saved = await result.current.save("field", "Field view", { ...state, page: 9 });
    });
    expect(saved).toBe(true);
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    const input = save.mock.calls[0]?.[2];
    expect(input?.payload).not.toHaveProperty("selection");
    expect((input?.payload.view as Record<string, unknown>)).not.toHaveProperty("page");
    expect(result.current.apply("field")).toBe(true);
    expect(applied).toHaveBeenCalledWith(expect.objectContaining({ page: 0 }), "field");
  });

  it("enforces the SEAM key grammar and 128-character combined limit", () => {
    expect(tableViewStateKey("priority", "field-view")).toBe("priority:field-view");
    expect(() => tableViewStateKey("priority work", "field")).toThrow(/tableId/);
    expect(() => tableViewStateKey("a".repeat(100), "b".repeat(40))).toThrow(/128/);
  });

  it("reports an invalid scoped key without calling persistence", async () => {
    const store = persistence();
    const { result } = renderHook(() => useOperationalTableViews({
      persistence: store,
      personId: "person-a",
      incidentId: "incident-a",
      tableId: "priority",
      tableSchema: "v1",
      onApply: () => undefined,
    }));
    await waitFor(() => expect(result.current.status).toBe("idle"));
    let saved = true;
    await act(async () => {
      saved = await result.current.save("invalid view", "Invalid", state);
    });
    expect(saved).toBe(false);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/viewId/);
    expect(store.saveTableViewState).not.toHaveBeenCalled();
  });
});
