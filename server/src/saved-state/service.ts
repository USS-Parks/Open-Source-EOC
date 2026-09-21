import type {
  SavedStateKind,
  SavedStateListPage,
  SavedStatePayload,
  SavedStateRecord,
  SavedStateWrite,
} from "@openeoc/shared";
import { AuthError, type Principal } from "../auth/service.js";
import type { Sql } from "../db/client.js";
import { getIncidentAuthority } from "../incidents/participation.js";

function toState(row: Record<string, unknown>): SavedStateRecord {
  return {
    incidentId: row.incident_id as string,
    kind: row.kind as SavedStateKind,
    key: row.state_key as string,
    schemaVersion: row.schema_version as number,
    revision: row.revision as number,
    payload: row.payload as SavedStatePayload,
    createdAt: new Date(row.created_at as Date | string).toISOString(),
    updatedAt: new Date(row.updated_at as Date | string).toISOString(),
  };
}

async function requireIncidentRead(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<void> {
  await getIncidentAuthority(sql, actor, incidentId);
}

export async function listSavedStates(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  kind: SavedStateKind,
  cursor: string | undefined,
  requestedLimit: number,
): Promise<SavedStateListPage> {
  await requireIncidentRead(sql, actor, incidentId);
  const limit = Math.max(1, Math.min(requestedLimit, 100));
  const rows = await sql`
    select incident_id, kind, state_key, schema_version, revision, payload,
      created_at, updated_at
    from saved_states
    where person_id = ${actor.person.id} and incident_id = ${incidentId}
      and kind = ${kind}
      and (${cursor ?? null}::text is null or state_key > ${cursor ?? null})
    order by state_key
    limit ${limit + 1}`;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map(toState);
  return { states: page, nextCursor: hasMore ? page.at(-1)!.key : null };
}

export async function getSavedState(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  kind: SavedStateKind,
  key: string,
): Promise<SavedStateRecord> {
  await requireIncidentRead(sql, actor, incidentId);
  const [row] = await sql`
    select incident_id, kind, state_key, schema_version, revision, payload,
      created_at, updated_at
    from saved_states
    where person_id = ${actor.person.id} and incident_id = ${incidentId}
      and kind = ${kind} and state_key = ${key}`;
  if (!row) throw new AuthError(404, "saved state not found");
  return toState(row);
}

async function conflictOrMissing(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  kind: SavedStateKind,
  key: string,
): Promise<never> {
  const [current] = await sql`
    select revision from saved_states
    where person_id = ${actor.person.id} and incident_id = ${incidentId}
      and kind = ${kind} and state_key = ${key}`;
  if (current) throw new AuthError(409, `saved state revision is ${current.revision as number}`);
  throw new AuthError(404, "saved state not found");
}

export async function saveSavedState(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  kind: SavedStateKind,
  key: string,
  input: SavedStateWrite,
): Promise<SavedStateRecord> {
  await requireIncidentRead(sql, actor, incidentId);
  const serializedPayload = JSON.stringify(input.payload);
  let row: Record<string, unknown> | undefined;
  if (input.expectedRevision === 0) {
    [row] = await sql`
      insert into saved_states
        (person_id, incident_id, kind, state_key, schema_version, payload)
      values (${actor.person.id}, ${incidentId}, ${kind}, ${key},
        ${input.schemaVersion}, ${serializedPayload}::text::json)
      on conflict do nothing
      returning incident_id, kind, state_key, schema_version, revision, payload,
        created_at, updated_at`;
    if (!row) {
      const [current] = await sql`
        select revision from saved_states
        where person_id = ${actor.person.id} and incident_id = ${incidentId}
          and kind = ${kind} and state_key = ${key}`;
      if (current) throw new AuthError(409, `saved state revision is ${current.revision as number}`);
      throw new AuthError(404, "incident not found");
    }
  } else {
    [row] = await sql`
      update saved_states set schema_version = ${input.schemaVersion},
        payload = ${serializedPayload}::text::json,
        revision = revision + 1, updated_at = now()
      where person_id = ${actor.person.id} and incident_id = ${incidentId}
        and kind = ${kind} and state_key = ${key}
        and revision = ${input.expectedRevision}
      returning incident_id, kind, state_key, schema_version, revision, payload,
        created_at, updated_at`;
    if (!row) return conflictOrMissing(sql, actor, incidentId, kind, key);
  }
  return toState(row);
}

export async function deleteSavedState(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  kind: SavedStateKind,
  key: string,
  expectedRevision: number,
): Promise<void> {
  await requireIncidentRead(sql, actor, incidentId);
  const [deleted] = await sql`
    delete from saved_states
    where person_id = ${actor.person.id} and incident_id = ${incidentId}
      and kind = ${kind} and state_key = ${key}
      and revision = ${expectedRevision}
    returning revision`;
  if (!deleted) await conflictOrMissing(sql, actor, incidentId, kind, key);
}
