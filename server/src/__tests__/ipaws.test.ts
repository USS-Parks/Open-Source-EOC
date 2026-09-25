import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignedXml } from "xml-crypto";
import { API_CONTRACT, generateApiDocs } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { addMembership, createPerson, principalForPerson, type Principal } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { configure, postAlert } from "../ipaws/service.js";
import {
  IPAWS_CAP_SERVICE_NS,
  IpawsCredentialError,
  buildPostCapRequest,
  httpTransport,
  parseIpawsResponse,
  postCap,
  type IpawsRequest,
  type IpawsTransport,
} from "../ipaws/connector.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";
import { capTimeFromNow, cogCertificate, eligibleAlert, ipawsFixture } from "./ipaws-support.js";

/**
 * IPAWS-OPEN enable-at-will (R2), built to FEMA's IPAWS-OPEN Interface
 * Design Guide v4.02. The connector signs what the IDG requires and reads
 * its responses failing closed; the frozen contract matches the running
 * app; and enablement is gated on a checked COG certificate plus a
 * documented MOA, disabled by default, with a single toggle taking it live.
 */

const accepted = ipawsFixture("accepted");
const cmasRejected = ipawsFixture("cmas-rejected");
const signatureInvalid = ipawsFixture("signature-invalid");
const expiredCertificate = ipawsFixture("expired-certificate");

const COG = "123456";
const certificate = cogCertificate(COG);
const ENDPOINT = "https://tdl.integration.aws.fema.gov/IPAWS_CAPService/IPAWS";
const creds = { cogId: COG, logonUser: "admin@example.org", certificate: certificate.bundle };

const eligibleDraft = eligibleAlert();

// A valid CAP alert that is deliberately not IPAWS-profile complete.
const ineligibleDraft = { ...eligibleDraft, code: [] as string[] };

const CAP_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">\n  <identifier>X-1</identifier>\n' +
  "  <headline>Flood Warning</headline>\n</alert>";

/** The ds:Signature element that directly follows `after` in `xml`. */
function signatureAfter(xml: string, after: RegExp): string {
  const start = xml.slice(xml.search(after));
  return /<(\w+:)?Signature [\s\S]*?<\/\1?Signature>/.exec(start)![0];
}

function verifies(xml: string, signature: string, idMode?: "wssecurity"): boolean {
  const sig = new SignedXml({ publicCert: certificate.cert, getCertFromKeyInfo: () => null, ...(idMode ? { idMode } : {}) });
  sig.loadSignature(signature);
  try {
    return sig.checkSignature(xml);
  } catch {
    return false;
  }
}

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminId: string;
let adminToken: string;
let memberToken: string;
let secondId: string;
let secondToken: string;
let adminPrincipal: Principal;
let priorKey: string | undefined;

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  return res.json().accessToken as string;
}

