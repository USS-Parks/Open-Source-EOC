import type { Sql } from "../db/client.js";
import { AuthError, requireAdmin, requireMember, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { decryptSecret, encryptSecret, fingerprint, hasSecretKey } from "../secrets/envelope.js";
import { httpTransport, postCap, type IpawsResult, type IpawsTransport } from "./connector.js";

/**
 * IPAWS-OPEN enablement and transmission (R2). The connector is
 * disabled by default. Going live is gated on two explicit acts by a
 * jurisdiction admin: configuring a COG's credentials and acknowledging
 * the documented MOA. Once both exist, enabling is a single toggle with no
 * redeploy. Transmission is admin-only, refused while disabled (INV-7),
 * limited to IPAWS-eligible alerts, and logged for attribution (INV-2).
 */

export interface IpawsStatus {
  readonly enabled: boolean;
  readonly environment: string;
  readonly configured: boolean;
  readonly cogId: string | null;
  readonly endpointUrl: string | null;
  readonly credentialFingerprint: string | null;
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
  moa_acknowledged: boolean;
  moa_reference: string | null;
  moa_acknowledged_at: Date | null;
}

async function loadConfig(sql: Sql, jurisdictionId: string): Promise<ConfigRow | null> {
  const [row] = await sql`
    select enabled, environment, cog_id, endpoint_url, credential_envelope,
           credential_fingerprint, moa_acknowledged, moa_reference, moa_acknowledged_at
    from ipaws_config where jurisdiction_id = ${jurisdictionId}`;
  return (row as ConfigRow | undefined) ?? null;
}

function toStatus(row: ConfigRow | null): IpawsStatus {
  return {
    enabled: row?.enabled ?? false,
    environment: row?.environment ?? "test",
    configured: Boolean(row?.cog_id && row?.credential_envelope),
    cogId: row?.cog_id ?? null,
    endpointUrl: row?.endpoint_url ?? null,
    credentialFingerprint: row?.credential_fingerprint ?? null,
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
  /** The COG credential; omit to update other fields without resending it. */
  readonly credential?: string;
}

/** Configure (or reconfigure) a jurisdiction's IPAWS-OPEN COG. Admin only. */
export async function configure(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: ConfigureInput,
): Promise<IpawsStatus> {
  requireAdmin(actor, jurisdictionId);
  if (input.credential !== undefined && !hasSecretKey())
    throw new AuthError(409, "server not provisioned for secret storage (OPENEOC_SECRET_KEY unset)");
  const envelope = input.credential !== undefined ? encryptSecret(input.credential) : null;
  const fp = input.credential !== undefined ? fingerprint(input.credential) : null;
  await sql`
    insert into ipaws_config
      (jurisdiction_id, environment, cog_id, endpoint_url, credential_envelope,
       credential_fingerprint, updated_by, updated_at)
    values
      (${jurisdictionId}, ${input.environment}, ${input.cogId}, ${input.endpointUrl},
       ${envelope}, ${fp}, ${actor.person.id}, now())
    on conflict (jurisdiction_id) do update set
      environment = excluded.environment,
      cog_id = excluded.cog_id,
      endpoint_url = excluded.endpoint_url,
      credential_envelope = coalesce(excluded.credential_envelope, ipaws_config.credential_envelope),
      credential_fingerprint =
        coalesce(excluded.credential_fingerprint, ipaws_config.credential_fingerprint),
      updated_by = excluded.updated_by,
      updated_at = now()`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "ipaws.configured",
    subjectTable: "ipaws_config",
    subjectId: jurisdictionId,
    payload: { environment: input.environment, cogId: input.cogId, credentialSet: envelope !== null },
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
    if (!row.credential_envelope)
      throw new AuthError(409, "configure COG credentials before enabling IPAWS");
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
 * Send a stored, IPAWS-eligible CAP alert to IPAWS-OPEN. Refused while
 * disabled. Every attempt, accepted or rejected, is logged with its
 * outcome. The transport is injectable for the recorded-fixture handshake;
 * production uses a real HTTP POST.
 */
export async function postAlert(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  capAlertId: string,
  transport: IpawsTransport = httpTransport,
  options: { requireEnabled?: boolean } = {},
): Promise<SubmitResult> {
  requireAdmin(actor, jurisdictionId);
  const requireEnabled = options.requireEnabled ?? true;
  const row = await loadConfig(sql, jurisdictionId);
  if (!row) throw new AuthError(409, "IPAWS is not configured for this jurisdiction");
  if (requireEnabled && !row.enabled) throw new AuthError(403, "IPAWS is not enabled");
  if (!requireEnabled && row.environment !== "test")
    throw new AuthError(409, "a test handshake is only allowed against the IPAWS test environment");
  if (!row.cog_id || !row.endpoint_url || !row.credential_envelope)
    throw new AuthError(409, "IPAWS configuration is incomplete");

  const [alert] = await sql`
    select jurisdiction_id, xml, ipaws_eligible from cap_alerts where id = ${capAlertId}`;
  if (!alert) throw new AuthError(404, "alert not found");
  if ((alert.jurisdiction_id as string) !== jurisdictionId)
    throw new AuthError(403, "alert belongs to another jurisdiction");
  if (!(alert.ipaws_eligible as boolean))
    throw new AuthError(422, "alert is not IPAWS-eligible");

  const secret = decryptSecret(row.credential_envelope);
  const result = await postCap(
    row.endpoint_url,
    { cogId: row.cog_id, secret },
    alert.xml as string,
    transport,
  );

  const [sub] = await sql`
    insert into ipaws_submissions
      (jurisdiction_id, cap_alert_id, environment, cog_id, accepted, detail, submitted_by)
    values
      (${jurisdictionId}, ${capAlertId}, ${row.environment}, ${row.cog_id}, ${result.accepted},
       ${result.detail}, ${actor.person.id})
    returning id`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "ipaws.submitted",
    subjectTable: "cap_alerts",
    subjectId: capAlertId,
    payload: {
      accepted: result.accepted,
      environment: row.environment,
      cogId: row.cog_id,
      detail: result.detail,
    },
  });
  return { ...result, submissionId: sub!.id as string };
}
