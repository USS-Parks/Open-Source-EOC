import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client.js";
import { clockNoticeText, clockOff } from "./clock.js";

/**
 * The console's notice that this device's clock and the server's differ by
 * more than 30 seconds, measured on every API answer. It clears itself when a
 * later answer finds the clocks together; Dismiss hides it until the offset
 * changes by another 30 seconds or the page reloads.
 */
export function ClockNotice({ client }: { readonly client: Pick<ApiClient, "serverClockOffset" | "onServerClock"> }) {
  const [offset, setOffset] = useState<number | null>(() => client.serverClockOffset());
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  useEffect(() => client.onServerClock(setOffset), [client]);
  if (offset === null || !clockOff(offset)) return null;
  if (dismissedAt !== null && Math.abs(offset - dismissedAt) <= 30_000) return null;
  return (
    <div className="eoc-clock-notice" role="status">
      <p>
        <strong>{clockNoticeText(offset)}</strong> Two-step sign-in codes can be refused and times on screen
        can be wrong until one of them is set right. On this device, set the date and time to update
        automatically; if other devices show this too, ask an administrator to check the server's clock.
      </p>
      <button type="button" className="eoc-kit-button is-quiet" onClick={() => setDismissedAt(offset)}>Dismiss</button>
    </div>
  );
}
