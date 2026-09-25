/**
 * Where a piece of work stands, in the one vocabulary every form uses: a
 * draft kept on this device, work saved on this device and waiting to be
 * sent, work the server has received, or a send that failed, with its reason
 * and a retry. A spinner that goes away is never the only answer to "did it
 * save?".
 */
export type WorkState =
  | { readonly kind: "empty" }
  | { readonly kind: "draft"; readonly savedAt: string; readonly restored?: boolean }
  | { readonly kind: "queued"; readonly savedAt: string }
  | { readonly kind: "sending" }
  | { readonly kind: "received"; readonly at: string; readonly reference?: string }
  /** A failed send; the work stays on this device, or only in the form when no draft store holds it. */
  | { readonly kind: "failed"; readonly reason: string; readonly keptInForm?: boolean };

function clock(iso: string): string {
  const at = new Date(iso);
  const today = at.toDateString() === new Date().toDateString();
  return at.toLocaleString([], today
    ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
    : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** "session expired" reads as "Session expired." */
function sentence(text: string): string {
  const trimmed = text.trim();
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? "" : "."}`;
}

export function workStateText(state: WorkState): string {
  switch (state.kind) {
    case "empty": return "";
    case "draft": return state.restored
      ? `Draft restored from this device, saved ${clock(state.savedAt)}. Not sent yet.`
      : `Draft saved on this device at ${clock(state.savedAt)}. Not sent yet.`;
    case "queued": return `Saved on this device at ${clock(state.savedAt)}; it is sent when the connection returns.`;
    case "sending": return "Sending to the server…";
    case "received": return `Received by the server at ${clock(state.at)}${state.reference ? ` as ${state.reference}` : ""}.`;
    case "failed": return `Not sent: ${sentence(state.reason)} ${state.keptInForm ? "Your values remain in this form." : "Your work is kept on this device."}`;
  }
}

/** The state line under a form, with a retry when a send failed. */
export function WorkStateLine(props: { readonly state: WorkState; readonly onRetry?: () => void }) {
  if (props.state.kind === "empty") return null;
  return (
    <p className="eoc-work-state" role={props.state.kind === "failed" ? "alert" : "status"} data-state={props.state.kind}>
      {workStateText(props.state)}
      {props.state.kind === "failed" && props.onRetry ? <> <button type="button" className="eoc-work-state-retry" onClick={props.onRetry}>Retry</button></> : null}
    </p>
  );
}
