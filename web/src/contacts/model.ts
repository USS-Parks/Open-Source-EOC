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

export interface MassSendInput {
  readonly subject: string;
  readonly message: string;
  readonly groupId?: string;
  readonly contactIds?: readonly string[];
  readonly channels: readonly MassChannel[];
  readonly mode: "broadcast" | "calldown";
  readonly intervalMinutes?: number;
  readonly acknowledgementsNeeded?: number;
}

export interface MassNotificationSummary {
  readonly id: string;
  readonly subject: string;
  readonly mode: "broadcast" | "calldown";
  readonly channels: readonly MassChannel[];
  readonly groupName: string | null;
  readonly intervalMinutes: number | null;
  readonly acknowledgementsNeeded: number;
  readonly sentBy: string;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly contactCount: number;
  readonly notified: number;
  readonly acknowledged: number;
  readonly state: MassState;
}

export interface MassNotificationsPage {
  readonly massNotifications: readonly MassNotificationSummary[];
  readonly nextCursor: string | null;
}

export interface MassDelivery {
  readonly channel: MassChannel;
  readonly address: string | null;
  readonly state: "queued" | "retrying" | "sent" | "failed" | "delivered";
  readonly attempts: number;
  readonly error: string | null;
  readonly receipt: Readonly<Record<string, unknown>> | null;
  readonly at: string;
}

export interface MassRecipient {
  readonly id: string;
  readonly priority: number;
  readonly contactId: string | null;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly inApp: boolean;
  readonly notifiedAt: string | null;
  readonly linkExpiresAt: string | null;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedVia: "link" | "app" | null;
  readonly deliveries: readonly MassDelivery[];
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
  if (d.state === "failed" || d.state === "retrying") return d.error ?? "";
  const r = d.receipt;
  if (!r) return "";
  if (r.provider === "fixture") return "fixture: not sent";
  if (typeof r.response === "string") return r.response;
  return typeof r.messageId === "string" ? `message ${r.messageId}` : "";
}

export const DELIVERY_LABELS: Readonly<Record<MassDelivery["state"], string>> = {
  queued: "Queued",
  retrying: "Retrying",
  sent: "Sent",
  failed: "Failed",
  delivered: "Delivered",
};
