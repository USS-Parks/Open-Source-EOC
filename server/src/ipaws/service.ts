import { CapAlertSchema, capToXml } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireAdmin, requireMember, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { withPerson } from "../db/context.js";
import { decryptSecret, encryptSecret, fingerprint, hasSecretKey } from "../secrets/envelope.js";
import {
  httpTransport,
  IpawsCredentialError,
  postCap,
  readCertificate,
  type IpawsCredentials,
  type IpawsResult,
  type IpawsSend,
  type IpawsTransport,
} from "./connector.js";

/**
 * IPAWS-OPEN enablement and transmission (R2). The connector is
 * disabled by default. Going live is gated on two explicit acts by a
 * jurisdiction admin: configuring a COG's credentials and acknowledging
 * the documented MOA. Once both exist, enabling is a single toggle with no
 * redeploy. Transmission is admin-only, refused while disabled (INV-7),
 * limited to IPAWS-eligible alerts, and logged for attribution (INV-2).
 * A send to the real endpoint needs two admins: one requests it and a
 * different one confirms it before the request expires.
 */

export interface IpawsStatus {
  readonly enabled: boolean;
  readonly environment: string;
  readonly configured: boolean;
  readonly cogId: string | null;
  readonly endpointUrl: string | null;
  readonly credentialFingerprint: string | null;
  /** When the stored COG certificate expires; null until one is configured. */
  readonly certificateExpiresAt: string | null;
  readonly moaAcknowledged: boolean;
  readonly moaReference: string | null;
  readonly moaAcknowledgedAt: string | null;
  readonly secretStorageAvailable: boolean;
}

interface ConfigRow {
  enabled: boolean;
  environment: string;
  cog_id: string | null;
  endpoint_url: string | null;
  credential_envelope: string | null;
  credential_fingerprint: string | null;
  certificate_expires_at: Date | null;
  moa_acknowledged: boolean;
  moa_reference: string | null;
  moa_acknowledged_at: Date | null;
}

async function loadConfig(sql: Sql, jurisdictionId: string): Promise<ConfigRow | null> {
  const [row] = await sql`
    select enabled, environment, cog_id, endpoint_url, credential_envelope,
           credential_fingerprint, certificate_expires_at, moa_acknowledged, moa_reference,
           moa_acknowledged_at
    from ipaws_config where jurisdiction_id = ${jurisdictionId}`;
  return (row as ConfigRow | undefined) ?? null;
}

function toStatus(row: ConfigRow | null): IpawsStatus {
  return {
    enabled: row?.enabled ?? false,
    environment: row?.environment ?? "test",
    configured: Boolean(row?.cog_id && row?.credential_envelope && row?.certificate_expires_at),
    cogId: row?.cog_id ?? null,
    endpointUrl: row?.endpoint_url ?? null,
    credentialFingerprint: row?.credential_fingerprint ?? null,
    certificateExpiresAt: row?.certificate_expires_at ? row.certificate_expires_at.toISOString() : null,
    moaAcknowledged: row?.moa_acknowledged ?? false,
    moaReference: row?.moa_reference ?? null,
    moaAcknowledgedAt: row?.moa_acknowledged_at ? row.moa_acknowledged_at.toISOString() : null,
    secretStorageAvailable: hasSecretKey(),
  };
}

