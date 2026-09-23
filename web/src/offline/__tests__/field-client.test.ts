import { IDBFactory } from "fake-indexeddb";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { openOfflineStore } from "../store.js";
import { FieldClient, RESTRICTED_SYNC_MESSAGE, type SyncAck } from "../field-client.js";
import { FieldSubmissionQueue } from "../../field/field-submissions.js";

/**
 * Offline durability: edits made in airplane mode persist, and
 * a fresh client built from the same durable store after a "restart"
 * recovers every queued edit. The reconnect-and-reconcile loop against a
 * real server is proven in the server package.
 */

async function clientOn(idb: IDBFactory, name: string): Promise<FieldClient> {
  const store = await openOfflineStore(idb, name);
  return new FieldClient(store);
}

const scope = {
  personId: "11111111-1111-4111-8111-111111111111",
  incidentId: "22222222-2222-4222-8222-222222222222",
};
const otherPerson = { ...scope, personId: "33333333-3333-4333-8333-333333333333" };
const otherIncident = { ...scope, incidentId: "44444444-4444-4444-8444-444444444444" };

class ScriptedSocket {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sentUpdates: string[];

  constructor(
    private readonly serverState: Uint8Array,
    private readonly acknowledge: boolean,
    sentUpdates: string[],
    private readonly conflicts = 0,
  ) {
    this.sentUpdates = sentUpdates;
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }

  send(raw: string): void {
    const message = JSON.parse(raw) as { type: string; operationId?: string; update?: string };
    if (message.type === "auth") {
      queueMicrotask(() => this.onmessage?.({
        data: JSON.stringify({
          type: "state",
          update: btoa(String.fromCharCode(...this.serverState)),
        }),
      } as MessageEvent));
      return;
    }
    this.sentUpdates.push(message.update!);
    queueMicrotask(() => {
      if (!this.acknowledge) {
        this.onerror?.(new Event("error"));
        return;
      }
      this.onmessage?.({
        data: JSON.stringify({
          type: "synced",
          operationId: message.operationId,
          seq: 4,
          conflicts: this.conflicts,
          exact: true,
        }),
      } as MessageEvent);
    });
  }

  close(): void {}
}

function serverState(values: Record<string, unknown>): Uint8Array {
  const doc = new Y.Doc();
  const records = doc.getMap<unknown>("records");
  for (const [key, value] of Object.entries(values)) records.set(key, value);
  return Y.encodeStateAsUpdate(doc);
}

