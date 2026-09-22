import { z } from "zod";
import { COMMUNITY_LIFELINES, LIFELINE_STATUS } from "../dictionary/lifelines.js";

/**
 * Situation reports (VEOC-20, F8). A sitrep is a frozen composition of
 * live board state at a moment: once archived it never changes, and the
 * briefing view renders the archive, not the live boards.
 */

export const LifelineCurrentSchema = z.object({
  lifeline: z.enum(COMMUNITY_LIFELINES.values as [string, ...string[]]),
  status: z.enum(LIFELINE_STATUS.values as [string, ...string[]]),
  note: z.string().nullable(),
  at: z.string().nullable(),
  assessment: z.object({
    id: z.string(),
    person: z.string(),
    position: z.string().nullable(),
    organization: z.string(),
    recordedAt: z.string(),
    payload: z.record(z.string(), z.unknown()),
  }).optional(),
  conflict: z.boolean().optional(),
});
export type LifelineCurrent = z.infer<typeof LifelineCurrentSchema>;

export const BoardSummarySchema = z.object({
  key: z.string(),
  title: z.string(),
  records: z.number().int().nonnegative(),
  byStatus: z.record(z.string(), z.number().int().nonnegative()),
  sourceTime: z.string().nullable().optional(),
});
export type BoardSummary = z.infer<typeof BoardSummarySchema>;

export const SignificantEventLineSchema = z.object({
  occurredAt: z.string(),
  summary: z.string(),
  severity: z.string().nullable(),
});

export const RumorControlLineSchema = z.object({
  rumor: z.string(),
  status: z.string(),
  response: z.string().nullable(),
  recordedAt: z.string().nullable().optional(),
});
export type RumorControlLine = z.infer<typeof RumorControlLineSchema>;

export const EsfCurrentLineSchema = z.object({
  framework: z.enum(["federal", "california"]),
  esf: z.string(),
  activation: z.string().nullable(),
  capacity: z.string().nullable(),
  situation: z.string().nullable(),
  assessedAt: z.string().nullable(),
  conflict: z.boolean(),
  assessment: z.object({
    id: z.string(),
    person: z.string(),
    position: z.string().nullable(),
    organization: z.string(),
    recordedAt: z.string(),
    payload: z.record(z.string(), z.unknown()),
  }).optional(),
});
export type EsfCurrentLine = z.infer<typeof EsfCurrentLineSchema>;

export const TalkingPointLineSchema = z.object({
  topic: z.string(),
  point: z.string(),
  recordedAt: z.string().nullable(),
});
export type TalkingPointLine = z.infer<typeof TalkingPointLineSchema>;

export const SitrepContentSchema = z.object({
  period: z.string().min(1),
  composedAt: z.string(),
  lifelines: z.array(LifelineCurrentSchema),
  esfs: z.array(EsfCurrentLineSchema).optional(),
  boards: z.array(BoardSummarySchema),
  significantEvents: z.array(SignificantEventLineSchema),
  // JIC rumor-control entries surface on the briefing view (VEOC-33A).
  rumorControl: z.array(RumorControlLineSchema).default([]),
  talkingPoints: z.array(TalkingPointLineSchema).optional(),
  incident: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  revision: z.number().int().positive().optional(),
  sourceTime: z.string().nullable().optional(),
  archiveReaderLevel: z.enum(["member", "admin"]).optional(),
});
export type SitrepContent = z.infer<typeof SitrepContentSchema>;

export interface SitrepRow {
  readonly id: string;
  readonly period: string;
  readonly composedAt: string;
  readonly composedBy: string;
  readonly content: SitrepContent;
  readonly incidentId?: string | null;
  readonly incidentName?: string | null;
  readonly revision?: number;
  readonly sourceTime?: string;
}
