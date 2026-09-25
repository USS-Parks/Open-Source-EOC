/** The incident overview's counts for one operational period, under the reader's row-level security. */
export interface IncidentOverviewSummary {
  readonly incidentId: string;
  /** The period counted against; null when the incident has no operational period. */
  readonly period: {
    readonly revision: number;
    readonly label: string;
    readonly startsAt: string;
    readonly endsAt: string;
  } | null;
  /** Requests past draft that have not closed or been cancelled. */
  readonly openRequests: number;
  /** Open requests at immediate priority. */
  readonly urgentRequests: number;
  /** Shelter records neither closed nor marked planned. */
  readonly activeShelters: number;
  readonly shelterOccupants: number;
  readonly fieldReports: number;
  readonly unverifiedFieldReports: number;
  /** Tasks not completed and due inside the period; null without a period. */
  readonly tasksDue: number | null;
  /** Organizations with a current participation grant, the owner excluded. */
  readonly participatingOrganizations: number;
}

/** One entry of the incident's recent operational activity, newest first. */
export interface IncidentActivityEntry {
  readonly id: string;
  readonly at: string;
  readonly category: string;
  readonly subjectTable: string | null;
  readonly subjectId: string | null;
  readonly person: string;
  readonly position: string | null;
  /** The author's organization on this incident: their participating organization, else the owner. */
  readonly organization: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  /** A record's current fields, when the entry is about a board record the reader may see. */
  readonly record: Readonly<Record<string, unknown>> | null;
  /** A message's text and thread, when the entry is a message the reader may see. */
  readonly message: { readonly body: string; readonly thread: string } | null;
}

/**
 * A shift handoff: when the reader's last shift ended, the operational period
 * being reported, and the material changes on the incident since then, each
 * naming its source record. Changes come from the owning organization's
 * record of events, so a participating organization's reader gets none.
 */
/** What closing an incident leaves running, so the administrator decides with it in view. */
export interface IncidentCloseout {
  readonly closedAt: string | null;
  /** Resource requests not closed, declined or cancelled; they stay readable and stop taking steps. */
  readonly openRequests: readonly { readonly id: string; readonly number: number; readonly item: string; readonly state: string }[];
  /** Tasks not completed; they stay readable and stop taking steps. */
  readonly openTasks: readonly { readonly id: string; readonly number: number; readonly item: string }[];
  /** Participant grants still in force; a grant keeps its read after close until revoked or expired. */
  readonly activeGrants: readonly { readonly id: string; readonly person: string; readonly organization: string; readonly expiresAt: string }[];
  /** Datasets registered for the incident; closing it does not stop them updating. */
  readonly datasets: number;
}

export interface ShiftHandoff {
  readonly since: string;
  /** What set `since`: the reader's last sign-out, their last position sign-out, the period's start, or the incident's activation. */
  readonly basis: "sign-out" | "position" | "period" | "activation";
  readonly period: { readonly label: string; readonly startsAt: string; readonly endsAt: string } | null;
  /** Newest first, at most `limit`; null when the reader's organization does not own the incident. */
  readonly changes: readonly HandoffChange[] | null;
  /** Every material change since, of which `changes` is the newest part. */
  readonly total: number;
}

export interface HandoffChange {
  readonly id: string;
  readonly at: string;
  readonly category: string;
  readonly person: string;
  readonly position: string | null;
  readonly organization: string | null;
  /** What changed, in words: "REQ-1043 Sandbags: Received → Accepted". */
  readonly summary: string;
  /** The source record to open. */
  readonly subject:
    | { readonly kind: "record"; readonly boardId: string; readonly id: string }
    | { readonly kind: "request"; readonly id: string }
    | { readonly kind: "task"; readonly id: string }
    | { readonly kind: "incident" };
}
