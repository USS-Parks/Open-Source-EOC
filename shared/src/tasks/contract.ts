import { z } from "zod";
import {
  WorkflowAssignmentRequestSchema,
  WorkflowDueRuleSchema,
} from "../boards/workflow.js";

const KeySchema = z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(80);
const TitleSchema = z.string().trim().min(1).max(500);
const TimestampSchema = z.string().datetime({ offset: true });
const TaskDependencyKeysSchema = z.array(KeySchema).max(100).refine(
  (keys) => new Set(keys).size === keys.length,
  "task dependency keys must be unique",
);
const TaskDependencyIdsSchema = z.array(z.string().uuid()).max(100).refine(
  (ids) => new Set(ids).size === ids.length,
  "task dependencies must be unique",
);

export const TaskStatusSchema = z.enum(["open", "in_progress", "completed"]);
export const TaskDueFilterSchema = z.enum(["overdue", "next_24_hours", "upcoming", "none"]);
export const TaskAssignmentFilterSchema = z.union([
  z.enum(["mine", "unassigned"]),
  z.string().uuid(),
]);

export const TaskTemplateItemSchema = z.union([
  TitleSchema,
  z.object({
    key: KeySchema.optional(),
    item: TitleSchema,
    category: KeySchema.default("general"),
    due: WorkflowDueRuleSchema.optional(),
    dependsOn: TaskDependencyKeysSchema.optional(),
  }).strict(),
]);

export const TaskListQuerySchema = z.object({
  status: TaskStatusSchema.optional(),
  category: KeySchema.optional(),
  assignment: TaskAssignmentFilterSchema.optional(),
  due: TaskDueFilterSchema.optional(),
}).strict();

export const TaskMetadataPatchSchema = z.object({
  expectedRevision: z.number().int().nonnegative().max(2_147_483_647),
  item: TitleSchema.optional(),
  category: KeySchema.optional(),
  dueAt: TimestampSchema.nullable().optional(),
  status: z.enum(["open", "in_progress"]).optional(),
  assignment: WorkflowAssignmentRequestSchema.nullable().optional(),
  dependencyIds: TaskDependencyIdsSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (
    value.item === undefined &&
    value.category === undefined &&
    value.dueAt === undefined &&
    value.status === undefined &&
    value.assignment === undefined &&
    value.dependencyIds === undefined
  ) {
    ctx.addIssue({ code: "custom", message: "task patch has no changes" });
  }
});

/** A task added to an incident by its owner's administrators, beside the activation checklists. */
export const TaskCreateSchema = z.object({
  item: TitleSchema,
  category: KeySchema.default("general"),
  dueAt: TimestampSchema.nullable().optional(),
  assignment: WorkflowAssignmentRequestSchema.nullable().optional(),
}).strict();

export const TaskCompletionRequestSchema = z.object({
  operationId: z.string().uuid(),
}).strict();

export const TaskAttributionSchema = z.object({
  personId: z.string().uuid(),
  positionId: z.string().uuid().nullable(),
  organizationId: z.string().uuid(),
  participationId: z.string().uuid().nullable(),
  title: z.string().min(1).max(160),
}).strict();

export const TaskCompletionReceiptSchema = z.object({
  operationId: z.string().uuid(),
  taskId: z.string().uuid(),
  incidentId: z.string().uuid(),
  status: z.literal("completed"),
  revision: z.number().int().positive(),
  completedAt: TimestampSchema,
  completedBy: TaskAttributionSchema,
}).strict();

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskDueFilter = z.infer<typeof TaskDueFilterSchema>;
export type TaskAssignmentFilter = z.infer<typeof TaskAssignmentFilterSchema>;
export type TaskTemplateItem = z.infer<typeof TaskTemplateItemSchema>;
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
export type TaskMetadataPatch = z.infer<typeof TaskMetadataPatchSchema>;
export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export type TaskCompletionRequest = z.infer<typeof TaskCompletionRequestSchema>;
export type TaskCompletionReceipt = z.infer<typeof TaskCompletionReceiptSchema>;

export interface TaskAssignmentView {
  readonly kind: "position" | "incident_participant";
  readonly id: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly title: string;
  readonly personId: string | null;
  /** The participant, or the position's current holders joined by commas; null when a position is vacant. */
  readonly personName: string | null;
}

export interface TaskDependencyView {
  readonly id: string;
  readonly item: string;
  readonly status: TaskStatus;
}

export interface IncidentTask {
  readonly id: string;
  /** The task's short number, shown as TASK-204. */
  readonly number: number;
  readonly incidentId: string;
  readonly item: string;
  readonly category: string;
  readonly status: TaskStatus;
  readonly dueAt: string | null;
  readonly revision: number;
  readonly assignment: TaskAssignmentView | null;
  /** Tasks that must be completed before this task can be completed. */
  readonly dependencies: readonly TaskDependencyView[];
  readonly completedAt: string | null;
  readonly completedBy: z.infer<typeof TaskAttributionSchema> | null;
}

export interface TaskAnalytics {
  readonly total: number;
  readonly byStatus: Readonly<Record<TaskStatus, number>>;
  readonly byCategory: Readonly<Record<string, number>>;
  readonly overdue: number;
  readonly dueNext24Hours: number;
  readonly upcoming: number;
  readonly withoutDue: number;
}

export interface TaskListResponse {
  /** One page of the filtered set; `analytics` counts all of it. */
  readonly tasks: readonly IncidentTask[];
  /** Cursor for the next page; null or absent on the last page. */
  readonly nextCursor?: string | null;
  readonly analytics: TaskAnalytics;
  readonly filters: TaskListQuery;
}
