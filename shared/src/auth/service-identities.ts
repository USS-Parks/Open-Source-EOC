import { z } from "zod";

/**
 * Service identities (VC-25): an integration that is not a person, scoped to
 * one jurisdiction at the viewer role (read) or the member role (read and
 * write), with an expiry. Its token is shown once, at creation.
 */

/** The longest an identity may live before it is replaced. */
export const SERVICE_IDENTITY_MAX_DAYS = 366;

export const SERVICE_IDENTITY_ROLES = ["viewer", "member"] as const;
export type ServiceIdentityRole = (typeof SERVICE_IDENTITY_ROLES)[number];

/**
 * Characters a name may not hold: control characters (as the people import
 * refuses), format characters such as bidirectional overrides and zero-width
 * joiners, line and paragraph separators, and the Hangul fillers that render
 * as blank. Each can make a name read as something it is not.
 */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0]/u;

export const ServiceIdentityCreateSchema = z.object({
  name: z.string().trim().min(1).max(120).refine((name) => !HIDDEN.test(name), "the name holds a control or invisible character"),
  role: z.enum(SERVICE_IDENTITY_ROLES),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();
export type ServiceIdentityCreate = z.infer<typeof ServiceIdentityCreateSchema>;

export interface ServiceIdentity {
  readonly id: string;
  readonly name: string;
  readonly role: ServiceIdentityRole;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
  /** Why it may not act now, or null when it may. */
  readonly stopped: ServiceIdentityStop | null;
}

/**
 * Revoked; expired; disabled through the People routes; or "creator", when
 * whoever created it no longer administers its jurisdiction or is disabled.
 */
export type ServiceIdentityStop = "revoked" | "expired" | "disabled" | "creator";
