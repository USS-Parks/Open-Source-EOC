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
import { AuthError, requireMember, requireWriter, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { lockIncidentMutation } from "../incidents/participation.js";

/**
 * CAP authoring, publishing, and ingest (F20). Authoring
 * validates against CAP 1.2 and computes IPAWS eligibility; publishing
 * stores the alert with its XML and raises a notification. Ingest parses
 * external CAP XML with full fidelity and stores it. Actual IPAWS
 * transmission is enable-at-will through the IPAWS module; this is the standards core.
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

export type AlertReviewState = "draft" | "in_review" | "approved";

export interface AlertReviewResult {
  readonly revision: number;
  readonly state: AlertReviewState;
  readonly actorName: string;
  readonly createdAt: string;
}

export interface AlertTransmissionResult {
  readonly state: "not_attempted" | "accepted" | "rejected";
  readonly environment: string | null;
  readonly submittedAt: string | null;
  readonly submittedByName: string | null;
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
  if (incidentId) {
    await requireOpenIncident(sql, incidentId, jurisdictionId);
  }
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
  await notify(sql, actor, jurisdictionId, alert, "authored", incidentId);
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

/** Store an unsent local CAP draft or exercise and begin its append-only review log. */
export async function createAlertDraft(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  draft: unknown,
  incidentId?: string,
): Promise<AuthorResult & { readonly reviewState: "draft" }> {
  const status = (draft as Record<string, unknown>).status;
  if (status !== "Draft" && status !== "Exercise" && status !== "Test") {
    throw new CapValidationError([{ path: "status", message: "local alert drafts must use Draft, Exercise, or Test status" }]);
  }
  const result = await authorAlert(sql, actor, jurisdictionId, draft, incidentId);
  await sql`
    insert into cap_alert_reviews (alert_id, jurisdiction_id, revision, state, actor_person_id)
    values (${result.id}, ${jurisdictionId}, 1, 'draft', ${actor.person.id})`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(incidentId ? { incidentId } : {}),
    category: "cap.draft.created",
    subjectTable: "cap_alerts",
    subjectId: result.id,
    payload: { identifier: result.identifier, status },
  });
  return { ...result, reviewState: "draft" };
}

export async function reviewAlert(
  sql: Sql,
  actor: Principal,
  id: string,
  next: AlertReviewState,
): Promise<AlertReviewResult> {
  const [candidate] = await sql`
    select jurisdiction_id, incident_id from cap_alerts where id = ${id}`;
  if (!candidate) throw new AuthError(404, "alert not found");
  const jurisdictionId = candidate.jurisdiction_id as string;
  requireWriter(actor, jurisdictionId);
  if (candidate.incident_id) {
    await requireOpenIncident(sql, candidate.incident_id as string, jurisdictionId);
  }
  await sql`select pg_advisory_xact_lock(hashtextextended(${id}, 83::bigint))`;
  const [row] = await sql`
    select a.jurisdiction_id, a.incident_id, a.origin, review.state as review_state,
      review.revision as review_revision
    from cap_alerts a
    left join lateral (
      select r.state, r.revision from cap_alert_reviews r where r.alert_id = a.id
      order by r.revision desc limit 1
    ) review on true
    where a.id = ${id}`;
  if (!row) throw new AuthError(404, "alert not found");
  if (row.origin !== "authored" || !row.review_state) {
    throw new AuthError(409, "only local alert drafts have review state");
  }
  const current = row.review_state as AlertReviewState;
  const allowed = (current === "draft" && next === "in_review")
    || (current === "in_review" && (next === "draft" || next === "approved"));
  if (!allowed) throw new AuthError(409, `cannot move alert review from ${current} to ${next}`);
  const [event] = await sql`
    insert into cap_alert_reviews (alert_id, jurisdiction_id, revision, state, actor_person_id)
    values (${id}, ${jurisdictionId}, ${(row.review_revision as number) + 1}, ${next}, ${actor.person.id})
    returning revision, created_at`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(row.incident_id ? { incidentId: row.incident_id as string } : {}),
    category: "cap.review.changed",
    subjectTable: "cap_alerts",
    subjectId: id,
    payload: { revision: event!.revision as number, from: current, to: next },
  });
  return {
    revision: event!.revision as number,
    state: next,
    actorName: actor.person.displayName,
    createdAt: (event!.created_at as Date).toISOString(),
  };
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
): Promise<{
  alert: CapAlert;
  xml: string;
  ipawsEligible: boolean;
  origin: string;
  incidentId: string | null;
  createdAt: string;
  review: AlertReviewResult | null;
  transmission: AlertTransmissionResult;
}> {
  const [row] = await sql`
    select a.jurisdiction_id, a.incident_id, a.alert, a.xml, a.ipaws_eligible, a.origin, a.created_at,
      review.revision as review_revision, review.state as review_state,
      review.created_at as reviewed_at, reviewer.display_name as reviewer_name,
      submission.accepted as transmission_accepted,
      submission.environment as transmission_environment,
      submission.submitted_at as transmitted_at,
      submitter.display_name as transmission_submitter_name
    from cap_alerts a
    left join lateral (
      select revision, state, actor_person_id, created_at from cap_alert_reviews
      where alert_id = a.id order by revision desc limit 1
    ) review on true
    left join persons reviewer on reviewer.id = review.actor_person_id
    left join lateral (
      select accepted, environment, submitted_by, submitted_at from ipaws_submissions
      where cap_alert_id = a.id order by submitted_at desc, id desc limit 1
    ) submission on true
    left join persons submitter on submitter.id = submission.submitted_by
    where a.id = ${id}`;
  if (!row) throw new AuthError(404, "alert not found");
  requireMember(actor, row.jurisdiction_id as string);
  return {
    alert: CapAlertSchema.parse(row.alert),
    xml: row.xml as string,
    ipawsEligible: Boolean(row.ipaws_eligible),
    origin: row.origin as string,
    incidentId: row.incident_id as string | null,
    createdAt: (row.created_at as Date).toISOString(),
    review: row.review_state ? {
      revision: row.review_revision as number,
      state: row.review_state as AlertReviewState,
      actorName: row.reviewer_name as string,
      createdAt: (row.reviewed_at as Date).toISOString(),
    } : null,
    transmission: transmissionFromRow(row),
  };
}