describe("the field client works offline and survives restart", () => {
  it("edits with no network, reads them back, and marks the board pending", async () => {
    const idb = new IDBFactory();
    const client = await clientOn(idb, "db1");
    await client.open(scope, "board-1");
    await client.edit(scope, "board-1", "rec-1", { road: "SR-169", status: "closed" });
    await client.edit(scope, "board-1", "rec-2", { road: "SR-96", status: "one_lane" });

    const records = client.records(scope, "board-1");
    expect(records["rec-1"]).toEqual({ road: "SR-169", status: "closed" });
    expect(records["rec-2"]!.status).toBe("one_lane");
    expect(await client.pendingBoardIds(scope)).toEqual(["board-1"]);
  });

  it("recovers queued edits in a brand-new client after an app restart", async () => {
    const idb = new IDBFactory();
    const first = await clientOn(idb, "db2");
    await first.open(scope, "board-1");
    const operation = await first.edit(
      scope, "board-1", "rec-1", { road: "SR-169", status: "closed" },
    );

    // Simulate an app restart: a new client, same durable store, no memory.
    const revived = await clientOn(idb, "db2");
    await revived.open(scope, "board-1");
    expect(revived.records(scope, "board-1")["rec-1"]).toEqual({ road: "SR-169", status: "closed" });
    expect(await revived.pendingOperations(scope)).toEqual([operation]);
    expect(await revived.pendingBoardIds(otherPerson)).toEqual([]);
    expect(await revived.pendingBoardIds(otherIncident)).toEqual([]);
    await revived.open(otherPerson, "board-1");
    expect(revived.records(otherPerson, "board-1")).toEqual({});
  });

  it("field-level edits from before and after restart merge into one record", async () => {
    const idb = new IDBFactory();
    const first = await clientOn(idb, "db3");
    await first.open(scope, "b");
    await first.edit(scope, "b", "r", { road: "SR-169" });

    const revived = await clientOn(idb, "db3");
    await revived.open(scope, "b");
    await revived.edit(scope, "b", "r", { status: "closed" });
    expect(revived.records(scope, "b")["r"]).toEqual({ road: "SR-169", status: "closed" });
  });

  it("flush pushes the queued state, clears pending, and no-ops when clean", async () => {
    const idb = new IDBFactory();
    const client = await clientOn(idb, "db4");
    await client.open(scope, "board-1");
    const operation = await client.edit(
      scope, "board-1", "rec-1", { road: "SR-169", status: "closed" },
    );

    let pushed: Uint8Array | null = null;
    const push = async (sent: typeof operation, state: Uint8Array): Promise<SyncAck> => {
      expect(sent).toEqual(operation);
      pushed = state;
      return { operationId: sent.operationId, seq: 1, conflicts: 0, exact: true };
    };
    const ack = await client.flush(scope, "board-1", push);
    expect(ack).toEqual({ operationId: operation.operationId, seq: 1, conflicts: 0, exact: true });
    expect(pushed).not.toBeNull();
    // The pushed state carries the edit: decode it into a fresh doc.
    const check = new Y.Doc();
    Y.applyUpdate(check, pushed!);
    expect(check.getMap("records").get("rec-1/road")).toBe("SR-169");
    expect(await client.pendingBoardIds(scope)).toEqual([]);

    // Nothing queued now: a second flush is a no-op.
    let pushedAgain = false;
    const ack2 = await client.flush(scope, "board-1", async () => {
      pushedAgain = true;
      return { operationId: operation.operationId, seq: 2, conflicts: 0, exact: true };
    });
    expect(ack2).toBeNull();
    expect(pushedAgain).toBe(false);
  });

  it("retains pending data when an acknowledgement is not exact", async () => {
    const idb = new IDBFactory();
    const client = await clientOn(idb, "db-mismatch");
    await client.open(scope, "board-1");
    const operation = await client.edit(scope, "board-1", "rec-1", { road: "SR-169" });
    await expect(client.flush(scope, "board-1", async () => ({
      operationId: "55555555-5555-4555-8555-555555555555",
      seq: 9,
      conflicts: 0,
      exact: true,
    }))).rejects.toThrow("does not match");
    expect(await client.pendingOperations(scope)).toEqual([operation]);
  });

  it("retries immutable bytes after a lost acknowledgement while merging newer server state", async () => {
    const idb = new IDBFactory();
    const sent: string[] = [];
    const scripts = [
      { state: serverState({ "remote-1/status": "open" }), acknowledge: false },
      { state: serverState({ "remote-2/status": "closed" }), acknowledge: true },
    ];
    const client = new FieldClient(
      await openOfflineStore(idb, "db-lost-ack"),
      "http://localhost",
      () => {
        const script = scripts.shift()!;
        return new ScriptedSocket(script.state, script.acknowledge, sent) as unknown as WebSocket;
      },
    );
    await client.open(scope, "board-1");
    const operation = await client.edit(scope, "board-1", "local", { status: "assigned" });

    await expect(client.sync(scope, "board-1", "token")).rejects.toThrow("socket error");
    expect((await client.pendingOperations(scope))[0]?.operationId).toBe(operation.operationId);
    expect(await client.sync(scope, "board-1", "token")).toMatchObject({
      operationId: operation.operationId,
      exact: true,
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
    expect(client.records(scope, "board-1")).toMatchObject({
      "remote-1": { status: "open" },
      "remote-2": { status: "closed" },
      local: { status: "assigned" },
    });
  });

  it("keeps an edit made during an in-flight acknowledgement as a separate operation", async () => {
    const client = await clientOn(new IDBFactory(), "db-in-flight");
    await client.open(scope, "board-1");
    const first = await client.edit(scope, "board-1", "record", { status: "open" });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const ack = new Promise<SyncAck>((resolve) => {
      release = () => resolve({ operationId: first.operationId, seq: 1, conflicts: 0, exact: true });
    });
    const inFlight = client.flush(scope, "board-1", async () => {
      entered();
      return ack;
    });
    await started;
    const second = await client.edit(scope, "board-1", "record", { details: "new edit" });
    release();
    await inFlight;

    expect((await client.pendingOperations(scope)).map((item) => item.operationId)).toEqual([
      second.operationId,
    ]);
    const frozen = new Y.Doc();
    const binary = atob(second.update);
    Y.applyUpdate(frozen, Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    expect(frozen.getMap("records").get("record/details")).toBe("new edit");
  });

  it("serializes concurrent edits without losing either board operation", async () => {
    const client = await clientOn(new IDBFactory(), "db-concurrent-edits");
    await Promise.all([client.open(scope, "board-a"), client.open(scope, "board-b")]);
    await Promise.all([
      client.edit(scope, "board-a", "a", { status: "open" }),
      client.edit(scope, "board-b", "b", { status: "closed" }),
    ]);
    expect((await client.pendingOperations(scope)).map((item) => item.boardId)).toEqual([
      "board-a",
      "board-b",
    ]);
  });

  it("caches the session and assigned boards for offline use", async () => {
    const idb = new IDBFactory();
    const client = await clientOn(idb, "db5");
    await client.cacheSession(
      scope,
      { accessToken: "a", resumeToken: "r", personId: scope.personId },
      [{ id: "board-1", title: "Road Closures", templateKey: "road_closures" }],
    );

    const revived = await clientOn(idb, "db5");
    const session = await revived.session(scope);
    expect(session?.resumeToken).toBe("r");
    const boards = await revived.cachedBoards(scope);
    expect(boards).toEqual([
      { id: "board-1", title: "Road Closures", templateKey: "road_closures" },
    ]);
  });
  it("retains exact conflict receipts by board and operation in the same person and incident scope after restart", async () => {
    const idb = new IDBFactory();
    const store = await openOfflineStore(idb, "d29-retained-conflict");
    const fields = new FieldClient(store, "", () =>
      new ScriptedSocket(serverState({}), true, [], 1) as unknown as WebSocket);
    const queue = FieldSubmissionQueue.from(store, fields);
    await queue.enqueue(scope, "board-conflict-a", "record-conflict-a", { status: "blocked" });
    await queue.enqueue(scope, "board-conflict-b", "record-conflict-b", { status: "blocked" });

    await expect(queue.syncOne(scope, "board-conflict-a", "transient-token"))
      .resolves.toMatchObject({ conflicts: 1, operationId: expect.any(String) });
    await expect(queue.sync(scope, "transient-token")).resolves.toMatchObject({
      phase: "conflict", pending: 0, receipt: { conflicts: 1 },
    });
    const retained = await queue.state(scope);
    expect(retained.entries).toHaveLength(2);
    expect(retained.entries?.map((entry) => entry.boardId).sort()).toEqual(["board-conflict-a", "board-conflict-b"]);
    expect(retained.entries?.every((entry) => entry.operationId === entry.receipt.operationId)).toBe(true);
    queue.close();

    const revivedStore = await openOfflineStore(idb, "d29-retained-conflict");
    const revived = FieldSubmissionQueue.from(revivedStore, new FieldClient(revivedStore));
    await expect(revived.state(scope)).resolves.toMatchObject({
      phase: "conflict", pending: 0, receipt: { conflicts: 1 },
    });
    expect((await revived.state(scope)).entries).toHaveLength(2);
    await expect(revived.state(otherPerson)).resolves.toMatchObject({ phase: "ready", pending: 0 });
    revived.close();
  });

  it("keeps legacy aggregate conflict metadata when writing a new receipt entry", async () => {
    const idb = new IDBFactory();
    const store = await openOfflineStore(idb, "d29-legacy-conflict");
    await store.setMeta(`field-submission-conflict:${scope.personId}:${scope.incidentId}`, {
      conflicts: 2,
      receipt: { operationId: "legacy-operation", seq: 3, conflicts: 2, exact: true },
    });
    const fields = new FieldClient(store, "", () =>
      new ScriptedSocket(serverState({}), true, [], 1) as unknown as WebSocket);
    const queue = FieldSubmissionQueue.from(store, fields);
    await queue.enqueue(scope, "board-new", "record-new", { status: "blocked" });
    const state = await queue.sync(scope, "transient-token");
    expect(state).toMatchObject({ phase: "conflict", pending: 0, receipt: { conflicts: 1 } });
    expect(state.message).toContain("3 field submission conflicts");
    expect(state.entries).toMatchObject([{ boardId: "board-new", receipt: { conflicts: 1 } }]);
    queue.close();
  });

  it("tells a restricted board's refusal from an expired session and still delivers other boards", async () => {
    const idb = new IDBFactory();
    const store = await openOfflineStore(idb, "restricted-board");
    const sent: string[] = [];
    const fields = new FieldClient(store, "", (url) => url.includes("/boards/board-restricted?")
      ? new RefusingSocket("records on this board are restricted; use its views") as unknown as WebSocket
      : new ScriptedSocket(serverState({}), true, sent) as unknown as WebSocket);
    const queue = FieldSubmissionQueue.from(store, fields);
    await queue.enqueue(scope, "board-restricted", "record-1", { status: "closed" });
    await queue.enqueue(scope, "board-open", "record-2", { status: "closed" });
    await expect(fields.sync(scope, "board-restricted", "token"))
      .rejects.toMatchObject({ code: "restricted", message: RESTRICTED_SYNC_MESSAGE });

    const state = await queue.sync(scope, "token");
    expect(state).toMatchObject({ phase: "restricted", pending: 1, message: RESTRICTED_SYNC_MESSAGE });
    expect(sent).toHaveLength(1);
    expect(await fields.pendingBoardIds(scope)).toEqual(["board-restricted"]);
    queue.close();
  });

  it("queues photo and audio files with a report and uploads them once its record synchronizes", async () => {
    const idb = new IDBFactory();
    const store = await openOfflineStore(idb, "queued-attachments");
    const fields = new FieldClient(store, "", () =>
      new ScriptedSocket(serverState({}), true, []) as unknown as WebSocket);
    const uploads: Array<{ url: string; init: RequestInit }> = [];
    let refuse = true;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      uploads.push({ url, init });
      if (refuse) return new Response(JSON.stringify({ error: "file store unavailable" }), { status: 503 });
      return new Response(JSON.stringify({ id: "file", field: null }), { status: 201 });
    }) as unknown as typeof fetch;
    const queue = FieldSubmissionQueue.from(store, fields, "https://eoc.example", fetchImpl);
    const photo = new File(["photo bytes"], "culvert.png", { type: "image/png" });
    const voice = new File(["audio bytes"], "crew.wav", { type: "audio/wav" });
    await queue.enqueue(scope, "board-1", "record-1", { summary: "Culvert failure" },
      [{ question: "photo", file: photo }, { question: "crews[0].voice_note", file: voice }]);
    await expect(queue.state(scope)).resolves.toMatchObject({
      phase: "queued", pending: 3, message: "1 field submission and 2 attachments queued on this device.",
    });

    // The record synchronizes; the refused upload stays queued with the server's reason.
    const refused = await queue.sync(scope, "transient-token");
    expect(refused).toMatchObject({ phase: "failed", pending: 2 });
    expect(refused.message).toBe("culvert.png was not uploaded: file store unavailable. It stays queued.");
    queue.close();

    // After a restart the files are still on the device and upload on the next pass.
    const revivedStore = await openOfflineStore(idb, "queued-attachments");
    const revived = FieldSubmissionQueue.from(revivedStore, new FieldClient(revivedStore), "https://eoc.example", fetchImpl);
    await expect(revived.state(scope)).resolves.toMatchObject({ pending: 2, message: "2 attachments queued on this device." });
    refuse = false;
    await expect(revived.sync(scope, "transient-token")).resolves.toMatchObject({ phase: "synced", pending: 0 });
    const sent = uploads.slice(1);
    expect(sent.map((upload) => upload.url)).toEqual([
      "https://eoc.example/api/v1/forms/records/record-1/attachments",
      "https://eoc.example/api/v1/forms/records/record-1/attachments",
    ]);
    expect(sent[0]!.init).toMatchObject({ method: "POST", headers: { authorization: "Bearer transient-token" } });
    const form = sent[1]!.init.body as FormData;
    expect(form.get("question")).toBe("crews[0].voice_note");
    expect(await (form.get("file") as File).text()).toBe("audio bytes");
    expect((form.get("file") as File).name).toBe("crew.wav");

    // A file over the per-attachment cap is refused before anything is queued.
    const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" });
    await expect(revived.enqueue(scope, "board-1", "record-2", { summary: "Too big" }, [{ question: "photo", file: huge }]))
      .rejects.toThrow("huge.png is larger than the 10 MB a queued attachment may be.");
    await expect(revived.state(scope)).resolves.toMatchObject({ phase: "ready", pending: 0 });
    revived.close();
  });
});

/** A server that refuses the sync right after authentication. */
class RefusingSocket {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(private readonly error: string) {
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }

  send(): void {
    queueMicrotask(() => this.onmessage?.({
      data: JSON.stringify({ type: "error", error: this.error, code: this.error.startsWith("records on this board are restricted") ? "restricted" : "auth_required" }),
    } as MessageEvent));
  }

  close(): void {}
}
