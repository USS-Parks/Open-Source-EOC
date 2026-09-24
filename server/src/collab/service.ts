import { planIncidentSpace, type PositionHolder, type SpacePlan } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import {
  AuthError,
  requireAdmin,
  requireMember,
  requireWriter,
  type Principal,
} from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { withPerson } from "../db/context.js";
import { decryptSecret, encryptSecret, hasSecretKey } from "../secrets/envelope.js";
import {
  adapterFor,
  httpTransport,
  type CollabAdapter,
  type HttpTransport,
} from "./adapters.js";

/**
 * Incident collaboration spaces (F15/R6). Activation provisions a
 * space with a channel per ICS section; membership follows position
 * assignment and is reconciled as a diff; announcements post from the
 * platform; deactivation archives the space. The backend is optional: with
 * none configured the platform still runs and these operations degrade to
 * in-app notifications (INV-3). The adapter is reached across a process
 * boundary; the transport is injectable for tests. The operations that call
 * the backend take the pool, not a transaction: they read in one
 * transaction, call the backend with none open, and write in another. The
 * backend calls are idempotent, so a failure part way leaves nothing to undo
 * and the operation can run again.
 */

export interface BackendStatus {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly kind: string | null;
  readonly baseUrl: string | null;
}

interface BackendRow {
  kind: string;
  base_url: string;
  token_envelope: string | null;
  homeserver: string | null;
  enabled: boolean;
}

interface LiveBackend {
  readonly adapter: CollabAdapter;
}

export async function getBackendStatus(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<BackendStatus> {
  requireMember(actor, jurisdictionId);
  const [row] = await sql`
    select kind, base_url, enabled, token_envelope from collab_backends
    where jurisdiction_id = ${jurisdictionId}`;
  return {
    configured: Boolean(row?.token_envelope),
    enabled: Boolean(row?.enabled),
    kind: (row?.kind as string) ?? null,
    baseUrl: (row?.base_url as string) ?? null,
  };
}

export interface ConfigureBackendInput {
  readonly kind: "mattermost" | "matrix";
  readonly baseUrl: string;
  readonly token?: string;
  readonly homeserver?: string;
  readonly enabled?: boolean;
}

export async function configureBackend(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: ConfigureBackendInput,
): Promise<BackendStatus> {
  requireAdmin(actor, jurisdictionId);
  if (input.token !== undefined && !hasSecretKey())
    throw new AuthError(409, "server not provisioned for secret storage (OPENEOC_SECRET_KEY unset)");
  const envelope = input.token !== undefined ? encryptSecret(input.token) : null;
  await sql`
    insert into collab_backends
      (jurisdiction_id, kind, base_url, token_envelope, homeserver, enabled, updated_by, updated_at)
    values
      (${jurisdictionId}, ${input.kind}, ${input.baseUrl}, ${envelope},
       ${input.homeserver ?? null}, ${input.enabled ?? false}, ${actor.person.id}, now())
    on conflict (jurisdiction_id) do update set
      kind = excluded.kind,
      base_url = excluded.base_url,
      token_envelope = coalesce(excluded.token_envelope, collab_backends.token_envelope),
      homeserver = excluded.homeserver,
      enabled = excluded.enabled,
      updated_by = excluded.updated_by,
      updated_at = now()`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "collab.configured",
    subjectTable: "collab_backends",
    subjectId: jurisdictionId,
    payload: { kind: input.kind, enabled: input.enabled ?? false, tokenSet: envelope !== null },
  });
  return getBackendStatus(sql, actor, jurisdictionId);
}

interface IncidentContext {
  readonly incidentId: string;
  readonly jurisdictionId: string;
  readonly name: string;
  readonly positionKeys: string[];
  readonly holders: PositionHolder[];
  readonly plan: SpacePlan;
  readonly holderPersonIds: string[];
}

