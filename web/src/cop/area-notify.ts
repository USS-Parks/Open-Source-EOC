import { MASS_SEND_MAX_RECIPIENTS } from "@openeoc/shared";
import type { ApiClient } from "../app/api/client.js";
import type { ComposerPrefill } from "../contacts/MassNotificationSurface.js";
import type { MassChannel } from "../contacts/model.js";

/**
 * Notify people in an area, after Juvare's geoalerting: the map's
 * drawn area goes to the server, which answers with the jurisdiction's
 * contacts whose known location lies inside it, and the mass notification
 * composer opens with them selected. Nothing is sent here: the person
 * writes the message and presses Send in the composer.
 */

type Ring = readonly (readonly [number, number])[];

export type AreaPolygon =
  | { readonly type: "Polygon"; readonly coordinates: readonly Ring[] }
  | { readonly type: "MultiPolygon"; readonly coordinates: readonly (readonly Ring[])[] };

/** The server's answer: names and channels, never where anyone is. */
export interface ContactsInArea {
  readonly contacts: readonly { readonly id: string; readonly name: string; readonly channels: readonly MassChannel[] }[];
  /** Contacts with an address that did not place and no set point, who may be inside. */
  readonly unplaced: number;
}

/** A longitude brought into -180 to 180, as a map panned round the world reports it beyond that. */
const wrap = (lng: number) => (lng < -180 || lng > 180 ? ((((lng + 180) % 360) + 360) % 360) - 180 : lng);

/** A drawn outline, open as the map's drawing keeps it, as a closed polygon. */
export function areaFromVertices(vertices: readonly (readonly [number, number])[]): Extract<AreaPolygon, { type: "Polygon" }> {
  if (vertices.length < 3) throw new Error("Draw at least three corners around the area.");
  const ring = vertices.map(([lng, lat]) => [wrap(lng), lat] as const);
  const [first] = ring;
  const last = ring.at(-1)!;
  const closed = first![0] === last[0] && first![1] === last[1];
  return { type: "Polygon", coordinates: [closed ? ring : [...ring, first!]] };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The composer's prefill: the contacts found, selected, and a note of what the search could not see. */
export function areaPrefill(found: ContactsInArea): ComposerPrefill {
  const unreachable = found.contacts.filter((c) => c.channels.length === 0).length;
  const note = [
    found.contacts.length
      ? `${plural(found.contacts.length, "contact", "contacts")} whose known location is in the drawn area ${found.contacts.length === 1 ? "is" : "are"} selected below.`
      : "No contact's known location is in the drawn area.",
    unreachable ? `${plural(unreachable, "has", "have")} no email, phone or app link.` : "",
    found.contacts.length > MASS_SEND_MAX_RECIPIENTS
      ? `One send reaches at most ${MASS_SEND_MAX_RECIPIENTS} contacts: draw a smaller area or send in parts.` : "",
    found.unplaced ? `${plural(found.unplaced, "contact's address", "contacts' addresses")} could not be placed on the map and may be inside.` : "",
    "Nothing is sent until you press Send notification.",
  ].filter(Boolean).join(" ");
  return { contactIds: found.contacts.map((c) => c.id), note };
}

/**
 * Finds who is in the area and opens the composer with them selected;
 * `open` shows the Mass Notification screen with the prefill. Resolves with
 * the server's answer; rejects, opening nothing, when the search fails.
 */
export async function notifyPeopleInArea(
  client: Pick<ApiClient, "contactsInArea">,
  jurisdictionId: string,
  area: AreaPolygon,
  open: (prefill: ComposerPrefill) => void,
): Promise<ContactsInArea> {
  const found = await client.contactsInArea(jurisdictionId, area);
  open(areaPrefill(found));
  return found;
}
