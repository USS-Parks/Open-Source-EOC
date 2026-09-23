import { ICS_FORMS } from "@openeoc/shared";

/**
 * Staffing as the web client sees it: the summary shape the staffing route
 * returns, the ICS 211 rows built from the open check-ins, and the badge code
 * helpers used when a code is printed or typed at check-in.
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
  readonly assignment: string;
  readonly date: string;
  readonly time: string;
  readonly method: string;
}

/** One numbered ICS 211 line per open check-in, in check-in order. */
export function ics211Rows(onDuty: readonly OnDutyEntry[]): Ics211Row[] {
  return onDuty.map((entry, index) => {
    const at = new Date(entry.since);
    return {
      id: entry.checkinId,
      number: index + 1,
      name: entry.personName,
      assignment: entry.positionTitle,
      date: icsDate(at),
      time: icsTime(at),
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

/** Read a QR code from a camera image where the browser has BarcodeDetector; null when it cannot. */
export async function readQrCode(file: File): Promise<string | null> {
  const api = globalThis as typeof globalThis & {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect(source: ImageBitmap): Promise<Array<{ rawValue?: string }>>;
    };
  };
  if (!api.BarcodeDetector) return null;
  const bitmap = await createImageBitmap(file);
  try {
    const [result] = await new api.BarcodeDetector({ formats: ["qr_code"] }).detect(bitmap);
    return result?.rawValue ? normalizeBadgeCode(result.rawValue) || null : null;
  } finally {
    bitmap.close();
  }
}

export const canReadQrCodes = (): boolean => "BarcodeDetector" in globalThis;
