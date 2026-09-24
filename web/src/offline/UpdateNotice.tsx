import { useState, useSyncExternalStore } from "react";
import { ActionButton } from "../design/controls.js";
import { applyUpdate, onUpdateWaiting, updateWaiting } from "./register.js";
import "./update-notice.css";

/** Small notice shown while a new build waits; the operator picks the moment to switch. */
export function UpdateNotice() {
  const ready = useSyncExternalStore(onUpdateWaiting, updateWaiting);
  const [later, setLater] = useState(false);
  // The browser switches once the running version has finished its requests, which can take a moment.
  const [switching, setSwitching] = useState(false);
  if (!ready || later) return null;
  return (
    <div className="eoc-update-notice" role="status" aria-label="App update">
      <p>A new version is ready.</p>
      <div>
        <ActionButton kind="quiet" disabled={switching} onClick={() => setLater(true)}>Later</ActionButton>
        <ActionButton kind="primary" loading={switching} loadingLabel="Switching…" onClick={() => { setSwitching(true); applyUpdate(); }}>
          Reload
        </ActionButton>
      </div>
    </div>
  );
}
