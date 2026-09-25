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
 * before it as well as after.
 */

const KeySchema = z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(80);
const GroupName = z.string().trim().min(1).max(200);
const unique = <T extends z.ZodTypeAny>(schema: T, max: number, what: string) =>
  z.array(schema).max(max).default([]).refine(
    (values) => new Set(values).size === values.length,
    `each ${what} is listed once`,
  );

export const PLAN_KINDS = ["incident_response", "recurring_event"] as const;
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
}).strict().superRefine((plan, ctx) => {
  if (plan.kind !== "incident_response") return;
  for (const [index, task] of plan.tasks.entries()) {
    if (task.releaseMinutes < 0) {
      ctx.addIssue({
        code: "custom", path: ["tasks", index, "releaseMinutes"],
        message: "an incident response plan releases a task at activation or after it",
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
  /** Tasks the plan has not released yet, soonest first. */
  readonly scheduled: ReadonlyArray<{
    readonly item: string;
    readonly positionTitle: string;
    readonly releaseAt: string;
  }>;
}
