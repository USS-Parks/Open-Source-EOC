import type { Sql } from "../db/client.js";
import { AuthError } from "../auth/service.js";

/**
 * Who a message reaches when it is addressed by group, position or shift
 * rather than by address (VA7). A contact group reaches its active contacts in
 * call-down order. A position reaches its own contact cards and each person
 * who holds it now. On call, a position reaches whoever is on shift in it now,
 * and when no one is, its holders, so a gap in the schedule still reaches
 * someone and the send says so. A person reached this way is reached through
 * their contact card when the directory has one, which carries their email
 * and phone; a person with no card is reached in the app only, since the
 * directory administrators maintain is the only source of outside addresses.
 *
 * Everyone is reached once however many parts name them, in this order:
 * groups, chosen contacts, positions, then on call, each in the order given,
 * which is a call-down's order. Reads run under the caller's row-level
 * security, which lets any member of the jurisdiction read the directory,
 * positions and shifts.
 */

export interface AudienceInput {
  readonly groupIds?: readonly string[] | undefined;
  readonly contactIds?: readonly string[] | undefined;
  readonly positionIds?: readonly string[] | undefined;
  readonly onCallPositionIds?: readonly string[] | undefined;
}

/** One contact card or person to reach, with the addresses it has now. */
export interface Reachable {
  readonly contactId: string | null;
  readonly personId: string | null;
  readonly positionId: string | null;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  /** How the message found them, in words. */
  readonly through: string;
}

/** What a send was addressed to and how many each part reached, as the send records it. */
export interface AudienceRecord {
  readonly groups: Array<{ id: string; name: string; reached: number }>;
  contacts: number;
  readonly positions: Array<{ id: string; title: string; reached: number }>;
  readonly onCall: Array<{ id: string; title: string; reached: number; onShift: boolean }>;
}

type Row = Record<string, unknown>;

function fromContact(c: Row, through: string): Reachable {
  return {
    contactId: c.id as string,
    personId: (c.person_id as string | null) ?? null,
    positionId: (c.position_id as string | null) ?? null,
    name: c.name as string,
    email: (c.emails as string[])[0] ?? null,
    phone: (c.phones as string[])[0] ?? null,
    through,
  };
}

async function positionTitle(tx: Sql, jurisdictionId: string, positionId: string): Promise<string> {
  const [position] = await tx`
    select title from positions where id = ${positionId} and jurisdiction_id = ${jurisdictionId}`;
  if (!position) throw new AuthError(422, "every position must be a position in this jurisdiction");
  return position.title as string;
}

/** People, in the order given, each through their contact card when they have one. */
async function people(tx: Sql, jurisdictionId: string, personIds: readonly string[], through: string): Promise<Reachable[]> {
  if (personIds.length === 0) return [];
  const cards = await tx`
    select distinct on (c.person_id) c.id, c.name, c.emails, c.phones, c.person_id, c.position_id
    from contacts c
    where c.jurisdiction_id = ${jurisdictionId} and c.active and c.person_id = any(${personIds as string[]}::uuid[])
    order by c.person_id, c.updated_at desc, c.id`;
  const names = await tx`select id, display_name from persons where id = any(${personIds as string[]}::uuid[])`;
  const card = new Map(cards.map((c) => [c.person_id as string, c]));
  const name = new Map(names.map((p) => [p.id as string, p.display_name as string]));
  return personIds.map((id) => card.has(id) ? fromContact(card.get(id)!, through) : {
    contactId: null, personId: id, positionId: null, name: name.get(id) ?? "Unnamed person", email: null, phone: null, through,
  });
}

/**
 * A position's own contact cards, then each person who holds it now. A card
 * carries the position's shared addresses, such as a desk phone; while
 * someone holds the position, the holders' own in-app notices cover the app,
 * so the card's notice to the position, which the holders would also see, is
 * left out.
 */
async function holders(tx: Sql, jurisdictionId: string, positionId: string, title: string, note = ""): Promise<Reachable[]> {
  const cards = await tx`
    select id, name, emails, phones, person_id, position_id from contacts
    where jurisdiction_id = ${jurisdictionId} and active and position_id = ${positionId}
    order by name, id`;
  const held = await tx`
    select a.person_id from position_assignments a join persons p on p.id = a.person_id and not p.disabled
    where a.position_id = ${positionId} and a.revoked_at is null
    order by a.assigned_at, a.person_id`;
  const holding = await people(tx, jurisdictionId, held.map((h) => h.person_id as string), `Holds ${title}${note}`);
  const own = cards.map((c) => fromContact(c, `Contact for ${title}${note}`));
  return [...(holding.length > 0 ? own.map((r) => ({ ...r, positionId: null })) : own), ...holding];
}

