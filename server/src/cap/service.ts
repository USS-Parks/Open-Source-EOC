import { randomUUID } from "node:crypto";
import {
  CapAlertSchema,
  capFromXml,
  capToXml,
  isIpawsEligible,
  validateCap12,
  type CapAlert,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";

/**
 * CAP authoring, publishing, and ingest (VEOC-26, F20). Authoring
 * validates against CAP 1.2 and computes IPAWS eligibility; publishing
 * stores the alert with its XML and raises a notification. Ingest parses
 * external CAP XML with full fidelity and stores it. Actual IPAWS
 * transmission is enable-at-will (VEOC-31); this is the standards core.
 */

export class CapValidationError extends Error {
  constructor(readonly issues: ReadonlyArray<{ path: string; message: string }>) {
    super("CAP validation failed");
  }
}

export interface AuthorResult {
  readonly id: string;
  readonly identifier: string;
  readonly ipawsEligible: boolean;
  readonly xml: string;
}

/**
 * Author and publish a CAP alert from incident context. The draft may
 * omit identifier and sent; the server fills them so every published
 * alert is uniquely and truthfully stamped.
 */
export async function authorAlert(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  draft: unknown,
  incidentId?: string,
): Promise<AuthorResult> {
  requireWriter(actor, jurisdictionId);
  const raw = draft as Record<string, unknown>;
  const stamped = {
    ...raw,
    identifier: (raw.identifier as string) || `OPENEOC-${randomUUID()}`,
    sent: (raw.sent as string) || new Date().toISOString(),
  };
  const issues = validateCap12(stamped);
  if (issues.length > 0) throw new CapValidationError(issues);
  const alert: CapAlert = CapAlertSchema.parse(stamped);
  const eligible = isIpawsEligible(alert);
  const xml = capToXml(alert);
  const [row] = await sql`
    insert into cap_alerts
      (jurisdiction_id, incident_id, identifier, origin, status, msg_type, scope,
       ipaws_eligible, alert, xml, created_by)
    values
      (${jurisdictionId}, ${incidentId ?? null}, ${alert.identifier}, 'authored',
       ${alert.status}, ${alert.msgType}, ${alert.scope}, ${eligible},
       ${sql.json(alert as never)}, ${xml}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await notify(sql, actor, jurisdictionId, alert, "authored");
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(incidentId ? { incidentId } : {}),
    category: "cap.authored",
    subjectTable: "cap_alerts",
    subjectId: id,
    payload: { identifier: alert.identifier, ipawsEligible: eligible },
  });
  return { id, identifier: alert.identifier, ipawsEligible: eligible, xml };
}

/** Ingest an external CAP XML alert with full fidelity and store it. */
export async function ingestAlert(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  xml: string,
): Promise<{ id: string; identifier: string; alert: CapAlert }> {
  requireWriter(actor, jurisdictionId);
  let alert: CapAlert;
  try {
    alert = capFromXml(xml);
  } catch (err) {
    throw new CapValidationError([
      { path: "xml", message: err instanceof Error ? err.message : "unparseable CAP XML" },
    ]);
  }
  const issues = validateCap12(alert);
  if (issues.length > 0) throw new CapValidationError(issues);
  const [existing] = await sql`
    select id from cap_alerts
    where jurisdiction_id = ${jurisdictionId} and identifier = ${alert.identifier}`;
  if (existing) return { id: existing.id as string, identifier: alert.identifier, alert };
  const [row] = await sql`
    insert into cap_alerts
      (jurisdiction_id, identifier, origin, status, msg_type, scope, ipaws_eligible, alert, xml,
       created_by)
    values
      (${jurisdictionId}, ${alert.identifier}, 'ingested', ${alert.status}, ${alert.msgType},
       ${alert.scope}, ${isIpawsEligible(alert)}, ${sql.json(alert as never)},
       ${capToXml(alert)}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await notify(sql, actor, jurisdictionId, alert, "ingested");
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "cap.ingested",
    subjectTable: "cap_alerts",
    subjectId: id,
    payload: { identifier: alert.identifier },
  });
  return { id, identifier: alert.identifier, alert };
}

export async function getAlert(
  sql: Sql,
  actor: Principal,
  id: string,
): Promise<{ alert: CapAlert; xml: string; ipawsEligible: boolean; origin: string }> {
  const [row] = await sql`
    select jurisdiction_id, alert, xml, ipaws_eligible, origin from cap_alerts where id = ${id}`;
  if (!row) throw new AuthError(404, "alert not found");
  requireMember(actor, row.jurisdiction_id as string);
  return {
    alert: CapAlertSchema.parse(row.alert),
    xml: row.xml as string,
    ipawsEligible: Boolean(row.ipaws_eligible),
    origin: row.origin as string,
  };
}

export async function listAlerts(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<Array<Record<string, unknown>>> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select id, identifier, origin, status, msg_type, scope, ipaws_eligible, created_at
    from cap_alerts where jurisdiction_id = ${jurisdictionId} order by created_at desc`;
  return rows.map((r) => ({ ...r, ipaws_eligible: Boolean(r.ipaws_eligible) }));
}

async function notify(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  alert: CapAlert,
  origin: string,
): Promise<void> {
  const headline = alert.info[0]?.headline ?? alert.info[0]?.event ?? alert.identifier;
  await sql`
    insert into notifications
      (jurisdiction_id, person_id, channel, title, body, status, detail)
    values
      (${jurisdictionId}, ${actor.person.id}, 'cap', ${`CAP ${origin}: ${headline}`},
       ${alert.info[0]?.description ?? ""}, 'delivered',
       ${sql.json({ identifier: alert.identifier, origin } as never)})`;
}

function requireWriter(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || (m.role !== "admin" && m.role !== "member"))
    throw new AuthError(403, "requires write access to this jurisdiction");
}

function requireMember(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((x) => x.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
}
