import type { BoardListItem, MemberRole } from "../app/api/client.js";

/** Human labels for the administration screen; raw keys never lead a row. */

export const ROLE_LABELS: Readonly<Record<MemberRole, string>> = {
  admin: "Administrator",
  member: "Member",
  viewer: "Viewer",
};

export const INTEGRATION_LABELS: Readonly<Record<string, string>> = {
  collab: "Collaboration channels",
  facilities: "Facilities and shelters",
  meetings: "Meetings and briefings",
  tracking: "Patient, evacuee and asset tracking",
};

export const DATA_CLASS_LABELS: Readonly<Record<string, string>> = {
  notifications: "Notifications",
  deliveries: "Outbound deliveries",
  feed_items: "Feed items",
  tracking: "Tracking records",
  staff_checkins: "Staff check-ins",
};

/** A guest grant scope in words: positions, or read access to one board. */
export function scopeLabel(scope: string, boards: readonly BoardListItem[]): string {
  if (scope === "positions:read") return "Read positions";
  const board = /^board:(.+):read$/.exec(scope)?.[1];
  if (board) return `Read board: ${boards.find((b) => b.id === board)?.title ?? "a board no longer listed"}`;
  return "Other access";
}

/** Save a generated file through the browser's download flow. */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