/**
 * Resolve an audience to the people it reaches as of `now`. A group or
 * position outside the jurisdiction is refused; an audience that reaches no
 * one is returned empty for the caller to refuse or record.
 */
export async function resolveAudience(
  tx: Sql,
  jurisdictionId: string,
  input: AudienceInput,
  now = new Date(),
): Promise<{ recipients: Reachable[]; audience: AudienceRecord }> {
  const recipients: Reachable[] = [];
  const contactsSeen = new Set<string>();
  const peopleSeen = new Set<string>();
  const add = (list: readonly Reachable[]) => {
    for (const r of list) {
      if ((r.contactId && contactsSeen.has(r.contactId)) || (r.personId && peopleSeen.has(r.personId))) continue;
      if (r.contactId) contactsSeen.add(r.contactId);
      if (r.personId) peopleSeen.add(r.personId);
      recipients.push(r);
    }
    return list.length;
  };
  const audience: AudienceRecord = { groups: [], contacts: 0, positions: [], onCall: [] };

  for (const groupId of new Set(input.groupIds ?? [])) {
    const [group] = await tx`
      select name from contact_groups where id = ${groupId} and jurisdiction_id = ${jurisdictionId}`;
    if (!group) throw new AuthError(404, "contact group not found");
    const members = await tx`
      select c.id, c.name, c.emails, c.phones, c.person_id, c.position_id
      from contact_group_members m join contacts c on c.id = m.contact_id
      where m.group_id = ${groupId} and c.active
      order by m.priority`;
    const name = group.name as string;
    audience.groups.push({ id: groupId, name, reached: add(members.map((c) => fromContact(c, `Group: ${name}`))) });
  }

  const ids = [...new Set(input.contactIds ?? [])];
  if (ids.length > 0) {
    const found = await tx`
      select id, name, emails, phones, person_id, position_id from contacts
      where jurisdiction_id = ${jurisdictionId} and active and id = any(${ids}::uuid[])`;
    const byId = new Map(found.map((c) => [c.id as string, c]));
    if (byId.size !== ids.length) throw new AuthError(422, "every contact must be an active contact in this jurisdiction");
    audience.contacts = add(ids.map((id) => fromContact(byId.get(id)!, "Chosen contact")));
  }

  for (const positionId of new Set(input.positionIds ?? [])) {
    const title = await positionTitle(tx, jurisdictionId, positionId);
    audience.positions.push({ id: positionId, title, reached: add(await holders(tx, jurisdictionId, positionId, title)) });
  }

  for (const positionId of new Set(input.onCallPositionIds ?? [])) {
    const title = await positionTitle(tx, jurisdictionId, positionId);
    const onShift = await tx`
      select s.person_id from shifts s join persons p on p.id = s.person_id and not p.disabled
      where s.jurisdiction_id = ${jurisdictionId} and s.position_id = ${positionId}
        and s.starts_at <= ${now} and s.ends_at > ${now}
      order by s.starts_at, s.person_id`;
    const reached = onShift.length > 0
      ? await people(tx, jurisdictionId, [...new Set(onShift.map((s) => s.person_id as string))], `On shift as ${title}`)
      : await holders(tx, jurisdictionId, positionId, title, ", no one on shift");
    audience.onCall.push({ id: positionId, title, reached: add(reached), onShift: onShift.length > 0 });
  }

  return { recipients, audience };
}

/** What a send was addressed to, in one line; a send from before audiences were kept names its group. */
export function audienceLabel(audience: Partial<AudienceRecord> | null | undefined, groupName: string | null): string {
  const none = (reached: number) => reached === 0 ? " (no one reached)" : "";
  const parts = [
    ...(audience?.groups ?? []).map((g) => `${g.name}${none(g.reached)}`),
    ...(audience?.contacts ? [`${audience.contacts} chosen ${audience.contacts === 1 ? "contact" : "contacts"}`] : []),
    ...(audience?.positions ?? []).map((p) => `${p.title}${none(p.reached)}`),
    ...(audience?.onCall ?? []).map((p) =>
      `On call: ${p.title}${p.reached === 0 ? " (no one reached)" : p.onShift ? "" : " (no one on shift, so its holders)"}`),
  ];
  return parts.length > 0 ? parts.join(", ") : (groupName ?? "Chosen contacts");
}
