import { ICS_FORMS } from "@openeoc/shared";
import { canReadCodes, readCodeFromImage } from "../design/qr.js";

/**
 * Staffing as the web client sees it: the summary shape the staffing route
 * returns, the ICS 211 rows built from the check-in history, and the badge
 * code helpers used when a code is printed or typed at check-in.
 */

export interface OnDutyEntry {
  readonly checkinId: string;
  readonly personId: string;
  readonly personName: string;
  readonly positionId: string;
  readonly positionTitle: string;
  readonly since: string;
  readonly method: string;
}

/** One check-in as the ICS-211 lists it, open or closed. */
export interface CheckinHistoryEntry {
  readonly checkinId: string;
  readonly personId: string;
  readonly personName: string;
  readonly agency: string;
  readonly positionTitle: string;
  readonly checkedInAt: string;
  readonly checkedOutAt: string | null;
  readonly method: string;
}

/** An issued badge; its code is never sent again. */
export interface BadgeEntry {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly label: string | null;
  readonly issuedAt: string;
  readonly revokedAt: string | null;
}

export interface UpcomingShift {
  readonly id: string;
  readonly positionTitle: string;
  readonly personName: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface StaffingSummary {
  /** Open check-ins, earliest first, one page at a time. */
  readonly onDuty: readonly OnDutyEntry[];
  readonly nextCursor: string | null;
  readonly vacantPositions: ReadonlyArray<{ readonly id: string; readonly key: string; readonly title: string }>;
  readonly upcomingShifts: readonly UpcomingShift[];
}

export const ICS_211 = ICS_FORMS.find((form) => form.id === "ICS-211")!;

const METHOD_LABELS: Readonly<Record<string, string>> = { manual: "Manual entry", scan: "Badge scan" };

export const methodLabel = (method: string): string => METHOD_LABELS[method] ?? method;

const pad = (value: number) => String(value).padStart(2, "0");

/** Local calendar date, year first. */
export const icsDate = (at: Date): string => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

/** Local 24-hour clock time as ICS forms write it, for example 0605. */
export const icsTime = (at: Date): string => `${pad(at.getHours())}${pad(at.getMinutes())}`;

export const icsDateTime = (value: string): string => {
  const at = new Date(value);
  return `${icsDate(at)} ${icsTime(at)}`;
};

export interface Ics211Row {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  readonly agency: string;
  readonly assignment: string;
  readonly date: string;
  readonly time: string;
  /** When the person checked out, or "On duty". */
  readonly checkOut: string;
  readonly method: string;
}

/** One numbered ICS 211 line per check-in, open or closed, in check-in order. */
export function ics211Rows(checkins: readonly CheckinHistoryEntry[]): Ics211Row[] {
  return checkins.map((entry, index) => {
    const at = new Date(entry.checkedInAt);
    return {
      id: entry.checkinId,
      number: index + 1,
      name: entry.personName,
      agency: entry.agency,
      assignment: entry.positionTitle,
      date: icsDate(at),
      time: icsTime(at),
      checkOut: entry.checkedOutAt ? icsDateTime(entry.checkedOutAt) : "On duty",
      method: methodLabel(entry.method),
    };
  });
}

/** A badge code in groups of four, easier to read aloud and type. */
export const groupBadgeCode = (code: string): string => code.match(/.{1,4}/g)?.join(" ") ?? "";

/** A typed or scanned badge code with the grouping spaces removed. */
export const normalizeBadgeCode = (input: string): string => input.replace(/\s+/g, "");

/** A datetime-local value as an ISO instant; undefined when blank or unreadable. */
export function instant(local: string): string | undefined {
  const date = new Date(local);
  return local && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

/** Read a badge's QR code from a camera image; null when none is found. */
export async function readQrCode(file: File): Promise<string | null> {
  const code = await readCodeFromImage(file, ["qr_code"]);
  return code ? normalizeBadgeCode(code) || null : null;
}

export const canReadQrCodes = canReadCodes;
