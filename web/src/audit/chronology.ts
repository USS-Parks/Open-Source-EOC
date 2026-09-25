/**
 * The audit chronology as the web client sees it: the entry shape the
 * chronology route returns, human labels for the event categories the server
 * records, and the one list of categories the significant-events view keeps.
 */

export interface ChronologyEntry {
  readonly seq: number;
  readonly id: string;
  readonly at: string;
  readonly personId: string;
  readonly person: string;
  readonly positionId: string | null;
  readonly position: string | null;
  readonly incidentId: string | null;
  readonly category: string;
  readonly subjectTable: string | null;
  readonly subjectId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly corrects: string | null;
  readonly line: string;
}

export interface ChronologyPage {
  readonly entries: readonly ChronologyEntry[];
  readonly nextCursor: string | null;
}

export interface ChronologyFilters {
  readonly incidentId?: string;
  /** Keep entries whose category is any one of these. */
  readonly categories?: readonly string[];
  /** ISO timestamps bounding the entry time, inclusive. */
  readonly from?: string;
  readonly to?: string;
}

/** Display label for every audit category the server records. */
export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  "aar.composed": "AAR composed",
  "aar.corrective_action_created": "AAR corrective action created",
  "aar.corrective_action_updated": "AAR corrective action updated",
  "aar.observed": "AAR observation recorded",
  "board.record.created": "Board record created",
  "board.record.updated": "Board record updated",
  "briefing.notified": "Briefing notice sent",
  "briefing.scheduled": "Briefing scheduled",
  "cap.authored": "CAP alert authored",
  "cap.draft.created": "CAP alert draft created",
  "cap.ingested": "CAP alert received",
  "cap.review.changed": "CAP alert review changed",
  "checklist.completed": "Checklist completed",
  "checklist.task.updated": "Checklist task updated",
  "collab.announced": "Collaboration space announced",
  "collab.archived": "Collaboration space archived",
  "collab.configured": "Collaboration configured",
  "collab.degraded": "Collaboration degraded",
  "collab.membership_synced": "Collaboration membership synchronized",
  "collab.provisioned": "Collaboration space provisioned",
  correction: "Correction",
  "cot.emitted": "CoT message sent",
  "cot.ingested": "CoT message received",
  "damage.assessment.created": "Damage assessment created",
  "damage.baseline.imported": "Damage baseline imported",
  "damage.report.approved": "Damage report approved",
  "damage.report.rejected": "Damage report rejected",
  "edxl.emitted": "EDXL message sent",
  "edxl.imported": "EDXL message imported",
  "facility.query.launched": "Facility status query sent",
  "facility.status.reported": "Facility status reported",
  "federation.peer_linked": "Federation partner linked",
  "federation.received": "Federation update received",
  "feed.created": "Data feed created",
  "feed.ingest.failed": "Data feed ingest failed",
  "feed.ingest.recovered": "Data feed answering again",
  "file.uploaded": "File uploaded",
  "form.imported": "Form imported",
  "form.submitted": "Form submitted",
  "iap.approved": "IAP approved",
  "iap.assembled": "IAP assembled",
  "iap.completed": "IAP completed",
  "iap.forms.refreshed": "IAP took changed ICS forms",
  "iap.ics204.revised": "IAP ICS 204 revised",
  "iap.revision.created": "IAP revision created",
  "iap.submitted": "IAP submitted for approval",
  "ics_form.created": "ICS form started",
  "ics_form.saved": "ICS form saved",
  "incident.activated": "Incident activated",
  "incident.area.revised": "Incident area or period revised",
  "incident.closed": "Incident closed",
  "incident.datapack.registered": "Incident data pack registered",
  "incident.participant.granted": "Incident participant added",
  "incident.participant.revoked": "Incident participant removed",
  "ipaws.configured": "IPAWS configured",
  "ipaws.disabled": "IPAWS disabled",
  "ipaws.enabled": "IPAWS enabled",
  "ipaws.moa_acknowledged": "IPAWS MOA acknowledged",
  "ipaws.send.cancelled": "IPAWS alert send cancelled",
  "ipaws.send.confirmed": "IPAWS alert send confirmed",
  "ipaws.send.requested": "IPAWS alert send requested",
  "ipaws.submitted": "IPAWS alert submitted",
  "jic.inquiry_answered": "JIC inquiry answered",
  "jic.inquiry_assigned": "JIC inquiry assigned",
  "jic.inquiry_logged": "JIC inquiry logged",
  "jic.release_decided": "JIC release decision",
  "jic.release_drafted": "JIC release drafted",
  "jic.release_published": "JIC release published",
  "jic.release_submitted": "JIC release submitted",
  "meeting.configured": "Meeting configured",
  "meeting.created": "Meeting created",
  "message.sent": "Message sent",
  "mfa.enrolled": "Two-step sign-in enrolled",
  "mfa.recovery_code_used": "Two-step sign-in recovery code used",
  "mfa.verification_failed": "Two-step sign-in failed",
  "notification.acknowledged": "Notification acknowledged",
  "notification.allowlist_updated": "Notification allowlist updated",
  "notification.mass_sent": "Mass notification sent",
  "operational.relationship.created": "Operational link created",
  "retention.policy.updated": "Retention policy updated",
  "retention.purged": "Expired records purged",
  "rr.cost_recorded": "Resource request cost recorded",
  "rr.escalated": "Resource request escalated",
  "rr.peer_report": "Resource request partner report",
  "rr.received_escalation": "Resource request escalation received",
  "rr.submitted": "Resource request submitted",
  "rr.transition": "Resource request status changed",
  "sitrep.composed": "SITREP composed",
  "staff.checkin": "Staff checked in",
  "staff.checkout": "Staff checked out",
  "sync.conflict": "Offline edit conflict",
  "tracking.registered": "Tracked person or asset registered",
  "tracking.scan": "Tracking scan",
};