export async function getStatus(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<IpawsStatus> {
  requireMember(actor, jurisdictionId);
  return toStatus(await loadConfig(sql, jurisdictionId));
}

export interface ConfigureInput {
  readonly environment: "test" | "production";
  readonly cogId: string;
  readonly endpointUrl: string;
  /**
   * The COG's FEMA-issued certificate and RSA private key as one PEM bundle;
   * omit to update other fields without resending it.
   */
  readonly credential?: string;
}

/**
 * Configure (or reconfigure) a jurisdiction's IPAWS-OPEN COG. Admin only.
 * The certificate bundle, new or stored, is checked against the COG id as
 * IPAWS-OPEN will check it, and refused with 422 naming the problem.
 */
export async function configure(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: ConfigureInput,
): Promise<IpawsStatus> {
  requireAdmin(actor, jurisdictionId);
  if (input.credential !== undefined && !hasSecretKey())
    throw new AuthError(409, "server not provisioned for secret storage (OPENEOC_SECRET_KEY unset)");
  const stored = input.credential === undefined ? (await loadConfig(sql, jurisdictionId))?.credential_envelope : null;
  const bundle = input.credential ?? (stored && hasSecretKey() ? decryptSecret(stored) : null);
  let expiresAt: Date | null = null;
  if (bundle !== null) {
    try {
      expiresAt = readCertificate(bundle, input.cogId).expiresAt;
    } catch (err) {
      if (err instanceof IpawsCredentialError) throw new AuthError(422, `COG certificate refused: ${err.message}`);
      throw err;
    }
  }
  const envelope = input.credential !== undefined ? encryptSecret(input.credential) : null;
  const fp = input.credential !== undefined ? fingerprint(input.credential) : null;
  await sql`
    insert into ipaws_config
      (jurisdiction_id, environment, cog_id, endpoint_url, credential_envelope,
       credential_fingerprint, certificate_expires_at, updated_by, updated_at)
    values
      (${jurisdictionId}, ${input.environment}, ${input.cogId}, ${input.endpointUrl},
       ${envelope}, ${fp}, ${expiresAt}, ${actor.person.id}, now())
    on conflict (jurisdiction_id) do update set
      environment = excluded.environment,
      cog_id = excluded.cog_id,
      endpoint_url = excluded.endpoint_url,
      credential_envelope = coalesce(excluded.credential_envelope, ipaws_config.credential_envelope),
      credential_fingerprint =
        coalesce(excluded.credential_fingerprint, ipaws_config.credential_fingerprint),
      certificate_expires_at = excluded.certificate_expires_at,
      updated_by = excluded.updated_by,
      updated_at = now()`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "ipaws.configured",
    subjectTable: "ipaws_config",
    subjectId: jurisdictionId,
    payload: {
      environment: input.environment,
      cogId: input.cogId,
      credentialSet: envelope !== null,
      certificateExpiresAt: expiresAt?.toISOString() ?? null,
    },
  });
  return toStatus(await loadConfig(sql, jurisdictionId));
}

/** Acknowledge the documented MOA with FEMA. Admin only. */
export async function acknowledgeMoa(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  reference: string,
): Promise<IpawsStatus> {
  requireAdmin(actor, jurisdictionId);
  if (!reference.trim()) throw new AuthError(400, "an MOA reference is required");
  const result = await sql`
    update ipaws_config set
      moa_acknowledged = true, moa_reference = ${reference},
      moa_acknowledged_by = ${actor.person.id}, moa_acknowledged_at = now(),
      updated_by = ${actor.person.id}, updated_at = now()
    where jurisdiction_id = ${jurisdictionId}`;
  if (result.count === 0) throw new AuthError(409, "configure IPAWS before acknowledging the MOA");
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "ipaws.moa_acknowledged",
    subjectTable: "ipaws_config",
    subjectId: jurisdictionId,
    payload: { reference },
  });
  return toStatus(await loadConfig(sql, jurisdictionId));
}

/**
 * Flip IPAWS on or off. Enabling is the single administrative act that
 * takes a configured, MOA-acknowledged COG live with no redeploy; it fails
 * closed if any prerequisite is missing. Disabling is always permitted.
 */
export async function setEnabled(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  enabled: boolean,
): Promise<IpawsStatus> {
  requireAdmin(actor, jurisdictionId);
  const row = await loadConfig(sql, jurisdictionId);
  if (enabled) {
    if (!row?.cog_id || !row?.endpoint_url)
      throw new AuthError(409, "configure a COG and endpoint before enabling IPAWS");
    if (!row.credential_envelope || !row.certificate_expires_at)
      throw new AuthError(409, "configure the COG certificate and key before enabling IPAWS");
    if (!row.moa_acknowledged)
      throw new AuthError(409, "acknowledge the documented MOA before enabling IPAWS");
    if (!hasSecretKey())
      throw new AuthError(409, "server not provisioned for secret storage (OPENEOC_SECRET_KEY unset)");
  }
  await sql`
    update ipaws_config set enabled = ${enabled}, updated_by = ${actor.person.id}, updated_at = now()
    where jurisdiction_id = ${jurisdictionId}`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: enabled ? "ipaws.enabled" : "ipaws.disabled",
    subjectTable: "ipaws_config",
    subjectId: jurisdictionId,
    payload: { enabled },
  });
  return toStatus(await loadConfig(sql, jurisdictionId));
}

