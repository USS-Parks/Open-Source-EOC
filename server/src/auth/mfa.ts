import { randomBytes } from "node:crypto";
import { recordAudit } from "../audit/service.js";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { decryptSecret, encryptSecret, hasSecretKey } from "../secrets/envelope.js";
import { checkAllowed, recordFailure, recordSuccess } from "./rate-limit.js";
import {
  AuthError,
  checkPassword,
  createSession,
  principalForPerson,
  type LoginResult,
} from "./service.js";
import { hashToken, newToken } from "./tokens.js";
import { matchTotp, newTotpSecret, otpauthUri, toBase32 } from "./totp.js";

/**
 * Second factor for local accounts: TOTP with single-use recovery codes.
 * A password alone never mints a session for an enrolled person. It yields
 * a short-lived, single-use challenge token, and the session is issued only
 * when that token comes back with a valid code. OIDC sign-in does not pass
 * through here; the identity provider owns its own second factor.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
const NO_KEY = "server not provisioned for secret storage (OPENEOC_SECRET_KEY unset)";
const BAD_CHALLENGE = "sign-in challenge is invalid or expired";

export type MfaChallenge =
  | { readonly mfaRequired: true; readonly mfaToken: string }
  | { readonly mfaEnrollmentRequired: true; readonly mfaToken: string };

/**
 * Password sign-in. An enrolled person is always asked for a code. When
 * requireAdminMfa is on, a jurisdiction or instance admin who has not
 * enrolled must enroll before a session is issued; enabling IPAWS is an
 * admin act, so this covers every account that can enable it. Anyone else
 * gets a session directly.
 */
export async function passwordLogin(
  sql: Sql,
  email: string,
  password: string,
  requireAdminMfa: boolean,
): Promise<LoginResult | MfaChallenge> {
  const personId = await checkPassword(sql, email, password);
  const challenge = await withPerson(sql, personId, async (tx): Promise<MfaChallenge | null> => {
    const [row] = await tx`
      select
        exists (select 1 from person_mfa
                where person_id = ${personId} and activated_at is not null) as enrolled,
        (select is_instance_admin from persons where id = ${personId})
          or exists (select 1 from jurisdiction_memberships
                     where person_id = ${personId} and role = 'admin') as privileged`;
    if (row!.enrolled)
      return { mfaRequired: true, mfaToken: await issueChallenge(tx, personId, "verify") };
    if (requireAdminMfa && row!.privileged)
      return { mfaEnrollmentRequired: true, mfaToken: await issueChallenge(tx, personId, "enroll") };
    return null;
  });
  return challenge ?? createSession(sql, personId);
}

/** Start or restart enrollment: a fresh secret, inactive until a first code proves it. */
export async function beginEnrollment(
  sql: Sql,
  mfaToken: string,
): Promise<{ secret: string; otpauthUri: string }> {
  const personId = await challengePerson(sql, mfaToken, "enroll");
  if (!hasSecretKey()) throw new AuthError(409, NO_KEY);
  const secret = newTotpSecret();
  return withPerson(sql, personId, async (tx) => {
    const [person] = await tx`select email from persons where id = ${personId}`;
    const stored = await tx`
      insert into person_mfa (person_id, secret_envelope)
      values (${personId}, ${encryptSecret(secret)})
      on conflict (person_id) do update
        set secret_envelope = excluded.secret_envelope, last_step = 0
        where person_mfa.activated_at is null
      returning person_id`;
    if (stored.length === 0) throw new AuthError(409, "MFA is already enrolled");
    return { secret, otpauthUri: otpauthUri(secret, person!.email as string) };
  });
}

/**
 * Finish enrollment with a first code. Activation issues ten recovery codes,
 * returned once and stored only as hashes, and completes the sign-in.
 */
export async function activateEnrollment(
  sql: Sql,
  mfaToken: string,
  code: string,
): Promise<LoginResult & { recoveryCodes: string[] }> {
  const personId = await challengePerson(sql, mfaToken, "enroll");
  const recoveryCodes = await withPerson(sql, personId, async (tx) => {
    const [row] = await tx`
      select secret_envelope from person_mfa
      where person_id = ${personId} and activated_at is null for update`;
    if (!row) throw new AuthError(409, "start enrollment before activating");
    const step = matchTotp(openSecret(row.secret_envelope as string), code.trim());
    if (step === null) return null;
    await spendChallenge(tx, mfaToken);
    await tx`
      update person_mfa set activated_at = now(), last_step = ${step}
      where person_id = ${personId}`;
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await tx`delete from mfa_recovery_codes where person_id = ${personId}`;
    for (const recovery of codes)
      await tx`
        insert into mfa_recovery_codes (person_id, code_hash)
        values (${personId}, ${hashRecoveryCode(recovery)})`;
    return codes;
  });
  if (!recoveryCodes) return rejectCode(sql, personId);
  recordSuccess(rateKey(personId));
  await auditMfa(sql, personId, "mfa.enrolled");
  return { ...(await createSession(sql, personId)), recoveryCodes };
}

