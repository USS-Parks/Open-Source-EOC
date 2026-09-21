import type {
  ImpactCategory,
  ImpactSourceAggregate,
  IncidentImpactResponse,
} from "./contract.js";

export interface ImpactReporter {
  readonly personId: string;
  readonly personName: string;
  readonly positionId: string | null;
  readonly positionTitle: string | null;
}

/** A reported condition. Exposure alone never creates or changes this value. */
export interface ImpactLifelineReport {
  readonly lifeline: string;
  readonly status: string;
  readonly note: string | null;
  readonly reportedAt: string | null;
  readonly recordId: string | null;
  readonly boardId: string | null;
  readonly reportedBy: ImpactReporter | null;
}

export interface IncidentImpactAnalysis {
  readonly impact: IncidentImpactResponse;
  readonly lifelines: readonly ImpactLifelineReport[];
  readonly lifelineInterpretation:
    "reported incident status only; geographic exposure does not imply lifeline failure";
}

export interface ImpactSourceDelta {
  readonly catalogSourceId: string;
  readonly datasetId: string | null;
  readonly datasetName: string;
  readonly unit: "records" | "people";
  readonly fromValue: number | null;
  readonly toValue: number | null;
  readonly delta: number | null;
  readonly explanation: string;
}

export interface ImpactCategoryDelta {
  readonly category: ImpactCategory;
  readonly unit: "records" | "people";
  readonly fromValue: number | null;
  readonly toValue: number | null;
  readonly delta: number | null;
  readonly explanation: string;
  readonly sources: readonly ImpactSourceDelta[];
}

export interface IncidentImpactComparison {
  readonly incidentId: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly baselineStatement:
    "both revisions use the current selected dataset registrations and loaded records; this is not a historical baseline snapshot";
  readonly categories: Readonly<Record<ImpactCategory, ImpactCategoryDelta>>;
}

export interface ImpactContribution {
  readonly sourceId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly geometry: unknown;
  /** One affected record, or this polygon's area-weighted people estimate. */
  readonly value: number;
}

export interface ImpactContributionPage {
  readonly incidentId: string;
  readonly areaRevision: number;
  readonly category: ImpactCategory;
  readonly source: ImpactSourceAggregate;
  readonly records: readonly ImpactContribution[];
  readonly nextCursor: string | null;
}
