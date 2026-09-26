import { z } from "zod";
import { CONDITION_MATCHES, ConditionItemSchema, TimeZoneSchema } from "./conditions.js";

/**
 * Board actions (VC-17): what a board does by itself when one of its records
 * is created, has a field changed or enters a workflow state. Each action is
 * one step from a fixed catalog, declared as data on the board template;
 * there is no expression language and no code (ADR-0004). The server runs an
 * action as the person whose write set it off, with that person's authority,
 * and records every run in the record's history.
 */

const Key = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case keys only");

export const ActionTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("record_created") }).strict(),
  z.object({ kind: z.literal("field_changed"), field: Key }).strict(),
  z.object({ kind: z.literal("state_entered"), state: Key }).strict(),
]);

/** The fields a set-field step may write: those a literal value can fill. */
export const SETTABLE_FIELD_TYPES = ["text", "number", "boolean", "enum", "datetime"] as const;

export const ActionStepSchema = z.discriminatedUnion("kind", [
  /** Set one field of the record to a value; a datetime value may be a relative time such as `now`. */
  z.object({
    kind: z.literal("set_field"),
    field: Key,
    value: z.union([z.string().max(4000), z.number().finite(), z.boolean()]),
  }).strict(),
  /**
   * Create a record on the board of the same incident made from template
   * `board`, copying fields by `mapping` and pointing its `link` field, a
   * reference to this board, back at the record.
   */
  z.object({
    kind: z.literal("create_record"),
    board: Key,
    link: Key,
    mapping: z.array(z.object({ to: Key, from: Key }).strict()).max(50).default([]),
  }).strict(),
  /** Request a workflow transition, as a person pressing its button would. */
  z.object({ kind: z.literal("transition"), transition: Key }).strict(),
  /** An in-app notice to a position's holders or to the record's creator. */
  z.object({
    kind: z.literal("notify"),
    to: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("position"), positionKey: Key }).strict(),
      z.object({ kind: z.literal("creator") }).strict(),
    ]),
    message: z.string().trim().min(1).max(500),
  }).strict(),
]);

export const BoardActionSchema = z.object({
  key: Key,
  label: z.string().trim().min(1).max(120),
  trigger: ActionTriggerSchema,
  /** Conditions on the record after the write, in the views' condition language. */
  condition: z.object({
    match: z.enum(CONDITION_MATCHES).default("all"),
    conditions: z.array(ConditionItemSchema).min(1).max(16),
    timeZone: TimeZoneSchema.optional(),
  }).strict().optional(),
  step: ActionStepSchema,
}).strict();

export type ActionTrigger = z.infer<typeof ActionTriggerSchema>;
export type ActionStep = z.infer<typeof ActionStepSchema>;
export type BoardAction = z.infer<typeof BoardActionSchema>;

/** How many actions deep a chain may go, each set off by the one before, before it is stopped. */
export const ACTION_CHAIN_DEPTH = 5;

/** What an action's write carries in its audit entry, so the record's history names the action. */
export interface ActionWrite {
  readonly key: string;
  readonly label: string;
  /** The chain the run belongs to: everything one person's write set off. */
  readonly chain: string;
}

/** One action run, as the record's history shows it. */
export interface BoardActionRun {
  readonly action: { readonly key: string; readonly label: string };
  readonly trigger: {
    readonly kind: ActionTrigger["kind"];
    /** The changed field, or null when the reader may not read it. */
    readonly field: string | null;
    /** The label of the state entered. */
    readonly state: string | null;
    /** The action whose write set this one off; null when a person's write did. */
    readonly byAction: string | null;
  };
  readonly step: ActionStep["kind"];
  readonly outcome: "done" | "refused" | "stopped";
  /** Why it was refused or stopped, or what became of a done step that changed nothing or waits. */
  readonly reason: string | null;
  readonly chain: string;
  readonly depth: number;
  /**
   * What the step did: the field it set, the record it created and its
   * board's title, the label of the state it reached, whom it notified.
   */
  readonly result: {
    readonly field?: string;
    readonly recordId?: string;
    readonly boardId?: string;
    readonly board?: string;
    readonly state?: string;
    readonly to?: string;
  } | null;
}
