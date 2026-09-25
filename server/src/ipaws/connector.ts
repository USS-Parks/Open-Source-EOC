import { X509Certificate, createPrivateKey, type KeyObject } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { SignedXml } from "xml-crypto";

/**
 * IPAWS-OPEN connector, built to FEMA's IPAWS-OPEN Interface Design Guide
 * (IDG) v4.02. It signs a CAP 1.2 alert and the SOAP request that carries it
 * into the CAP service's postCAP operation, and reads the status IPAWS-OPEN
 * returns for each dissemination channel. Transport is injected, so the same
 * code runs against the IPAWS-OPEN environments and against fixtures in
 * tests. No network access lives in this module.
 */

/** The CAP service namespace (IDG 8.2 and the CAPService WSDL). */
export const IPAWS_CAP_SERVICE_NS = "http://gov.fema.ipaws.services/IPAWS_CAPService/";
const SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/";
const WSSE_NS = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
const WSU_NS = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
const X509_TOKEN = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3";
const BASE64_BINARY =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary";

// IDG Table 91: RSA-SHA256 over exclusive canonicalization, SHA-256 digests.
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const EXC_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";

const BODY_ID = "id-body";
const TOKEN_ID = "x509-token";

export interface IpawsCredentials {
  /** Collaborative Operating Group id; the certificate's CN must contain it. */
  readonly cogId: string;
  /** The IDG's logonUser: who is sending, kept with the transaction at IPAWS-OPEN. */
  readonly logonUser: string;
  /** The COG's FEMA-issued certificate and its RSA private key, as one PEM bundle. */
  readonly certificate: string;
}

export interface IpawsRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** The signed CAP alert the body carries: the document IPAWS-OPEN disseminates. */
  readonly signedAlert: string;
}

export interface IpawsHttpResponse {
  readonly status: number;
  readonly body: string;
}

/** A transport delivers a built request and returns the raw HTTP response. */
export type IpawsTransport = (req: IpawsRequest) => Promise<IpawsHttpResponse>;

/** One status item IPAWS-OPEN returned for a dissemination channel (IDG Table 109). */
export interface IpawsChannelStatus {
  readonly channel: string;
  readonly code: string | null;
  readonly error: boolean;
  readonly status: string;
}

export interface IpawsResult {
  readonly accepted: boolean;
  /** A short, human-readable explanation for the log and the operator. */
  readonly detail: string;
  readonly httpStatus: number;
  readonly channels: readonly IpawsChannelStatus[];
}

export interface IpawsSend extends IpawsResult {
  /** The signed alert as transmitted, or null when nothing was sent. */
  readonly transmittedXml: string | null;
}

/** A credential IPAWS-OPEN would refuse; the message names the first problem. */
export class IpawsCredentialError extends Error {}

export interface IpawsCertificate {
  readonly certPem: string;
  readonly key: KeyObject;
  readonly commonName: string;
  readonly expiresAt: Date;
}

const CERT_PEM = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/;
const KEY_PEM = /-----BEGIN ((?:RSA |EC |ENCRYPTED )?PRIVATE KEY)-----([\s\S]+?)-----END \1-----/;

/** A PEM block rebuilt with 64-character lines, whatever line breaks a paste kept or lost. */
function pem(label: string, body: string): string {
  const base64 = body.replace(/\s/g, "");
  return `-----BEGIN ${label}-----\n${(base64.match(/.{1,64}/g) ?? []).join("\n")}\n-----END ${label}-----\n`;
}

/**
 * Read a PEM bundle holding the COG certificate and its private key, and
 * check it as IPAWS-OPEN will: an RSA key that belongs to the certificate, a
 * certificate in date, and a CN that contains the COG id (IDG 8.2.1).
 */
