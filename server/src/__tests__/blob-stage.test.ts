import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { BlobStore } from "../files/service.js";

/** A refused upload leaves no staging file behind, even while Windows still closes its handle. */
const root = mkdtempSync(join(tmpdir(), "openeoc-stage-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("upload staging", () => {
  it("removes the staging file of an upload over the limit before it refuses it", async () => {
    const store = new BlobStore(root);
    for (let i = 0; i < 25; i += 1) {
      const chunks = Array.from({ length: 8 }, () => Buffer.alloc(4096, 120));
      await expect(store.stage(Readable.from(chunks), 10_000)).rejects.toThrow("file exceeds the 10000 byte limit");
      expect(readdirSync(root).filter((name) => name.startsWith(".upload-"))).toEqual([]);
    }
  });
});