/**
 * The significant-events view: milestones an EOC watch officer logs, as
 * opposed to routine record keeping. Corrections stay in view so an amended
 * milestone never hides its amendment.
 */
export const SIGNIFICANT_CATEGORIES: readonly string[] = [
  "incident.activated",
  // The activation notice, or any mass notification sent for the incident.
  "notification.mass_sent",
  "incident.closed",
  "incident.area.revised",
  "rr.submitted",
  "rr.transition",
  "rr.escalated",
  "rr.received_escalation",
  "ipaws.send.requested",
  "ipaws.submitted",
  "ipaws.send.confirmed",
  "ipaws.send.cancelled",
  "iap.submitted",
  "iap.approved",
  "iap.completed",
  "jic.release_published",
  "sitrep.composed",
  "facility.status.reported",
  "correction",
];

/** "some_key.value" as "Some key value"; the fallback for keys without a label. */
export function humanize(key: string): string {
  const words = key.replace(/[._]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Unnamed event";
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? humanize(category);
}

/**
 * The server category filter for a view: one chosen category, else the
 * significant set, else none (every event).
 */
export function chronologyCategories(significantOnly: boolean, category: string): readonly string[] | undefined {
  if (category !== "all") return [category];
  return significantOnly ? SIGNIFICANT_CATEGORIES : undefined;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** A one-line reading of an entry's payload: a correction note, a state change, or a record summary. */
export function entryDetail(entry: ChronologyEntry): string {
  const p = entry.payload;
  const from = text(p["from"]);
  const to = text(p["to"]);
  if (from && to) return `${humanize(from)} to ${humanize(to)}`;
  const data = p["data"] && typeof p["data"] === "object" ? (p["data"] as Record<string, unknown>) : {};
  const board = text(p["board"]);
  const summary = text(p["note"]) ?? text(p["summary"]) ?? text(data["summary"])
    ?? text(p["title"]) ?? text(data["title"]) ?? text(p["name"]) ?? text(p["reason"]);
  return [board ? `${humanize(board)} board` : null, summary].filter(Boolean).join(": ");
}
