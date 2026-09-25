import { z } from "zod";
import { ViewConditionSchema } from "./conditions.js";

const WorkflowKeySchema = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case keys only");

export const WorkflowStateSchema = z.object({
  key: WorkflowKeySchema,
  label: z.string().trim().min(1).max(120),
  terminal: z.boolean().default(false),
  /** Fields no one may change while a record is in this state; its creation sets them. */
  readOnlyFields: z.array(WorkflowKeySchema).max(200).optional(),
}).strict();

/**
 * A transition's guard: conditions on the record's fields, all or any of
 * which must hold for the transition to be requested and, after its
 * approvals, completed. The conditions are the board views' own language,
 * evaluated the same way on the server and in the browser.
 */
export const WorkflowGuardSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(ViewConditionSchema).min(1).max(16),
  /** Said when the guard refuses the transition; without one, the unmet conditions are named. */
  message: z.string().trim().min(1).max(200).optional(),
}).strict();

export const WorkflowActorSchema = z.enum([
  "writer",
  "jurisdiction_admin",
  "assigned_position",
  "incident_coordinator",
]);

export const WorkflowAssignmentTargetKindSchema = z.enum([
  "position",
  "incident_participant",
]);

export const WorkflowAssignmentRuleSchema = z.object({
  required: z.boolean().default(true),
  allowedTargets: z.array(WorkflowAssignmentTargetKindSchema).min(1).max(2)
    .refine((items) => new Set(items).size === items.length, "duplicate assignment target"),
}).strict();

export const WorkflowApproverSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("position_key"), positionKey: WorkflowKeySchema }).strict(),
  z.object({ kind: z.literal("jurisdiction_admin") }).strict(),
  z.object({ kind: z.literal("incident_coordinator") }).strict(),
]);

export const WorkflowApprovalRuleSchema = z.object({
  key: WorkflowKeySchema,
  label: z.string().trim().min(1).max(120),
  approver: WorkflowApproverSchema,
  count: z.number().int().min(1).max(20).default(1),
  allowSelfApproval: z.boolean().default(false),
}).strict();

export const WorkflowDueRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("relative"),
    minutes: z.number().int().min(1).max(525_600),
    anchor: z.enum(["created", "transitioned"]).default("transitioned"),
  }).strict(),
  z.object({
    kind: z.literal("record_field"),
    field: WorkflowKeySchema,
  }).strict(),
]);

export const WorkflowEscalationRuleSchema = z.object({
  key: WorkflowKeySchema,
  afterMinutes: z.number().int().min(1).max(525_600),
  assignment: WorkflowAssignmentRuleSchema.optional(),
  repeatEveryMinutes: z.number().int().min(1).max(43_200).optional(),
  maxOccurrences: z.number().int().min(1).max(20).default(1),
}).strict().superRefine((rule, ctx) => {
  if (rule.maxOccurrences > 1 && rule.repeatEveryMinutes === undefined) {
    ctx.addIssue({ code: "custom", message: "repeating escalation needs repeatEveryMinutes" });
  }
});

export const WorkflowTransitionSchema = z.object({
  key: WorkflowKeySchema,
  label: z.string().trim().min(1).max(120),
  from: WorkflowKeySchema,
  to: WorkflowKeySchema,
  allowedActors: z.array(WorkflowActorSchema).min(1).max(4)
    .refine((items) => new Set(items).size === items.length, "duplicate transition actor"),
  assignment: WorkflowAssignmentRuleSchema.optional(),
  approvals: z.array(WorkflowApprovalRuleSchema).max(20).default([]),
  due: WorkflowDueRuleSchema.optional(),
  escalations: z.array(WorkflowEscalationRuleSchema).max(20).default([]),
  guard: WorkflowGuardSchema.optional(),
}).strict();

