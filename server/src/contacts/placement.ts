import type { Sql } from "../db/client.js";
import type { Gazetteer } from "../geocode/gazetteer.js";

/**
 * Where a contact's address is on the map, found once when the address is
 * saved so the area search never waits on the gazetteer. The jurisdiction
 * has no boundary of its own, so its known extent stands in: its incidents'
 * operational areas and its contacts' set points, widened by a margin. The
 * extent's middle breaks ties, and an address is placed only at one house
 * number inside it: an address found at two, found only as a street or a
 * town, or found only outside the extent is left unplaced, as is every
 * address while the jurisdiction has no extent yet.
 */

/** Degrees past the jurisdiction's known extent an address may still be placed, about 20 to 28 km. */
const MARGIN = 0.25;

const STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP"
    .split(" "),
);

/**
 * An address as the gazetteer reads it: without a trailing ZIP code, or a
 * state after a comma or before the ZIP code. The gazetteer holds neither,
 * so either would keep "816 3rd St, Eureka, CA 95501" from matching.
 */
export function searchableAddress(address: string): string {
  let text = address.trim();
  const zip = /[\s,]+\d{5}(?:-\d{4})?$/.exec(text);
  if (zip) text = text.slice(0, zip.index);
  const state = /(,\s*|\s+)([A-Za-z]{2})$/.exec(text);
  if (state && STATES.has(state[2]!.toUpperCase()) && (zip !== null || state[1]!.includes(","))) text = text.slice(0, state.index);
  return text.replace(/[\s,]+$/, "");
}

/** The point an address places at, as [longitude, latitude], or null when it does not place. */
export async function placeAddress(
  tx: Sql,
  gazetteer: Gazetteer | null,
  jurisdictionId: string,
  address: string | null,
): Promise<[number, number] | null> {
  if (!gazetteer || !address) return null;
  const [extent] = await tx<{ w: number | null; s: number; e: number; n: number }[]>`
    select ST_XMin(x) as w, ST_YMin(x) as s, ST_XMax(x) as e, ST_YMax(x) as n from (
      select ST_Extent(g) as x from (
        select a.geometry as g from incident_area_revisions a join incidents i on i.id = a.incident_id
        where i.jurisdiction_id = ${jurisdictionId} and a.geometry is not null
        union all
        select location from contacts where jurisdiction_id = ${jurisdictionId} and location is not null
      ) known
    ) extent`;
  if (!extent || extent.w === null) return null;
  const [w, s, e, n] = [extent.w - MARGIN, extent.s - MARGIN, extent.e + MARGIN, extent.n + MARGIN];
  const [first, second] = gazetteer.search(searchableAddress(address), { limit: 2, near: [(w + e) / 2, (s + n) / 2] });
  if (first?.kind !== "address" || second?.kind === "address") return null;
  return first.lon >= w && first.lon <= e && first.lat >= s && first.lat <= n ? [first.lon, first.lat] : null;
}
