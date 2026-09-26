import { z } from "zod";

/**
 * Executable plans (VC-09). A plan is a jurisdiction's emergency plan as an
 * object it can run: sections people read, each linked to the parts of the
 * incident template that carry it out; tasks released on a schedule; the
 * notice activation sends; and how often the plan is reviewed. Activating a
 * plan opens an incident from its template and then does the rest.
 *
 * An incident response plan times its tasks from activation. A recurring
 * event plan (a fire season, a fair, a holiday weekend) is activated for each
 * occurrence with the event's start, and times its tasks from that start,
 * before it as well as after. A continuity plan (VC-19) keeps a government's
 * essential functions running when its offices, people or systems are lost:
 * each function with the time it must be restored within and the position
 * that restores it, the recovery locations, the orders of succession and the
 * delegations of authority. Activating one opens a task per essential
 * function, due within its recovery time.
 */

const KeySchema = z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(80);
const GroupName = z.string().trim().min(1).max(200);
const unique = <T extends z.ZodTypeAny>(schema: T, max: number, what: string) =>
  z.array(schema).max(max).default([]).refine(
    (values) => new Set(values).size === values.length,
    `each ${what} is listed once`,
  );

export const PLAN_KINDS = ["incident_response", "recurring_event", "continuity"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/** A year either side of the anchor, in minutes. */
const YEAR_MINUTES = 525_600;

export const PlanSectionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(""),
  /** The template's positions, boards, contact groups and rules that carry this section out. */
  positions: unique(KeySchema, 30, "position"),
  boards: unique(KeySchema, 30, "board"),
  contactGroups: unique(GroupName, 20, "contact group"),
  rules: unique(KeySchema, 30, "rule"),
}).strict();

export const PlanTaskSchema = z.object({
  position: KeySchema,
  item: z.string().trim().min(1).max(500),
  category: KeySchema.default("general"),
  /**
   * Minutes from the anchor to the task's release: activation for an
   * incident response plan (zero or more), the event's start for a recurring
   * event plan (negative is before it).
   */
  releaseMinutes: z.number().int().min(-YEAR_MINUTES).max(YEAR_MINUTES),
  /** Minutes after release the task is due; none leaves it without a due time. */
  dueMinutes: z.number().int().min(1).max(43_200).optional(),
}).strict();

/** Whom activation notifies, by the names the template opens, and how. */
export const PlanNoticeSchema = z.object({
  contactGroups: unique(GroupName, 20, "contact group"),
  positions: unique(KeySchema, 50, "position"),
  onCallPositions: unique(KeySchema, 50, "on-call position"),
  channels: z.array(z.enum(["email", "sms", "inapp"])).min(1).max(3),
  message: z.string().trim().min(1).max(2000).optional(),
}).strict().refine(
  (notice) => notice.contactGroups.length + notice.positions.length + notice.onCallPositions.length > 0,
  "the notice needs a contact group, a position or an on-call position",
);

const Line = (max: number) => z.string().trim().min(1).max(max);

/** A function the government must keep performing, and how fast it must come back. */
export const EssentialFunctionSchema = z.object({
  name: Line(200),
  description: z.string().max(2000).default(""),
  /** 1 is restored first. */
  priority: z.number().int().min(1).max(99),
  /** Hours within which the function must be performing again: its recovery time objective. */
  recoveryHours: z.number().int().min(1).max(8760),
  /** The template position that restores and performs it. */
  position: KeySchema,
  resources: unique(Line(200), 30, "resource"),
  vitalRecords: unique(Line(200), 30, "vital record"),
}).strict();

export const RecoveryLocationSchema = z.object({
  name: Line(200),
  address: z.string().trim().max(300).default(""),
  /** How many staff it seats; none when not known. */
  capacity: z.number().int().min(1).max(10_000).optional(),
  notes: z.string().max(1000).default(""),
}).strict();

/** Who acts when the holder of a leadership role cannot, in order. */
export const SuccessionSchema = z.object({
  role: Line(200),
  successors: z.array(Line(200)).min(1).max(10),
}).strict();

export const DelegationSchema = z.object({
  authority: Line(300),
  delegatedTo: Line(200),
  /** When the delegation takes effect. */
  when: z.string().trim().max(500).default(""),
  limits: z.string().trim().max(500).default(""),
}).strict();

