import * as Y from "yjs";
import type { OfflineStore } from "./store.js";

export interface ContinuityScope {
  readonly personId: string;
  readonly incidentId: string;
}

export interface FieldSession {
  readonly accessToken: string;
  readonly resumeToken: string;
  readonly personId: string;
}

export interface CachedBoard {
  readonly id: string;
  readonly title: string;
  readonly templateKey: string;
}

export interface PendingBoardOperation extends ContinuityScope {
  readonly boardId: string;
  readonly operationId: string;
  readonly queuedAt: string;
  /** Immutable base64 Yjs update used for every retry of this operation. */
  readonly update: string;
}

export interface SyncAck {
  readonly operationId: string | null;
  readonly seq: number;
  readonly conflicts: number;
  readonly exact: boolean;
  /** The late submission the server kept it as, because the incident had closed (AG-07). */
  readonly late?: string;
}

export type SyncErrorCode = "auth_required" | "conflict" | "failed";

export class SyncTransportError extends Error {
  constructor(readonly code: SyncErrorCode, message: string) {
    super(message);
    this.name = "SyncTransportError";
  }
}

/** The server's refusal as a transport error; a code this client does not know reads as a failure. */
function syncFailure(code: string | undefined, message: string | undefined): SyncTransportError {
  const known = code === "auth_required" || code === "conflict" ? code : "failed";
  return new SyncTransportError(known, message ?? "sync failed");
}

export type PushFn = (
  operation: PendingBoardOperation,
  state: Uint8Array,
) => Promise<SyncAck>;

const scopeId = (scope: ContinuityScope): string => `${scope.personId}:${scope.incidentId}`;
const docKey = (scope: ContinuityScope, boardId: string): string =>
  `board:${scopeId(scope)}:${boardId}`;
const operationsKey = (scope: ContinuityScope): string => `board-operations:${scopeId(scope)}`;
const sessionKey = (scope: ContinuityScope): string => `session:${scopeId(scope)}`;
const boardsKey = (scope: ContinuityScope): string => `boards:${scopeId(scope)}`;
const resultsKey = (scope: ContinuityScope): string => `board-results:${scopeId(scope)}`;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

/** Scoped IndexedDB Yjs client for durable board operations. */
export class FieldClient {
  private readonly docs = new Map<string, Y.Doc>();
  private mutation = Promise.resolve();
  private delivery = Promise.resolve();

  constructor(
    private readonly store: OfflineStore,
    private readonly baseUrl = "",
    private readonly wsFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async cacheSession(
    scope: ContinuityScope,
    session: FieldSession,
    boards: readonly CachedBoard[],
  ): Promise<void> {
    if (scope.personId !== session.personId) throw new Error("session belongs to another person");
    await this.store.setMeta(sessionKey(scope), session);
    await this.store.setMeta(boardsKey(scope), boards);
  }

  async session(scope: ContinuityScope): Promise<FieldSession | null> {
    return this.store.getMeta<FieldSession>(sessionKey(scope));
  }

  async cachedBoards(scope: ContinuityScope): Promise<CachedBoard[]> {
    return (await this.store.getMeta<CachedBoard[]>(boardsKey(scope))) ?? [];
  }

  async open(scope: ContinuityScope, boardId: string): Promise<void> {
    const key = docKey(scope, boardId);
    if (this.docs.has(key)) return;
    const doc = new Y.Doc();
    const state = await this.store.loadDoc(key);
    if (state) Y.applyUpdate(doc, state);
    this.docs.set(key, doc);
  }

  private doc(scope: ContinuityScope, boardId: string): Y.Doc {
    const doc = this.docs.get(docKey(scope, boardId));
    if (!doc) throw new Error(`board ${boardId} is not open for this continuity scope`);
    return doc;
  }

  async edit(
    scope: ContinuityScope,
    boardId: string,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<PendingBoardOperation> {
    return this.change(async () => {
      const doc = this.doc(scope, boardId);
      const records = doc.getMap<unknown>("records");
      doc.transact(() => {
        for (const [key, value] of Object.entries(fields)) records.set(`${recordId}/${key}`, value);
      });
      const state = Y.encodeStateAsUpdate(doc);
      const operation: PendingBoardOperation = {
        ...scope,
        boardId,
        operationId: crypto.randomUUID(),
        queuedAt: new Date().toISOString(),
        update: toBase64(state),
      };
      const pending = await this.pendingOperations(scope);
      await this.store.saveDocAndMeta(
        docKey(scope, boardId),
        state,
        operationsKey(scope),
        [...pending, operation],
      );
      return operation;
    });
  }

  records(scope: ContinuityScope, boardId: string): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of this.doc(scope, boardId).getMap<unknown>("records").entries()) {
      const slash = key.indexOf("/");
      if (slash <= 0) continue;
      (out[key.slice(0, slash)] ??= {})[key.slice(slash + 1)] = value;
    }
    return out;
  }

  async pendingOperations(scope: ContinuityScope): Promise<PendingBoardOperation[]> {
    return (await this.store.getMeta<PendingBoardOperation[]>(operationsKey(scope))) ?? [];
  }

  async pendingBoardIds(scope: ContinuityScope): Promise<string[]> {
    return [...new Set((await this.pendingOperations(scope)).map((item) => item.boardId))];
  }

