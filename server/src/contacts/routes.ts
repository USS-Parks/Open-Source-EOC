import type { FastifyInstance, FastifyRequest } from "fastify";
import { ContactInputSchema as ContactBody, type ContactInputBody as ContactInput } from "@openeoc/shared";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, pageQuery } from "../db/cursor.js";
import { AuthError, requireAdmin, requireMember } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import type { Gazetteer } from "../geocode/gazetteer.js";
import { IMPORT_FIELDS, guessMapping, parseCsv, readRows, type ImportMapping } from "./csv.js";
import { placeAddress } from "./placement.js";

/**
 * The contacts directory: people to reach during an incident, whether or not
 * they hold an account, and named groups of them in call-down order. Members
 * of the jurisdiction read it; its admins maintain it. Row-level security
 * holds the same line in the database. Where a contact is (its address, its
 * set map point and the point its address placed at) is read only by the
 * jurisdiction's writers, who may notify it, as volunteers' reach details
 * are; viewers read those as null, and group lists and the map's area
 * search never carry them.
 */

/** A stored point: a PostGIS point from [longitude, latitude], or null. */
function pointOf(tx: Sql, coordinates: readonly [number, number] | null | undefined) {
  return coordinates ? tx`ST_SetSRID(ST_MakePoint(${coordinates[0]}, ${coordinates[1]}), 4326)` : null;
}

const pointView = (lon: unknown, lat: unknown) =>
  (lon === null ? null : { type: "Point" as const, coordinates: [lon as number, lat as number] as [number, number] });

const GroupBody = z.object({
  name: z.string().trim().min(1).max(200),
  contactIds: z.array(z.string().uuid()).max(500),
});

const ImportBody = z.object({
  csv: z.string().min(1).max(1_000_000),
  // Which column each field comes from; omitted, it is guessed from the header names.
  mapping: z.partialRecord(z.enum(IMPORT_FIELDS), z.string().nullable()).optional(),
  dryRun: z.boolean(),
});

const MAX_IMPORT_ROWS = 2000;

const JurisdictionParams = z.object({ jurisdictionId: z.string().uuid() });
const ContactParams = z.object({ contactId: z.string().uuid() });
const GroupParams = z.object({ groupId: z.string().uuid() });

type Row = Record<string, unknown>;

async function readContacts(
  tx: Sql,
  jurisdictionId: string,
  filter: { id?: string; q?: string | undefined; after?: string[] | null; limit?: number },
): Promise<Row[]> {
  const like = filter.q ? `%${filter.q.replace(/[\\%_]/g, "\\$&")}%` : null;
  return tx`
    select c.id, c.name, c.organization, c.title, c.emails, c.phones, c.person_id,
      p.display_name as person_name, c.position_id, pos.title as position_title,
      c.notes, c.active, c.updated_at,
      case when writer.yes then c.address end as address,
      case when writer.yes then ST_X(c.location) end as lon, case when writer.yes then ST_Y(c.location) end as lat,
      case when writer.yes then ST_X(c.address_point) end as address_lon,
      case when writer.yes then ST_Y(c.address_point) end as address_lat
    from contacts c
    cross join lateral (select public.is_writer_of(c.jurisdiction_id) as yes) writer
    left join persons p on p.id = c.person_id
    left join positions pos on pos.id = c.position_id
    where c.jurisdiction_id = ${jurisdictionId}
      ${filter.id ? tx`and c.id = ${filter.id}` : tx``}
      ${like ? tx`and (c.name ilike ${like} or c.organization ilike ${like})` : tx``}
      ${filter.after ? tx`and (c.name, c.id) > (${filter.after[0]!}, ${filter.after[1]!}::uuid)` : tx``}
    order by c.name, c.id
    limit ${filter.limit ?? 1}`;
}

function contactView(r: Row) {
  return {
    id: r.id as string,
    name: r.name as string,
    organization: r.organization as string | null,
    title: r.title as string | null,
    emails: r.emails as string[],
    phones: r.phones as string[],
    personId: r.person_id as string | null,
    personName: r.person_name as string | null,
    positionId: r.position_id as string | null,
    positionTitle: r.position_title as string | null,
    notes: r.notes as string | null,
    active: r.active as boolean,
    address: r.address as string | null,
    location: pointView(r.lon, r.lat),
    /** Where the address placed; the area search uses it when no point is set. */
    addressPoint: pointView(r.address_lon, r.address_lat),
    updatedAt: (r.updated_at as Date).toISOString(),
  };
}

