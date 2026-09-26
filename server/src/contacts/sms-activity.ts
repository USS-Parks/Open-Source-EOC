import { createHash, randomInt } from "node:crypto";
import { ZodError } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson, withSavepoint } from "../db/context.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { insertRecord, validateNewRecord, writableBoard } from "../boards/service.js";
import { channelRefusal, sendMessage, type InboundSms, type StoredChannel } from "../notify/channels.js";

/**
 * Field activity by text message. When an administrator turns it on for the
 * jurisdiction's SMS gateway, a responder texts what they did from a phone
 * number registered to their person record (a contacts directory entry
 * linked to them) that they have confirmed, signed in, with a code texted to
 * it. The gateway's reader files the text on the ICS 214 activity log of the
 * open incident they hold a position on, as them, gives them an in-app
 * notice, and texts a confirmation to the registered number.
 *
 * What a text says: `LOG entry`, `#incident entry` or `LOG #incident entry`.
 * Nothing else is ever filed: a text without LOG or # answers an open send,
 * as before, or does nothing, so an auto-reply is never an entry. `#incident`
 * picks one of the sender's incidents by the start of its name in letters and
 * digits ("#north" for North Coast Storm); it is needed only by someone who
 * holds positions on more than one open incident.
 *
 * Refused, with nothing filed:
 * - a carrier keyword (STOP, HELP and the like), or the product's own text
 *   coming back ("OpenEOC: ..."): no reply;
 * - a number not registered to, and confirmed by, an enabled person: no
 *   reply, so the reader never tells a stranger which numbers are registered;
 * - more than TEXTS_PER_HOUR texts from one number in an hour that were filed
 *   or answered: no reply;
 * - a number on more than one directory entry, an empty or too long entry,
 *   no current assignment, an incident not picked, or an entry the log
 *   refuses the person: a reply to the registered number saying why.
 *
 * A reply goes to the number on the directory entry, never to the sender as
 * the phone gave it, and a gateway sends at most GATEWAY_REPLIES_PER_HOUR. A
 * sender can be forged, so an entry filed this way is marked as texted on the
 * record, in its audit, on the printed ICS 214 and in exports, and both the
 * confirmation text and the in-app notice tell the person what was filed as
 * them.
 */

/** The longest entry a text may carry, in characters. */
export const MAX_ENTRY_CHARS = 1000;
/** Texts from one number filed or answered in an hour; the rest are kept and refused without a reply. */
export const TEXTS_PER_HOUR = 20;
/** Texts one gateway sends back in an hour; past it, texts are still filed but not answered. */
export const GATEWAY_REPLIES_PER_HOUR = 300;
/** How long a code lasts; issue_sms_activity_code keeps the same. */
const CODE_TTL_MS = 15 * 60_000;

/** Carrier and industry keywords (CTIA): never filed and never answered here. */
const CARRIER_KEYWORDS = new Set([
  "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "OPT OUT",
  "START", "UNSTOP", "HELP", "INFO",
]);

