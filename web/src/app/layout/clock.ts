/**
 * This device's clock against the server's. Every API answer carries the
 * server's time in its Date header, to the second; the offset is that time
 * less the middle of the request on this device's clock. Two-step codes
 * accept one 30-second step either way, and the server settles competing
 * edits by its own clock, so a device more than 30 seconds off is told.
 */

/** How far a device's clock may differ from the server's before the console says so. */
export const CLOCK_TOLERANCE_MS = 30_000;

/** A measure over a slower round trip than this says too little to act on. */
const MAX_ROUND_TRIP_MS = 5_000;

/**
 * The server's clock less this device's, in milliseconds, from one answer:
 * positive when this device is behind. Null when the answer has no usable
 * Date header or took too long to say.
 */
export function clockOffsetMs(dateHeader: string | null, sentAt: number, receivedAt: number): number | null {
  if (!dateHeader) return null;
  const server = Date.parse(dateHeader);
  if (Number.isNaN(server) || receivedAt < sentAt || receivedAt - sentAt > MAX_ROUND_TRIP_MS) return null;
  // The header drops the milliseconds, so the middle of its second is the best guess.
  return server + 500 - (sentAt + receivedAt) / 2;
}

/** Whether an offset is past the tolerance. */
export function clockOff(offsetMs: number | null): boolean {
  return offsetMs !== null && Math.abs(offsetMs) > CLOCK_TOLERANCE_MS;
}

function unit(count: number, name: string): string {
  return `${count} ${name}${count === 1 ? "" : "s"}`;
}

/** An offset in words, to the second under an hour and to the minute past it: "2 minutes 5 seconds", "3 hours 2 minutes". */
export function describeOffset(offsetMs: number): string {
  const seconds = Math.round(Math.abs(offsetMs) / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (days > 0) return hours > 0 ? `${unit(days, "day")} ${unit(hours, "hour")}` : unit(days, "day");
  if (hours > 0) return minutes > 0 ? `${unit(hours, "hour")} ${unit(minutes, "minute")}` : unit(hours, "hour");
  if (minutes > 0) return rest > 0 ? `${unit(minutes, "minute")} ${unit(rest, "second")}` : unit(minutes, "minute");
  return unit(rest, "second");
}

/** The notice's first sentence: "This device's clock is 2 minutes behind the server's." */
export function clockNoticeText(offsetMs: number): string {
  return `This device's clock is ${describeOffset(offsetMs)} ${offsetMs > 0 ? "behind" : "ahead of"} the server's.`;
}