async function readGroups(
  tx: Sql,
  jurisdictionId: string,
  filter: { id?: string; after?: string[] | null; limit?: number },
): Promise<Row[]> {
  return tx`
    select g.id, g.name, g.updated_at,
      coalesce((select json_agg(json_build_object('contactId', c.id, 'name', c.name, 'active', c.active)
                                order by m.priority)
                from contact_group_members m join contacts c on c.id = m.contact_id
                where m.group_id = g.id), '[]'::json) as members
    from contact_groups g
    where g.jurisdiction_id = ${jurisdictionId}
      ${filter.id ? tx`and g.id = ${filter.id}` : tx``}
      ${filter.after ? tx`and (g.name, g.id) > (${filter.after[0]!}, ${filter.after[1]!}::uuid)` : tx``}
    order by g.name, g.id
    limit ${filter.limit ?? 1}`;
}

function groupView(r: Row) {
  return {
    id: r.id as string,
    name: r.name as string,
    members: r.members as Array<{ contactId: string; name: string; active: boolean }>,
    updatedAt: (r.updated_at as Date).toISOString(),
  };
}

/** A linked person must belong to the jurisdiction, and a linked position must be one of its own. */
async function checkLinks(tx: Sql, jurisdictionId: string, input: ContactInput): Promise<void> {
  if (input.personId) {
    const [member] = await tx`
      select 1 from jurisdiction_memberships
      where person_id = ${input.personId} and jurisdiction_id = ${jurisdictionId}`;
    if (!member) throw new AuthError(422, "the linked person is not a member of this jurisdiction");
  }
  if (input.positionId) {
    const [position] = await tx`
      select 1 from positions where id = ${input.positionId} and jurisdiction_id = ${jurisdictionId}`;
    if (!position) throw new AuthError(422, "the linked position is not one of this jurisdiction's positions");
  }
}

/** The jurisdiction of a row the caller can see, or 404. */
async function ownerOf(tx: Sql, table: "contacts" | "contact_groups", id: string): Promise<string> {
  const [row] = await tx`select jurisdiction_id from ${tx(table)} where id = ${id}`;
  if (!row) throw new AuthError(404, table === "contacts" ? "contact not found" : "contact group not found");
  return row.jurisdiction_id as string;
}

async function saveMembers(tx: Sql, jurisdictionId: string, groupId: string, contactIds: string[]): Promise<void> {
  const ids = [...new Set(contactIds)];
  const [found] = await tx`
    select count(*)::int as n from contacts
    where jurisdiction_id = ${jurisdictionId} and id = any(${ids}::uuid[])`;
  if (found!.n !== ids.length) throw new AuthError(422, "every member must be a contact in this jurisdiction");
  await tx`delete from contact_group_members where group_id = ${groupId}`;
  await tx`
    insert into contact_group_members (group_id, contact_id, jurisdiction_id, priority)
    select ${groupId}, x.id, ${jurisdictionId}, x.priority
    from unnest(${ids}::uuid[]) with ordinality as x(id, priority)`;
}

