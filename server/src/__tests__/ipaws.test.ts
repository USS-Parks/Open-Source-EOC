import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_CONTRACT, generateApiDocs } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { principalForPerson, type Principal } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { configure, postAlert } from "../ipaws/service.js";
import {
  buildPostCapRequest,
  parseIpawsResponse,
  type IpawsRequest,
  type IpawsTransport,
} from "../ipaws/connector.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * IPAWS-OPEN enable-at-will (VEOC-31, R2). The connector interprets
 * recorded IPAWS-OPEN responses; the frozen contract matches the running
 * app; and enablement is gated on explicit configuration plus a documented
 * MOA, disabled by default, with a single toggle taking it live.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "ipaws", "__fixtures__");
const accepted = readFileSync(join(FIXTURES, "postcap-accepted.xml"), "utf8");
const rejected = readFileSync(join(FIXTURES, "postcap-rejected.xml"), "utf8");

const eligibleDraft = {
  sender: "oes@yuroktribe.example",
  status: "Actual",
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
      effective: "2026-09-18T12:00:00-07:00",
      onset: "2026-09-18T13:00:00-07:00",
      expires: "2026-09-18T18:00:00-07:00",
      senderName: "Yurok Tribe OES",
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

// A valid CAP alert that is deliberately not IPAWS-profile complete.
const ineligibleDraft = { ...eligibleDraft, code: [] as string[] };

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminId: string;
let adminToken: string;
let memberToken: string;
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
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = await login("admin@example.org", "correct-horse-battery");
  memberToken = await login("member@example.org", "another-good-password");
  adminPrincipal = await principalForPerson(runtime, adminId);
}, 60000);

afterAll(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (admin) await admin.end();
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

describe("IPAWS-OPEN connector against recorded fixtures", () => {
  it("builds a postCAP request that carries the alert and COG", () => {
    const req = buildPostCapRequest(
      "https://tdl.integratedpublicalertsystem.gov/IPAWS_CAPService/IPAWS",
      { cogId: "123456", secret: "pin-secret" },
      '<?xml version="1.0"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>X-1</identifier></alert>',
    );
    expect(req.method).toBe("POST");
    expect(req.headers.soapaction).toContain("postCAP");
    expect(req.headers["x-ipaws-cog"]).toBe("123456");
    expect(req.body).toContain("<cogId>123456</cogId>");
    expect(req.body).toContain("<identifier>X-1</identifier>");
    // The embedded CAP must not carry its own XML declaration.
    expect(req.body.match(/<\?xml/g)?.length).toBe(1);
  });

  it("reads an acceptance", () => {
    const result = parseIpawsResponse({ status: 200, body: accepted });
    expect(result.accepted).toBe(true);
    expect(result.detail).toContain("IPAWS-OPEN-TEST-ACK-2026-0918-001");
  });

  it("reads a SOAP-fault rejection", () => {
    const result = parseIpawsResponse({ status: 500, body: rejected });
    expect(result.accepted).toBe(false);
    expect(result.detail).toContain("not authorized");
  });
});

describe("frozen contract matches the running app", () => {
  it("registers every REST endpoint the contract publishes", () => {
    for (const e of API_CONTRACT.rest) {
      expect(app.hasRoute({ method: e.method, url: e.path }), `${e.method} ${e.path}`).toBe(true);
    }
  });

  it("registers every WebSocket channel the contract publishes", () => {
    for (const w of API_CONTRACT.websockets) {
      expect(app.hasRoute({ method: "GET", url: w.path }), w.path).toBe(true);
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
      payload: {
        environment: "test",
        cogId: "123456",
        endpointUrl: "https://tdl.integratedpublicalertsystem.gov/IPAWS_CAPService/IPAWS",
        credential: "pin-secret",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("configures, still refuses to enable without the MOA, then enables after it", async () => {
    const cfg = await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${jurisdictionId}/ipaws/config`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        environment: "test",
        cogId: "123456",
        endpointUrl: "https://tdl.integratedpublicalertsystem.gov/IPAWS_CAPService/IPAWS",
        credential: "pin-secret",
      },
    });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json().configured).toBe(true);
    // The raw credential is never echoed; only a fingerprint is shown.
    expect(cfg.body).not.toContain("pin-secret");
    expect(cfg.json().credentialFingerprint).toMatch(/^[0-9a-f]{12}$/);

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
          endpointUrl: "https://tdl.integratedpublicalertsystem.gov/IPAWS_CAPService/IPAWS",
          credential: "pin-secret",
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
  });

  it("transmits an eligible alert and records an acceptance", async () => {
    const { id, ipawsEligible } = await authorAlert(eligibleDraft);
    expect(ipawsEligible).toBe(true);
    let sent: IpawsRequest | null = null;
    const transport: IpawsTransport = async (req) => {
      sent = req;
      return { status: 200, body: accepted };
    };
    const result = await withPerson(runtime, adminId, (tx) =>
      postAlert(tx, adminPrincipal, jurisdictionId, id, transport),
    );
    expect(result.accepted).toBe(true);
    expect(sent).not.toBeNull();
    expect(sent!.body).toContain("Flood Warning");

    const [row] = await admin`
      select accepted, cog_id from ipaws_submissions where cap_alert_id = ${id}`;
    expect(row!.accepted).toBe(true);
    expect(row!.cog_id).toBe("123456");
    const [audit] = await admin`
      select payload ->> 'accepted' as accepted from audit_events where category = 'ipaws.submitted'`;
    expect(audit!.accepted).toBe("true");
  });

  it("records a rejection when IPAWS-OPEN faults", async () => {
    const { id } = await authorAlert(eligibleDraft);
    const transport: IpawsTransport = async () => ({ status: 500, body: rejected });
    const result = await withPerson(runtime, adminId, (tx) =>
      postAlert(tx, adminPrincipal, jurisdictionId, id, transport),
    );
    expect(result.accepted).toBe(false);
    expect(result.detail).toContain("not authorized");
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

function okTransport(): IpawsTransport {
  return async () => ({ status: 200, body: accepted });
}