export interface SubmitResult extends IpawsResult {
  readonly submissionId: string;
}

/**
 * 'live' sends to an enabled COG; 'handshake' is the dry run against the
 * IPAWS-OPEN test environment, allowed before enablement.
 */
export type SendKind = "live" | "handshake";

/** How long a requested send waits for a second admin before it lapses. */
export const SEND_REQUEST_MINUTES = 15;

export interface SendRequest {
  readonly id: string;
  readonly capAlertId: string;
  readonly kind: SendKind;
  readonly status: "pending" | "confirmed" | "cancelled" | "expired";
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly submissionId: string | null;
}

interface Sendable {
  readonly environment: string;
  readonly cogId: string;
  readonly endpointUrl: string;
  readonly credentialEnvelope: string;
  readonly xml: string;
}

/** A time in CAP 1.2 form: whole seconds and a numeric zone, never "Z". */
function capTime(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "-00:00");
}

/**
 * The configuration and alert XML for a send, or the reason it cannot go.
 * IPAWS-OPEN refuses an alert whose sent time is more than 5 minutes old
 * (IDG code 303), and a second admin has SEND_REQUEST_MINUTES to confirm, so
 * the stored alert is serialized afresh with sent set to now. An alert that
 * has expired by then is refused.
 */
async function sendable(
  sql: Sql,
  jurisdictionId: string,
  capAlertId: string,
  kind: SendKind,
): Promise<Sendable> {
  const row = await loadConfig(sql, jurisdictionId);
  if (!row) throw new AuthError(409, "IPAWS is not configured for this jurisdiction");
  if (kind === "live" && !row.enabled) throw new AuthError(403, "IPAWS is not enabled");
  if (kind === "handshake" && row.environment !== "test")
    throw new AuthError(409, "a test handshake is only allowed against the IPAWS test environment");
  if (!row.cog_id || !row.endpoint_url || !row.credential_envelope)
    throw new AuthError(409, "IPAWS configuration is incomplete");
  if (!row.certificate_expires_at)
    throw new AuthError(409, "reconfigure IPAWS with the COG certificate and key");
  const now = new Date();
  if (row.certificate_expires_at.getTime() <= now.getTime())
    throw new AuthError(409, `the COG certificate expired on ${row.certificate_expires_at.toISOString()}`);

  const [alert] = await sql`
    select jurisdiction_id, alert, ipaws_eligible from cap_alerts where id = ${capAlertId}`;
  if (!alert) throw new AuthError(404, "alert not found");
  if ((alert.jurisdiction_id as string) !== jurisdictionId)
    throw new AuthError(403, "alert belongs to another jurisdiction");
  if (!(alert.ipaws_eligible as boolean))
    throw new AuthError(422, "alert is not IPAWS-eligible");
  const cap = CapAlertSchema.safeParse(alert.alert);
  if (!cap.success) throw new AuthError(422, "the stored alert cannot be read for transmission");
  const lapsed = cap.data.info.find((info) => !(Date.parse(info.expires ?? "") > now.getTime()));
  if (lapsed) throw new AuthError(409, `the alert expired at ${lapsed.expires ?? "an unset time"}; author a new one`);
  return {
    environment: row.environment,
    cogId: row.cog_id,
    endpointUrl: row.endpoint_url,
    credentialEnvelope: row.credential_envelope,
    xml: capToXml({ ...cap.data, sent: capTime(now) }),
  };
}

/**
 * Log one send attempt, accepted or rejected, with its outcome in
 * ipaws_submissions and the audit: the status of each channel, and the
 * signed alert as transmitted.
 */