function duplicateName(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

export function contactRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
  gazetteer: Gazetteer | null = null,
): void {
  app.get("/api/v1/jurisdictions/:jurisdictionId/contacts", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    requireMember(req.principal, jurisdictionId);
    const query = z.object({ ...pageQuery, q: z.string().trim().max(200).optional() }).parse(req.query);
    const after = decodeCursor(query.cursor, ["key", "id"]);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await withPerson(sql, req.principal.person.id, (tx) =>
      readContacts(tx, jurisdictionId, { q: query.q, after, limit: limit + 1 }),
    );
    const page = cutPage(rows, limit, (r) => [r.name as string, r.id as string]);
    return reply.send({ contacts: page.items.map(contactView), nextCursor: page.nextCursor });
  });

  app.post("/api/v1/jurisdictions/:jurisdictionId/contacts", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    requireAdmin(req.principal, jurisdictionId);
    const input = ContactBody.parse(req.body);
    const view = await withPerson(sql, req.principal.person.id, async (tx) => {
      await checkLinks(tx, jurisdictionId, input);
      const addressPoint = await placeAddress(tx, gazetteer, jurisdictionId, input.address ?? null);
      const [row] = await tx`
        insert into contacts
          (jurisdiction_id, name, organization, title, emails, phones, person_id, position_id,
           notes, active, address, location, address_point, updated_by)
        values
          (${jurisdictionId}, ${input.name}, ${input.organization}, ${input.title},
           ${input.emails}::text[], ${input.phones}::text[], ${input.personId}, ${input.positionId},
           ${input.notes}, ${input.active}, ${input.address ?? null}, ${pointOf(tx, input.location?.coordinates)},
           ${pointOf(tx, addressPoint)}, ${req.principal.person.id})
        returning id`;
      const id = row!.id as string;
      await recordAudit(tx, req.principal, {
        jurisdictionId,
        category: "contact.created",
        subjectTable: "contacts",
        subjectId: id,
        // The numbers and person link decide who a text files activity as.
        payload: { name: input.name, phones: input.phones, personId: input.personId },
      });
      const [created] = await readContacts(tx, jurisdictionId, { id });
      return contactView(created!);
    });
    return reply.status(201).send(view);
  });

  app.put("/api/v1/contacts/:contactId", { preHandler: authenticate }, async (req, reply) => {
    const { contactId } = ContactParams.parse(req.params);
    const input = ContactBody.parse(req.body);
    const view = await withPerson(sql, req.principal.person.id, async (tx) => {
      const jurisdictionId = await ownerOf(tx, "contacts", contactId);
      requireAdmin(req.principal, jurisdictionId);
      await checkLinks(tx, jurisdictionId, input);
      const [before] = await tx`select phones, person_id from contacts where id = ${contactId}`;
      // A sent address is placed again, so saving it once more retries a placement that failed.
      const addressPoint = input.address === undefined ? undefined : await placeAddress(tx, gazetteer, jurisdictionId, input.address);
      await tx`
        update contacts set
          name = ${input.name}, organization = ${input.organization}, title = ${input.title},
          emails = ${input.emails}::text[], phones = ${input.phones}::text[],
          person_id = ${input.personId}, position_id = ${input.positionId}, notes = ${input.notes},
          active = ${input.active}, updated_by = ${req.principal.person.id}, updated_at = now()
          ${addressPoint === undefined ? tx`` : tx`, address = ${input.address ?? null}, address_point = ${pointOf(tx, addressPoint)}`}
          ${input.location === undefined ? tx`` : tx`, location = ${pointOf(tx, input.location?.coordinates)}`}
        where id = ${contactId}`;
      await recordAudit(tx, req.principal, {
        jurisdictionId,
        category: "contact.updated",
        subjectTable: "contacts",
        subjectId: contactId,
        // A change of numbers or person link also clears their texted-activity confirmations (a trigger).
        payload: {
          name: input.name, active: input.active, phones: input.phones, personId: input.personId,
          previous: { phones: (before?.phones as string[] | undefined) ?? [], personId: (before?.person_id as string | null | undefined) ?? null },
        },
      });
      const [updated] = await readContacts(tx, jurisdictionId, { id: contactId });
      return contactView(updated!);
    });
    return reply.send(view);
  });

  /** Deleting a contact removes it from its groups; past mass notifications keep what they sent. */
  app.delete("/api/v1/contacts/:contactId", { preHandler: authenticate }, async (req, reply) => {
    const { contactId } = ContactParams.parse(req.params);
    await withPerson(sql, req.principal.person.id, async (tx) => {
      const jurisdictionId = await ownerOf(tx, "contacts", contactId);
      requireAdmin(req.principal, jurisdictionId);
      await tx`delete from contacts where id = ${contactId}`;
      await recordAudit(tx, req.principal, {
        jurisdictionId,
        category: "contact.deleted",
        subjectTable: "contacts",
        subjectId: contactId,
      });
    });
    return reply.status(204).send();
  });

  /**
   * Import contacts from a CSV file with a header row. A dry run reports each
   * row as it would be imported, with its errors, and writes nothing. A
   * commit imports every row or, when any row has an error, none.
   */
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/contacts/import",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = JurisdictionParams.parse(req.params);
      requireAdmin(req.principal, jurisdictionId);
      const body = ImportBody.parse(req.body);
      let table: string[][];
      try {
        table = parseCsv(body.csv);
      } catch (err) {
        throw new AuthError(422, `the file is not valid CSV: ${err instanceof Error ? err.message : String(err)}`);
      }
      const headers = (table[0] ?? []).map((h) => h.trim());
      const data = table.slice(1);
      if (data.length === 0) throw new AuthError(422, "the file needs a header row and at least one contact");
      if (data.length > MAX_IMPORT_ROWS) throw new AuthError(422, `import at most ${MAX_IMPORT_ROWS} contacts at a time`);
      const mapping: ImportMapping = body.mapping
        ? Object.fromEntries(IMPORT_FIELDS.map((f) => [f, body.mapping![f] ?? null])) as ImportMapping
        : guessMapping(headers);
      for (const column of Object.values(mapping)) {
        if (column !== null && !headers.includes(column)) throw new AuthError(422, `the file has no column named ${column}`);
      }
      if (!mapping.name) throw new AuthError(422, "choose the column that holds each contact's name");
      const rows = readRows(data, headers, mapping);
      const invalid = rows.filter((r) => r.errors.length > 0).length;
      if (!body.dryRun && invalid > 0)
        throw new AuthError(422, `${invalid} of ${rows.length} rows have errors; correct them and check the file again`);
      let created = 0;
      if (!body.dryRun) {
        await withPerson(sql, req.principal.person.id, async (tx) => {
          for (const r of rows) {
            await tx`
              insert into contacts (jurisdiction_id, name, organization, title, emails, phones, notes, updated_by)
              values (${jurisdictionId}, ${r.name}, ${r.organization}, ${r.title}, ${r.emails}::text[],
                      ${r.phones}::text[], ${r.notes}, ${req.principal.person.id})`;
          }
          await recordAudit(tx, req.principal, {
            jurisdictionId,
            category: "contact.imported",
            subjectTable: "contacts",
            payload: { created: rows.length },
          });
        });
        created = rows.length;
      }
      return reply.send({ headers, mapping, rows, valid: rows.length - invalid, invalid, created });
    },
  );

  app.get("/api/v1/jurisdictions/:jurisdictionId/contact-groups", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    requireMember(req.principal, jurisdictionId);
    const page = z.object(pageQuery).parse(req.query);
    const after = decodeCursor(page.cursor, ["key", "id"]);
    const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await withPerson(sql, req.principal.person.id, (tx) =>
      readGroups(tx, jurisdictionId, { after, limit: limit + 1 }),
    );
    const cut = cutPage(rows, limit, (r) => [r.name as string, r.id as string]);
    return reply.send({ groups: cut.items.map(groupView), nextCursor: cut.nextCursor });
  });

  app.post("/api/v1/jurisdictions/:jurisdictionId/contact-groups", { preHandler: authenticate }, async (req, reply) => {
    const { jurisdictionId } = JurisdictionParams.parse(req.params);
    requireAdmin(req.principal, jurisdictionId);
    const input = GroupBody.parse(req.body);
    try {
      const view = await withPerson(sql, req.principal.person.id, async (tx) => {
        const [row] = await tx`
          insert into contact_groups (jurisdiction_id, name, updated_by)
          values (${jurisdictionId}, ${input.name}, ${req.principal.person.id})
          returning id`;
        const id = row!.id as string;
        await saveMembers(tx, jurisdictionId, id, input.contactIds);
        await recordAudit(tx, req.principal, {
          jurisdictionId,
          category: "contact_group.saved",
          subjectTable: "contact_groups",
          subjectId: id,
          payload: { name: input.name, members: input.contactIds.length },
        });
        const [created] = await readGroups(tx, jurisdictionId, { id });
        return groupView(created!);
      });
      return reply.status(201).send(view);
    } catch (err) {
      if (duplicateName(err)) throw new AuthError(409, `a group named ${input.name} already exists`);
      throw err;
    }
  });

  app.put("/api/v1/contact-groups/:groupId", { preHandler: authenticate }, async (req, reply) => {
    const { groupId } = GroupParams.parse(req.params);
    const input = GroupBody.parse(req.body);
    try {
      const view = await withPerson(sql, req.principal.person.id, async (tx) => {
        const jurisdictionId = await ownerOf(tx, "contact_groups", groupId);
        requireAdmin(req.principal, jurisdictionId);
        await tx`
          update contact_groups set name = ${input.name}, updated_by = ${req.principal.person.id}, updated_at = now()
          where id = ${groupId}`;
        await saveMembers(tx, jurisdictionId, groupId, input.contactIds);
        await recordAudit(tx, req.principal, {
          jurisdictionId,
          category: "contact_group.saved",
          subjectTable: "contact_groups",
          subjectId: groupId,
          payload: { name: input.name, members: input.contactIds.length },
        });
        const [updated] = await readGroups(tx, jurisdictionId, { id: groupId });
        return groupView(updated!);
      });
      return reply.send(view);
    } catch (err) {
      if (duplicateName(err)) throw new AuthError(409, `a group named ${input.name} already exists`);
      throw err;
    }
  });

  app.delete("/api/v1/contact-groups/:groupId", { preHandler: authenticate }, async (req, reply) => {
    const { groupId } = GroupParams.parse(req.params);
    await withPerson(sql, req.principal.person.id, async (tx) => {
      const jurisdictionId = await ownerOf(tx, "contact_groups", groupId);
      requireAdmin(req.principal, jurisdictionId);
      await tx`delete from contact_groups where id = ${groupId}`;
      await recordAudit(tx, req.principal, {
        jurisdictionId,
        category: "contact_group.deleted",
        subjectTable: "contact_groups",
        subjectId: groupId,
      });
    });
    return reply.status(204).send();
  });
}
