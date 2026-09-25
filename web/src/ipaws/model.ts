/**
 * IPAWS-OPEN enablement and the two-person send, as the server reports them,
 * plus the pure rules the alerts surface uses to label them. Nothing here
 * talks to the network; the API client carries these shapes.
 */

export type IpawsEnvironment = "test" | "production";

export interface IpawsStatus {
  readonly enabled: boolean;
  readonly environment: IpawsEnvironment;
  readonly configured: boolean;
  readonly cogId: string | null;
  readonly endpointUrl: string | null;
  /** A short fingerprint of the stored certificate bundle; the bundle itself is never returned. */
  readonly credentialFingerprint: string | null;
  /** When the stored COG certificate expires; null until one is configured. */
  readonly certificateExpiresAt: string | null;
  readonly moaAcknowledged: boolean;
  readonly moaReference: string | null;
  readonly moaAcknowledgedAt: string | null;
  readonly secretStorageAvailable: boolean;
}

export interface IpawsConfigInput {
  readonly environment: IpawsEnvironment;
  readonly cogId: string;
  readonly endpointUrl: string;
  /** The COG's FEMA certificate and private key as one PEM bundle; omit to keep the stored one. */
  readonly credential?: string;
}

/** 'live' needs IPAWS enabled; 'handshake' is the test-environment dry run allowed before that. */
export type IpawsSendKind = "live" | "handshake";

export interface IpawsSendRequest {
  readonly id: string;
  readonly capAlertId: string;
  readonly kind: IpawsSendKind;
  readonly status: "pending" | "confirmed" | "cancelled" | "expired";
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly submissionId: string | null;
}

/** One status item IPAWS-OPEN returned for a dissemination channel. */
export interface IpawsChannelStatus {
  readonly channel: string;
  readonly code: string | null;
  readonly error: boolean;
  readonly status: string;
}

export interface IpawsSendResult {
  readonly accepted: boolean;
  readonly detail: string;
  readonly httpStatus: number;
  readonly channels: readonly IpawsChannelStatus[];
  readonly submissionId: string;
  readonly request: IpawsSendRequest;
}

