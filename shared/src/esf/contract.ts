import { z } from "zod";
import {
  CALIFORNIA_ESFS,
  EMERGENCY_SUPPORT_FUNCTIONS,
  ESF_ACTIVATION,
  ESF_CAPACITY,
} from "../dictionary/esf.js";
import { COMMUNITY_LIFELINES } from "../dictionary/lifelines.js";
import {
  AssessmentConfidenceSchema,
  ReportedEvidenceSchema,
  StabilizationActionInputSchema,
  type AssessmentAttribution,
} from "../lifelines/contract.js";

const TimestampSchema = z.string().datetime({ offset: true });
const TextSchema = z.string().trim().min(1).max(4_000);

export const EsfFrameworkSchema = z.enum(["federal", "california"]);

export const EsfIdentitySchema = z.discriminatedUnion("framework", [
  z.object({
    framework: z.literal("federal"),
    esf: EMERGENCY_SUPPORT_FUNCTIONS.schema,
    definitionVersion: z.literal(1).default(1),
  }).strict(),
  z.object({
    framework: z.literal("california"),
    esf: CALIFORNIA_ESFS.schema,
    definitionVersion: z.literal(1).default(1),
  }).strict(),
]);

export const CreateEsfAssessmentSchema = z.object({
  identity: EsfIdentitySchema,
  activation: ESF_ACTIVATION.schema,
  capacity: ESF_CAPACITY.schema,
  assessedAt: TimestampSchema,
  confidence: AssessmentConfidenceSchema,
  situation: TextSchema,
  operationalPeriod: z.string().trim().min(1).max(160).optional(),
  coordinatorOrganizationId: z.string().uuid().optional(),
  supportingOrganizationIds: z.array(z.string().uuid()).max(50).default([])
    .refine((items) => new Set(items).size === items.length, "duplicate supporting organization"),
  missions: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  priorities: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  evidence: z.array(ReportedEvidenceSchema).max(100).default([]),
  relatedLifelines: z.array(COMMUNITY_LIFELINES.schema).max(8).default([])
    .refine((items) => new Set(items).size === items.length, "duplicate related lifeline"),
  actions: z.array(StabilizationActionInputSchema).max(100).default([])
    .refine((items) => new Set(items.map((item) => item.key)).size === items.length,
      "duplicate stabilization action key"),
  supersedesAssessmentId: z.string().uuid().optional(),
}).strict();

export type CreateEsfAssessment = z.infer<typeof CreateEsfAssessmentSchema>;

export interface EsfAssessmentReport {
  readonly id: string;
  readonly incidentId: string;
  readonly framework: "federal" | "california";
  readonly esf: string;
  readonly definitionVersion: number;
  readonly activation: string;
  readonly capacity: string;
  readonly legacyStatus: string | null;
  readonly assessedAt: string;
  readonly sourceKind: "native" | "legacy_board";
  readonly payload: Record<string, unknown>;
  readonly supersedesAssessmentId: string | null;
  readonly legacyBoardId: string | null;
  readonly legacyRecordId: string | null;
  readonly attribution: AssessmentAttribution;
}

export interface EsfCurrentState {
  readonly framework: "federal" | "california";
  readonly esf: string;
  readonly activation: string | null;
  readonly capacity: string | null;
  readonly conflict: boolean;
  readonly reports: readonly EsfAssessmentReport[];
  readonly decision: {
    readonly id: string;
    readonly selectedAssessmentId: string;
    readonly rationale: string;
    readonly attribution: AssessmentAttribution;
  } | null;
}
