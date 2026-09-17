import * as Y from "yjs";
import type { OfflineStore } from "./store.js";

/**
 * Offline-first field client (VEOC-21). Every opened board is a local
 * Yjs document, hydrated from the durable store, so edits made in
 * airplane mode are real immediately and survive an app restart. The
 * queue is the CRDT itself: on reconnect the client exchanges state with
 * the server over the sync channel (VEOC-13), which reconciles and
 * checkpoints. Authentication never strands the user: the resume token
 * is cached, so a disconnected session renews on reconnect without
 * losing a single queued edit.
 */

const DIRTY_KEY = "dirty";
const SESSION_KEY = "session";
const BOARDS_KEY = "boards";

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

export interface SyncAck {
  readonly seq: number;
  readonly conflicts: number;
}

/** A transport that pushes local state and returns the server ack. */
export type PushFn = (state: Uint8Array) => Promise<SyncAck>;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export class FieldClient {
  private readonly docs = new Map<string, Y.Doc>();

  constructor(
    private readonly store: OfflineStore,
    private readonly baseUrl = "",
    private readonly wsFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  /** Cache the session and assigned boards for offline use. */
  async cacheSession(session: FieldSession, boards: readonly CachedBoard[]): Promise<void> {
    await this.store.setMeta(SESSION_KEY, session);
    await this.store.setMeta(BOARDS_KEY, boards);
  }

  async session(): Promise<FieldSession | null> {
    return this.store.getMeta<FieldSession>(SESSION_KEY);
  }

  async cachedBoards(): Promise<CachedBoard[]> {
    return (await this.store.getMeta<CachedBoard[]>(BOARDS_KEY)) ?? [];
  }

  /** Hydrate (or create) the local doc for a board from durable storage. */
  async open(boardId: string): Promise<void> {
    if (this.docs.has(boardId)) return;
    const doc = new Y.Doc();
    const state = await this.store.loadDoc(boardId);
    if (state) Y.applyUpdate(doc, state);
    this.docs.set(boardId, doc);
  }

  private doc(boardId: string): Y.Doc {
    const doc = this.docs.get(boardId);
    if (!doc) throw new Error(`board ${boardId} not open`);
    return doc;
  }

  /**
   * Edit a record offline. Flat `recordId/field` keys give field-level
   * merge on reconnect (VEOC-13). The doc is persisted synchronously with
   * the edit, so nothing is lost if the app dies before reconnect.
   */
  async edit(
    boardId: string,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const doc = this.doc(boardId);
    const records = doc.getMap<unknown>("records");
    doc.transact(() => {
      for (const [k, v] of Object.entries(fields)) records.set(`${recordId}/${k}`, v);
    });
    await this.store.saveDoc(boardId, Y.encodeStateAsUpdate(doc));
    await this.markDirty(boardId);
  }

  /** Current records as plain objects, for the field UI (works offline). */
  records(boardId: string): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of this.doc(boardId).getMap<unknown>("records").entries()) {
      const slash = key.indexOf("/");
      if (slash <= 0) continue;
      (out[key.slice(0, slash)] ??= {})[key.slice(slash + 1)] = value;
    }
    return out;
  }

  async pendingBoardIds(): Promise<string[]> {
    return (await this.store.getMeta<string[]>(DIRTY_KEY)) ?? [];
  }

  private async markDirty(boardId: string): Promise<void> {
    const dirty = new Set(await this.pendingBoardIds());
    dirty.add(boardId);
    await this.store.setMeta(DIRTY_KEY, [...dirty]);
  }

  private async clearDirty(boardId: string): Promise<void> {
    const dirty = new Set(await this.pendingBoardIds());
    dirty.delete(boardId);
    await this.store.setMeta(DIRTY_KEY, [...dirty]);
  }

  /**
   * Push queued state through a transport and settle the board. Applying
   * any server state the transport surfaces happens before the push, so
   * the merged doc is what gets persisted. A clean (non-dirty) board is a
   * no-op. Used directly by tests; sync() wraps it around a WebSocket.
   */
  async flush(boardId: string, push: PushFn): Promise<SyncAck | null> {
    const doc = this.doc(boardId);
    if (!(await this.pendingBoardIds()).includes(boardId)) return null;
    const ack = await push(Y.encodeStateAsUpdate(doc));
    await this.store.saveDoc(boardId, Y.encodeStateAsUpdate(doc));
    await this.clearDirty(boardId);
    return ack;
  }

  /**
   * Renew a disconnected session on reconnect. The cached resume token
   * buys a fresh access token without re-login and without touching the
   * queued edits. Throws while still offline; the caller keeps using the
   * cached data and retries later.
   */
  async renew(): Promise<string> {
    const session = await this.session();
    if (!session) throw new Error("no cached session");
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/auth/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resumeToken: session.resumeToken }),
    });
    if (!res.ok) throw new Error(`resume failed: ${res.status}`);
    const body = (await res.json()) as { accessToken: string; resumeToken?: string };
    await this.store.setMeta(SESSION_KEY, {
      ...session,
      accessToken: body.accessToken,
      resumeToken: body.resumeToken ?? session.resumeToken,
    } satisfies FieldSession);
    return body.accessToken;
  }

  /**
   * Full reconnect-and-reconcile over the sync WebSocket: authenticate,
   * apply the server's state into the local doc, push the merged state,
   * and settle on the ack. This is the production reconnect path.
   */
  async sync(boardId: string, token: string, timeoutMs = 15000): Promise<SyncAck | null> {
    await this.open(boardId);
    const wsBase = this.baseUrl.replace(/^http/, "ws");
    const socket = this.wsFactory(`${wsBase}/api/v1/sync/boards/${boardId}`);
    const doc = this.doc(boardId);
    const push: PushFn = (state) =>
      new Promise<SyncAck>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("sync timeout")), timeoutMs);
        socket.onmessage = (ev: MessageEvent) => {
          const msg = JSON.parse(String(ev.data)) as {
            type: string;
            update?: string;
            seq?: number;
            conflicts?: number;
            error?: string;
          };
          if (msg.type === "state") {
            Y.applyUpdate(doc, fromBase64(msg.update!));
            socket.send(
              JSON.stringify({ type: "update", update: toBase64(Y.encodeStateAsUpdate(doc)) }),
            );
          } else if (msg.type === "synced") {
            clearTimeout(timer);
            resolve({ seq: msg.seq!, conflicts: msg.conflicts! });
          } else if (msg.type === "error") {
            clearTimeout(timer);
            reject(new Error(msg.error));
          }
        };
        socket.onerror = () => {
          clearTimeout(timer);
          reject(new Error("socket error"));
        };
        socket.onopen = () => socket.send(JSON.stringify({ type: "auth", token }));
        void state;
      });
    try {
      return await this.flush(boardId, push);
    } finally {
      socket.close();
    }
  }
}