  async lastResult(scope: ContinuityScope, boardId: string): Promise<SyncAck | null> {
    const results = (await this.store.getMeta<Record<string, SyncAck>>(resultsKey(scope))) ?? {};
    return results[boardId] ?? null;
  }

  private async settle(
    scope: ContinuityScope,
    operation: PendingBoardOperation,
    ack: SyncAck,
  ): Promise<void> {
    await this.change(async () => {
      const pending = await this.pendingOperations(scope);
      if (!pending.some((item) => item.operationId === operation.operationId)) {
        throw new Error("pending board operation changed before acknowledgement");
      }
      await this.store.setMeta(
        operationsKey(scope),
        pending.filter((item) => item.operationId !== operation.operationId),
      );
      const results = (await this.store.getMeta<Record<string, SyncAck>>(resultsKey(scope))) ?? {};
      await this.store.setMeta(resultsKey(scope), { ...results, [operation.boardId]: ack });
    });
  }

  async flush(scope: ContinuityScope, boardId: string, push: PushFn): Promise<SyncAck | null> {
    const run = this.delivery.then(() => this.flushOne(scope, boardId, push));
    this.delivery = run.then(() => undefined, () => undefined);
    return run;
  }

  private async flushOne(
    scope: ContinuityScope,
    boardId: string,
    push: PushFn,
  ): Promise<SyncAck | null> {
    const operation = (await this.pendingOperations(scope)).find(
      (item) => item.boardId === boardId,
    );
    if (!operation) return null;
    const ack = await push(operation, fromBase64(operation.update));
    if (!ack.exact || ack.operationId !== operation.operationId) {
      throw new Error("sync acknowledgement does not match the pending operation");
    }
    await this.settle(scope, operation, ack);
    return ack;
  }

  private async mergeServerState(
    scope: ContinuityScope,
    boardId: string,
    state: Uint8Array,
  ): Promise<void> {
    await this.change(async () => {
      const doc = this.doc(scope, boardId);
      Y.applyUpdate(doc, state);
      await this.store.saveDoc(docKey(scope, boardId), Y.encodeStateAsUpdate(doc));
    });
  }

  async renew(scope: ContinuityScope): Promise<string> {
    const session = await this.session(scope);
    if (!session) throw new SyncTransportError("auth_required", "no cached session");
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/auth/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resumeToken: session.resumeToken }),
    });
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "auth_required" : "failed";
      throw new SyncTransportError(code, `resume failed: ${response.status}`);
    }
    const body = (await response.json()) as { accessToken: string; resumeToken?: string };
    await this.store.setMeta(sessionKey(scope), {
      ...session,
      accessToken: body.accessToken,
      resumeToken: body.resumeToken ?? session.resumeToken,
    } satisfies FieldSession);
    return body.accessToken;
  }

  async sync(
    scope: ContinuityScope,
    boardId: string,
    token: string,
    timeoutMs = 15000,
  ): Promise<SyncAck | null> {
    await this.open(scope, boardId);
    const wsBase = this.baseUrl.replace(/^http/, "ws");
    const socketRef: { current: WebSocket | null } = { current: null };
    const push: PushFn = (operation, frozenUpdate) => new Promise<SyncAck>((resolve, reject) => {
      const activeSocket = this.wsFactory(
        `${wsBase}/api/v1/sync/boards/${boardId}?incidentId=${encodeURIComponent(scope.incidentId)}`,
      );
      socketRef.current = activeSocket;
      const timer = setTimeout(() => reject(new SyncTransportError("failed", "sync timeout")), timeoutMs);
      activeSocket.onmessage = (event: MessageEvent) => {
        const handle = async () => {
        const message = JSON.parse(String(event.data)) as {
          type: string;
          update?: string;
          operationId?: string | null;
          seq?: number;
          conflicts?: number;
          exact?: boolean;
          late?: string;
          code?: string;
          error?: string;
        };
        if (message.type === "state") {
          await this.mergeServerState(scope, boardId, fromBase64(message.update!));
          activeSocket.send(JSON.stringify({
            type: "update",
            operationId: operation.operationId,
            incidentId: scope.incidentId,
            queuedAt: operation.queuedAt,
            update: toBase64(frozenUpdate),
          }));
        } else if (message.type === "update") {
          await this.mergeServerState(scope, boardId, fromBase64(message.update!));
        } else if (message.type === "synced") {
          clearTimeout(timer);
          resolve({
            operationId: message.operationId ?? null,
            seq: message.seq!,
            conflicts: message.conflicts!,
            exact: message.exact === true,
            ...(message.late ? { late: message.late } : {}),
          });
        } else if (message.type === "error") {
          clearTimeout(timer);
          reject(syncFailure(message.code, message.error));
        }
        };
        void handle().catch((error: unknown) => {
          clearTimeout(timer);
          reject(error);
        });
      };
      activeSocket.onerror = () => {
        clearTimeout(timer);
        reject(new SyncTransportError("failed", "socket error"));
      };
      activeSocket.onopen = () => activeSocket.send(JSON.stringify({ type: "auth", token }));
    });
    try {
      return await this.flush(scope, boardId, push);
    } finally {
      socketRef.current?.close();
    }
  }

  private change<T>(update: () => Promise<T>): Promise<T> {
    const run = this.mutation.then(update);
    this.mutation = run.then(() => undefined, () => undefined);
    return run;
  }
}