export const ContinuitySchema = z.object({
  essentialFunctions: z.array(EssentialFunctionSchema).min(1).max(50),
  recoveryLocations: z.array(RecoveryLocationSchema).max(20).default([]),
  succession: z.array(SuccessionSchema).max(30).default([]),
  delegations: z.array(DelegationSchema).max(30).default([]),
}).strict();

export const PlanDefinitionSchema = z.object({
  kind: z.enum(PLAN_KINDS),
  /** The incident template activation opens: positions, boards, checklists, groups, reports and rules. */
  templateKey: KeySchema,
  incidentKind: z.enum(["incident", "daily_ops", "planned_event", "exercise"]).optional(),
  sections: z.array(PlanSectionSchema).max(40).default([]),
  tasks: z.array(PlanTaskSchema).max(200).default([]),
  notice: PlanNoticeSchema.optional(),
  /** Days between reviews; the scheduler reminds the jurisdiction's administrators when one is due. */
  reviewEveryDays: z.number().int().min(1).max(1095).optional(),
  /** A continuity plan's functions, locations, succession and delegations; only a continuity plan has them. */
  continuity: ContinuitySchema.optional(),
}).strict().superRefine((plan, ctx) => {
  if (plan.kind === "continuity" && !plan.continuity) {
    ctx.addIssue({ code: "custom", path: ["continuity"], message: "a continuity plan names its essential functions" });
  }
  if (plan.kind !== "continuity" && plan.continuity) {
    ctx.addIssue({ code: "custom", path: ["continuity"], message: "only a continuity plan has essential functions" });
  }
  if (plan.kind === "recurring_event") return;
  for (const [index, task] of plan.tasks.entries()) {
    if (task.releaseMinutes < 0) {
      ctx.addIssue({
        code: "custom", path: ["tasks", index, "releaseMinutes"],
        message: "a plan without an event releases a task at activation or after it",
      });
    }
  }
});

export const PlanSaveSchema = z.object({
  title: z.string().trim().min(1).max(200),
  definition: PlanDefinitionSchema,
  /** The version the editor opened; 0 for a new plan. */
  expectedVersion: z.number().int().min(0),
}).strict();

export const PlanActivateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** A recurring event plan's occurrence start; required for one, refused for the other kind. */
  eventAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export type PlanSection = z.infer<typeof PlanSectionSchema>;
export type PlanTask = z.infer<typeof PlanTaskSchema>;
export type PlanNotice = z.infer<typeof PlanNoticeSchema>;
export type EssentialFunction = z.infer<typeof EssentialFunctionSchema>;
export type Continuity = z.infer<typeof ContinuitySchema>;
export type PlanDefinition = z.infer<typeof PlanDefinitionSchema>;
export type PlanDefinitionInput = z.input<typeof PlanDefinitionSchema>;
export type PlanSave = z.input<typeof PlanSaveSchema>;
export type PlanActivate = z.infer<typeof PlanActivateSchema>;

export interface PlanSummary {
  readonly id: string;
  readonly title: string;
  readonly kind: PlanKind;
  readonly version: number;
  readonly templateKey: string;
  readonly sections: number;
  readonly tasks: number;
  readonly updatedAt: string;
  readonly reviewEveryDays: number | null;
  readonly reviewedAt: string | null;
  /** When the next review falls due; null when the plan has no review cadence. */
  readonly reviewDueAt: string | null;
}

export interface PlanDetail extends PlanSummary {
  readonly jurisdictionId: string;
  readonly definition: PlanDefinition;
}

export interface PlanVersion {
  readonly version: number;
  readonly title: string;
  readonly definition: PlanDefinition;
  readonly savedAt: string;
  readonly savedBy: string | null;
}

export interface PlanActivation {
  readonly incidentId: string;
  readonly planVersion: number;
  /** Tasks released at activation, and tasks waiting for their release time. */
  readonly tasksReleased: number;
  readonly tasksScheduled: number;
  readonly notice?: { readonly massNotificationId: string; readonly recipients: number };
}

/** The plan an incident was activated from, as its participants read it. */
export interface IncidentPlan {
  readonly planId: string;
  readonly title: string;
  readonly kind: PlanKind;
  readonly version: number;
  readonly eventAt: string | null;
  readonly sections: readonly PlanSection[];
  /** A continuity plan's functions, locations, succession and delegations. */
  readonly continuity: Continuity | null;
  /** Tasks the plan has not released yet, soonest first. */
  readonly scheduled: ReadonlyArray<{
    readonly item: string;
    readonly positionTitle: string;
    readonly releaseAt: string;
  }>;
}
