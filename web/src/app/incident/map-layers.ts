import type { BoardListItem, CollectionRef } from "../api/client.js";

/**
 * The map's layers for the selected incident: only boards known to be in its
 * scope, the jurisdiction's standing boards (which serve no incident) and the
 * incident's own. A board of another incident, a partner organization's own
 * board or a board another organization granted as a guest stays off. With
 * no incident selected, every layer the caller can read.
 */
export function layersInScope<T extends { readonly id: string }>(
  collections: readonly T[],
  boards: readonly BoardListItem[],
  incidentId: string | null,
  incidentBoardIds: ReadonlySet<string>,
): T[] {
  if (!incidentId) return [...collections];
  const standing = new Set(boards.filter((board) => board.incidentIds?.length === 0).map((board) => board.id));
  return collections.filter((collection) => standing.has(collection.id) || incidentBoardIds.has(collection.id));
}

/**
 * The incident a layer's items and tiles are read through: the selected one
 * when the caller holds no role on the board and reaches it through that
 * incident. A board the caller holds a role on is read as its board views
 * are, every record the caller may read, whether or not it names an incident.
 */
export function layerReadScope(
  collection: Pick<CollectionRef, "incidentIds"> | undefined,
  incidentId: string | null | undefined,
): string | undefined {
  return incidentId && collection?.incidentIds?.includes(incidentId) ? incidentId : undefined;
}
