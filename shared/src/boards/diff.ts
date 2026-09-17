import type { BoardTemplate, FieldDef, ViewDef } from "./fields.js";

export interface TemplateDiff {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly addedFields: readonly string[];
  readonly removedFields: readonly string[];
  readonly changedFields: readonly string[];
  readonly addedViews: readonly string[];
  readonly removedViews: readonly string[];
  readonly changedViews: readonly string[];
}

function byKey<T extends { key: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((i) => [i.key, i]));
}

function changed(a: FieldDef | ViewDef, b: FieldDef | ViewDef): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Structural diff between two template versions: what an administrator
 * reviews before saving, and what the ledger of a board's history shows.
 */
export function templateDiff(prev: BoardTemplate, next: BoardTemplate): TemplateDiff {
  const prevFields = byKey(prev.fields);
  const nextFields = byKey(next.fields);
  const prevViews = byKey(prev.views);
  const nextViews = byKey(next.views);
  return {
    fromVersion: prev.version,
    toVersion: next.version,
    addedFields: [...nextFields.keys()].filter((k) => !prevFields.has(k)),
    removedFields: [...prevFields.keys()].filter((k) => !nextFields.has(k)),
    changedFields: [...nextFields.keys()].filter(
      (k) => prevFields.has(k) && changed(prevFields.get(k)!, nextFields.get(k)!),
    ),
    addedViews: [...nextViews.keys()].filter((k) => !prevViews.has(k)),
    removedViews: [...prevViews.keys()].filter((k) => !nextViews.has(k)),
    changedViews: [...nextViews.keys()].filter(
      (k) => prevViews.has(k) && changed(prevViews.get(k)!, nextViews.get(k)!),
    ),
  };
}

/**
 * Rollback: a draft that restores a prior version's content under a new
 * version number. History is never rewritten; going back is going forward
 * to old content (the same rule the audit substrate follows).
 */
export function rollbackDraft(target: BoardTemplate, currentVersion: number): BoardTemplate {
  return { ...target, version: currentVersion + 1 };
}
