import type { TaskCompletionReceipt } from "@openeoc/shared";
import { ContinuityCoordinator } from "../continuity.js";
import {
  type ContinuityScope,
  FieldClient,
  SyncTransportError,
} from "../field-client.js";
import { openOfflineStore, type OfflineStore } from "../store.js";
import { TaskCompletionQueue } from "../task-completions.js";

interface FixtureConfig {
  readonly personId: string;
  readonly incidentId: string;
  readonly boardId: string;
  readonly taskId: string;
  readonly token: string;
  readonly databaseName: string;
}

interface ContinuityFixture {
  configure(config: FixtureConfig): Promise<void>;
  editReport(recordId: string, fields: Record<string, unknown>): Promise<unknown>;
  queueTask(operationId: string): Promise<unknown>;
  markOffline(): Promise<unknown>;
  snapshot(): Promise<unknown>;
  snapshotScope(scope: ContinuityScope): Promise<unknown>;
  records(): Record<string, Record<string, unknown>>;
  reconnect(): Promise<unknown>;
}

let config: FixtureConfig | null = null;
let scope: ContinuityScope | null = null;
let store: OfflineStore | null = null;
let fields: FieldClient | null = null;
let tasks: TaskCompletionQueue | null = null;
let coordinator: ContinuityCoordinator | null = null;

function required<T>(value: T | null, label: string): T {
  if (!value) throw new Error(`${label} is not configured`);
  return value;
}

const fixture: ContinuityFixture = {
  async configure(next) {
    store?.close();
    config = next;
    scope = { personId: next.personId, incidentId: next.incidentId };
    store = await openOfflineStore(indexedDB, next.databaseName);
    fields = new FieldClient(store, location.origin);
    tasks = new TaskCompletionQueue(store);
    coordinator = new ContinuityCoordinator(store, fields, tasks);
    await fields.open(scope, next.boardId);
    document.body.dataset.ready = "true";
  },

  async editReport(recordId, values) {
    return required(fields, "fields").edit(
      required(scope, "scope"),
      required(config, "config").boardId,
      recordId,
      values,
    );
  },

  async queueTask(operationId) {
    const current = required(config, "config");
    return required(tasks, "tasks").enqueue({
      operationId,
      taskId: current.taskId,
      incidentId: current.incidentId,
      personId: current.personId,
    });
  },

  markOffline() {
    return required(coordinator, "coordinator").markOffline(required(scope, "scope"));
  },

  snapshot() {
    return required(coordinator, "coordinator").snapshot(required(scope, "scope"));
  },

  snapshotScope(otherScope) {
    return required(coordinator, "coordinator").snapshot(otherScope);
  },

  records() {
    return required(fields, "fields").records(
      required(scope, "scope"),
      required(config, "config").boardId,
    );
  },

  reconnect() {
    const current = required(config, "config");
    const currentScope = required(scope, "scope");
    const currentFields = required(fields, "fields");
    return required(coordinator, "coordinator").reconnect(currentScope, {
      syncBoard: (boardId) => currentFields.sync(currentScope, boardId, current.token),
      completeTask: async (operation): Promise<TaskCompletionReceipt> => {
        const response = await fetch(
          `/api/v1/incidents/${operation.incidentId}/tasks/${operation.taskId}/complete`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${current.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ operationId: operation.operationId }),
          },
        );
        if (!response.ok) {
          const code = response.status === 401 || response.status === 403 || response.status === 404
            ? "auth_required"
            : response.status === 409
              ? "conflict"
              : "failed";
          throw new SyncTransportError(code, `task completion failed: ${response.status}`);
        }
        return response.json() as Promise<TaskCompletionReceipt>;
      },
    });
  },
};

declare global {
  interface Window {
    continuityFixture: ContinuityFixture;
  }
}

window.continuityFixture = fixture;
