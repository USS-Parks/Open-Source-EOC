import {
  INCIDENT_PARTICIPANT_ROLE_SCOPE,
  type IncidentParticipantGrant, type IncidentParticipantGrantInput, type IncidentParticipantRole,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";

export interface IncidentAuthority {
  readonly jurisdictionId: string;
  readonly canManageParticipation: boolean;
  readonly canEditArea: boolean;
  readonly canContribute: boolean;
  readonly participation: {
    id: string;
    organizationId: string;
    incidentPositionTitle: string;
    role: IncidentParticipantRole;
  } | null;
}

/** Serialize incident-scoped mutations that span tables without widening RLS. */
export async function lockIncidentMutation(sql: Sql, incidentId: string): Promise<void> {
  // The canonical text of the id, so every spelling of one incident takes one lock.
  await sql`select pg_advisory_xact_lock(hashtextextended(${incidentId}::uuid::text, 82::bigint))`;
}

/** The database evaluates membership, revocation and expiry on every request. */
export async function getIncidentAuthority(
  sql: Sql, actor: Principal, incidentId: string,
): Promise<IncidentAuthority> {
  const [incident] = await sql`
    select id, jurisdiction_id, is_admin_of(jurisdiction_id) as can_manage,
      can_revise_incident_area(id) as can_edit,
      (is_writer_of(jurisdiction_id) or
       has_incident_participation(id, 'contributor')) as can_contribute
    from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  const [grant] = await sql`
    select ip.id, ip.organization_id, ip.incident_position_title, ip.role
    from incident_participants ip
    where ip.incident_id = ${incidentId} and ip.person_id = ${actor.person.id}
      and ip.revoked_at is null and ip.expires_at > now()
      and eligible_incident_person(ip.person_id, ip.organization_id)
    limit 1`;
  return {
    jurisdictionId: incident.jurisdiction_id as string,
    canManageParticipation: Boolean(incident.can_manage),
    canEditArea: Boolean(incident.can_edit),
    canContribute: Boolean(incident.can_contribute),
    participation: grant ? {
      id: grant.id as string,
      organizationId: grant.organization_id as string,
      incidentPositionTitle: grant.incident_position_title as string,
      role: grant.role as IncidentParticipantRole,
    } : null,
  };
}

function requireManager(authority: IncidentAuthority): void {
  if (!authority.canManageParticipation)
    throw new AuthError(403, "requires incident owner admin");
}

const grantSelect = `
  select ip.id, ip.incident_id, ip.organization_id, j.slug as organization_slug,
    j.name as organization_name, ip.person_id, p.email as person_email,
    p.display_name as person_name, ip.incident_position_title, ip.role,
    ip.expires_at, ip.revoked_at, ip.created_at,
    invitation.created_at as invited_at, invitation.read_at as invitation_read_at
  from incident_participants ip
  join jurisdictions j on j.id = ip.organization_id
  join persons p on p.id = ip.person_id
  left join lateral (
    select n.created_at, n.read_at from notifications n
    where n.channel = 'invitation' and n.detail ->> 'participantId' = ip.id::text
    order by n.created_at desc limit 1
  ) invitation on true`;

function toGrant(row: Record<string, unknown>): IncidentParticipantGrant {
  return {
    id: row.id as string,
    incidentId: row.incident_id as string,
    organizationId: row.organization_id as string,
    organizationSlug: row.organization_slug as string,
    organizationName: row.organization_name as string,
    personId: row.person_id as string,
    personEmail: row.person_email as string,
    personName: row.person_name as string,
    incidentPositionTitle: row.incident_position_title as string,
    role: row.role as IncidentParticipantRole,
    expiresAt: new Date(row.expires_at as string).toISOString(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string).toISOString() : null,
    createdAt: new Date(row.created_at as string).toISOString(),
    invitation: row.invited_at ? {
      deliveredAt: new Date(row.invited_at as string).toISOString(),
      readAt: row.invitation_read_at ? new Date(row.invitation_read_at as string).toISOString() : null,
    } : null,
  };
}

export async function listIncidentParticipants(
  sql: Sql, actor: Principal, incidentId: string,
): Promise<{ participants: IncidentParticipantGrant[]; canManageParticipation: boolean }> {
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  const rows = await sql.unsafe(
    `${grantSelect} where ip.incident_id = $1
     order by j.name, p.display_name, ip.created_at desc limit 500`, [incidentId],
  );
  return {
    participants: rows.map(toGrant),
    canManageParticipation: authority.canManageParticipation,
  };
}

export async function grantIncidentParticipant(
  sql: Sql, actor: Principal, incidentId: string, input: IncidentParticipantGrantInput,
): Promise<IncidentParticipantGrant> {
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  requireManager(authority);
  await lockIncidentMutation(sql, incidentId);
  const expiresAt = new Date(input.expiresAt);
  if (expiresAt <= new Date()) throw new AuthError(400, "expiry must be in the future");
  const [incident] = await sql`select closed_at from incidents where id = ${incidentId} for update`;
  if (incident?.closed_at) throw new AuthError(409, "incident is closed");
  const [target] = await sql`
    select j.id as organization_id, p.id as person_id
    from jurisdictions j, persons p
    where j.slug = ${input.organizationSlug}
      and lower(p.email) = lower(${input.personEmail}) and not p.disabled`;
  if (!target) throw new AuthError(404, "organization or person not found");
  const [eligible] = await sql`
    select eligible_incident_person(${target.person_id as string},
      ${target.organization_id as string}) as allowed`;
  if (!eligible?.allowed) throw new AuthError(403, "person is not a member of that organization");
  let id: string;
  try {
    const [created] = await sql`
      insert into incident_participants
        (incident_id, organization_id, person_id, incident_position_title,
         role, expires_at, reason, created_by)
      values (${incidentId}, ${target.organization_id as string},
        ${target.person_id as string}, ${input.incidentPositionTitle},
        ${input.role}, ${expiresAt}, ${input.reason}, ${actor.person.id})
      returning id`;
    id = created!.id as string;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505")
      throw new AuthError(409, "person already has an active incident grant");
    throw error;
  }
  await recordAudit(sql, actor, {
    jurisdictionId: authority.jurisdictionId, incidentId,
    category: "incident.participant.granted", subjectTable: "incident_participants",
    subjectId: id, payload: {
      organizationId: target.organization_id, personId: target.person_id,
      incidentPositionTitle: input.incidentPositionTitle, role: input.role,
      expiresAt: expiresAt.toISOString(), reason: input.reason,
    },
  });
  // The invitation names the organization, the incident and the access granted, and opens the incident.
  const [names] = await sql`
    select i.name as incident, owner.name as owner, partner.name as partner
    from incidents i join jurisdictions owner on owner.id = i.jurisdiction_id, jurisdictions partner
    where i.id = ${incidentId} and partner.id = ${target.organization_id as string}`;
  await sql`
    insert into notifications (jurisdiction_id, person_id, incident_id, channel, title, body, status, detail)
    values (${authority.jurisdictionId}, ${target.person_id as string}, ${incidentId}, 'invitation',
      ${`${names!.owner as string} invites you to ${names!.incident as string}`},
      ${`${names!.owner as string} added you to the ${names!.incident as string} incident for ${names!.partner as string}, as ${input.incidentPositionTitle}. `
        + `You can ${INCIDENT_PARTICIPANT_ROLE_SCOPE[input.role]}, until ${expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC. `
        + `Reason: ${input.reason} Choose ${names!.incident as string} in the incident list to open it.`},
      'delivered', ${sql.json({ participantId: id, route: `#/overview?incident=${incidentId}` } as never)})`;
  const [row] = await sql.unsafe(`${grantSelect} where ip.id = $1`, [id]);
  return toGrant(row!);
}

export async function revokeIncidentParticipant(
  sql: Sql, actor: Principal, incidentId: string, participantId: string, reason: string,
): Promise<IncidentParticipantGrant> {
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  requireManager(authority);
  await lockIncidentMutation(sql, incidentId);
  const [updated] = await sql`
    update incident_participants
    set revoked_at = now(), revoked_by = ${actor.person.id}, revoke_reason = ${reason}
    where id = ${participantId} and incident_id = ${incidentId} and revoked_at is null
    returning id`;
  if (!updated) throw new AuthError(404, "active participant not found");
  await recordAudit(sql, actor, {
    jurisdictionId: authority.jurisdictionId, incidentId,
    category: "incident.participant.revoked", subjectTable: "incident_participants",
    subjectId: participantId, payload: { reason },
  });
  const [row] = await sql.unsafe(`${grantSelect} where ip.id = $1`, [participantId]);
  return toGrant(row!);
}