export function isCarrierKeyword(text: string): boolean {
  return CARRIER_KEYWORDS.has(text.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").toUpperCase());
}

/** The product's own text coming back, from an auto-reply or a forward: never an answer or an entry. */
export function isEcho(text: string): boolean {
  return /^\s*openeoc:/i.test(text);
}

export interface ActivityText {
  /** Whether it starts with LOG or #, without which nothing is filed. */
  readonly marked: boolean;
  /** The incident it picks after #, in lower case; null when it picks none. */
  readonly incident: string | null;
  readonly entry: string;
}

/** A text read by the grammar above. */
export function parseActivityText(text: string): ActivityText {
  let rest = text.trim();
  const log = /^log(?::|\s+|$)/i.exec(rest);
  if (log) rest = rest.slice(log[0].length).trimStart();
  const tag = /^#([a-z0-9]+)(?::|\s+|$)/i.exec(rest);
  if (tag) rest = rest.slice(tag[0].length);
  return { marked: Boolean(log ?? tag), incident: tag ? tag[1]!.toLowerCase() : null, entry: rest.trim() };
}

/** An incident name as `#incident` matches it: letters and digits, lower case. */
const compact = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The shortest tag, from the name's first word up, that picks this incident alone among the sender's. */
export function incidentTag(name: string, names: readonly string[]): string {
  const full = compact(name);
  // ponytail: two incidents with the same name have no tag that parts them; rename one.
  for (let n = Math.max(3, compact(name.split(/\s+/)[0] ?? "").length); n < full.length; n += 1) {
    const tag = full.slice(0, n);
    if (names.filter((other) => compact(other).startsWith(tag)).length === 1) return tag;
  }
  return full;
}

/**
 * The digit strings a registered number may be stored as for this sender: as
 * given, and a ten-digit national number with the North American 1. Matching
 * whole numbers, not their last ten digits as a reply to a send does, keeps a
 * number abroad that ends in the same ten digits from filing as someone here.
 * Null for a short code or anything else that cannot be a registered number.
 */
export function numberForms(sender: string): string[] | null {
  const digits = sender.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return digits.length === 10 ? [digits, `1${digits}`] : [digits];
}

export type Refusal =
  | "keyword" | "echo" | "rate_limited" | "shared_number" | "too_long" | "empty"
  | "no_assignment" | "choose_incident" | "refused_by_log" | "failed";

export interface Reply {
  readonly to: string;
  readonly body: string;
}

/** A text to file: as whom, where, and the number the confirmation goes to. */
export interface Filing {
  readonly personId: string;
  readonly phone: string;
  readonly incidentId: string;
  readonly incidentName: string;
  readonly boardId: string;
  readonly position: Principal["position"];
  readonly entry: string;
}

export type ActivityDecision =
  | { readonly kind: "unmatched" }
  | { readonly kind: "refused"; readonly refusal: Refusal; readonly personId: string | null; readonly reply: Reply | null }
  | { readonly kind: "file"; readonly filing: Filing };

/**
 * What a text marked LOG or # does, decided by the reader (an administrator)
 * from the jurisdiction's directory, confirmed numbers and position
 * assignments. The hourly count is read from the texts already kept, which
 * the reader's lock makes every other reader's too.
 */
export async function decideActivity(tx: Sql, jurisdictionId: string, text: InboundSms): Promise<ActivityDecision> {
  const refuse = (refusal: Refusal, personId: string | null = null, reply: Reply | null = null): ActivityDecision =>
    ({ kind: "refused", refusal, personId, reply });
  if (isCarrierKeyword(text.text)) return refuse("keyword");
  const forms = numberForms(text.sender);
  if (!forms) return { kind: "unmatched" };
  const entries = await tx`
    select c.person_id, ph as phone,
           coalesce(p.id is not null and not p.disabled and not p.service_identity, false) as live,
           exists (select 1 from sms_activity_numbers n
                   where n.jurisdiction_id = c.jurisdiction_id and n.person_id = c.person_id
                     and n.phone = ph and n.confirmed_at is not null) as confirmed
    from contacts c
    cross join lateral unnest(c.phones) ph
    left join persons p on p.id = c.person_id
    where c.jurisdiction_id = ${jurisdictionId} and c.active
      and regexp_replace(ph, '[^0-9]', '', 'g') = any(${forms}::text[])`;
  const registered = entries.find((e) => e.live && e.confirmed);
  if (!registered) return { kind: "unmatched" };
  const phone = registered.phone as string;

  // Texts filed or answered for this number in the last hour, in either form a sender may take.
  const key = phone.replace(/\D/g, "");
  const senderForms = key.length === 11 && key.startsWith("1") ? [key, key.slice(1)] : [key];
  const [recent] = await tx`
    select count(*)::int as n from sms_replies
    where jurisdiction_id = ${jurisdictionId} and read_at > now() - interval '1 hour'
      and (outcome = 'logged' or reply is not null)
      and regexp_replace(sender, '[^0-9]', '', 'g') = any(${senderForms}::text[])`;
  if ((recent!.n as number) >= TEXTS_PER_HOUR) return refuse("rate_limited");

  const reply = (body: string): Reply => ({ to: phone, body: `OpenEOC: nothing filed. ${body}` });
  if (new Set(entries.map((e) => (e.person_id as string | null) ?? "")).size > 1)
    return refuse("shared_number", null, reply("This number is on more than one contacts directory entry; ask an administrator."));
  const personId = registered.person_id as string;
  const parsed = parseActivityText(text.text);
  if (parsed.entry.length > MAX_ENTRY_CHARS)
    return refuse("too_long", personId, reply(`Keep an activity entry under ${MAX_ENTRY_CHARS} characters.`));
  if (isCarrierKeyword(parsed.entry)) return refuse("keyword", personId);
  if (!parsed.entry) return refuse("empty", personId, reply("Text LOG and what you did, for example: LOG Arrived at staging."));

  // Current assignment: an open incident of this jurisdiction the person holds
  // a position on, with an activity log; its first log if it has several.
  const assigned = await tx`
    select distinct on (i.id) i.id, i.name, i.activated_at,
           pos.id as position_id, pos.key as position_key, pos.title as position_title,
           pos.jurisdiction_id as position_jurisdiction,
           (select b.id from incident_boards ib join boards b on b.id = ib.board_id
            where ib.incident_id = i.id and b.template_key = 'activity_log' and b.archived_at is null
            order by b.created_at, b.id limit 1) as board_id
    from position_assignments pa
    join positions pos on pos.id = pa.position_id
    join incident_positions ip on ip.position_id = pa.position_id
    join incidents i on i.id = ip.incident_id
    where pa.person_id = ${personId} and pa.revoked_at is null
      and i.jurisdiction_id = ${jurisdictionId} and i.closed_at is null
    order by i.id, pa.assigned_at, pos.key`;
  const incidents = assigned.filter((a) => a.board_id)
    .sort((a, b) => (a.activated_at as Date).getTime() - (b.activated_at as Date).getTime());
  if (incidents.length === 0)
    return refuse("no_assignment", personId, reply("You hold no position on an open incident with an activity log."));
  const names = incidents.map((i) => i.name as string);
  const picked = parsed.incident === null ? incidents
    : incidents.filter((i) => compact(i.name as string).startsWith(parsed.incident!));
  if (picked.length !== 1) {
    const tags = names.slice(0, 4).map((name) => `#${incidentTag(name, names)}`).join(" or ");
    return refuse("choose_incident", personId, reply(`Start the text with the incident: ${tags}.`));
  }
  const chosen = picked[0]!;
  return {
    kind: "file",
    filing: {
      personId,
      phone,
      incidentId: chosen.id as string,
      incidentName: chosen.name as string,
      boardId: chosen.board_id as string,
      position: {
        id: chosen.position_id as string,
        key: chosen.position_key as string,
        title: chosen.position_title as string,
        jurisdictionId: chosen.position_jurisdiction as string,
      },
      entry: parsed.entry,
    },
  };
}

/**
 * File a decided text on the activity log as the person, inside the reader's
 * transaction: in a savepoint with the person bound to the session, so
 * row-level security and the board's own rules see them, and the reader bound
 * again after (a rollback of the savepoint restores the reader too). The log
 * refuses what the person may not write now (no longer a writer, the incident
 * closed, an entry not valid).
 */
export async function fileAsPerson(
  tx: Sql,
  readerId: string,
  text: InboundSms,
  filing: Filing,
): Promise<{ readonly recordId: string } | "refused"> {
  try {
    return await withSavepoint(tx, async (sp) => {
      await sp`select set_config('app.person_id', ${filing.personId}, true)`;
      const actor = await principalIn(sp, filing.personId, filing.position);
      const board = await writableBoard(sp, actor, filing.boardId, filing.incidentId);
      const data = await validateNewRecord(sp, actor, board, { entry: filing.entry }, filing.incidentId);
      const recordId = await insertRecord(sp, actor, board, data, filing.incidentId, "sms",
        { gatewayMessageId: text.id, sender: text.sender, receivedAt: text.receivedAt.toISOString() });
      await sp`select set_config('app.person_id', ${readerId}, true)`;
      return { recordId };
    });
  } catch (err) {
    if (err instanceof AuthError || err instanceof ZodError) return "refused";
    throw err;
  }
}

/**
 * The person as principalForPerson reads them, but on the reader's own
 * connection, with the person already bound to it: no second connection is
 * held while the reader's transaction is open.
 */
async function principalIn(sp: Sql, personId: string, position: Principal["position"]): Promise<Principal> {
  const [person] = await sp`
    select id, email, display_name, disabled, is_instance_admin, service_identity_stopped(id) as service_stopped
    from persons where id = ${personId}`;
  if (!person || person.disabled || person.service_stopped) throw new AuthError(401, "person unavailable");
  const memberships = await sp`select jurisdiction_id, role from jurisdiction_memberships where person_id = ${personId}`;
  return {
    sessionId: "system",
    person: { id: personId, email: person.email as string, displayName: person.display_name as string },
    position,
    memberships: memberships.map((m) => ({ jurisdictionId: m.jurisdiction_id as string, role: m.role as string })),
    isInstanceAdmin: Boolean(person.is_instance_admin),
    guests: [],
  };
}

/** The in-app notice to the person an entry was filed as. */
export async function noticeFiled(tx: Sql, jurisdictionId: string, filing: Filing, recordId: string): Promise<void> {
  await tx`
    insert into notifications (jurisdiction_id, person_id, channel, title, body, status, detail)
    values (${jurisdictionId}, ${filing.personId}, 'sms_activity', 'Activity filed as you by text message',
            ${`On the ${filing.incidentName} activity log: "${filing.entry.slice(0, 200)}". If you did not send it, tell the EOC.`},
            'delivered', ${tx.json({ incidentId: filing.incidentId, boardId: filing.boardId, recordId } as never)})`;
}

/** The confirmation texted to the registered number, with what was filed as them. */
export function confirmation(filing: Filing): Reply {
  const said = filing.entry.length > 60 ? `${filing.entry.slice(0, 57)}...` : filing.entry;
  return { to: filing.phone, body: `OpenEOC: filed on the ${filing.incidentName} activity log: "${said}". Not you? Call the EOC.` };
}

/** The reply when the log refuses the entry as the person. */
export function refusedByLog(filing: Filing): Reply {
  return { to: filing.phone, body: `OpenEOC: nothing filed. The ${filing.incidentName} activity log did not take the entry; call the EOC.` };
}

/**
 * Whether the gateway may still text back this hour: replies and codes
 * together, as issue_sms_activity_code counts them.
 */
export async function mayReply(tx: Sql, jurisdictionId: string): Promise<boolean> {
  const [sent] = await tx`
    select (select count(*) from sms_replies
            where jurisdiction_id = ${jurisdictionId} and reply is not null and read_at > now() - interval '1 hour')
         + (select count(*) from sms_activity_codes
            where jurisdiction_id = ${jurisdictionId} and sent_at > now() - interval '1 hour') as n`;
  return Number(sent!.n) < GATEWAY_REPLIES_PER_HOUR;
}

// ---- Confirming a number ----

export interface ActivityNumber {
  readonly jurisdictionId: string;
  readonly jurisdictionName: string;
  readonly phone: string;
  readonly confirmedAt: string | null;
  /** While a code texted to it can still be entered. */
  readonly codeExpiresAt: string | null;
}

// The SHA-256 of a six-digit code is reversed in moments, so no application
// role may read code_hash (9001's column grants); only the two functions that
// issue and check codes see it.
const hashCode = (code: string) => createHash("sha256").update(code, "utf8").digest("hex");

function requirePerson(actor: Principal): void {
  if (actor.service) throw new AuthError(403, "a service identity cannot do this");
}

/** The caller's numbers on contacts linked to them, where texted activity logging is on. */
export async function listActivityNumbers(sql: Sql, actor: Principal): Promise<ActivityNumber[]> {
  requirePerson(actor);
  return withPerson(sql, actor.person.id, async (tx) => {
    const rows = await tx`
      select distinct on (c.jurisdiction_id, ph) c.jurisdiction_id, j.name, ph as phone,
             n.confirmed_at, case when n.code_expires_at > now() then n.code_expires_at end as code_expires_at
      from contacts c
      cross join lateral unnest(c.phones) ph
      join jurisdictions j on j.id = c.jurisdiction_id
      left join sms_activity_numbers n
        on n.jurisdiction_id = c.jurisdiction_id and n.person_id = c.person_id and n.phone = ph
      where c.person_id = ${actor.person.id} and c.active and public.sms_activity_logging(c.jurisdiction_id)
      order by c.jurisdiction_id, ph`;
    return rows.map((r) => ({
      jurisdictionId: r.jurisdiction_id as string,
      jurisdictionName: r.name as string,
      phone: r.phone as string,
      confirmedAt: r.confirmed_at ? (r.confirmed_at as Date).toISOString() : null,
      codeExpiresAt: r.code_expires_at ? (r.code_expires_at as Date).toISOString() : null,
    }));
  });
}

/** Why issue_sms_activity_code refused a code, as the caller hears it. */
const CODE_REFUSALS: Readonly<Record<string, AuthError>> = {
  not_linked: new AuthError(404, "that number is not on a contacts directory entry linked to you"),
  off: new AuthError(409, "texted activity logging is not on for this jurisdiction"),
  confirmed: new AuthError(409, "that number is already confirmed"),
  locked: new AuthError(429, "too many wrong codes; try again tomorrow or ask an administrator"),
  too_soon: new AuthError(429, "a code was sent less than five minutes ago"),
  daily_cap: new AuthError(429, "five codes have been sent today; try again tomorrow"),
  busy: new AuthError(429, "the SMS gateway has sent all it may this hour; try again later"),
};

/**
 * Text a six-digit code to one of the caller's registered numbers through the
 * jurisdiction's gateway. issue_sms_activity_code decides, as the caller and
 * with the row locked, whether a code may go (the link, the five-minute
 * interval, the daily caps, the lock, the gateway's budget) and keeps its
 * hash; only then is it texted. The gateway is read as the administrator its
 * reader acts as.
 */
export async function sendActivityCode(sql: Sql, actor: Principal, jurisdictionId: string, phone: string): Promise<{ expiresAt: string }> {
  requirePerson(actor);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await withPerson(sql, actor.person.id, async (tx) => {
    const [row] = await tx`select public.issue_sms_activity_code(${jurisdictionId}, ${phone}, ${hashCode(code)}) as result`;
    const result = row!.result as string;
    if (result !== "issued") throw CODE_REFUSALS[result] ?? new AuthError(409, "no code was issued");
    await recordAudit(tx, actor, {
      jurisdictionId, category: "sms_activity.code_sent", subjectTable: "persons", subjectId: actor.person.id, payload: { phone },
    });
  });
  const [reader] = await sql`select person_id from sms_reply_readers() where jurisdiction_id = ${jurisdictionId}`;
  const stored = reader ? await withPerson(sql, reader.person_id as string, async (tx) => {
    const [channel] = await tx`
      select settings, secret_envelope from notification_channels where jurisdiction_id = ${jurisdictionId} and kind = 'sms'`;
    return channel ? { settings: channel.settings as unknown, secret: channel.secret_envelope as string | null } as StoredChannel : null;
  }) : null;
  const refused = await channelRefusal("sms", stored, []);
  if (refused) throw new AuthError(409, refused);
  try {
    await sendMessage("sms", stored!, {
      jurisdictionId, to: phone, subject: "",
      body: `OpenEOC: your code to log activity by text is ${code}. Enter it in OpenEOC; it lasts 15 minutes.`,
    }, { timeoutMs: 10_000 });
  } catch (err) {
    throw new AuthError(502, `the code was not sent: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { expiresAt: expiresAt.toISOString() };
}

/** Confirm one of the caller's numbers with the code texted to it. */
export async function confirmActivityNumber(sql: Sql, actor: Principal, jurisdictionId: string, phone: string, code: string): Promise<void> {
  requirePerson(actor);
  const result = await withPerson(sql, actor.person.id, async (tx) => {
    const [row] = await tx`select public.confirm_sms_activity_number(${jurisdictionId}, ${phone}, ${hashCode(code.trim())}) as result`;
    const outcome = row!.result as "confirmed" | "wrong" | "locked" | "expired";
    if (outcome === "confirmed") {
      await recordAudit(tx, actor, {
        jurisdictionId, category: "sms_activity.number_confirmed", subjectTable: "persons", subjectId: actor.person.id, payload: { phone },
      });
    }
    return outcome;
  });
  if (result === "wrong") throw new AuthError(422, "the code does not match");
  if (result === "locked") throw CODE_REFUSALS.locked!;
  if (result === "expired") throw new AuthError(422, "no code is waiting for that number; send a new one");
}
