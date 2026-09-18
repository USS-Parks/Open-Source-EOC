import { randomBytes } from "node:crypto";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { decryptSecret, encryptSecret, hasSecretKey } from "../secrets/envelope.js";
import { buildMeetingUrl, mintJitsiJwt } from "./jitsi.js";

/**
 * Meeting bridges and briefings (VEOC-33, F15/R4). A one-click Jitsi bridge
 * per incident or ICS section, its link stable and surfaced for the incident
 * dashboard; and scheduled briefings that, when due, notify the incident's
 * holders through the VEOC-14 notifications substrate.
 */

export interface MeetingConfigStatus {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly baseUrl: string | null;
  readonly appId: string | null;
  readonly authenticated: boolean;
}

interface ConfigRow {
  base_url: string;
  app_id: string | null;
  secret_envelope: string | null;
  enabled: boolean;
}

async function loadConfig(sql: Sql, jurisdictionId: string): Promise<ConfigRow | null> {
  const [row] = (await sql`
    select base_url, app_id, secret_envelope, enabled from meeting_config
    where jurisdiction_id = ${jurisdictionId}`) as unknown as ConfigRow[];
  return row ?? null;
}

export async function getMeetingConfig(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<MeetingConfigStatus> {
  requireMember(actor, jurisdictionId);
  const row = await loadConfig(sql, jurisdictionId);
  return {
    configured: Boolean(row),
    enabled: Boolean(row?.enabled),
    baseUrl: row?.base_url ?? null,
    appId: row?.app_id ?? null,
    authenticated: Boolean(row?.secret_envelope),
  };
}

export interface ConfigureMeetingInput {
  readonly baseUrl: string;
  readonly appId?: string;
  readonly secret?: string;
  readonly enabled?: boolean;
}

export async function configureMeetingBridge(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: ConfigureMeetingInput,
): Promise<MeetingConfigStatus> {
  requireAdmin(actor, jurisdictionId);
  if (input.secret !== undefined && !hasSecretKey())
    throw new AuthError(409, "server not provisioned for secret storage (OPENEOC_SECRET_KEY unset)");
  const envelope = input.secret !== undefined ? encryptSecret(input.secret) : null;
  await sql`
    insert into meeting_config
      (jurisdiction_id, base_url, app_id, secret_envelope, enabled, updated_by, updated_at)
    values
      (${jurisdictionId}, ${input.baseUrl}, ${input.appId ?? null}, ${envelope},
       ${input.enabled ?? false}, ${actor.person.id}, now())
    on conflict (jurisdiction_id) do update set
      base_url = excluded.base_url,
      app_id = excluded.app_id,
      secret_envelope = coalesce(excluded.secret_envelope, meeting_config.secret_envelope),
      enabled = excluded.enabled,
      updated_by = excluded.updated_by,
      updated_at = now()`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "meeting.configured",
    subjectTable: "meeting_config",
    subjectId: jurisdictionId,
    payload: { enabled: input.enabled ?? false, authenticated: envelope !== null },
  });
  return getMeetingConfig(sql, actor, jurisdictionId);
}

export interface Bridge {
  readonly room: string;
  readonly section: string;
  readonly url: string;
}

/**
 * One-click: return a joinable bridge for the incident (or a section). The
 * room is created once and reused, so the link is stable; when a JWT secret
 * is configured a fresh, per-caller token scopes the room to the audience.
 */
export async function openBridge(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  section: string | null,
): Promise<Bridge> {
  const [incident] = await sql`
    select jurisdiction_id, name from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  const jurisdictionId = incident.jurisdiction_id as string;
  requireMember(actor, jurisdictionId);
  const cfg = await loadConfig(sql, jurisdictionId);
  if (!cfg || !cfg.enabled) throw new AuthError(409, "meeting bridge is not configured");

  const sectionKey = section ?? "incident";
  const freshRoom = `eoc-${randomBytes(8).toString("hex")}`;
  const [row] = await sql`
    insert into meetings (incident_id, section, room, created_by)
    values (${incidentId}, ${sectionKey}, ${freshRoom}, ${actor.person.id})
    on conflict (incident_id, section) do update set room = meetings.room
    returning room, (xmax = 0) as inserted`;
  const room = row!.room as string;
  if (row!.inserted) {
    await recordAudit(sql, actor, {
      jurisdictionId,
      incidentId,
      category: "meeting.created",
      subjectTable: "meetings",
      subjectId: incidentId,
      payload: { section: sectionKey },
    });
  }
  return { room, section: sectionKey, url: await urlFor(sql, actor, jurisdictionId, cfg, room) };
}

export async function listBridges(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<Bridge[]> {
  const [incident] = await sql`select jurisdiction_id from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  const jurisdictionId = incident.jurisdiction_id as string;
  requireMember(actor, jurisdictionId);
  const cfg = await loadConfig(sql, jurisdictionId);
  const rows = await sql`
    select section, room from meetings where incident_id = ${incidentId} order by section`;
  const out: Bridge[] = [];
  for (const r of rows) {
    out.push({
      room: r.room as string,
      section: r.section as string,
      url: cfg ? await urlFor(sql, actor, jurisdictionId, cfg, r.room as string) : "",
    });
  }
  return out;
}

