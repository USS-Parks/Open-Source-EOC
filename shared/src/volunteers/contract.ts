import { z } from "zod";

/**
 * Volunteer and CERT roster (VC-20). Volunteers are not accounts: a roster
 * entry names a person, their affiliation (a CERT team, a faith group, a
 * partner organization), how to reach them, their skills, and their
 * credentials, each with its issuer and expiry. A jurisdiction's staff enter
 * and edit the roster. A partner organization taking part in an incident
 * enters its own volunteers for that incident and reads only those.
 *
 * A deployment assigns a volunteer to an incident in a role, from a start to
 * an end, and may name the credentials the role needs. Hours come from
 * deployments: a volunteer's ended deployments, merged where they overlap and
 * cut at local midnight, one row per volunteer per day.
 */

/** Credential names match without regard to case or surrounding space. */
export const credentialKey = (name: string): string => name.trim().toLowerCase();

const Text = (max: number) => z.string().trim().max(max);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD")
  .refine((day) => !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day, "a date that exists");
/** Deployment times are kept to the minute, so hours add up exactly. */
const Minute = z.iso.datetime({ offset: true })
  .refine((value) => Date.parse(value) % 60_000 === 0, "a time to the minute, with no seconds");
const uniqueNames = (max: number, length: number, what: string) =>
  z.array(Text(length).min(1)).max(max).default([]).refine(
    (values) => new Set(values.map(credentialKey)).size === values.length,
    `each ${what} is listed once`,
  );

export const VOLUNTEER_AFFILIATIONS = ["cert", "faith", "partner", "community", "other"] as const;
export type VolunteerAffiliation = (typeof VOLUNTEER_AFFILIATIONS)[number];
export const VOLUNTEER_AFFILIATION_LABELS: Readonly<Record<VolunteerAffiliation, string>> = {
  cert: "CERT team",
  faith: "Faith group",
  partner: "Partner organization",
  community: "Community group",
  other: "Other",
};

export const VolunteerCredentialSchema = z.object({
  /** Such as "CERT Basic Training", "CPR and First Aid" or "Amateur radio license". */
  name: Text(200).min(1),
  issuer: Text(200).default(""),
  issuedOn: Day.nullable().default(null),
  /** None for a credential that does not expire. */
  expiresOn: Day.nullable().default(null),
}).strict().refine(
  (credential) => !credential.issuedOn || !credential.expiresOn || credential.expiresOn >= credential.issuedOn,
  { message: "a credential expires on or after the day it is issued", path: ["expiresOn"] },
);

export const VolunteerSchema = z.object({
  name: Text(200).min(1),
  affiliation: z.enum(VOLUNTEER_AFFILIATIONS),
  /** The team's, group's or organization's name. */
  affiliationName: Text(200).default(""),
  phone: Text(40).default(""),
  email: z.union([z.literal(""), z.email().max(254)]).default(""),
  skills: uniqueNames(30, 80, "skill"),
  credentials: z.array(VolunteerCredentialSchema).max(30).default([]).refine(
    (credentials) => new Set(credentials.map((c) => credentialKey(c.name))).size === credentials.length,
    "each credential is listed once",
  ),
  notes: Text(2000).default(""),
  active: z.boolean().default(true),
}).strict();

const deploymentFields = {
  role: Text(200).min(1),
  startsAt: Minute,
  /** None while the deployment is under way. */
  endsAt: Minute.nullable().default(null),
  /** The credentials the role needs, by name. */
  needs: uniqueNames(10, 200, "credential"),
  note: Text(500).default(""),
};
const endsAfterStart = { message: "a deployment ends after it starts", path: ["endsAt"] };
const ends = (d: { startsAt: string; endsAt: string | null }) => d.endsAt === null || Date.parse(d.endsAt) > Date.parse(d.startsAt);

export const VolunteerDeploymentSchema = z.object({ incidentId: z.string().uuid(), ...deploymentFields })
  .strict().refine(ends, endsAfterStart);
/** A deployment's own details; its volunteer and incident stay as they were. */
export const VolunteerDeploymentUpdateSchema = z.object(deploymentFields).strict().refine(ends, endsAfterStart);

export type VolunteerCredential = z.infer<typeof VolunteerCredentialSchema>;
export type VolunteerInput = z.input<typeof VolunteerSchema>;
export type Volunteer = z.infer<typeof VolunteerSchema>;
export type VolunteerDeploymentInput = z.input<typeof VolunteerDeploymentSchema>;
export type VolunteerDeploymentUpdate = z.input<typeof VolunteerDeploymentUpdateSchema>;

export interface VolunteerView {
  readonly id: string;
  readonly name: string;
  readonly affiliation: VolunteerAffiliation;
  readonly affiliationName: string;
  readonly skills: readonly string[];
  /** Each credential, expired when its expiry is before the roster's day. */
  readonly credentials: ReadonlyArray<VolunteerCredential & { readonly expired: boolean }>;
  /** Null when the reader may not see how to reach the volunteer. */
  readonly contact: { readonly phone: string; readonly email: string } | null;
  /** The partner organization that entered the volunteer, and the incident it entered them for; null for the jurisdiction's staff. */
  readonly enteredBy: { readonly organizationId: string; readonly organizationName: string; readonly incidentId: string } | null;
  readonly notes: string;
  readonly active: boolean;
  readonly updatedAt: string;
}

export interface VolunteerDeploymentView {
  readonly id: string;
  readonly volunteerId: string;
  readonly volunteerName: string;
  readonly incidentId: string;
  readonly incidentName: string;
  readonly role: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly needs: readonly string[];
  readonly note: string;
  /** A needed credential the volunteer does not hold, or that expires before the deployment's last day. */
  readonly warnings: readonly string[];
}

export interface VolunteerHoursDay {
  readonly volunteerId: string;
  readonly volunteerName: string;
  readonly date: string;
  readonly minutes: number;
}

export interface VolunteerRoster {
  readonly jurisdictionId: string;
  /** The incident the deployments and hours are narrowed to, when read for one. */
  readonly incidentId: string | null;
  readonly timeZone: string;
  /** The roster's day in its time zone; a credential that expires before it is expired. */
  readonly today: string;
  readonly volunteers: readonly VolunteerView[];
  readonly deployments: readonly VolunteerDeploymentView[];
  /** Per volunteer per local day, from ended deployments. */
  readonly hours: readonly VolunteerHoursDay[];
  /** Deployments under way, not counted in the hours until they end. */
  readonly underWay: ReadonlyArray<{ readonly deploymentId: string; readonly volunteerName: string; readonly since: string }>;
  /** How the reader adds volunteers: to the jurisdiction's roster, for their organization in this incident, or not at all. */
  readonly entry: "jurisdiction" | "organization" | null;
  readonly canSeeContacts: boolean;
}

/**
 * What a deployment needs that the volunteer lacks through `throughDay`, the
 * deployment's last local day: a credential not held, or one expired before
 * that day. A credential with no expiry, or one expiring that day or later,
 * covers the need.
 */
export function deploymentWarnings(
  credentials: ReadonlyArray<Pick<VolunteerCredential, "name" | "expiresOn">>,
  needs: readonly string[],
  throughDay: string,
): string[] {
  return needs.flatMap((need) => {
    const held = credentials.filter((credential) => credentialKey(credential.name) === credentialKey(need));
    if (held.length === 0) return [`No ${need} on record`];
    if (held.some((credential) => credential.expiresOn === null || credential.expiresOn >= throughDay)) return [];
    const latest = held.map((credential) => credential.expiresOn!).sort().at(-1)!;
    return [`${need} expired ${latest}`];
  });
}
