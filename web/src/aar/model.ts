import {
  CAPABILITY_ELEMENT_LABELS,
  CORE_CAPABILITY_LABELS,
  type AarActionAssignment,
  type AarAnalytics,
  type AarCorrectiveAction,
  type AarObservation,
  type IncidentAreaRevision,
  type IncidentParticipantGrant,
  type WorkflowAssignmentRequest,
} from "@openeoc/shared";
import type { PositionRef } from "../app/api/client.js";

export type AarFilterDimension = "all" | "priority" | "status" | "capability";
export interface AarFilter {
  readonly dimension: AarFilterDimension;
  readonly key: string;
}

export interface AarWorkspaceData {
  readonly observations: readonly AarObservation[];
  readonly correctiveActions: readonly (AarCorrectiveAction & {
    readonly incidentId: string | null;
    readonly createdAt: string;
  })[];
  readonly analytics: AarAnalytics;
}

export interface AarOwnerOption {
  readonly value: string;
  readonly label: string;
  readonly assignment: WorkflowAssignmentRequest;
}

export function capabilityLabel(key: string): string {
  return CORE_CAPABILITY_LABELS[key] ?? humanLabel(key);
}

export function elementLabel(key: string): string {
  return CAPABILITY_ELEMENT_LABELS[key] ?? humanLabel(key);
}

export function humanLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

export function filterLabel(filter: AarFilter): string {
  if (filter.dimension === "all") return "All records";
  return `${humanLabel(filter.dimension)}: ${filter.dimension === "capability" ? capabilityLabel(filter.key) : humanLabel(filter.key)}`;
}

export function recordIds(data: AarWorkspaceData, filter: AarFilter): {
  readonly observationIds: ReadonlySet<string>;
  readonly actionIds: ReadonlySet<string>;
  readonly count: number;
} {
  if (filter.dimension === "all") {
    return {
      observationIds: new Set(data.observations.map((item) => item.id)),
      actionIds: new Set(data.correctiveActions.map((item) => item.id)),
      count: data.analytics.totals.records,
    };
  }
  const buckets = filter.dimension === "priority"
    ? data.analytics.byPriority
    : filter.dimension === "status"
      ? data.analytics.byStatus
      : data.analytics.byCapability;
  const bucket = buckets.find((item) => item.key === filter.key);
  return {
    observationIds: new Set(bucket?.observationIds ?? []),
    actionIds: new Set(bucket?.correctiveActionIds ?? []),
    count: bucket?.count ?? 0,
  };
}

export function ownerOptions(
  incidentId: string,
  positions: readonly PositionRef[],
  participants: readonly IncidentParticipantGrant[],
  now = new Date(),
): readonly AarOwnerOption[] {
  const positionOptions = positions.map((position) => ({
    value: `position:${position.id}`,
    label: `Position: ${position.title}`,
    assignment: { kind: "position", positionId: position.id } as const,
  }));
  const participantOptions = participants
    .filter((participant) => participant.incidentId === incidentId
      && participant.revokedAt === null && new Date(participant.expiresAt) > now
      && (participant.role === "contributor" || participant.role === "coordinator"))
    .map((participant) => ({
      value: `participant:${participant.id}`,
      label: `${participant.incidentPositionTitle} — ${participant.organizationName}`,
      assignment: {
        kind: "incident_participant",
        incidentId,
        participantId: participant.id,
      } as const,
    }));
  return [...positionOptions, ...participantOptions].sort((left, right) => left.label.localeCompare(right.label));
}

export function assignmentValue(assignment: AarActionAssignment | null): string {
  if (!assignment) return "";
  return assignment.kind === "position"
    ? `position:${assignment.positionId ?? ""}`
    : `participant:${assignment.participantId ?? ""}`;
}

export function periodLabel(revision: IncidentAreaRevision): string {
  return revision.operationalPeriod?.label ?? `Revision ${revision.revision} — no operational period`;
}
