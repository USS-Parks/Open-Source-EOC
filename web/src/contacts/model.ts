/** Contacts, groups and mass notifications as the web client reads them, and their display helpers. */

export interface Contact {
  readonly id: string;
  readonly name: string;
  readonly organization: string | null;
  readonly title: string | null;
  readonly emails: readonly string[];
  readonly phones: readonly string[];
  readonly personId: string | null;
  readonly personName: string | null;
  readonly positionId: string | null;
  readonly positionTitle: string | null;
  readonly notes: string | null;
  readonly active: boolean;
  readonly updatedAt: string;
}

export interface ContactInput {
  readonly name: string;
  readonly organization: string | null;
  readonly title: string | null;
  readonly emails: readonly string[];
  readonly phones: readonly string[];
  readonly personId: string | null;
  readonly positionId: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

export interface ContactsPage {
  readonly contacts: readonly Contact[];
  readonly nextCursor: string | null;
}

export interface ContactGroup {
  readonly id: string;
  readonly name: string;
  readonly members: ReadonlyArray<{ readonly contactId: string; readonly name: string; readonly active: boolean }>;
  readonly updatedAt: string;
}

export interface ContactGroupsPage {
  readonly groups: readonly ContactGroup[];
  readonly nextCursor: string | null;
}

export const IMPORT_FIELDS = ["name", "organization", "title", "email", "phone", "notes"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportMapping = Readonly<Record<ImportField, string | null>>;

export interface ImportRow {
  readonly row: number;
  readonly name: string;
  readonly organization: string | null;
  readonly title: string | null;
  readonly emails: readonly string[];
  readonly phones: readonly string[];
  readonly notes: string | null;
  readonly errors: readonly string[];
}

export interface ContactImportResult {
  readonly headers: readonly string[];
  readonly mapping: ImportMapping;
  readonly rows: readonly ImportRow[];
  readonly valid: number;
  readonly invalid: number;
  readonly created: number;
}

export type MassChannel = "email" | "sms" | "inapp";
export type MassState = "sent" | "calling" | "acknowledged" | "unacknowledged";

/** Whom a send reaches: any of these, together; everyone is reached once. */
export interface Audience {
  readonly groupIds?: readonly string[];
  readonly contactIds?: readonly string[];
  /** Whoever holds each position now. */
  readonly positionIds?: readonly string[];
  /** Whoever is on shift in each position now, or its holders when no one is. */
  readonly onCallPositionIds?: readonly string[];
}

export interface MassSendInput extends Audience {
  readonly subject: string;
  readonly message: string;
  readonly groupId?: string;
  /** In order; with a fallback, the order SMS and email are tried in. */
  readonly channels: readonly MassChannel[];
  readonly mode: "broadcast" | "calldown";
  readonly intervalMinutes?: number;
  /** A broadcast's minutes to wait for an acknowledgement before the next device. */
  readonly fallbackMinutes?: number;
  readonly acknowledgementsNeeded?: number;
  /** Up to six answers the recipient chooses from on the acknowledgement link. */
  readonly responseOptions?: readonly string[];
}

/** The notice an activation sends; without a message it says the incident is activated. */
export interface ActivationNotice extends Audience {
  readonly channels: readonly MassChannel[];
  readonly message?: string;
  readonly fallbackMinutes?: number;
  readonly responseOptions?: readonly string[];
}

/** Answers typed one per line, checked as the server checks them; throws the reason. */
export function answersOf(text: string): string[] {
  const answers = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (answers.length > 6) throw new Error("Ask for at most six answers.");
  if (answers.some((a) => a.length > 60)) throw new Error("Keep each answer to 60 characters.");
  if (new Set(answers).size !== answers.length) throw new Error("Each answer must differ from the others.");
  return answers;
}

/** An audience with its empty parts left out, or null when it names no one. */
export function audienceOf(parts: { readonly [K in keyof Audience]-?: readonly string[] }): Audience | null {
  const audience = Object.fromEntries(Object.entries(parts).filter(([, ids]) => ids.length > 0)) as Audience;
  return Object.keys(audience).length > 0 ? audience : null;
}

export interface MassNotificationSummary {
  readonly id: string;
  readonly subject: string;
  readonly mode: "broadcast" | "calldown";
  readonly channels: readonly MassChannel[];
  readonly groupName: string | null;
  /** What the send was addressed to, in one line, with any part that reached no one. */
  readonly audience: string;
  readonly incidentId: string | null;
  readonly intervalMinutes: number | null;
  readonly fallbackMinutes: number | null;
  readonly acknowledgementsNeeded: number;
  readonly sentBy: string;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly contactCount: number;
  readonly notified: number;
  readonly acknowledged: number;
  readonly state: MassState;
  /** Each answer the send asked for, with how many chose it; empty when it asked nothing. */
  readonly responses: ReadonlyArray<{ readonly option: string; readonly count: number }>;
}

export interface MassNotificationsPage {
  readonly massNotifications: readonly MassNotificationSummary[];
  readonly nextCursor: string | null;
}

export interface MassDelivery {
  readonly channel: MassChannel;
  readonly address: string | null;
  readonly state: "scheduled" | "queued" | "retrying" | "sent" | "failed" | "expired" | "delivered";
  readonly attempts: number;
  readonly error: string | null;
  readonly receipt: Readonly<Record<string, unknown>> | null;
  readonly at: string;
  /** When a queued delivery falls due; a scheduled fallback goes then unless acknowledged first. */
  readonly dueAt: string | null;
}

export interface MassRecipient {
  readonly id: string;
  readonly priority: number;
  readonly contactId: string | null;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly inApp: boolean;
  /** How the send found this person: a group, a position held, a shift. */
  readonly reachedThrough: string | null;
  /** The answer chosen on the link, when the send asked for one. */
  readonly response: string | null;
  readonly notifiedAt: string | null;
  readonly linkExpiresAt: string | null;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedVia: "link" | "app" | "sms" | "sheet" | null;
  /** Texts read back from an SMS gateway from this person's number, oldest first. */
  readonly replies: ReadonlyArray<{ readonly body: string; readonly receivedAt: string; readonly outcome: "acknowledged" | "answered" | "not_an_answer" }>;
  readonly deliveries: readonly MassDelivery[];
}

/** One line of a printed call-down sheet entered back: who was reached, when, and the answer given. */
export interface SheetEntry {
  readonly recipientId: string;
  /** When they were reached; now when left out. */
  readonly at?: string;
  /** One of the send's answers, when it asked a question. */
  readonly response?: string;
}

const ACKNOWLEDGED_VIA: Readonly<Record<NonNullable<MassRecipient["acknowledgedVia"]>, string>> = {
  link: "by link",
  app: "in the app",
  sms: "by text reply",
  sheet: "from the call-down sheet",
};

/** How and when a recipient acknowledged, with their answer: "Answered Available by text reply". */
export function acknowledgedText(r: Pick<MassRecipient, "response" | "acknowledgedVia">): string {
  return `${r.response ? `Answered ${r.response}` : "Acknowledged"} ${ACKNOWLEDGED_VIA[r.acknowledgedVia ?? "link"]}`;
}

export interface MassNotificationDetail extends MassNotificationSummary {
  readonly message: string;
  readonly recipients: readonly MassRecipient[];
}

export const CHANNEL_LABELS: Readonly<Record<MassChannel, string>> = { email: "Email", sms: "SMS", inapp: "In app" };

/** Addresses typed into one field, separated by commas, semicolons or line breaks. */
export function splitList(text: string): string[] {
  return text.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
}

/** A phone number as people type it, reduced to E.164 form when it is one. */
export function normalizePhone(text: string): string {
  return text.replace(/[\s().-]/g, "");
}

export function stateLabel(m: Pick<MassNotificationSummary, "state" | "acknowledged" | "notified" | "contactCount" | "acknowledgementsNeeded">): string {
  const count = `${m.acknowledged} of ${m.contactCount} acknowledged`;
  switch (m.state) {
    case "sent": return `Sent · ${count}`;
    case "acknowledged": return `Acknowledged · ${count}`;
    case "unacknowledged": return `Call-down ended without ${m.acknowledgementsNeeded === 1 ? "an acknowledgement" : `${m.acknowledgementsNeeded} acknowledgements`} · ${count}`;
    case "calling": return `Calling down · contact ${m.notified} of ${m.contactCount} · ${count}`;
  }
}

export function stateStatus(state: MassState): "success" | "warning" | "critical" | "unknown" {
  return state === "acknowledged" ? "success" : state === "unacknowledged" ? "critical" : state === "calling" ? "warning" : "unknown";
}

/** What a delivery's receipt or error says, in one line. */
export function deliveryDetail(d: MassDelivery): string {
  if (d.state === "failed" || d.state === "retrying" || d.state === "expired") return d.error ?? "";
  const r = d.receipt;
  if (!r) return "";
  if (r.provider === "fixture") return "fixture: not sent";
  if (typeof r.response === "string") return r.response;
  return typeof r.messageId === "string" ? `message ${r.messageId}` : "";
}

export const DELIVERY_LABELS: Readonly<Record<MassDelivery["state"], string>> = {
  scheduled: "Falls back if not acknowledged",
  queued: "Queued",
  retrying: "Waiting for a route",
  sent: "Sent",
  failed: "Failed",
  expired: "Expired, not sent",
  delivered: "Delivered",
};
