import type { ContinuityScope } from "./field-client.js";

const EVENT = "openeoc:offline-queue-change";

export function notifyOfflineQueueChange(scope: ContinuityScope): void {
  if (typeof CustomEvent === "undefined" || typeof dispatchEvent !== "function") return;
  dispatchEvent(new CustomEvent<ContinuityScope>(EVENT, { detail: scope }));
}

/** Subscribe only to durable work for one person and incident. */
export function subscribeOfflineQueueChange(
  scope: ContinuityScope,
  listener: () => void,
): () => void {
  if (typeof addEventListener !== "function") return () => {};
  const onChange = (event: Event) => {
    const changed = (event as CustomEvent<ContinuityScope>).detail;
    if (changed?.personId === scope.personId && changed.incidentId === scope.incidentId) listener();
  };
  addEventListener(EVENT, onChange);
  return () => removeEventListener(EVENT, onChange);
}
