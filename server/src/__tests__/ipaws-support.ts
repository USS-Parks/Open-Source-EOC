import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selfSigned } from "./smtp-relay.js";

/**
 * Shared material for the IPAWS tests: a COG certificate bundle made on the
 * spot (no key is ever committed), the IDG-shaped response fixtures, and an
 * IPAWS-eligible alert whose times are relative to now, since a send
 * refuses an alert that has already expired.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "ipaws", "__fixtures__");

export function ipawsFixture(
  name: "accepted" | "cmas-rejected" | "signature-invalid" | "expired-certificate",
): string {
  return readFileSync(join(FIXTURES, `postcap-${name}.xml`), "utf8");
}

/** A certificate and RSA key as the one PEM bundle an admin pastes, CN naming the COG. */
export function cogCertificate(
  cogId: string,
  options: { commonName?: string; notAfter?: string; rsa?: boolean } = {},
): { bundle: string; cert: string; key: string } {
  const { cert, key } = selfSigned({
    rsa: options.rsa ?? true,
    commonName: options.commonName ?? `IPAWSOPEN_${cogId}`,
    ...(options.notAfter ? { notAfter: options.notAfter } : {}),
  });
  return { bundle: `${cert}${key}`, cert, key };
}

/** A time in CAP 1.2 form, minutes from now. */
export function capTimeFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "-00:00");
}

/** An IPAWS-eligible flood warning, in effect now and expiring in six hours. */
export function eligibleAlert(overrides: { status?: string; expires?: string; senderName?: string } = {}) {
  return {
    sender: "oes@yuroktribe.example",
    status: overrides.status ?? "Actual",
    msgType: "Alert",
    scope: "Public",
    code: ["IPAWSv1.0"],
    info: [
      {
        language: "en-US",
        category: ["Met"],
        event: "Flood Warning",
        responseType: ["Prepare"],
        urgency: "Expected",
        severity: "Severe",
        certainty: "Likely",
        eventCode: [{ valueName: "SAME", value: "FLW" }],
        effective: capTimeFromNow(0),
        onset: capTimeFromNow(60),
        expires: overrides.expires ?? capTimeFromNow(360),
        senderName: overrides.senderName ?? "Yurok Tribe OES",
        headline: "Flood Warning for the Lower Klamath",
        description: "Rising water along the Lower Klamath River through the evening.",
        instruction: "Move to higher ground.",
        area: [
          {
            areaDesc: "Lower Klamath River corridor",
            geocode: [{ valueName: "SAME", value: "006015" }],
          },
        ],
      },
    ],
  };
}