/** An IPAWS audit event from the jurisdiction chronology, with the actor's name. */
export interface IpawsTrailEntry {
  readonly at: string;
  readonly personId: string;
  readonly person: string;
  readonly category: string;
  readonly subjectId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

// FEMA serves IPAWS-OPEN from fema.gov hosts (IDG v4.02 section 4.3). Any other endpoint is a stand-in.
const FEMA_HOST_SUFFIXES = [".fema.gov"];

/** True only for an https endpoint on a FEMA IPAWS-OPEN host. */
export function isFemaEndpoint(url: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && FEMA_HOST_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

export type IpawsModeKey = "unconfigured" | "fixture" | "test" | "standby" | "live";

export interface IpawsMode {
  readonly key: IpawsModeKey;
  readonly label: string;
  readonly detail: string;
}

/**
 * Where a confirmed send would go. Anything short of an enabled production
 * COG on a FEMA host is named for what it is, so a fixture or test setup is
 * never mistaken for the live system.
 */
export function ipawsMode(status: IpawsStatus): IpawsMode {
  if (!status.configured) {
    return { key: "unconfigured", label: "IPAWS not configured", detail: "No alert can leave this workspace." };
  }
  if (!isFemaEndpoint(status.endpointUrl)) {
    return {
      key: "fixture",
      label: "Fixture endpoint, not FEMA",
      detail: "Sends reach only a stand-in endpoint. Nothing reaches FEMA IPAWS-OPEN or the public.",
    };
  }
  if (status.environment !== "production") {
    return {
      key: "test",
      label: "IPAWS test environment",
      detail: "Confirmed sends reach the FEMA IPAWS-OPEN test environment, not the public.",
    };
  }
  if (!status.enabled) {
    return { key: "standby", label: "Production IPAWS, disabled", detail: "Production is configured but switched off. Nothing is sent." };
  }
  return { key: "live", label: "LIVE production IPAWS", detail: "A confirmed send reaches the public through FEMA IPAWS-OPEN." };
}

export interface SendAvailability {
  readonly live: boolean;
  readonly handshake: boolean;
  /** Why no send can be requested, or null when one can. */
  readonly reason: string | null;
}

/** Which send requests an actor may make for an alert, mirroring the server's refusals. */
export function sendAvailability(input: {
  readonly isAdmin: boolean;
  readonly ipawsEligible: boolean;
  readonly reviewState: string | null;
  readonly status: IpawsStatus | null;
}): SendAvailability {
  const none = (reason: string): SendAvailability => ({ live: false, handshake: false, reason });
  if (!input.isAdmin) return none("Only a jurisdiction admin can request an IPAWS send.");
  if (!input.ipawsEligible) return none("This alert does not meet the FEMA IPAWS profile.");
  if (input.reviewState !== "approved") return none("Approve the alert locally before requesting an IPAWS send.");
  const status = input.status;
  if (!status?.configured) return none("IPAWS is not configured for this jurisdiction.");
  if (status.enabled) return { live: true, handshake: false, reason: null };
  if (status.environment === "test") return { live: false, handshake: true, reason: null };
  return none("IPAWS is disabled. An admin must enable it before a send can be requested.");
}

/** Time left on a pending request as m:ss, or null once it has lapsed. */
export function timeLeft(expiresAt: string, now: number): string | null {
  const ms = Date.parse(expiresAt) - now;
  if (!(ms > 0)) return null;
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export type SendOutcomeKey = "pending" | "accepted" | "rejected" | "submitted" | "expired" | "cancelled";

/**
 * The state an operator reads for a send request: a short label, and once
 * IPAWS-OPEN has answered, its answer by channel or its reason.
 */
export function sendOutcome(
  send: IpawsSendRequest,
  trail: readonly IpawsTrailEntry[],
  now: number,
): { readonly key: SendOutcomeKey; readonly label: string; readonly answer?: string } {
  if (send.status === "cancelled") return { key: "cancelled", label: "Cancelled" };
  if (send.status === "expired" || (send.status === "pending" && timeLeft(send.expiresAt, now) === null)) {
    return { key: "expired", label: "Expired without confirmation" };
  }
  if (send.status === "pending") return { key: "pending", label: "Awaiting a second admin" };
  const submitted = trail.find((entry) => entry.category === "ipaws.submitted" && entry.payload.requestId === send.id);
  if (!submitted) return { key: "submitted", label: "Submitted" };
  const detail = typeof submitted.payload.detail === "string" ? submitted.payload.detail : "";
  const channels = Array.isArray(submitted.payload.channels) ? (submitted.payload.channels as IpawsChannelStatus[]) : [];
  const summary = channelSummary(channels);
  const accepted = submitted.payload.accepted === true;
  const answer = accepted || channels.some((c) => c.error) ? summary : detail;
  return {
    key: accepted ? "accepted" : "rejected",
    label: accepted ? "Accepted by IPAWS-OPEN" : "Rejected by IPAWS-OPEN",
    ...(answer ? { answer } : {}),
  };
}

/** The channels that reach the public, as opposed to CAP exchange and profile checks (IDG Table 1). */
const DISSEMINATION = new Set(["NWEM", "EAS", "CMAS", "PUBLIC"]);

/**
 * Which public channels IPAWS-OPEN acknowledged and which it refused, with
 * the code and status of each refusal. A refusal on one channel can come
 * with an alert already out on another, so both are named.
 */
export function channelSummary(channels: readonly IpawsChannelStatus[]): string {
  const refused = channels.filter((c) => c.error);
  const failed = new Set(refused.map((c) => c.channel));
  const reached = [...new Set(
    channels.filter((c) => DISSEMINATION.has(c.channel) && !failed.has(c.channel) && c.status === "Ack").map((c) => c.channel),
  )];
  const parts: string[] = [];
  if (reached.length > 0) parts.push(`Acknowledged on ${reached.join(", ")}.`);
  if (refused.length > 0) {
    parts.push(`Refused on ${refused.map((c) => `${c.channel} (${[c.code, c.status].filter(Boolean).join(" ")})`).join(", ")}.`);
  }
  return parts.join(" ");
}

/** A person's display name from the IPAWS audit trail; "You" for the viewer. */
export function actorName(personId: string | null, selfId: string | null, trail: readonly IpawsTrailEntry[]): string {
  if (!personId) return "Not recorded";
  if (personId === selfId) return "You";
  return trail.find((entry) => entry.personId === personId)?.person ?? "Another admin";
}
