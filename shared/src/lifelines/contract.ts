import { z } from "zod";
import { COMMUNITY_LIFELINES, LIFELINE_STATUS } from "../dictionary/lifelines.js";
import { WorkflowAssignmentRequestSchema } from "../boards/workflow.js";
import { IMPACT_CATEGORIES } from "../impact/contract.js";

const KeySchema = z.string().regex(/^[a-z][a-z0-9_]*$/).max(80);
const TextSchema = z.string().trim().min(1).max(4_000);
const OptionalTextSchema = z.string().trim().max(4_000).optional();
const TimestampSchema = z.string().datetime({ offset: true });

export const AssessmentConfidenceSchema = z.enum(["confirmed", "estimated", "unknown"]);
export const StabilizationActionStatusSchema = z.enum([
  "planned", "in_progress", "blocked", "complete",
]);

export const ReportedEvidenceSchema = z.object({
  kind: z.literal("reported"),
  description: TextSchema,
  sourceOrganizationId: z.string().uuid().optional(),
  sourceReference: z.string().trim().min(1).max(500).optional(),
  observedAt: TimestampSchema.optional(),
}).strict();

export const ImpactEvidenceRequestSchema = z.object({
  kind: z.literal("impact"),
  category: z.enum(IMPACT_CATEGORIES),
  areaRevision: z.number().int().positive().optional(),
  datasetId: z.string().uuid().optional(),
}).strict();

export const LifelineComponentInputSchema = z.object({
  key: KeySchema,
  label: z.string().trim().min(1).max(160),
  condition: LIFELINE_STATUS.schema,
  impactStatement: OptionalTextSchema,
  affectedGeography: z.string().trim().max(1_000).optional(),
  causes: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  dependencies: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
}).strict();

export const StabilizationActionInputSchema = z.object({
  key: KeySchema,
  title: z.string().trim().min(1).max(240),
  status: StabilizationActionStatusSchema,
  dueAt: TimestampSchema.optional(),
  responsibleOrganizationId: z.string().uuid().optional(),
  assignment: WorkflowAssignmentRequestSchema.optional(),
  linkedResourceRequestId: z.string().uuid().optional(),
  linkedBoardRecordId: z.string().uuid().optional(),
}).strict();

export const CreateLifelineAssessmentSchema = z.object({
  lifeline: COMMUNITY_LIFELINES.schema,
  definitionVersion: z.literal(1).default(1),
  condition: LIFELINE_STATUS.schema,
  assessedAt: TimestampSchema,
  confidence: AssessmentConfidenceSchema,
  impactStatement: TextSchema,
  operationalPeriod: z.string().trim().min(1).max(160).optional(),
  stabilizationOutlook: z.string().trim().max(4_000).optional(),
  /** What stabilized means for this lifeline in this incident. */
  stabilizationObjective: z.string().trim().min(1).max(4_000).optional(),
  /** When the reporting liaison will assess again; after the assessment time. */
  nextUpdateAt: TimestampSchema.optional(),
  components: z.array(LifelineComponentInputSchema).max(100).default([]),
  evidence: z.array(z.discriminatedUnion("kind", [
    ReportedEvidenceSchema, ImpactEvidenceRequestSchema,
  ])).max(100).default([]),
  responsibleOrganizationIds: z.array(z.string().uuid()).max(50).default([])
    .refine((items) => new Set(items).size === items.length, "duplicate responsible organization"),
  actions: z.array(StabilizationActionInputSchema).max(100).default([])
    .refine((items) => new Set(items.map((item) => item.key)).size === items.length,
      "duplicate stabilization action key"),
  supersedesAssessmentId: z.string().uuid().optional(),
}).strict().refine(
  (input) => !input.nextUpdateAt || Date.parse(input.nextUpdateAt) > Date.parse(input.assessedAt),
  { message: "the next update must come after the assessment", path: ["nextUpdateAt"] },
);

export const AssessmentDecisionSchema = z.object({
  selectedAssessmentId: z.string().uuid(),
  rationale: TextSchema,
}).strict();

export interface AssessmentAttribution {
  readonly personId: string;
  readonly personName: string;
  readonly positionId: string | null;
  readonly positionTitle: string | null;
  readonly participationId: string | null;
  readonly homeOrganizationId: string;
  readonly homeOrganizationName: string;
  readonly recordedAt: string;
}

export interface ImpactEvidenceSnapshot {
  readonly kind: "impact";
  readonly category: (typeof IMPACT_CATEGORIES)[number];
  readonly areaRevision: number;
  readonly datasetId: string | null;
  readonly value: number | null;
  readonly coverage: string;
  readonly reason: string | null;
  readonly loadedAt: string | null;
  readonly sourceVintage: string | null;
  readonly capturedAt: string;
}

export type CreateLifelineAssessment = z.infer<typeof CreateLifelineAssessmentSchema>;
export type AssessmentDecisionInput = z.infer<typeof AssessmentDecisionSchema>;
export type StabilizationActionInput = z.infer<typeof StabilizationActionInputSchema>;

export interface LifelineAssessmentReport {
  readonly id: string;
  readonly incidentId: string;
  readonly lifeline: string;
  readonly definitionVersion: number;
  readonly condition: string;
  readonly assessedAt: string;
  readonly sourceKind: "native" | "legacy_board";
  readonly legacyStatus: string | null;
  readonly payload: Record<string, unknown>;
  readonly stabilizationObjective: string | null;
  readonly nextUpdateAt: string | null;
  readonly supersedesAssessmentId: string | null;
  readonly legacyBoardId: string | null;
  readonly legacyRecordId: string | null;
  readonly attribution: AssessmentAttribution;
}

export interface LifelineCurrentState {
  readonly lifeline: string;
  readonly condition: string | null;
  readonly conflict: boolean;
  readonly reports: readonly LifelineAssessmentReport[];
  readonly decision: {
    readonly id: string;
    readonly selectedAssessmentId: string;
    readonly rationale: string;
    readonly attribution: AssessmentAttribution;
  } | null;
}
