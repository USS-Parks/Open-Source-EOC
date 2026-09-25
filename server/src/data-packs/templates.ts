import { z } from "zod";
import { ConditionSchema } from "../notify/engine.js";
import { CadenceSchema, ReportDefinitionSchema } from "../reports/service.js";

/**
 * Report and rule templates (VA11): the portable forms of a jurisdiction's
 * reports and notification rules, which a signed solution package carries
 * and incident activation makes live (VA12). They import nothing from the
 * incident or package modules, so both can use them.
 */

export const Key = z.string().regex(/^[a-z][a-z0-9_]*$/, "use a lower_snake key").max(80);
export const Version = z.number().int().positive();
export const Title = z.string().trim().min(1).max(200);

/**
 * A report as a template: the board template it runs on, by key, its columns,
 * conditions, groups, totals and sorts, and optionally when it runs and in
 * which format. Recipients are a jurisdiction's own, so they are not carried.
 */
export const ReportTemplateSchema = z.object({
  key: Key,
  version: Version,
  title: Title,
  board: Key,
  definition: ReportDefinitionSchema,
  schedule: z.object({ cadence: CadenceSchema, format: z.enum(["pdf", "xlsx", "csv"]) }).strict().optional(),
}).strict();
export type ReportTemplate = z.infer<typeof ReportTemplateSchema>;

const Via = z.array(z.enum(["inapp", "email", "sms"])).min(1).max(3);

/**
 * Who a rule reaches, named so it means the same in any jurisdiction: the
 * position that asked, a position by its key, a contact group by its name.
 * Webhook and ntfy addresses and email and SMS numbers are a jurisdiction's
 * own and are not carried.
 */
export const PortableChannelSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inapp"), target: z.enum(["requesting_position"]) }).strict(),
  z.object({ kind: z.literal("position"), position: Key, reach: z.enum(["holders", "on_call"]).default("holders"), via: Via }).strict(),
  z.object({ kind: z.literal("group"), group: Title, via: Via }).strict(),
]);

/** A notification rule as a template: the board template it watches, by key, its event, condition and who it reaches. */
export const RuleTemplateSchema = z.object({
  key: Key,
  version: Version,
  title: Title,
  board: Key.nullable(),
  event: z.enum(["record.created", "record.updated", "scheduled"]),
  condition: ConditionSchema.default({ op: "any" }),
  channels: z.array(PortableChannelSchema).min(1).max(10),
  scheduleIntervalMinutes: z.number().int().positive().max(10_080).optional(),
}).strict();
export type RuleTemplate = z.infer<typeof RuleTemplateSchema>;