async function authorAlert(draft: unknown): Promise<{ id: string; ipawsEligible: boolean }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/cap/alerts`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { alert: draft },
  });
  if (res.statusCode !== 200 && res.statusCode !== 201)
    throw new Error(`author failed: ${res.body}`);
  return { id: res.json().id as string, ipawsEligible: res.json().ipawsEligible as boolean };
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-ipaws-key-material";
  const db = await freshDb();
  admin = db.admin;
  runtime = db.runtime;
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  adminId = seed.adminId;
  secondId = await createPerson(admin, {
    email: "second-admin@example.org",
    displayName: "Second Admin",
    password: "second-admin-password",
  });
  await addMembership(admin, secondId, jurisdictionId, "admin");
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = await login("admin@example.org", "correct-horse-battery");
  memberToken = await login("member@example.org", "another-good-password");
  secondToken = await login("second-admin@example.org", "second-admin-password");
  adminPrincipal = await principalForPerson(runtime, adminId);
}, 60000);

afterAll(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (admin) await admin.end();
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

describe("IPAWS-OPEN connector, to the Interface Design Guide", () => {
  it("builds the postCAP request the IDG describes", () => {
    const req = buildPostCapRequest(ENDPOINT, creds, CAP_XML);
    expect(req.method).toBe("POST");
    expect(req.url).toBe(ENDPOINT);
    expect(req.headers).toEqual({
      "content-type": "text/xml; charset=utf-8",
      soapaction: `"${IPAWS_CAP_SERVICE_NS}postCAP"`,
    });
    expect(req.body).toContain(`xmlns:ipaws="${IPAWS_CAP_SERVICE_NS}"`);
    expect(req.body).toContain(
      "<ipaws:CAPHeaderTypeDef><ipaws:logonUser>admin@example.org</ipaws:logonUser>" +
        "<ipaws:logonCogId>123456</ipaws:logonCogId></ipaws:CAPHeaderTypeDef>",
    );
    expect(req.body).toMatch(/<wsse:Security [^>]*soap:mustUnderstand="1"/);
    const token = /<wsse:BinarySecurityToken [^>]*>([^<]+)</.exec(req.body)![1];
    expect(token).toBe(certificate.cert.replace(/-----[A-Z ]+-----|\s/g, ""));
    expect(req.body).toMatch(/<ipaws:postCAPRequestTypeDef><alert xmlns="urn:oasis:names:tc:emergency:cap:1\.2">/);
    expect(req.body).toContain("<identifier>X-1</identifier>");
    // No PIN or secret travels anywhere, and the embedded CAP has no declaration of its own.
    expect(req.body).not.toMatch(/PRIVATE KEY|pin/i);
    expect(req.body.match(/<\?xml/g)?.length).toBe(1);
  });

  it("signs the SOAP Body and the alert so both verify against the COG certificate", () => {
    const req = buildPostCapRequest(ENDPOINT, creds, CAP_XML);
    const soapSignature = signatureAfter(req.body, /<wsse:Security /).replace(
      "<ds:Signature ",
      '<ds:Signature xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" ',
    );
    expect(soapSignature).toContain('<ds:Reference URI="#id-body">');
    expect(soapSignature).toContain('Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"');
    expect(soapSignature).toContain('Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"');
    expect(soapSignature).toContain('<wsse:Reference URI="#x509-token"');
    expect(req.body).toContain('<soap:Body wsu:Id="id-body">');
    expect(verifies(req.body, soapSignature, "wssecurity")).toBe(true);

    // The alert as IPAWS-OPEN will read it out of the Body, signature and all.
    const alert = /<alert [\s\S]*<\/alert>/.exec(req.body)![0];
    expect(alert).toBe(req.signedAlert);
    const capSignature = signatureAfter(alert, /<alert /);
    expect(capSignature).toContain('<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>');
    expect(verifies(alert, capSignature)).toBe(true);
    expect(verifies(alert.replace("Flood Warning", "Flood Watch"), capSignature)).toBe(false);
    expect(verifies(req.body.replace("<identifier>X-1<", "<identifier>X-2<"), soapSignature, "wssecurity"))
      .toBe(false);
  });

  it("refuses, before signing, any certificate IPAWS-OPEN would refuse", () => {
    const refused = (certificate: string, message: RegExp) =>
      expect(() => buildPostCapRequest(ENDPOINT, { ...creds, certificate }, CAP_XML)).toThrow(message);
    refused(cogCertificate("999999").bundle, /CN \(IPAWSOPEN_999999\) does not contain COG id 123456/);
    refused(cogCertificate(COG, { notAfter: "250601000000Z" }).bundle, /certificate expired on 2025-06-01/);
    refused(`${certificate.cert}${cogCertificate(COG).key}`, /does not belong to the certificate/);
    refused(cogCertificate(COG, { rsa: false }).bundle, /not an RSA key/);
    refused(certificate.cert, /no PEM private key/);
    refused("pin-secret", /no PEM certificate/);
    refused(`${certificate.cert}-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----\n`, /encrypted/);
    // A paste that lost or changed its line breaks still reads.
    const flattened = certificate.bundle.replace(/\n/g, "");
    expect(buildPostCapRequest(ENDPOINT, { ...creds, certificate: flattened }, CAP_XML).body).toContain("postCAP");
    expect(buildPostCapRequest(ENDPOINT, { ...creds, certificate: certificate.bundle.replace(/\n/g, "\r\n") }, CAP_XML))
      .toHaveProperty("signedAlert");
    expect(() => buildPostCapRequest(ENDPOINT, { ...creds, certificate: "pin-secret" }, CAP_XML))
      .toThrow(IpawsCredentialError);
  });

  it("reports a refused certificate as not sent, without calling the transport", async () => {
    let calls = 0;
    const result = await postCap(ENDPOINT, { ...creds, cogId: "654321" }, CAP_XML, async () => {
      calls += 1;
      return { status: 200, body: accepted };
    });
    expect(calls).toBe(0);
    expect(result).toMatchObject({ accepted: false, httpStatus: 0, channels: [], transmittedXml: null });
    expect(result.detail).toMatch(/^not sent: .*does not contain COG id 654321/);
  });

  it("reports a transport that throws as unanswered, keeping the alert it may have delivered", async () => {
    const result = await postCap(ENDPOINT, creds, CAP_XML, async () => {
      throw new TypeError("fetch failed");
    });
    expect(result).toMatchObject({ accepted: false, detail: "IPAWS-OPEN did not answer: fetch failed" });
    expect(result.transmittedXml).toContain("<identifier>X-1</identifier>");
  });

  it("reads an acceptance with the status of each channel", () => {
    const result = parseIpawsResponse({ status: 200, body: accepted });
    expect(result.accepted).toBe(true);
    expect(result.channels).toContainEqual({ channel: "EAS", code: "500", error: false, status: "Ack" });
    expect(result.channels).toContainEqual({ channel: "IPAWS", code: null, error: false, status: "Ack" });
    expect(result.channels).toHaveLength(7);
    expect(result.detail).toMatch(/^accepted: CAPEXCH 200 Ack; .*PUBLIC 800 Ack$/);
  });

  it("reads HTTP 200 with a channel flagged ERROR as a rejection that names what went out", () => {
    // The old connector read this response as accepted.
    const result = parseIpawsResponse({ status: 200, body: cmasRejected });
    expect(result.accepted).toBe(false);
    expect(result.detail).toBe(
      "rejected on CMAS, though acknowledged on EAS, PUBLIC: CMAS 615 signer-not-authorized-for-event-code-CMAS",
    );
    expect(result.channels.filter((c) => c.error)).toEqual([
      { channel: "CMAS", code: "615", error: true, status: "signer-not-authorized-for-event-code-CMAS" },
    ]);
  });

  it("reads an invalid alert signature as a rejection", () => {
    const result = parseIpawsResponse({ status: 200, body: signatureInvalid });
    expect(result.accepted).toBe(false);
    expect(result.detail).toBe(
      "rejected on CAPEXCH: CAPEXCH 208 alert-signature-not-valid; CAPEXCH 221 invalid-CAPEXCHANGE-message",
    );
  });

  it("reads a SOAP Fault as a rejection", () => {
    const result = parseIpawsResponse({ status: 500, body: expiredCertificate });
    expect(result).toMatchObject({ accepted: false, httpStatus: 500, channels: [] });
    expect(result.detail).toContain("signed with invalid certificate");
  });

  it("fails closed on anything it does not recognize", () => {
    const rejectedWith = (status: number, body: string) => {
      const result = parseIpawsResponse({ status, body });
      expect(result.accepted).toBe(false);
      return result.detail;
    };
    // The shape the old connector's fixture had: no postCAPResponseTypeDef.
    expect(rejectedWith(200,
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><postCAPResponse>' +
        "<return><errorCount>0</errorCount></return></postCAPResponse></soap:Body></soap:Envelope>",
    )).toBe("unrecognized IPAWS-OPEN response");
    expect(rejectedWith(200,
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
        '<ns2:postCAPResponseTypeDef xmlns:ns2="http://gov.fema.ipaws.services/IPAWS_CAPService/"/>' +
        "</soap:Body></soap:Envelope>",
    )).toBe("unrecognized IPAWS-OPEN response");
    expect(rejectedWith(200, accepted.replace(/<ns4:subParaListItem>[\s\S]*<\/ns4:subParaListItem>/, "")))
      .toBe("IPAWS-OPEN returned no channel status");
    expect(rejectedWith(502, "<html>Bad Gateway</html>")).toBe("IPAWS-OPEN HTTP 502");
    expect(rejectedWith(200, "not xml <<<")).toMatch(/unparseable|unrecognized/);
    expect(rejectedWith(302, accepted)).toBe("IPAWS-OPEN HTTP 302");
  });
});

describe("frozen contract matches the running app", () => {
  /**
   * The contract publishes every route the product can serve, including the
   * optional integrations and the identity-provider routes, so the app it is
   * checked against enables all of them. A default deployment registers
   * neither set. Route registration never touches the database.
   */
  let contractApp: FastifyInstance;

  beforeAll(async () => {
    contractApp = buildApp(
      (() => {
        throw new Error("route inventory must not query the database");
      }) as unknown as Sql,
      {
        integrations: ["collab", "facilities", "meetings", "tracking"],
        oidc: {
          issuer: "https://identity.invalid",
          clientId: "route-inventory",
          clientSecret: "not-used",
          redirectUri: "https://eoc.invalid/api/v1/auth/oidc/callback",
        },
      },
    );
    // Websocket and plugin-registered routes only exist once plugins load.
    await contractApp.ready();
  });

  afterAll(async () => {
    await contractApp.close();
  });

  it("registers every REST endpoint the contract publishes", () => {
    for (const e of API_CONTRACT.rest) {
      expect(contractApp.hasRoute({ method: e.method, url: e.path }), `${e.method} ${e.path}`)
        .toBe(true);
    }
  });

  it("registers every WebSocket channel the contract publishes", () => {
    for (const w of API_CONTRACT.websockets) {
      expect(contractApp.hasRoute({ method: "GET", url: w.path }), w.path).toBe(true);
    }
  });

  it("documents the IPAWS surface in the generated docs", () => {
    const docs = generateApiDocs();
    expect(docs).toContain("### ipaws");
    expect(docs).toContain("`POST /api/v1/jurisdictions/:jurisdictionId/cap/alerts/:alertId/ipaws`");
  });
});

describe("enablement is gated and disabled by default", () => {
  it("reports disabled and unconfigured at first", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${jurisdictionId}/ipaws`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
    expect(res.json().configured).toBe(false);
  });

  it("refuses to enable before configuration", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${jurisdictionId}/ipaws/enable`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(409);
  });

  it("refuses a member configuring IPAWS", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${jurisdictionId}/ipaws/config`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { environment: "test", cogId: COG, endpointUrl: ENDPOINT, credential: certificate.bundle },
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a certificate IPAWS-OPEN would refuse, naming the problem", async () => {
    const put = (payload: object) =>
      app.inject({
        method: "PUT",
        url: `/api/v1/jurisdictions/${jurisdictionId}/ipaws/config`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { environment: "test", endpointUrl: ENDPOINT, ...payload },
      });
    const pin = await put({ cogId: COG, credential: "pin-secret" });
    expect(pin.statusCode).toBe(422);
    expect(pin.json().error).toBe("COG certificate refused: the credential holds no PEM certificate");
    const otherCog = await put({ cogId: "654321", credential: certificate.bundle });
    expect(otherCog.statusCode).toBe(422);
    expect(otherCog.json().error).toContain("does not contain COG id 654321");
    const [row] = await admin`select count(*)::int as n from ipaws_config where jurisdiction_id = ${jurisdictionId}`;
    expect(row!.n).toBe(0);
  });

  it("configures, still refuses to enable without the MOA, then enables after it", async () => {
    const cfg = await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${jurisdictionId}/ipaws/config`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { environment: "test", cogId: COG, endpointUrl: ENDPOINT, credential: certificate.bundle },
    });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json().configured).toBe(true);
    expect(cfg.json().certificateExpiresAt).toBe("2049-12-31T23:59:59.000Z");
    // The key is never echoed; only a fingerprint is shown.
    expect(cfg.body).not.toContain("PRIVATE KEY");
    expect(cfg.json().credentialFingerprint).toMatch(/^[0-9a-f]{12}$/);

    // The stored certificate is checked again when the COG id changes without it.
    const renamed = await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${jurisdictionId}/ipaws/config`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { environment: "test", cogId: "654321", endpointUrl: ENDPOINT },
    });
    expect(renamed.statusCode).toBe(422);

    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${jurisdictionId}/ipaws/enable`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: true },
    });
    expect(denied.statusCode).toBe(409);

    const moa = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${jurisdictionId}/ipaws/moa`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reference: "MOA-FEMA-IPAWS-2026-YUROK" },
    });
    expect(moa.statusCode).toBe(200);
    expect(moa.json().moaAcknowledged).toBe(true);

    const enabled = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${jurisdictionId}/ipaws/enable`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().enabled).toBe(true);
  });
});

describe("transmission requires enablement and eligibility", () => {
  it("refuses to transmit while configured but not enabled", async () => {
    // A fresh jurisdiction: configured (so it is past the "not configured"
    // guard) but never enabled, so transmission must fail closed with 403.
    const other = await freshDb();
    try {
      const seed = await seedIdentity(other.admin);
      const otherPrincipal = await principalForPerson(other.runtime, seed.adminId);
      await withPerson(other.runtime, seed.adminId, (tx) =>
        configure(tx, otherPrincipal, seed.jurisdictionId, {
          environment: "test",
          cogId: "654321",
          endpointUrl: ENDPOINT,
          credential: cogCertificate("654321").bundle,
        }),
      );
      await expect(
        withPerson(other.runtime, seed.adminId, (tx) =>
          postAlert(tx, otherPrincipal, seed.jurisdictionId, randomUUID(), okTransport()),
        ),
      ).rejects.toThrow(/not enabled/);
    } finally {
      await other.runtime.end();
      await other.admin.end();
    }
  }, 120_000); // builds a second database, which waits its turn behind other files' setup

  it("transmits an eligible alert and records an acceptance", async () => {
    const { id, ipawsEligible } = await authorAlert(eligibleDraft);
    expect(ipawsEligible).toBe(true);
    let sent: IpawsRequest | null = null;
    const transport: IpawsTransport = async (req) => {
      sent = req;
      return { status: 200, body: accepted };
    };
    const before = Date.now();
    const result = await withPerson(runtime, adminId, (tx) =>
      postAlert(tx, adminPrincipal, jurisdictionId, id, transport),
    );
    expect(result.accepted).toBe(true);
    expect(result.channels).toHaveLength(7);
    const req = sent as IpawsRequest | null;
    expect(req!.body).toContain("Flood Warning");
    expect(req!.body).toContain("<ipaws:logonUser>admin@example.org</ipaws:logonUser>");
    // Stamped as it goes, in CAP form, so IPAWS-OPEN's five-minute check (code 303) passes.
    const stamped = /<sent>([^<]+)<\/sent>/.exec(req!.signedAlert)![1]!;
    expect(stamped).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-00:00$/);
    expect(Date.parse(stamped)).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(Date.parse(stamped)).toBeLessThanOrEqual(Date.now());

    const [row] = await admin`
      select accepted, cog_id, channels, transmitted_xml from ipaws_submissions where cap_alert_id = ${id}`;
    expect(row!.accepted).toBe(true);
    expect(row!.cog_id).toBe(COG);
    expect(row!.transmitted_xml).toBe(req!.signedAlert);
    expect(row!.channels).toContainEqual({ channel: "CMAS", code: "600", error: false, status: "Ack" });
    const [audit] = await admin`
      select payload ->> 'accepted' as accepted from audit_events where category = 'ipaws.submitted'`;
    expect(audit!.accepted).toBe("true");
  });

  it("records a rejection when IPAWS-OPEN faults", async () => {
    const { id } = await authorAlert(eligibleDraft);
    const transport: IpawsTransport = async () => ({ status: 500, body: expiredCertificate });
    const result = await withPerson(runtime, adminId, (tx) =>
      postAlert(tx, adminPrincipal, jurisdictionId, id, transport),
    );
    expect(result.accepted).toBe(false);
    expect(result.detail).toContain("signed with invalid certificate");
  });

  it("records a channel's refusal as a rejection, with the channels that went out", async () => {
    const { id } = await authorAlert(eligibleDraft);
    const result = await withPerson(runtime, adminId, (tx) =>
      postAlert(tx, adminPrincipal, jurisdictionId, id, async () => ({ status: 200, body: cmasRejected })),
    );
    expect(result.accepted).toBe(false);
    expect(result.detail).toMatch(/^rejected on CMAS, though acknowledged on EAS, PUBLIC/);
    const [row] = await admin`
      select accepted, channels from ipaws_submissions where id = ${result.submissionId}`;
    expect(row!.accepted).toBe(false);
    expect(row!.channels).toContainEqual({
      channel: "CMAS", code: "615", error: true, status: "signer-not-authorized-for-event-code-CMAS",
    });
  });

  it("refuses an alert that has expired by the time it would go", async () => {
    const { id } = await authorAlert(eligibleAlert({ expires: capTimeFromNow(-1) }));
    await expect(
      withPerson(runtime, adminId, (tx) => postAlert(tx, adminPrincipal, jurisdictionId, id, okTransport())),
    ).rejects.toThrow(/the alert expired at .*; author a new one/);
  });

  it("refuses a CAP alert that is not IPAWS-eligible", async () => {
    const { id, ipawsEligible } = await authorAlert(ineligibleDraft);
    expect(ipawsEligible).toBe(false);
    await expect(
      withPerson(runtime, adminId, (tx) =>
        postAlert(tx, adminPrincipal, jurisdictionId, id, okTransport()),
      ),
    ).rejects.toThrow(/not IPAWS-eligible/);
  });
});

describe("a send to the real endpoint takes two admins", () => {
  // A loopback stand-in for IPAWS-OPEN that answers with the recorded acceptance.
  let endpoint: Server;
  let hits = 0;

  beforeAll(async () => {
    endpoint = createServer((req, res) => {
      hits += 1;
      req.resume();
      res.writeHead(200, { "content-type": "text/xml" });
      res.end(accepted);
    });
    await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
    const { port } = endpoint.address() as AddressInfo;
    const cfg = await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${jurisdictionId}/ipaws/config`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { environment: "test", cogId: "123456", endpointUrl: `http://127.0.0.1:${port}/IPAWS` },
    });
    expect(cfg.json()).toMatchObject({ enabled: true, configured: true });
  });

  afterAll(async () => {
    await new Promise((resolve) => endpoint.close(resolve));
  });

  function call(method: "GET" | "POST", path: string, token: string, payload?: object) {
    const url = `/api/v1/jurisdictions/${jurisdictionId}${path}`;
    const headers = { authorization: `Bearer ${token}` };
    return payload === undefined
      ? app.inject({ method, url, headers })
      : app.inject({ method, url, headers, payload });
  }

  async function requestLive(): Promise<string> {
    const { id } = await authorAlert(eligibleDraft);
    const res = await call("POST", `/cap/alerts/${id}/ipaws`, adminToken);
    expect(res.statusCode).toBe(202);
    return res.json().id as string;
  }

  it("holds the request until a different admin confirms, and audits both", async () => {
    const { id: alertId } = await authorAlert(eligibleDraft);
    const requested = await call("POST", `/cap/alerts/${alertId}/ipaws`, adminToken);
    expect(requested.statusCode).toBe(202);
    const request = requested.json();
    expect(request).toMatchObject({ kind: "live", status: "pending", requestedBy: adminId });
    expect(Date.parse(request.expiresAt) - Date.parse(request.requestedAt)).toBe(15 * 60_000);
    expect(hits).toBe(0);

    const own = await call("POST", `/ipaws/sends/${request.id}/confirm`, adminToken);
    expect(own.statusCode).toBe(403);
    expect(own.json().error).toContain("different admin");
    expect((await call("POST", `/ipaws/sends/${request.id}/confirm`, memberToken)).statusCode).toBe(403);
    expect((await call("GET", "/ipaws/sends", memberToken)).statusCode).toBe(403);
    const listed = await call("GET", "/ipaws/sends", secondToken);
    expect(listed.json().sends[0]).toMatchObject({ id: request.id, status: "pending" });
    expect(hits).toBe(0);

    const confirmed = await call("POST", `/ipaws/sends/${request.id}/confirm`, secondToken);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      accepted: true,
      request: { status: "confirmed", requestedBy: adminId, decidedBy: secondId },
    });
    expect(hits).toBe(1);
    expect((await call("POST", `/ipaws/sends/${request.id}/confirm`, secondToken)).statusCode).toBe(409);

    const trail = await admin`
      select category, person_id, payload from audit_events
      where category like 'ipaws.s%' and (subject_id = ${request.id} or subject_id = ${alertId})
      order by seq`;
    expect(trail.map((e) => [e.category, e.person_id])).toEqual([
      ["ipaws.send.requested", adminId],
      ["ipaws.send.confirmed", secondId],
      ["ipaws.submitted", secondId],
    ]);
    expect(trail[1]!.payload).toMatchObject({ requestedBy: adminId, confirmedBy: secondId });
    expect(trail[2]!.payload).toMatchObject({ requestId: request.id, requestedBy: adminId });
    const [sub] = await admin`
      select submitted_by from ipaws_submissions where id = ${confirmed.json().submissionId as string}`;
    expect(sub!.submitted_by).toBe(secondId);
  });

  it("lets an unconfirmed request lapse", async () => {
    const requestId = await requestLive();
    await admin`update ipaws_send_requests set expires_at = now() - interval '1 second' where id = ${requestId}`;
    const listed = await call("GET", "/ipaws/sends", secondToken);
    expect(listed.json().sends.find((s: { id: string }) => s.id === requestId).status).toBe("expired");
    const before = hits;
    const res = await call("POST", `/ipaws/sends/${requestId}/confirm`, secondToken);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("expired");
    expect(hits).toBe(before);
  });

  it("lets an admin cancel a pending request, which then cannot be confirmed", async () => {
    const requestId = await requestLive();
    const cancelled = await call("POST", `/ipaws/sends/${requestId}/cancel`, adminToken);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: "cancelled", decidedBy: adminId });
    expect((await call("POST", `/ipaws/sends/${requestId}/confirm`, secondToken)).statusCode).toBe(409);
    expect((await call("POST", `/ipaws/sends/${requestId}/cancel`, secondToken)).statusCode).toBe(409);
    const [audit] = await admin`
      select person_id from audit_events
      where category = 'ipaws.send.cancelled' and subject_id = ${requestId}`;
    expect(audit!.person_id).toBe(adminId);
  });

  it("applies to the test-environment handshake as well", async () => {
    const { id } = await authorAlert(eligibleDraft);
    const requested = await call("POST", "/ipaws/test", adminToken, { alertId: id });
    expect(requested.statusCode).toBe(202);
    expect(requested.json()).toMatchObject({ kind: "handshake", status: "pending" });
    const before = hits;
    const confirmed = await call("POST", `/ipaws/sends/${requested.json().id as string}/confirm`, secondToken);
    expect(confirmed.json().accepted).toBe(true);
    expect(hits).toBe(before + 1);
  });

  it("refuses a single-handed send through the real transport", async () => {
    const { id } = await authorAlert(eligibleDraft);
    await expect(
      withPerson(runtime, adminId, (tx) => postAlert(tx, adminPrincipal, jurisdictionId, id, httpTransport)),
    ).rejects.toThrow(/second admin/);
  });

  it("holds the rule in the database too", async () => {
    const requestId = await requestLive();
    await expect(
      admin`update ipaws_send_requests set status = 'confirmed', decided_by = requested_by
            where id = ${requestId}`,
    ).rejects.toThrow(/second_person/);
  });
});

function okTransport(): IpawsTransport {
  return async () => ({ status: 200, body: accepted });
}
