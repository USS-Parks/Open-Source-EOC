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
  /** Shelter records neither closed nor planned. */
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