async function loadIncidentContext(sql: Sql, incidentId: string): Promise<IncidentContext & { closed: boolean }> {
  const [incident] = await sql`
    select jurisdiction_id, name, closed_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  const positionRows = await sql`
    select p.key from incident_positions ip
    join positions p on p.id = ip.position_id
    where ip.incident_id = ${incidentId}`;
  const holderRows = await sql`
    select p.key as position_key, pa.person_id, per.email
    from incident_positions ip
    join positions p on p.id = ip.position_id
    join position_assignments pa on pa.position_id = p.id and pa.revoked_at is null
    join persons per on per.id = pa.person_id
    where ip.incident_id = ${incidentId}`;
  const positionKeys = positionRows.map((r) => r.key as string);
  const holders: PositionHolder[] = holderRows.map((r) => ({
    positionKey: r.position_key as string,
    personId: r.person_id as string,
    email: r.email as string,
  }));
  return {
    incidentId,
    jurisdictionId: incident.jurisdiction_id as string,
    name: incident.name as string,
    positionKeys,
    holders,
    plan: planIncidentSpace(incident.name as string, positionKeys, holders),
    holderPersonIds: [...new Set(holders.map((h) => h.personId))],
    closed: Boolean(incident.closed_at),
  };
}

async function loadLiveBackend(
  sql: Sql,
  jurisdictionId: string,
  transport: HttpTransport,
): Promise<LiveBackend | null> {
  const [row] = (await sql`
    select kind, base_url, token_envelope, homeserver, enabled from collab_backends
    where jurisdiction_id = ${jurisdictionId}`) as unknown as BackendRow[];
  if (!row || !row.enabled || !row.token_envelope) return null;
  const token = decryptSecret(row.token_envelope);
  const adapter = adapterFor(
    row.kind,
    {
      baseUrl: row.base_url,
      token,
      ...(row.homeserver ? { homeserver: row.homeserver } : {}),
    },
    transport,
  );
  return { adapter };
}

export interface ProvisionResult {
  readonly degraded: boolean;
  readonly backend: string | null;
  readonly channels: number;
}

/**
 * Provision (or re-provision) the incident's collaboration space. With no
 * enabled backend, degrade to in-app notifications and report it.
 */
export async function provisionForIncident(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  transport: HttpTransport = httpTransport,
): Promise<ProvisionResult> {
  const { ctx, live } = await withPerson(sql, actor.person.id, async (tx) => {
    const ctx = await loadIncidentContext(tx, incidentId);
    requireAdmin(actor, ctx.jurisdictionId);
    const live = await loadLiveBackend(tx, ctx.jurisdictionId, transport);
    if (!live) await degrade(tx, actor, ctx, `Collaboration space requested for ${ctx.name}`);
    return { ctx, live };
  });
  if (!live) return { degraded: true, backend: null, channels: ctx.plan.channels.length };

  const remoteSpaceId = await live.adapter.ensureSpace(ctx.plan.spaceName, ctx.plan.spaceDisplayName);
  const remoteChannelIds: string[] = [];
  for (const ch of ctx.plan.channels) {
    const remoteChannelId = await live.adapter.ensureChannel(remoteSpaceId, ch.name, ch.displayName);
    await live.adapter.setMembers(remoteChannelId, ch.memberEmails);
    remoteChannelIds.push(remoteChannelId);
  }

  await withPerson(sql, actor.person.id, async (tx) => {
    const [space] = await tx`
      insert into collab_spaces (incident_id, backend_kind, remote_space_id, status, created_by)
      values (${incidentId}, ${live.adapter.kind}, ${remoteSpaceId}, 'active', ${actor.person.id})
      on conflict (incident_id) do update set
        backend_kind = excluded.backend_kind,
        remote_space_id = excluded.remote_space_id,
        status = 'active', archived_at = null
      returning id`;
    const spaceId = space!.id as string;
    for (const [i, ch] of ctx.plan.channels.entries()) {
      const [channel] = await tx`
        insert into collab_channels (space_id, section, name, remote_channel_id)
        values (${spaceId}, ${ch.section}, ${ch.name}, ${remoteChannelIds[i]!})
        on conflict (space_id, section) do update set
          name = excluded.name, remote_channel_id = excluded.remote_channel_id
        returning id`;
      await mirrorMembers(tx, channel!.id as string, ch.memberPersonIds);
    }
    await recordAudit(tx, actor, {
      jurisdictionId: ctx.jurisdictionId,
      incidentId,
      category: "collab.provisioned",
      subjectTable: "collab_spaces",
      subjectId: spaceId,
      payload: { backend: live.adapter.kind, channels: ctx.plan.channels.length },
    });
  });
  return { degraded: false, backend: live.adapter.kind, channels: ctx.plan.channels.length };
}

export interface SyncResult {
  readonly degraded: boolean;
  readonly added: number;
  readonly removed: number;
}

/**
 * Reconcile channel membership to the incident's current position holders.
 * Called after an assignment or reassignment. If a space exists it diffs;
 * if a backend is enabled but no space exists yet it provisions first.
 */
export async function syncIncidentMembership(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  transport: HttpTransport = httpTransport,
): Promise<SyncResult> {
  const { ctx, space, live, channels } = await withPerson(sql, actor.person.id, async (tx) => {
    const ctx = await loadIncidentContext(tx, incidentId);
    requireAdmin(actor, ctx.jurisdictionId);
    const [space] = await tx`
      select id, remote_space_id, status from collab_spaces where incident_id = ${incidentId}`;
    const live = await loadLiveBackend(tx, ctx.jurisdictionId, transport);
    const channels = space ? await tx`
      select id, section, remote_channel_id from collab_channels where space_id = ${space.id as string}` : [];
    return { ctx, space, live, channels };
  });
  if (!live || !space || (space.status as string) !== "active") {
    if (live && !space) {
      await provisionForIncident(sql, actor, incidentId, transport);
      return { degraded: false, added: 0, removed: 0 };
    }
    return { degraded: true, added: 0, removed: 0 };
  }

  let added = 0;
  let removed = 0;
  const mirrored: Array<{ channelId: string; personIds: readonly string[] }> = [];
  const planBySection = new Map(ctx.plan.channels.map((c) => [c.section, c]));
  for (const row of channels) {
    const planned = planBySection.get(row.section as string);
    if (!planned) continue;
    const result = await live.adapter.setMembers(
      row.remote_channel_id as string,
      planned.memberEmails,
    );
    added += result.added.length;
    removed += result.removed.length;
    mirrored.push({ channelId: row.id as string, personIds: planned.memberPersonIds });
  }
  await withPerson(sql, actor.person.id, async (tx) => {
    for (const m of mirrored) await mirrorMembers(tx, m.channelId, m.personIds);
    await recordAudit(tx, actor, {
      jurisdictionId: ctx.jurisdictionId,
      incidentId,
      category: "collab.membership_synced",
      subjectTable: "collab_spaces",
      subjectId: space.id as string,
      payload: { added, removed },
    });
  });
  return { degraded: false, added, removed };
}

export async function postAnnouncement(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  section: string | null,
  text: string,
  transport: HttpTransport = httpTransport,
): Promise<{ degraded: boolean }> {
  const target = section ?? "all";
  const planned = await withPerson(sql, actor.person.id, async (tx) => {
    const ctx = await loadIncidentContext(tx, incidentId);
    requireWriter(actor, ctx.jurisdictionId);
    const [space] = await tx`
      select id, status from collab_spaces where incident_id = ${incidentId}`;
    const live = await loadLiveBackend(tx, ctx.jurisdictionId, transport);
    if (!live || !space || (space.status as string) !== "active") {
      await degrade(tx, actor, ctx, `${ctx.name}: ${text}`);
      return null;
    }
    const [channel] = await tx`
      select remote_channel_id from collab_channels
      where space_id = ${space.id as string} and section = ${target}`;
    if (!channel) throw new AuthError(404, "no such section channel");
    return { ctx, live, spaceId: space.id as string, remoteChannelId: channel.remote_channel_id as string };
  });
  if (!planned) return { degraded: true };
  await planned.live.adapter.postAnnouncement(planned.remoteChannelId, text);
  await withPerson(sql, actor.person.id, (tx) =>
    recordAudit(tx, actor, {
      jurisdictionId: planned.ctx.jurisdictionId,
      incidentId,
      category: "collab.announced",
      subjectTable: "collab_spaces",
      subjectId: planned.spaceId,
      payload: { section: target },
    }),
  );
  return { degraded: false };
}

export async function archiveForIncident(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  transport: HttpTransport = httpTransport,
): Promise<{ archived: boolean }> {
  const found = await withPerson(sql, actor.person.id, async (tx) => {
    const ctx = await loadIncidentContext(tx, incidentId);
    requireAdmin(actor, ctx.jurisdictionId);
    const [space] = await tx`
      select id, remote_space_id, status from collab_spaces where incident_id = ${incidentId}`;
    if (!space || (space.status as string) === "archived") return null;
    const live = await loadLiveBackend(tx, ctx.jurisdictionId, transport);
    return { ctx, live, spaceId: space.id as string, remoteSpaceId: space.remote_space_id as string };
  });
  if (!found) return { archived: false };
  if (found.live) await found.live.adapter.archiveSpace(found.remoteSpaceId);
  await withPerson(sql, actor.person.id, async (tx) => {
    await tx`
      update collab_spaces set status = 'archived', archived_at = now()
      where id = ${found.spaceId}`;
    await recordAudit(tx, actor, {
      jurisdictionId: found.ctx.jurisdictionId,
      incidentId,
      category: "collab.archived",
      subjectTable: "collab_spaces",
      subjectId: found.spaceId,
    });
  });
  return { archived: true };
}

/** Whether an enabled, credentialed backend is configured for a jurisdiction. */
export async function isBackendEnabled(sql: Sql, jurisdictionId: string): Promise<boolean> {
  const [row] = await sql`
    select enabled, token_envelope from collab_backends where jurisdiction_id = ${jurisdictionId}`;
  return Boolean(row?.enabled && row?.token_envelope);
}

/** Re-sync every active incident that includes a given position. Best-effort. */
export async function syncPositionIncidents(
  sql: Sql,
  actor: Principal,
  positionId: string,
  transport: HttpTransport = httpTransport,
): Promise<void> {
  const rows = await withPerson(sql, actor.person.id, (tx) => tx`
    select distinct i.id from incident_positions ip
    join incidents i on i.id = ip.incident_id
    where ip.position_id = ${positionId} and i.closed_at is null`);
  for (const r of rows) {
    try {
      await syncIncidentMembership(sql, actor, r.id as string, transport);
    } catch {
      // One incident's sync failing must not block the assignment.
    }
  }
}

/** Replace a channel's mirrored membership with exactly these person ids. */
async function mirrorMembers(sql: Sql, channelId: string, personIds: readonly string[]): Promise<void> {
  await sql`delete from collab_channel_members where channel_id = ${channelId}`;
  for (const personId of personIds) {
    await sql`
      insert into collab_channel_members (channel_id, person_id)
      values (${channelId}, ${personId}) on conflict do nothing`;
  }
}

/** The no-backend path: an in-app notification to each current holder. */
async function degrade(
  sql: Sql,
  actor: Principal,
  ctx: IncidentContext,
  message: string,
): Promise<void> {
  for (const personId of ctx.holderPersonIds) {
    await sql`
      insert into notifications (jurisdiction_id, person_id, channel, title, body, status, detail)
      values (${ctx.jurisdictionId}, ${personId}, 'collab', ${`Incident: ${ctx.name}`},
              ${message}, 'delivered', ${sql.json({ degraded: true } as never)})`;
  }
  await recordAudit(sql, actor, {
    jurisdictionId: ctx.jurisdictionId,
    incidentId: ctx.incidentId,
    category: "collab.degraded",
    subjectTable: "incidents",
    subjectId: ctx.incidentId,
    payload: { notified: ctx.holderPersonIds.length, message },
  });
}
