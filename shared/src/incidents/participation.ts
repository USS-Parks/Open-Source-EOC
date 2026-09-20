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
}
