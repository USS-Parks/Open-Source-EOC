import { describe, expect, it } from "vitest";
import {
  createMetadataDraftStore,
  draftScopeKey,
  type DraftScope,
  type MetadataDraftBackend,
} from "../form-drafts.js";

const scope: DraftScope = {
  personId: "person-a",
  incidentId: "incident-a",
  formId: "request",
  recordId: null,
  schema: "v1",
};

function memoryBackend(): MetadataDraftBackend & { readonly values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    async getMeta<T>(key: string) { return (values.get(key) as T | undefined) ?? null; },
    async setMeta(key: string, value: unknown) { values.set(key, value); },
  };
}

describe("scoped metadata drafts", () => {
  it("separates person, incident, form, record, and schema contexts", () => {
    const keys = [
      scope,
      { ...scope, personId: "person-b" },
      { ...scope, incidentId: "incident-b" },
      { ...scope, formId: "assessment" },
      { ...scope, recordId: "record-a" },
      { ...scope, schema: "v2" },
    ].map(draftScopeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(() => draftScopeKey({ ...scope, personId: "" })).toThrow("non-empty");
  });

  it("round-trips and clears a scoped draft", async () => {
    const backend = memoryBackend();
    const store = createMetadataDraftStore(backend);
    await store.save(scope, { summary: "Generator request" });
    expect((await store.load(scope))?.values).toEqual({ summary: "Generator request" });
    expect(await store.load({ ...scope, incidentId: "other" })).toBeNull();
    await store.clear(scope);
    expect(await store.load(scope)).toBeNull();
  });

  it("serializes writes so a slower older value cannot overwrite a newer value", async () => {
    const values = new Map<string, unknown>();
    const completions: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let call = 0;
    const store = createMetadataDraftStore({
      async getMeta<T>(key: string) { return (values.get(key) as T | undefined) ?? null; },
      async setMeta(key, value) {
        call += 1;
        const current = call;
        if (current === 1) await firstGate;
        values.set(key, value);
        completions.push(`write-${current}`);
      },
    });
    const older = store.save(scope, { summary: "older" });
    const newer = store.save(scope, { summary: "newer" });
    await Promise.resolve();
    expect(completions).toEqual([]);
    releaseFirst?.();
    await Promise.all([older, newer]);
    expect(completions).toEqual(["write-1", "write-2"]);
    expect((await store.load(scope))?.values).toEqual({ summary: "newer" });
  });
});
