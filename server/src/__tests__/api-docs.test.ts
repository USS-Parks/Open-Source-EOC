import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateApiDocs } from "@openeoc/shared";

/**
 * The published API docs are generated from the frozen contract, never
 * hand-edited (VEOC-31, INV-4/INV-9). This test regenerates them and holds
 * the committed docs/API.md to the output, so the two cannot drift. To
 * refresh the file after a contract change, run vitest with UPDATE_DOCS=1.
 */

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "API.md");

describe("generated API docs", () => {
  it("docs/API.md is current with the contract", () => {
    const generated = generateApiDocs();
    if (process.env.UPDATE_DOCS) writeFileSync(DOCS, generated);
    const onDisk = readFileSync(DOCS, "utf8");
    expect(onDisk).toBe(generated);
  });
});
