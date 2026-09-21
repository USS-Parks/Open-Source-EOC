export interface DraftScope {
  readonly personId: string;
  readonly incidentId: string;
  readonly formId: string;
  readonly recordId: string | null;
  readonly schema: string;
}

export interface DraftRecord {
  readonly values: Readonly<Record<string, unknown>>;
  readonly savedAt: string;
}

export interface ScopedDraftStore {
  load(scope: DraftScope): Promise<DraftRecord | null>;
  save(scope: DraftScope, values: Readonly<Record<string, unknown>>): Promise<DraftRecord>;
  clear(scope: DraftScope): Promise<void>;
}

export interface MetadataDraftBackend {
  getMeta<T>(key: string): Promise<T | null>;
  setMeta(key: string, value: unknown): Promise<void>;
}

interface StoredDraft {
  readonly version: 1;
  readonly scope: DraftScope;
  readonly values: Readonly<Record<string, unknown>>;
  readonly savedAt: string;
}

function scopeParts(scope: DraftScope): readonly string[] {
  return [
    scope.personId,
    scope.incidentId,
    scope.formId,
    scope.recordId ?? "new",
    scope.schema,
  ];
}

export function draftScopeKey(scope: DraftScope): string {
  const values = scopeParts(scope);
  if (values.some((value) => value.trim().length === 0)) {
    throw new Error("Draft scope values must be non-empty");
  }
  return `design-draft:v1:${values.map((value) => encodeURIComponent(value)).join(":")}`;
}

function sameScope(left: DraftScope, right: DraftScope): boolean {
  return scopeParts(left).every((value, index) => value === scopeParts(right)[index]);
}

/**
 * Thin adapter over OfflineStore metadata methods. Writes are serialized per
 * exact scope so a slower older save can never overwrite a newer value.
 */
export function createMetadataDraftStore(backend: MetadataDraftBackend): ScopedDraftStore {
  const writes = new Map<string, Promise<void>>();

  function enqueue(key: string, write: () => Promise<void>): Promise<void> {
    const previous = writes.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(write);
    writes.set(key, next);
    void next.finally(() => {
      if (writes.get(key) === next) writes.delete(key);
    }).catch(() => undefined);
    return next;
  }

  return {
    async load(scope) {
      const key = draftScopeKey(scope);
      await (writes.get(key) ?? Promise.resolve()).catch(() => undefined);
      const stored = await backend.getMeta<StoredDraft>(key);
      if (!stored || stored.version !== 1 || !sameScope(stored.scope, scope)) return null;
      return { values: { ...stored.values }, savedAt: stored.savedAt };
    },

    async save(scope, values) {
      const key = draftScopeKey(scope);
      const record: StoredDraft = {
        version: 1,
        scope: { ...scope },
        values: { ...values },
        savedAt: new Date().toISOString(),
      };
      await enqueue(key, () => backend.setMeta(key, record));
      return { values: record.values, savedAt: record.savedAt };
    },

    async clear(scope) {
      const key = draftScopeKey(scope);
      await enqueue(key, () => backend.setMeta(key, null));
    },
  };
}
