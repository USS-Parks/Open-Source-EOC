import { z } from "zod";

const DomainSchema = z.enum(["lifeline", "esf"]);
const KeySchema = z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(160);
const IdSchema = z.string().uuid();

export const OperationalRelationshipTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), taskId: IdSchema }).strict(),
  z.object({ kind: z.literal("resource_request"), resourceRequestId: IdSchema }).strict(),
  z.object({ kind: z.literal("board_record"), boardRecordId: IdSchema }).strict(),
  z.object({ kind: z.literal("map_feature"), datasetId: IdSchema, featureId: z.string().trim().min(1).max(500) }).strict(),
  z.object({ kind: z.literal("iap_objective"), iapId: IdSchema, contentRevision: z.number().int().positive(), objectiveIndex: z.number().int().nonnegative() }).strict(),
]);

export const OperationalRelationshipCreateSchema = z.object({
  source: z.object({ domain: DomainSchema, framework: KeySchema, definitionKey: KeySchema }).strict(),
  target: OperationalRelationshipTargetSchema,
}).strict();

export type OperationalRelationshipCreate = z.infer<typeof OperationalRelationshipCreateSchema>;
export type OperationalRelationshipTargetInput = z.infer<typeof OperationalRelationshipTargetSchema>;

/** Server-projected targets include the readable identity needed to revisit the exact record. */
export type OperationalRelationshipTarget =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "resource_request"; readonly resourceRequestId: string }
  | {
      readonly kind: "board_record";
      readonly boardRecordId: string;
      readonly boardId: string;
      readonly boardTitle: string;
      readonly label: string;
    }
  | { readonly kind: "map_feature"; readonly datasetId: string; readonly featureId: string }
  | {
      readonly kind: "iap_objective";
      readonly iapId: string;
      readonly contentRevision: number;
      readonly objectiveIndex: number;
      readonly objectiveLabel: string;
      readonly operationalPeriod: string;
    };

export interface OperationalRelationship {
  readonly id: string;
  readonly incidentId: string;
  readonly source: { readonly domain: "lifeline" | "esf"; readonly framework: string; readonly definitionKey: string };
  readonly target: OperationalRelationshipTarget;
  /** An IAP objective link becomes stale when its recorded draft revision changes. */
  readonly targetState: "available" | "stale";
  readonly attribution: {
    readonly personId: string;
    readonly personName: string;
    readonly organizationId: string;
    readonly organizationName: string;
    readonly positionId: string | null;
    readonly positionTitle: string | null;
    readonly participationId: string | null;
    readonly recordedAt: string;
  };
}
