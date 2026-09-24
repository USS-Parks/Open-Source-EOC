import { z } from "zod";
import { WorkflowAssignmentRequestSchema } from "../boards/workflow.js";
import type { ResourceKindDefinition } from "../dictionary/resource-typing.js";

export const ResourceOrganizationSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
});
export type ResourceOrganization = z.infer<typeof ResourceOrganizationSchema>;

export const ResourceRequestAssignmentSchema = WorkflowAssignmentRequestSchema;
export type ResourceRequestAssignment = z.infer<typeof ResourceRequestAssignmentSchema>;

export const ResourceAssignmentViewSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("position"),
    positionId: z.uuid(),
    positionKey: z.string().min(1),
    positionTitle: z.string().min(1),
    organization: ResourceOrganizationSchema,
  }),
  z.object({
    kind: z.literal("incident_participant"),
    participantId: z.uuid(),
    incidentId: z.uuid(),
    personId: z.uuid(),
    personName: z.string().min(1),
    incidentPositionTitle: z.string().min(1),
    participantRole: z.enum(["contributor", "coordinator"]),
    organization: ResourceOrganizationSchema,
  }),
]);
export type ResourceAssignmentView = z.infer<typeof ResourceAssignmentViewSchema>;

export const ResourceRequestSummarySchema = z.object({
  id: z.uuid(),
  incidentId: z.uuid().nullable(),
  item: z.string().min(1),
  quantity: z.number().int().positive(),
  priority: z.string().min(1),
  state: z.string().min(1),
  receivingOrganization: ResourceOrganizationSchema,
  supplyingOrganization: ResourceOrganizationSchema.nullable(),
  assignment: ResourceAssignmentViewSchema.nullable(),
  /** The catalog kind requested, and the least capable type that fills it; null takes any type. */
  resourceKind: z.string().nullable(),
  resourceType: z.number().int().nullable(),
  /** Every cost recorded on the request, in cents. */
  costCents: z.number().int().nonnegative(),
});
export type ResourceRequestSummary = z.infer<typeof ResourceRequestSummarySchema>;

/** A kind in a jurisdiction's typing catalog: seeded, added locally, or imported from the RTLT. */
export interface ResourceKind extends ResourceKindDefinition {
  readonly source: "seed" | "local" | "rtlt";
  readonly rtltId: string | null;
  readonly sourceNote: string;
}

/** A resource in a jurisdiction's pool. */
export interface PoolResource {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly type: number | null;
  readonly status: string;
  readonly request: { readonly id: string; readonly item: string } | null;
  readonly returnCondition: string | null;
  readonly demobilizationChecks: readonly string[];
  readonly updatedAt: string;
}

export const ResourceRequestChronologySchema = z.object({
  fromState: z.string().nullable(),
  toState: z.string().min(1),
  note: z.string().nullable(),
  by: z.string().nullable(),
  at: z.string().datetime({ offset: true }),
});
export type ResourceRequestChronology = z.infer<typeof ResourceRequestChronologySchema>;

export const ResourceRequestDetailSchema = ResourceRequestSummarySchema.extend({
  chronology: z.array(ResourceRequestChronologySchema),
});
export type ResourceRequestDetail = z.infer<typeof ResourceRequestDetailSchema>;
