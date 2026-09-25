import { useEffect, useState } from "react";
import { createMetadataDraftStore, type ScopedDraftStore } from "../design/form-drafts.js";
import { openOfflineStore } from "./store.js";

/** Drafts kept on this device, in the offline store; a test injects its own store. */
export function useDraftStore(injected?: ScopedDraftStore): { store: ScopedDraftStore | null; error: string | null } {
  const [local, setLocal] = useState<ScopedDraftStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (injected) return;
    if (typeof indexedDB === "undefined") {
      setError("Draft storage is unavailable in this browser.");
      return;
    }
    let active = true;
    let close: (() => void) | null = null;
    void openOfflineStore().then((store) => {
      close = store.close;
      if (!active) {
        store.close();
        return;
      }
      setLocal(createMetadataDraftStore(store));
      setError(null);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Draft storage is unavailable.");
    });
    return () => {
      active = false;
      close?.();
    };
  }, [injected]);
  return { store: injected ?? local, error };
}