async function urlFor(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  cfg: ConfigRow,
  room: string,
): Promise<string> {
  if (!cfg.secret_envelope || !cfg.app_id) return buildMeetingUrl(cfg.base_url, room);
  const secret = decryptSecret(cfg.secret_envelope);
  const domain = safeHost(cfg.base_url);
  const moderator = actor.memberships.some(
    (m) => m.jurisdictionId === jurisdictionId && m.role === "admin",
  );
  const jwt = mintJitsiJwt(
    { appId: cfg.app_id, secret, domain },
    room,
    {
      id: actor.person.id,
      name: actor.person.displayName,
      email: actor.person.email,
      moderator,
    },
  );
  return buildMeetingUrl(cfg.base_url, room, jwt);
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "meet";
  }
}

export async function scheduleBriefing(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  input: { title: string; scheduledAt: Date; section?: string | undefined },
): Promise<{ id: string }> {
  const [incident] = await sql`select jurisdiction_id from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  const jurisdictionId = incident.jurisdiction_id as string;
  requireMember(actor, jurisdictionId);
  const [row] = await sql`
    insert into briefings (incident_id, title, section, scheduled_at, created_by)
    values (${incidentId}, ${input.title}, ${input.section ?? null},
            ${input.scheduledAt}, ${actor.person.id})
    returning id`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    incidentId,
    category: "briefing.scheduled",
    subjectTable: "briefings",
    subjectId: row!.id as string,
    payload: { title: input.title, scheduledAt: input.scheduledAt.toISOString() },
  });
  return { id: row!.id as string };
}

export interface BriefingRow {
  readonly id: string;
  readonly title: string;
  readonly section: string | null;
  readonly scheduledAt: string;
  readonly notifiedAt: string | null;
}

export async function listBriefings(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<BriefingRow[]> {
  const [incident] = await sql`select jurisdiction_id from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  requireMember(actor, incident.jurisdiction_id as string);
  const rows = await sql`
    select id, title, section, scheduled_at, notified_at from briefings
    where incident_id = ${incidentId} order by scheduled_at`;
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    section: (r.section as string | null) ?? null,
    scheduledAt: (r.scheduled_at as Date).toISOString(),
    notifiedAt: r.notified_at ? (r.notified_at as Date).toISOString() : null,
  }));
}

/**
 * Fire every due briefing across the jurisdiction's active incidents,
 * notifying each incident's current position holders through the VEOC-14
 * notifications substrate, then stamp the briefing so it fires once.
 */
export async function runDueBriefings(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<{ fired: number; notified: number }> {
  requireAdmin(actor, jurisdictionId);
  const due = await sql`
    select b.id, b.incident_id, b.title, b.scheduled_at, i.name as incident_name
    from briefings b join incidents i on i.id = b.incident_id
    where i.jurisdiction_id = ${jurisdictionId}
      and i.closed_at is null and b.notified_at is null and b.scheduled_at <= now()
    order by b.scheduled_at`;
  let notified = 0;
  for (const b of due) {
    const holders = await sql`
      select distinct pa.person_id
      from incident_positions ip
      join position_assignments pa on pa.position_id = ip.position_id and pa.revoked_at is null
      where ip.incident_id = ${b.incident_id as string}`;
    for (const h of holders) {
      await sql`
        insert into notifications (jurisdiction_id, person_id, channel, title, body, status, detail)
        values (${jurisdictionId}, ${h.person_id as string}, 'briefing',
                ${`Briefing: ${b.title as string}`},
                ${`${b.incident_name as string} briefing at ${(b.scheduled_at as Date).toISOString()}`},
                'delivered', ${sql.json({ briefingId: b.id as string } as never)})`;
      notified += 1;
    }
    await sql`update briefings set notified_at = now() where id = ${b.id as string}`;
    await recordAudit(sql, actor, {
      jurisdictionId,
      incidentId: b.incident_id as string,
      category: "briefing.notified",
      subjectTable: "briefings",
      subjectId: b.id as string,
      payload: { title: b.title as string, notified: holders.length },
    });
  }
  return { fired: due.length, notified };
}

function requireAdmin(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
}

function requireMember(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((x) => x.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
}