async function recordSubmission(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  capAlertId: string,
  send: Sendable,
  result: IpawsSend,
  attribution: Record<string, unknown>,
): Promise<SubmitResult> {
  const [sub] = await sql`
    insert into ipaws_submissions
      (jurisdiction_id, cap_alert_id, environment, cog_id, accepted, detail, channels,
       transmitted_xml, submitted_by)
    values
      (${jurisdictionId}, ${capAlertId}, ${send.environment}, ${send.cogId}, ${result.accepted},
       ${result.detail}, ${sql.json(result.channels as never)}, ${result.transmittedXml},
       ${actor.person.id})
    returning id`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "ipaws.submitted",
    subjectTable: "cap_alerts",
    subjectId: capAlertId,
    payload: {
      accepted: result.accepted,
      environment: send.environment,
      cogId: send.cogId,
      detail: result.detail,
      channels: result.channels,
      ...attribution,
    },
  });
  return {
    accepted: result.accepted,
    detail: result.detail,
    httpStatus: result.httpStatus,
    channels: result.channels,
    submissionId: sub!.id as string,
  };
}

/** The connector's credentials: the COG's certificate, sent as the acting admin. */
function credentials(send: Sendable, actor: Principal, certificate: string): IpawsCredentials {
  return { cogId: send.cogId, logonUser: actor.person.email, certificate };
}

/**
 * Send single-handed through an injected transport: the recorded-fixture
 * path. Refused while disabled. It runs inside the caller's transaction
 * because it refuses the HTTP transport, so nothing it awaits leaves the
 * process. Anything bound for the real IPAWS-OPEN endpoint goes through
 * requestSend and a second admin's confirmSend.
 */
export async function postAlert(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  capAlertId: string,
  transport: IpawsTransport,
): Promise<SubmitResult> {
  requireAdmin(actor, jurisdictionId);
  if (transport === httpTransport)
    throw new AuthError(409, "an IPAWS send needs a second admin's confirmation");
  const send = await sendable(sql, jurisdictionId, capAlertId, "live");
  const result = await postCap(
    send.endpointUrl,
    credentials(send, actor, decryptSecret(send.credentialEnvelope)),
    send.xml,
    transport,
  );
  return recordSubmission(sql, actor, jurisdictionId, capAlertId, send, result, {});
}

function toSendRequest(row: Record<string, unknown>): SendRequest {
  const iso = (v: unknown): string | null => (v ? (v as Date).toISOString() : null);
  return {
    id: row.id as string,
    capAlertId: row.cap_alert_id as string,
    kind: row.kind as SendKind,
    status: row.status as SendRequest["status"],
    requestedBy: row.requested_by as string,
    requestedAt: iso(row.requested_at)!,
    expiresAt: iso(row.expires_at)!,
    decidedBy: (row.decided_by as string | null) ?? null,
    decidedAt: iso(row.decided_at),
    submissionId: (row.submission_id as string | null) ?? null,
  };
}

async function sendRequests(sql: Sql, jurisdictionId: string, id?: string): Promise<SendRequest[]> {
  const rows = await sql`
    select id, cap_alert_id, kind, requested_by, requested_at, expires_at,
      decided_by, decided_at, submission_id,
      case when status = 'pending' and expires_at <= now() then 'expired' else status end as status
    from ipaws_send_requests
    where jurisdiction_id = ${jurisdictionId} ${id ? sql`and id = ${id}` : sql``}
    order by requested_at desc limit 50`;
  return rows.map(toSendRequest);
}

/** The jurisdiction's most recent send requests, newest first. Admin only. */
export async function listSendRequests(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<SendRequest[]> {
  requireAdmin(actor, jurisdictionId);
  return sendRequests(sql, jurisdictionId);
}

/**
 * First half of the two-person rule: an admin asks to send an alert. Nothing
 * is transmitted until a different admin confirms within
 * SEND_REQUEST_MINUTES.
 */
export async function requestSend(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  capAlertId: string,
  kind: SendKind,
): Promise<SendRequest> {
  requireAdmin(actor, jurisdictionId);
  await sendable(sql, jurisdictionId, capAlertId, kind);
  const [row] = await sql`
    insert into ipaws_send_requests (jurisdiction_id, cap_alert_id, kind, requested_by, expires_at)
    values (${jurisdictionId}, ${capAlertId}, ${kind}, ${actor.person.id},
            now() + make_interval(mins => ${SEND_REQUEST_MINUTES}))
    returning id`;
  const [request] = await sendRequests(sql, jurisdictionId, row!.id as string);
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "ipaws.send.requested",
    subjectTable: "ipaws_send_requests",
    subjectId: request!.id,
    payload: { capAlertId, kind, expiresAt: request!.expiresAt },
  });
  return request!;
}

