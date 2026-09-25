import { z } from "zod";

export const IncidentParticipantRoleSchema = z.enum(["viewer", "contributor", "coordinator"]);
export type IncidentParticipantRole = z.infer<typeof IncidentParticipantRoleSchema>;

export const IncidentParticipantGrantInputSchema = z.object({
  organizationSlug: z.string().trim().min(1).max(120),
  personEmail: z.email(),
  incidentPositionTitle: z.string().trim().min(1).max(120),
  role: IncidentParticipantRoleSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1).max(1000),
}).strict();
export type IncidentParticipantGrantInput = z.infer<typeof IncidentParticipantGrantInputSchema>;

export const IncidentParticipantRevokeInputSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
}).strict();

export interface IncidentParticipantGrant {
  readonly id: string;
  readonly incidentId: string;
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly organizationName: string;
  readonly personId: string;
  readonly personEmail: string;
  readonly personName: string;
  readonly incidentPositionTitle: string;
  readonly role: IncidentParticipantRole;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  /** The invitation the person was sent, as its administrators read it; null to other readers. */
  readonly invitation: { readonly deliveredAt: string; readonly readAt: string | null } | null;
}

/** What a grant's role lets its person do on the incident, in the invitation's words. */
export const INCIDENT_PARTICIPANT_ROLE_SCOPE: Readonly<Record<IncidentParticipantRole, string>> = {
  viewer: "read what the incident shares with its participants",
  contributor: "read what the incident shares and add records, requests and messages",
  coordinator: "read and add to the incident, and revise its operational area where the incident allows",
};

/** One kind of thing an incident holds, and which of it a grant's person reads. */
export interface PreviewSection {
  readonly key: "boards" | "records" | "requests" | "threads" | "datasets";
  readonly label: string;
  /** What the person reads, by name. */
  readonly readable: readonly string[];
  /** What the reviewing administrator reads and the person does not, by name. */
  readonly restricted: readonly string[];
}

/** What a participant grant lets its person read on the incident. */
export interface GrantPreview {
  readonly person: string;
  readonly organization: string;
  readonly role: string;
  readonly expiresAt: string;
  /** False once the grant is revoked or has expired: the person then reads nothing on the incident. */
  readonly active: boolean;
  readonly sections: readonly PreviewSection[];
}
