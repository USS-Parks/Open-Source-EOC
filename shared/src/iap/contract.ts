import { z } from "zod";

export const IAP_DISPLAY_STATES = [
  "not_started",
  "in_progress",
  "in_approval",
  "approved",
  "complete",
] as const;

export const IapDisplayStateSchema = z.enum(IAP_DISPLAY_STATES);
export type IapDisplayState = z.infer<typeof IapDisplayStateSchema>;

export const IAP_WORKSPACE_VIEWS = ["all", "working", "published"] as const;
export const IapWorkspaceViewSchema = z.enum(IAP_WORKSPACE_VIEWS);
export type IapWorkspaceView = z.infer<typeof IapWorkspaceViewSchema>;

export const IapWorkspaceQuerySchema = z
  .object({
    view: IapWorkspaceViewSchema.default("all"),
    organizationId: z.string().uuid().optional(),
    periodRevision: z.coerce.number().int().positive().optional(),
    role: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export type IapWorkspaceQuery = z.infer<typeof IapWorkspaceQuerySchema>;

export interface IapProgress {
  readonly requiredFormIds: readonly string[];
  readonly completedFormIds: readonly string[];
  readonly missingFormIds: readonly string[];
  readonly completed: number;
  readonly required: number;
  readonly percent: number;
}

export interface IapPeriodReference {
  readonly revision: number;
  readonly label: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface IapPreparedAttribution {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly roleKey: string;
  readonly roleLabel: string;
  readonly positionId: string | null;
  readonly participationId: string | null;
}

export interface IapWorkspaceItem {
  readonly revisionRootId: string;
  readonly revisionNumber: number;
  readonly contentRevision: number;
  readonly supersedesIapId: string | null;
  readonly id: string;
  readonly operationalPeriod: string;
  readonly period: IapPeriodReference | null;
  readonly status: IapDisplayState;
  readonly formCount: number;
  readonly targetForms: number;
  readonly progress: IapProgress;
  readonly preparedBy: string | null;
  readonly preparedAttribution: IapPreparedAttribution;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly createdAt: string;
}

export interface IapFacetValue {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

export interface IapWorkspaceSummary {
  readonly total: number;
  readonly byState: Readonly<Record<IapDisplayState, number>>;
  readonly completedForms: number;
  readonly requiredForms: number;
}

export interface IapWorkspaceResponse {
  /** One page of the filtered set, newest first; `summary` and `facets` count all of it. */
  readonly iaps: readonly IapWorkspaceItem[];
  /** Cursor for the next page; null or absent on the last page. */
  readonly nextCursor?: string | null;
  readonly query: IapWorkspaceQuery;
  readonly summary: IapWorkspaceSummary;
  readonly facets: {
    readonly organizations: readonly IapFacetValue[];
    readonly roles: readonly IapFacetValue[];
  };
}