/**
 * Complete a sign-in with a TOTP code or one unused recovery code. A TOTP
 * step at or below the last accepted step is refused, so an observed code
 * cannot be replayed; a recovery code is spent by the first use.
 */
export async function verifyMfa(sql: Sql, mfaToken: string, code: string): Promise<LoginResult> {
  const personId = await challengePerson(sql, mfaToken, "verify");
  const method = await withPerson(sql, personId, async (tx) => {
    const [row] = await tx`
      select secret_envelope from person_mfa
      where person_id = ${personId} and activated_at is not null`;
    if (!row) throw new AuthError(401, BAD_CHALLENGE);
    const step = matchTotp(openSecret(row.secret_envelope as string), code.trim());
    let method: "totp" | "recovery" | null = null;
    if (step !== null) {
      const advanced = await tx`
        update person_mfa set last_step = ${step}
        where person_id = ${personId} and last_step < ${step}
        returning person_id`;
      if (advanced.length === 1) method = "totp";
    } else {
      const spent = await tx`
        update mfa_recovery_codes set used_at = now()
        where person_id = ${personId} and code_hash = ${hashRecoveryCode(code)}
          and used_at is null
        returning id`;
      if (spent.length === 1) method = "recovery";
    }
    if (method) await spendChallenge(tx, mfaToken);
    return method;
  });
  if (!method) return rejectCode(sql, personId);
  recordSuccess(rateKey(personId));
  if (method === "recovery") await auditMfa(sql, personId, "mfa.recovery_code_used");
  return createSession(sql, personId);
}

async function issueChallenge(tx: Sql, personId: string, purpose: "verify" | "enroll"): Promise<string> {
  const token = newToken();
  await tx`delete from mfa_challenges where person_id = ${personId} and expires_at < now()`;
  await tx`
    insert into mfa_challenges (token_hash, person_id, purpose, expires_at)
    values (${token.hash}, ${personId}, ${purpose}, ${new Date(Date.now() + CHALLENGE_TTL_MS)})`;
  return token.token;
}

/** Resolve a presented challenge to its person, then apply the attempt backoff. */
async function challengePerson(sql: Sql, mfaToken: string, purpose: "verify" | "enroll"): Promise<string> {
  const [row] = await sql`select resolve_mfa_challenge(${hashToken(mfaToken)}, ${purpose}) as person_id`;
  const personId = row?.person_id as string | null | undefined;
  if (!personId) throw new AuthError(401, BAD_CHALLENGE);
  if (!checkAllowed(rateKey(personId))) throw new AuthError(429, "too many attempts, retry later");
  return personId;
}

/** Spend the challenge; a concurrent request that already spent it loses. */
async function spendChallenge(tx: Sql, mfaToken: string): Promise<void> {
  const spent = await tx`
    update mfa_challenges set used_at = now()
    where token_hash = ${hashToken(mfaToken)} and used_at is null
    returning token_hash`;
  if (spent.length !== 1) throw new AuthError(401, BAD_CHALLENGE);
}

function openSecret(envelope: string): string {
  if (!hasSecretKey()) throw new AuthError(409, NO_KEY);
  return decryptSecret(envelope);
}

async function rejectCode(sql: Sql, personId: string): Promise<never> {
  recordFailure(rateKey(personId));
  await auditMfa(sql, personId, "mfa.verification_failed");
  throw new AuthError(401, "invalid verification code");
}

/** The login backoff keyed on the person, so new challenges do not reset it. */
function rateKey(personId: string): string {
  return `mfa:${personId}`;
}

/** Fifty random bits, shown as two groups of five, for example "k3m9q-x2p7d". */
function newRecoveryCode(): string {
  const raw = toBase32(randomBytes(7)).slice(0, 10).toLowerCase();
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function hashRecoveryCode(code: string): string {
  return hashToken(code.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * MFA events land in the audit trail of every jurisdiction the person
 * belongs to; audit events are jurisdiction-scoped, and a person with no
 * membership has no trail to write to.
 */
async function auditMfa(sql: Sql, personId: string, category: string): Promise<void> {
  const actor = await principalForPerson(sql, personId);
  await withPerson(sql, personId, async (tx) => {
    for (const membership of actor.memberships)
      await recordAudit(tx, actor, {
        jurisdictionId: membership.jurisdictionId,
        category,
        subjectTable: "persons",
        subjectId: personId,
      });
  });
}
