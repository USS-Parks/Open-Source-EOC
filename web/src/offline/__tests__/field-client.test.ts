import { IDBFactory } from "fake-indexeddb";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { openOfflineStore } from "../store.js";
import { FieldClient, type SyncAck } from "../field-client.js";

/**
 * Offline durability (VEOC-21): edits made in airplane mode persist, and
 * a fresh client built from the same durable store after a "restart"
 * recovers every queued edit. The reconnect-and-reconcile loop against a
 * real server is proven in the server package.
 */

async function clientOn(idb: IDBFactory, name: string): Promise<FieldClient> {
  const store = await openOfflineStore(idb, name);
  return new FieldClient(store);
}

describe("the field client works offline and survives restart", () => {
  it("edits with no network, reads them back, and marks the board pending", async () => {
    const idb = new IDBFactory();
    const client = await clientOn(idb, "db1");
    await client.open("board-1");
    await client.edit("board-1", "rec-1", { road: "SR-169", status: "closed" });
    await client.edit("board-1", "rec-2", { road: "SR-96", status: "one_lane" });

    const records = client.records("board-1");
    expect(records["rec-1"]).toEqual({ road: "SR-169", status: "closed" });
    expect(records["rec-2"]!.status).toBe("one_lane");
    expect(await client.pendingBoardIds()).toEqual(["board-1"]);
  });

  it("recovers queued edits in a brand-new client after an app restart", async () => {
    const idb = new IDBFactory();
    const first = await clientOn(idb, "db2");
    await first.open("board-1");
    await first.edit("board-1", "rec-1", { road: "SR-169", status: "closed" });

    // Simulate an app restart: a new client, same durable store, no memory.
    const revived = await clientOn(idb, "db2");
    await revived.open("board-1");
    expect(revived.records("board-1")["rec-1"]).toEqual({ road: "SR-169", status: "closed" });
    expect(await revived.pendingBoardIds()).toEqual(["board-1"]);
  });

  it("field-level edits from before and after restart merge into one record", async () => {
    const idb = new IDBFactory();
    const first = await clientOn(idb, "db3");
    await first.open("b");
    await first.edit("b", "r", { road: "SR-169" });

    const revived = await clientOn(idb, "db3");
    await revived.open("b");
    await revived.edit("b", "r", { status: "closed" });
    expect(revived.records("b")["r"]).toEqual({ road: "SR-169", status: "closed" });
  });

  it("flush pushes the queued state, clears pending, and no-ops when clean", async () => {
    const idb = new IDBFactory();
    const client = await clientOn(idb, "db4");
    await client.open("board-1");
    await client.edit("board-1", "rec-1", { road: "SR-169", status: "closed" });

    let pushed: Uint8Array | null = null;
    const push = async (state: Uint8Array): Promise<SyncAck> => {
      pushed = state;
      return { seq: 1, conflicts: 0 };
    };
    const ack = await client.flush("board-1", push);
    expect(ack).toEqual({ seq: 1, conflicts: 0 });
    expect(pushed).not.toBeNull();
    // The pushed state carries the edit: decode it into a fresh doc.
    const check = new Y.Doc();
    Y.applyUpdate(check, pushed!);
    expect(check.getMap("records").get("rec-1/road")).toBe("SR-169");
    expect(await client.pendingBoardIds()).toEqual([]);

    // Nothing queued now: a second flush is a no-op.
    let pushedAgain = false;
    const ack2 = await client.flush("board-1", async () => {
      pushedAgain = true;
      return { seq: 2, conflicts: 0 };
    });
    expect(ack2).toBeNull();
    expect(pushedAgain).toBe(false);
  });

  it("caches the session and assigned boards for offline use", async () => {
    const idb = new IDBFactory();
    const client = await clientOn(idb, "db5");
    await client.cacheSession(
      { accessToken: "a", resumeToken: "r", personId: "p" },
      [{ id: "board-1", title: "Road Closures", templateKey: "road_closures" }],
    );

    const revived = await clientOn(idb, "db5");
    const session = await revived.session();
    expect(session?.resumeToken).toBe("r");
    const boards = await revived.cachedBoards();
    expect(boards).toEqual([
      { id: "board-1", title: "Road Closures", templateKey: "road_closures" },
    ]);
  });
});
