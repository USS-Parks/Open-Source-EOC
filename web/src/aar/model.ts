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
import { FOLLOW_THROUGH_CATEGORIES, chartKey, localToday } from "./dashboard.js";

/** A drilldown of the records list: server buckets for priority, status and capability; the dashboard's rule for the rest. */
export type AarFilterDimension = "all" | "priority" | "status" | "capability" | "element" | "followThrough";
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
  if (filter.dimension === "element") return `Element: ${elementLabel(filter.key)}`;
  if (filter.dimension === "followThrough")
    return `Improvement plan: ${FOLLOW_THROUGH_CATEGORIES.find((item) => item.key === filter.key)?.label ?? humanLabel(filter.key)}`;
  return `${humanLabel(filter.dimension)}: ${filter.dimension === "capability" ? capabilityLabel(filter.key) : humanLabel(filter.key)}`;
}

export function recordIds(data: AarWorkspaceData, filter: AarFilter, today = localToday()): {
  readonly observationIds: ReadonlySet<string>;
  readonly actionIds: ReadonlySet<string>;
  readonly count: number;
} {
  if (filter.dimension === "element" || filter.dimension === "followThrough") {
    const chart = filter.dimension;
    const ids = (items: readonly (AarObservation | AarWorkspaceData["correctiveActions"][number])[]) =>
      new Set(items.filter((item) => chartKey(chart, item, today) === filter.key).map((item) => item.id));
    const observationIds = ids(data.observations);
    const actionIds = ids(data.correctiveActions);
    return { observationIds, actionIds, count: observationIds.size + actionIds.size };
  }
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