export async function listAlerts(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<Array<Record<string, unknown>>> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select a.id, a.identifier, a.origin, a.status, a.msg_type, a.scope, a.ipaws_eligible,
      a.incident_id, a.created_at, a.alert #>> '{info,0,headline}' as headline,
      a.alert #>> '{info,0,event}' as event, review.revision as review_revision,
      review.state as review_state, review.created_at as reviewed_at,
      reviewer.display_name as reviewer_name, submission.accepted as transmission_accepted,
      submission.environment as transmission_environment,
      submission.submitted_at as transmitted_at,
      submitter.display_name as transmission_submitter_name
    from cap_alerts a
    left join lateral (
      select revision, state, actor_person_id, created_at from cap_alert_reviews
      where alert_id = a.id order by revision desc limit 1
    ) review on true
    left join persons reviewer on reviewer.id = review.actor_person_id
    left join lateral (
      select accepted, environment, submitted_by, submitted_at from ipaws_submissions
      where cap_alert_id = a.id order by submitted_at desc, id desc limit 1
    ) submission on true
    left join persons submitter on submitter.id = submission.submitted_by
    where a.jurisdiction_id = ${jurisdictionId} order by a.created_at desc`;
  return rows.map((r) => ({
    ...r,
    ipaws_eligible: Boolean(r.ipaws_eligible),
    created_at: (r.created_at as Date).toISOString(),
    reviewed_at: r.reviewed_at ? (r.reviewed_at as Date).toISOString() : null,
    transmission: transmissionFromRow(r),
  }));
}

function transmissionFromRow(row: Record<string, unknown>): AlertTransmissionResult {
  if (row.transmitted_at == null) {
    return { state: "not_attempted", environment: null, submittedAt: null, submittedByName: null };
  }
  return {
    state: row.transmission_accepted ? "accepted" : "rejected",
    environment: row.transmission_environment as string,
    submittedAt: (row.transmitted_at as Date).toISOString(),
    submittedByName: row.transmission_submitter_name as string | null,
  };
}

async function requireOpenIncident(sql: Sql, incidentId: string, jurisdictionId: string): Promise<void> {
  await lockIncidentMutation(sql, incidentId);
  const [incident] = await sql`
    select jurisdiction_id, closed_at from incidents where id = ${incidentId}`;
  if (!incident || incident.jurisdiction_id !== jurisdictionId) {
    throw new AuthError(404, "incident not found");
  }
  if (incident.closed_at) throw new AuthError(409, "incident is closed");
}

async function notify(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  alert: CapAlert,
  origin: string,
  incidentId?: string,
): Promise<void> {
  const headline = alert.info[0]?.headline ?? alert.info[0]?.event ?? alert.identifier;
  await sql`
    insert into notifications
      (jurisdiction_id, person_id, channel, title, body, status, detail)
    values
      (${jurisdictionId}, ${actor.person.id}, 'cap', ${`CAP ${origin}: ${headline}`},
       ${alert.info[0]?.description ?? ""}, 'delivered',
       ${sql.json({ identifier: alert.identifier, origin, incidentId: incidentId ?? null, urgency: alert.info[0]?.urgency ?? null, severity: alert.info[0]?.severity ?? null } as never)})`;
}
