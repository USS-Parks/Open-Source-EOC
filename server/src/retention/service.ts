import type { Sql } from "../db/client.js";
import { recordAudit } from "../audit/service.js";
import { requireAdmin, type Principal } from "../auth/service.js";

/**
 * Records retention. A jurisdiction admin sets a retention period per data
 * class, and the scheduler's purge job deletes expired rows from that class's
 * tables and no others. Nothing is purged for a class until its period is
 * set. The audit trail and incident records are never purged; the audit
 * trail leaves only by export.
 *
 * The tables per class are the allowlist enforced by `retention_purge` in the
 * database; none of them carries an append-only trigger.
 */
export const DATA_CLASSES = {
  notifications: ["notifications", "delivery_outbox"],
  deliveries: ["delivery_outbox", "federation_outbox"],
  feed_items: ["feed_items"],
  tracking: ["tracked_objects", "tracking_events"],
  staff_checkins: ["staff_checkins"],
} as const;

export type DataClass = keyof typeof DATA_CLASSES;

export const DATA_CLASS_NAMES = Object.keys(DATA_CLASSES) as [DataClass, ...DataClass[]];

export interface RetentionPolicy {
  readonly dataClass: DataClass;
  /** Days a row is kept; null keeps the class indefinitely. */
  readonly retentionDays: number | null;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export interface RetentionChange {
  readonly dataClass: DataClass;
  readonly retentionDays: number | null;
}

// ponytail: at most this many rows per class per jurisdiction per hourly run
// (120,000 a day); raise it if a backlog outgrows that.
const PURGE_BATCH = 5000;

/** Every data class with its period, null where none is set. */
export async function getRetention(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<RetentionPolicy[]> {
  requireAdmin(actor, jurisdictionId);
  const rows = await sql`
    select data_class, retention_days, updated_at, updated_by
    from retention_policies where jurisdiction_id = ${jurisdictionId}`;
  const byClass = new Map(rows.map((r) => [r.data_class as string, r]));
  return DATA_CLASS_NAMES.map((dataClass) => {
    const row = byClass.get(dataClass);
    return {
      dataClass,
      retentionDays: (row?.retention_days as number | null | undefined) ?? null,
      updatedAt: row ? new Date(row.updated_at as string).toISOString() : null,
      updatedBy: (row?.updated_by as string | undefined) ?? null,
    };
  });
}

/** Set the period for each listed class; classes not listed keep theirs. */
export async function setRetention(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  changes: readonly RetentionChange[],
): Promise<RetentionPolicy[]> {
  requireAdmin(actor, jurisdictionId);
  for (const change of changes) {
    await sql`
      insert into retention_policies (jurisdiction_id, data_class, retention_days, updated_by)
      values (${jurisdictionId}, ${change.dataClass}, ${change.retentionDays}, ${actor.person.id})
      on conflict (jurisdiction_id, data_class) do update
      set retention_days = excluded.retention_days, updated_by = excluded.updated_by,
          updated_at = now()`;
  }
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "retention.policy.updated",
    subjectTable: "retention_policies",
    payload: { changes },
  });
  return getRetention(sql, actor, jurisdictionId);
}

/**
 * One purge pass across every jurisdiction with a period set. Returns the rows
 * deleted per table for each jurisdiction where anything was deleted; each of
 * those jurisdictions also gains one `retention.purged` audit event.
 */
export async function purgeExpired(
  sql: Sql,
  batch = PURGE_BATCH,
): Promise<Record<string, Record<string, number>>> {
  const [row] = await sql`select retention_purge(${batch}) as purged`;
  return row!.purged as Record<string, Record<string, number>>;
}
