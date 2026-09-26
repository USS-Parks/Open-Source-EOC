import type { FastifyInstance, FastifyRequest } from "fastify";
import { ContactAreaQuerySchema, type ContactArea } from "@openeoc/shared";
import { z } from "zod";
import { AuthError, requireWriter } from "../auth/service.js";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";

/**
 * Notify people in an area, after Juvare's geoalerting: the jurisdiction's
 * active contacts whose known location lies inside an area drawn on the map.
 * A contact is where its set point is, else where its address placed when
 * it was saved (contacts/placement.ts); the search reads only those stored
 * points and never waits on the gazetteer. People are reached through the
 * contact linked to them. Only those who may send a mass notification ask,
 * row-level security reads the contacts, and the answer carries each
 * contact's name and channels, never where the contact is.
 */

const Params = z.object({ jurisdictionId: z.string().uuid() });

export type AreaChannel = "email" | "sms" | "inapp";

export interface ContactsInArea {
  readonly contacts: readonly { readonly id: string; readonly name: string; readonly channels: readonly AreaChannel[] }[];
  /** Contacts with an address that did not place and no set point, who may be inside. */
  readonly unplaced: number;
}

type Row = {
  id: string; name: string; emails: string[]; phones: string[]; person_id: string | null; position_id: string | null;
  inside: boolean | null;
};

/**
 * The contacts inside the area, inside the caller's transaction. The area is
 * an uncorrelated subquery, so Postgres builds it once per search (an
 * InitPlan) even under a generic plan, not once per contact.
 */
// ponytail: a sequential point-in-polygon test over the jurisdiction's contacts, well under a second for tens of thousands; add a GiST index on coalesce(location, address_point) if a directory outgrows that.
export async function contactsInArea(tx: Sql, jurisdictionId: string, area: ContactArea): Promise<ContactsInArea> {
  const geojson = JSON.stringify(area);
  const [shape] = await tx`select ST_IsValid(ST_GeomFromGeoJSON(${geojson})) as valid`;
  if (!shape?.valid) throw new AuthError(422, "the area's outline is not a valid shape: it crosses itself or its parts overlap; draw it again");
  const rows = await tx<Row[]>`
    select id, name, emails, phones, person_id, position_id,
      ST_Intersects(coalesce(location, address_point), (select ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326))) as inside
    from contacts
    where jurisdiction_id = ${jurisdictionId} and active and (location is not null or address is not null)
    order by name, id`;
  return {
    contacts: rows.filter((row) => row.inside).map((row) => ({
      id: row.id,
      name: row.name,
      channels: [
        ...(row.emails.length ? ["email" as const] : []),
        ...(row.phones.length ? ["sms" as const] : []),
        ...(row.person_id || row.position_id ? ["inapp" as const] : []),
      ],
    })),
    unplaced: rows.filter((row) => row.inside === null).length,
  };
}

export function areaContactRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post("/api/v1/jurisdictions/:jurisdictionId/contacts/in-area", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = Params.parse(req.params);
    // Who is where is for those who may notify them, as sending is.
    requireWriter(req.principal, jurisdictionId);
    const { area } = ContactAreaQuerySchema.parse(req.body);
    return reply.send(await withPerson(sql, req.principal.person.id, (tx) => contactsInArea(tx, jurisdictionId, area)));
  });
}
