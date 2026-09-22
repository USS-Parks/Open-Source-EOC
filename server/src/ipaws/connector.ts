import { XMLParser } from "fast-xml-parser";

/**
 * IPAWS-OPEN connector (R2). Builds the SOAP request that carries
 * a CAP 1.2 alert into IPAWS-OPEN's postCAP operation and interprets the
 * service's response. Transport is injected, so the same code runs against
 * the live IPAWS-OPEN test and production endpoints and against recorded
 * fixtures in tests. No network access lives in this module.
 */

/** urn for the IPAWS-OPEN 3.0 web service operations. */
export const IPAWS_OPEN_NS = "http://www.integratedpublicalertsystem.gov/IPAWS_CAPService/";

export interface IpawsCredentials {
  /** Collaborative Operating Group id the alert is sent under. */
  readonly cogId: string;
  /** The COG's IPAWS-OPEN credential (PIN or web-service secret). */
  readonly secret: string;
}

export interface IpawsRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface IpawsHttpResponse {
  readonly status: number;
  readonly body: string;
}

/** A transport delivers a built request and returns the raw HTTP response. */
export type IpawsTransport = (req: IpawsRequest) => Promise<IpawsHttpResponse>;

export interface IpawsResult {
  readonly accepted: boolean;
  /** A short, human-readable explanation for the log and the operator. */
  readonly detail: string;
  readonly httpStatus: number;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Strip a leading XML declaration so the CAP document can be embedded as a
 * child element inside the SOAP envelope (a nested declaration is illegal).
 */
function stripXmlDeclaration(xml: string): string {
  return xml.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
}

/**
 * Build the IPAWS-OPEN postCAP request for a CAP alert. The COG id is
 * carried in the operation body as IPAWS-OPEN expects; the credential
 * secret rides in a header the transport forwards, never in the logged
 * request body.
 */
export function buildPostCapRequest(
  endpointUrl: string,
  creds: IpawsCredentials,
  capXml: string,
): IpawsRequest {
  const cap = stripXmlDeclaration(capXml).trim();
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>` +
    `<postCAP xmlns="${IPAWS_OPEN_NS}">` +
    `<cogId>${xmlEscape(creds.cogId)}</cogId>` +
    `<alertXml>${cap}</alertXml>` +
    `</postCAP>` +
    `</soap:Body>` +
    `</soap:Envelope>`;
  return {
    url: endpointUrl,
    method: "POST",
    headers: {
      "content-type": "text/xml; charset=utf-8",
      soapaction: `"${IPAWS_OPEN_NS}postCAP"`,
      "x-ipaws-cog": creds.cogId,
      "x-ipaws-pin": creds.secret,
    },
    body,
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

/**
 * Interpret an IPAWS-OPEN response. A SOAP Fault, a non-2xx status, or an
 * error result element is a rejection; anything else that names the alert
 * as received is an acceptance. The detail string is safe to log.
 */
export function parseIpawsResponse(res: IpawsHttpResponse): IpawsResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(res.body) as Record<string, unknown>;
  } catch {
    return { accepted: false, detail: "unparseable IPAWS-OPEN response", httpStatus: res.status };
  }
  const envelope = (parsed.Envelope ?? {}) as Record<string, unknown>;
  const soapBody = (envelope.Body ?? {}) as Record<string, unknown>;

  const fault = soapBody.Fault as Record<string, unknown> | undefined;
  if (fault) {
    const reason =
      (fault.faultstring as string) ??
      ((fault.Reason as Record<string, unknown>)?.Text as string) ??
      "IPAWS-OPEN fault";
    return { accepted: false, detail: String(reason), httpStatus: res.status };
  }

  if (res.status < 200 || res.status >= 300) {
    return { accepted: false, detail: `IPAWS-OPEN HTTP ${res.status}`, httpStatus: res.status };
  }

  const response = (soapBody.postCAPResponse ?? {}) as Record<string, unknown>;
  const result = response.return as Record<string, unknown> | string | undefined;
  if (result && typeof result === "object") {
    const errors = result.errorCount ?? result.errors;
    if (errors && String(errors) !== "0") {
      return {
        accepted: false,
        detail: String((result.errorMessage as string) ?? "IPAWS-OPEN reported errors"),
        httpStatus: res.status,
      };
    }
    const messageId = (result.messageId as string) ?? (result.identifier as string) ?? "";
    return {
      accepted: true,
      detail: messageId ? `accepted (${messageId})` : "accepted",
      httpStatus: res.status,
    };
  }

  return { accepted: true, detail: "accepted", httpStatus: res.status };
}

/** The default transport: a real HTTP POST to IPAWS-OPEN. */
export const httpTransport: IpawsTransport = async (req) => {
  const res = await fetch(req.url, { method: req.method, headers: { ...req.headers }, body: req.body });
  return { status: res.status, body: await res.text() };
};

/** Build, send, and interpret in one step. */
export async function postCap(
  endpointUrl: string,
  creds: IpawsCredentials,
  capXml: string,
  transport: IpawsTransport,
): Promise<IpawsResult> {
  const req = buildPostCapRequest(endpointUrl, creds, capXml);
  const res = await transport(req);
  return parseIpawsResponse(res);
}