export function readCertificate(bundle: string, cogId: string, now = new Date()): IpawsCertificate {
  const certBlock = CERT_PEM.exec(bundle);
  if (!certBlock) throw new IpawsCredentialError("the credential holds no PEM certificate");
  const keyBlock = KEY_PEM.exec(bundle);
  if (!keyBlock) throw new IpawsCredentialError("the credential holds no PEM private key");
  if (keyBlock[1] === "ENCRYPTED PRIVATE KEY" || keyBlock[2]!.includes("Proc-Type: 4,ENCRYPTED"))
    throw new IpawsCredentialError("the private key is encrypted; export it without a passphrase");
  const certPem = pem("CERTIFICATE", certBlock[1]!);
  let cert: X509Certificate;
  let key: KeyObject;
  try {
    cert = new X509Certificate(certPem);
  } catch {
    throw new IpawsCredentialError("the certificate cannot be read");
  }
  try {
    key = createPrivateKey(pem(keyBlock[1]!, keyBlock[2]!));
  } catch {
    throw new IpawsCredentialError("the private key cannot be read");
  }
  if (key.asymmetricKeyType !== "rsa")
    throw new IpawsCredentialError("IPAWS-OPEN signatures are RSA-SHA256; the private key is not an RSA key");
  if (!cert.checkPrivateKey(key))
    throw new IpawsCredentialError("the private key does not belong to the certificate");
  const expiresAt = new Date(cert.validTo);
  if (!(expiresAt.getTime() > now.getTime()))
    throw new IpawsCredentialError(`the certificate expired on ${expiresAt.toISOString()}`);
  if (new Date(cert.validFrom).getTime() > now.getTime())
    throw new IpawsCredentialError(`the certificate is not valid until ${new Date(cert.validFrom).toISOString()}`);
  const commonName = /^CN=(.*)$/m.exec(cert.subject)?.[1] ?? "";
  if (!commonName.includes(cogId))
    throw new IpawsCredentialError(
      `the certificate's CN (${commonName || "none"}) does not contain COG id ${cogId}`,
    );
  return { certPem, key, commonName, expiresAt };
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
 * Sign a CAP alert with an enveloped signature over the whole alert (IDG
 * 8.2). Any later change to the alert, whitespace included, breaks it.
 */
export function signAlert(capXml: string, cert: IpawsCertificate): string {
  const sig = new SignedXml({
    privateKey: cert.key,
    publicCert: cert.certPem,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: EXC_C14N,
  });
  sig.addReference({
    xpath: "/*",
    transforms: [ENVELOPED, EXC_C14N],
    digestAlgorithm: SHA256,
    isEmptyUri: true,
  });
  sig.computeSignature(stripXmlDeclaration(capXml).trim());
  return sig.getSignedXml();
}

/**
 * Build the IPAWS-OPEN postCAP request for a CAP alert (IDG 5.3 and 8.2):
 * the signed alert in postCAPRequestTypeDef; the COG and user in
 * CAPHeaderTypeDef; and a WS-Security header carrying the certificate as a
 * BinarySecurityToken and a signature over the Body. Throws
 * IpawsCredentialError before signing anything IPAWS-OPEN would refuse.
 */
export function buildPostCapRequest(
  endpointUrl: string,
  creds: IpawsCredentials,
  capXml: string,
  now = new Date(),
): IpawsRequest {
  const cert = readCertificate(creds.certificate, creds.cogId, now);
  const signedAlert = signAlert(capXml, cert);
  const token = cert.certPem.replace(/-----[A-Z ]+-----|\s/g, "");
  const envelope =
    `<soap:Envelope xmlns:soap="${SOAP_NS}" xmlns:wsu="${WSU_NS}" xmlns:ipaws="${IPAWS_CAP_SERVICE_NS}">` +
    `<soap:Header>` +
    `<wsse:Security xmlns:wsse="${WSSE_NS}" soap:mustUnderstand="1">` +
    `<wsse:BinarySecurityToken EncodingType="${BASE64_BINARY}" ValueType="${X509_TOKEN}" wsu:Id="${TOKEN_ID}">` +
    `${token}</wsse:BinarySecurityToken>` +
    `</wsse:Security>` +
    `<ipaws:CAPHeaderTypeDef>` +
    `<ipaws:logonUser>${xmlEscape(creds.logonUser)}</ipaws:logonUser>` +
    `<ipaws:logonCogId>${xmlEscape(creds.cogId)}</ipaws:logonCogId>` +
    `</ipaws:CAPHeaderTypeDef>` +
    `</soap:Header>` +
    `<soap:Body wsu:Id="${BODY_ID}">` +
    `<ipaws:postCAPRequestTypeDef>${signedAlert}</ipaws:postCAPRequestTypeDef>` +
    `</soap:Body>` +
    `</soap:Envelope>`;

  const sig = new SignedXml({
    idMode: "wssecurity",
    privateKey: cert.key,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: EXC_C14N,
    getKeyInfoContent: () =>
      `<wsse:SecurityTokenReference><wsse:Reference URI="#${TOKEN_ID}" ValueType="${X509_TOKEN}"/>` +
      `</wsse:SecurityTokenReference>`,
  });
  sig.addReference({
    xpath: `//*[local-name(.)='Body' and namespace-uri(.)='${SOAP_NS}']`,
    transforms: [EXC_C14N],
    digestAlgorithm: SHA256,
  });
  sig.computeSignature(envelope, {
    prefix: "ds",
    location: { reference: `//*[local-name(.)='Security' and namespace-uri(.)='${WSSE_NS}']`, action: "append" },
    existingPrefixes: { wsse: WSSE_NS },
  });

  return {
    url: endpointUrl,
    method: "POST",
    headers: {
      "content-type": "text/xml; charset=utf-8",
      soapaction: `"${IPAWS_CAP_SERVICE_NS}postCAP"`,
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>${sig.getSignedXml()}`,
    signedAlert,
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === "parameterListItem" || name === "subParaListItem",
});

/** Element text whether or not the element also carried attributes. */
function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v) return String((v as Record<string, unknown>)["#text"]);
  return "";
}

type Rec = Record<string, unknown>;

/**
 * The response lists each channel's status items as runs of CHANNELNAME,
 * STATUSITEMID, ERROR and STATUS (IDG 8.2.1 and Table 109); a run starts at
 * each CHANNELNAME.
 */
function readChannels(items: readonly Rec[]): IpawsChannelStatus[] {
  const channels: { channel: string; code: string | null; error: boolean; status: string }[] = [];
  for (const item of items) {
    for (const sub of (item.subParaListItem as Rec[] | undefined) ?? []) {
      const name = text(sub.subParameterName);
      const value = text(sub.subParameterValue);
      if (name === "CHANNELNAME") {
        channels.push({ channel: value, code: null, error: false, status: "" });
        continue;
      }
      const current = channels.at(-1);
      if (!current) continue;
      if (name === "STATUSITEMID") current.code = value;
      else if (name === "ERROR") current.error = value.toUpperCase() === "Y";
      else if (name === "STATUS") current.status = value;
    }
  }
  return channels;
}

/** The channels that reach the public, as opposed to CAP exchange and profile checks. */
const DISSEMINATION = new Set(["NWEM", "EAS", "CMAS", "PUBLIC"]);

function describe(c: IpawsChannelStatus): string {
  return [c.channel, c.code, c.status].filter(Boolean).join(" ");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Interpret an IPAWS-OPEN postCAP response, failing closed. It is accepted
 * only when IPAWS-OPEN answers 2xx with a postCAPResponseTypeDef listing at
 * least one status item and no item flags ERROR. A SOAP Fault, any other
 * status, an unparseable body or an unrecognized shape is a rejection. When
 * some channels acknowledge and others report errors, the detail names both,
 * since the alert may already have reached the public on the former.
 */
export function parseIpawsResponse(res: IpawsHttpResponse): IpawsResult {
  const rejected = (detail: string, channels: readonly IpawsChannelStatus[] = []): IpawsResult => ({
    accepted: false,
    detail,
    httpStatus: res.status,
    channels,
  });
  let parsed: Rec;
  try {
    parsed = parser.parse(res.body) as Rec;
  } catch {
    return rejected("unparseable IPAWS-OPEN response");
  }
  const soapBody = ((parsed.Envelope as Rec | undefined)?.Body ?? {}) as Rec;

  const fault = soapBody.Fault as Rec | undefined;
  if (fault) {
    const reason = text(fault.faultstring) || text((fault.Reason as Rec | undefined)?.Text);
    return rejected(reason || "IPAWS-OPEN fault");
  }
  if (res.status < 200 || res.status >= 300) return rejected(`IPAWS-OPEN HTTP ${res.status}`);

  const response = soapBody.postCAPResponseTypeDef;
  if (!response || typeof response !== "object") return rejected("unrecognized IPAWS-OPEN response");
  const channels = readChannels(((response as Rec).parameterListItem as Rec[] | undefined) ?? []);
  if (channels.length === 0) return rejected("IPAWS-OPEN returned no channel status");

  const errors = channels.filter((c) => c.error);
  if (errors.length > 0) {
    const failed = new Set(errors.map((c) => c.channel));
    const reached = unique(
      channels
        .filter((c) => DISSEMINATION.has(c.channel) && !failed.has(c.channel) && c.status === "Ack")
        .map((c) => c.channel),
    );
    const also = reached.length > 0 ? `, though acknowledged on ${reached.join(", ")}` : "";
    return rejected(
      `rejected on ${[...failed].join(", ")}${also}: ${errors.map(describe).join("; ")}`,
      channels,
    );
  }
  return { accepted: true, detail: `accepted: ${channels.map(describe).join("; ")}`, httpStatus: res.status, channels };
}

/**
 * The default transport: a real HTTP POST to IPAWS-OPEN. The timeout covers
 * the whole exchange, body included; a send that times out is reported as
 * failed, never as accepted.
 */
export const httpTransport = async (req: IpawsRequest, timeoutMs = 30_000): Promise<IpawsHttpResponse> => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: { ...req.headers },
    body: req.body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, body: await res.text() };
};

/**
 * Check, sign, send and interpret in one step. A credential IPAWS-OPEN would
 * refuse is reported without calling the transport; a transport that throws
 * is reported as unanswered, with the signed alert kept, since it may have
 * arrived.
 */
export async function postCap(
  endpointUrl: string,
  creds: IpawsCredentials,
  capXml: string,
  transport: IpawsTransport,
  now = new Date(),
): Promise<IpawsSend> {
  let req: IpawsRequest;
  try {
    req = buildPostCapRequest(endpointUrl, creds, capXml, now);
  } catch (err) {
    if (!(err instanceof IpawsCredentialError)) throw err;
    return { accepted: false, detail: `not sent: ${err.message}`, httpStatus: 0, channels: [], transmittedXml: null };
  }
  try {
    return { ...parseIpawsResponse(await transport(req)), transmittedXml: req.signedAlert };
  } catch (err) {
    return {
      accepted: false,
      detail: `IPAWS-OPEN did not answer: ${err instanceof Error ? err.message : String(err)}`,
      httpStatus: 0,
      channels: [],
      transmittedXml: req.signedAlert,
    };
  }
}