export const BoardWorkflowSchema = z.object({
  initialState: WorkflowKeySchema,
  states: z.array(WorkflowStateSchema).min(1).max(50),
  transitions: z.array(WorkflowTransitionSchema).min(1).max(200),
}).strict().superRefine((workflow, ctx) => {
  const states = new Map<string, z.infer<typeof WorkflowStateSchema>>();
  for (const state of workflow.states) {
    if (states.has(state.key)) ctx.addIssue({ code: "custom", message: `duplicate workflow state ${state.key}` });
    states.set(state.key, state);
  }
  if (!states.has(workflow.initialState)) {
    ctx.addIssue({ code: "custom", message: `unknown initial workflow state ${workflow.initialState}` });
  }
  const transitionKeys = new Set<string>();
  for (const transition of workflow.transitions) {
    if (transitionKeys.has(transition.key)) {
      ctx.addIssue({ code: "custom", message: `duplicate workflow transition ${transition.key}` });
    }
    transitionKeys.add(transition.key);
    if (!states.has(transition.from)) {
      ctx.addIssue({ code: "custom", message: `transition ${transition.key} has unknown source ${transition.from}` });
    }
    if (!states.has(transition.to)) {
      ctx.addIssue({ code: "custom", message: `transition ${transition.key} has unknown target ${transition.to}` });
    }
    if (transition.from === transition.to) {
      ctx.addIssue({ code: "custom", message: `transition ${transition.key} must change state` });
    }
    if (states.get(transition.from)?.terminal) {
      ctx.addIssue({ code: "custom", message: `terminal state ${transition.from} cannot have outgoing transitions` });
    }
    const approvalKeys = new Set<string>();
    for (const approval of transition.approvals) {
      if (approvalKeys.has(approval.key)) {
        ctx.addIssue({ code: "custom", message: `transition ${transition.key} repeats approval ${approval.key}` });
      }
      approvalKeys.add(approval.key);
    }
    const escalationKeys = new Set<string>();
    for (const escalation of transition.escalations) {
      if (escalationKeys.has(escalation.key)) {
        ctx.addIssue({ code: "custom", message: `transition ${transition.key} repeats escalation ${escalation.key}` });
      }
      escalationKeys.add(escalation.key);
    }
  }
});

export const WorkflowAssignmentRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("position"),
    positionId: z.uuid(),
  }).strict(),
  z.object({
    kind: z.literal("incident_participant"),
    incidentId: z.uuid(),
    participantId: z.uuid(),
  }).strict(),
]);

export type BoardWorkflow = z.infer<typeof BoardWorkflowSchema>;
export type WorkflowGuard = z.infer<typeof WorkflowGuardSchema>;
export type WorkflowTransition = z.infer<typeof WorkflowTransitionSchema>;
export type WorkflowDueRule = z.infer<typeof WorkflowDueRuleSchema>;
export type WorkflowEscalationRule = z.infer<typeof WorkflowEscalationRuleSchema>;
export type WorkflowAssignmentRequest = z.infer<typeof WorkflowAssignmentRequestSchema>;

export interface WorkflowClockInput {
  readonly createdAt: string;
  readonly transitionedAt: string;
  readonly record: Readonly<Record<string, unknown>>;
}

/** Resolve a declarative due rule without consulting wall-clock time. */
export function workflowDueAt(rule: WorkflowDueRule, input: WorkflowClockInput): string | null {
  if (rule.kind === "record_field") {
    const value = input.record[rule.field];
    if (value === undefined || value === null) return null;
    const parsed = z.iso.datetime({ offset: true }).safeParse(value);
    if (!parsed.success) throw new Error(`due field ${rule.field} is not an ISO timestamp`);
    return new Date(parsed.data).toISOString();
  }
  const anchor = rule.anchor === "created" ? input.createdAt : input.transitionedAt;
  const time = new Date(anchor).getTime();
  if (!Number.isFinite(time)) throw new Error(`invalid ${rule.anchor} workflow timestamp`);
  return new Date(time + rule.minutes * 60_000).toISOString();
}

/** Scheduled occurrence for a declared escalation, indexed from zero. */
export function workflowEscalationAt(
  rule: WorkflowEscalationRule,
  transitionedAt: string,
  occurrence: number,
): string {
  if (!Number.isInteger(occurrence) || occurrence < 0 || occurrence >= rule.maxOccurrences) {
    throw new Error("escalation occurrence is outside the declared schedule");
  }
  const time = new Date(transitionedAt).getTime();
  if (!Number.isFinite(time)) throw new Error("invalid transitioned workflow timestamp");
  const repeat = occurrence === 0 ? 0 : occurrence * rule.repeatEveryMinutes!;
  return new Date(time + (rule.afterMinutes + repeat) * 60_000).toISOString();
}