/**
 * Second half: a different admin confirms, and the send runs under the
 * confirming admin with both identities in the audit. `sql` is the pool, not
 * a transaction: the confirmation is checked, claimed and audited in one
 * transaction, IPAWS-OPEN is called with none open, and the submission is
 * recorded in a second. A confirmed request is never sent again, so a send
 * that fails in transit is recorded as not accepted. If the process stops
 * between the call and the record, the request stays confirmed with no
 * submission in the send list; it cannot be resent, and a new send must be
 * requested. The transport is injectable for tests; production uses a real
 * HTTP POST.
 */
export async function confirmSend(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  requestId: string,
  transport: IpawsTransport = httpTransport,
): Promise<SubmitResult & { readonly request: SendRequest }> {
  requireAdmin(actor, jurisdictionId);
  const claim = await withPerson(sql, actor.person.id, async (tx) => {
    const [pending] = await tx`
      select cap_alert_id, kind, requested_by, status, expires_at <= now() as expired
      from ipaws_send_requests
      where jurisdiction_id = ${jurisdictionId} and id = ${requestId}
      for update`;
    if (!pending) throw new AuthError(404, "send request not found");
    if (pending.status !== "pending")
      throw new AuthError(409, `send request is already ${pending.status as string}`);
    if (pending.expired) throw new AuthError(409, "send request expired; request the send again");
    if (pending.requested_by === actor.person.id)
      throw new AuthError(403, "a different admin must confirm this send");

    const capAlertId = pending.cap_alert_id as string;
    const kind = pending.kind as SendKind;
    const requestedBy = pending.requested_by as string;
    const send = await sendable(tx, jurisdictionId, capAlertId, kind);
    await tx`
      update ipaws_send_requests
      set status = 'confirmed', decided_by = ${actor.person.id}, decided_at = now()
      where id = ${requestId}`;
    await recordAudit(tx, actor, {
      jurisdictionId,
      category: "ipaws.send.confirmed",
      subjectTable: "ipaws_send_requests",
      subjectId: requestId,
      payload: { capAlertId, kind, requestedBy, confirmedBy: actor.person.id },
    });
    return { capAlertId, requestedBy, send, certificate: decryptSecret(send.credentialEnvelope) };
  });

  const { capAlertId, requestedBy, send } = claim;
  const result = await postCap(send.endpointUrl, credentials(send, actor, claim.certificate), send.xml, transport)
    .catch((err: unknown): IpawsSend => ({
      accepted: false,
      detail: `not sent: ${err instanceof Error ? err.message : String(err)}`,
      httpStatus: 0,
      channels: [],
      transmittedXml: null,
    }));

  return withPerson(sql, actor.person.id, async (tx) => {
    const submitted = await recordSubmission(tx, actor, jurisdictionId, capAlertId, send, result, {
      requestId,
      requestedBy,
    });
    await tx`update ipaws_send_requests set submission_id = ${submitted.submissionId} where id = ${requestId}`;
    const [request] = await sendRequests(tx, jurisdictionId, requestId);
    return { ...submitted, request: request! };
  });
}

/** Withdraw a pending send. Any admin of the jurisdiction may. */
export async function cancelSend(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  requestId: string,
): Promise<SendRequest> {
  requireAdmin(actor, jurisdictionId);
  const [row] = await sql`
    update ipaws_send_requests
    set status = 'cancelled', decided_by = ${actor.person.id}, decided_at = now()
    where jurisdiction_id = ${jurisdictionId} and id = ${requestId} and status = 'pending'
    returning cap_alert_id, requested_by`;
  if (!row) {
    const [existing] = await sendRequests(sql, jurisdictionId, requestId);
    if (!existing) throw new AuthError(404, "send request not found");
    throw new AuthError(409, `send request is already ${existing.status}`);
  }
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "ipaws.send.cancelled",
    subjectTable: "ipaws_send_requests",
    subjectId: requestId,
    payload: {
      capAlertId: row.cap_alert_id as string,
      requestedBy: row.requested_by as string,
      cancelledBy: actor.person.id,
    },
  });
  const [request] = await sendRequests(sql, jurisdictionId, requestId);
  return request!;
}
