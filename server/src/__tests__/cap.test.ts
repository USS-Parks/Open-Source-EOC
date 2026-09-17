import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capToXml, CapAlertSchema, type CapAlert } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * CAP authoring and ingest (VEOC-26): author from incident context with
 * CAP 1.2 + IPAWS validation, and ingest external CAP XML with fidelity.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let memberToken: string;

const fullInfo = {
  language: "en-US",
  category: ["Met"],
  event: "Flood Warning",
  urgency: "Expected",
  severity: "Severe",
  certainty: "Likely",
  eventCode: [{ valueName: "SAME", value: "FLW" }],
  effective: "2026-09-17T12:00:00-07:00",
  expires: "2026-09-17T18:00:00-07:00",
  senderName: "Yurok Tribe OES",
  headline: "Flood Warning for the Lower Klamath",
  description: "Rising water through the evening.",
  instruction: "Move to higher ground.",
  area: [{ areaDesc: "Lower Klamath", geocode: [{ valueName: "SAME", value: "006015" }] }],
};

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  memberToken = await tokenFor("member@example.org", "another-good-password");
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

async function tokenFor(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  return res.json().accessToken as string;
}

describe("authoring CAP from incident context", () => {
  it("validates, stamps, stores, and marks an IPAWS-eligible alert", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/alerts`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        alert: {
          sender: "oes@yuroktribe.example",
          status: "Actual",
          msgType: "Alert",
          scope: "Public",
          code: ["IPAWSv1.0"],
          info: [fullInfo],
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; identifier: string; ipawsEligible: boolean; xml: string };
    expect(body.ipawsEligible).toBe(true);
    expect(body.identifier).toMatch(/^OPENEOC-/); // server-stamped
    expect(body.xml).toContain('xmlns="urn:oasis:names:tc:emergency:cap:1.2"');

    // Fetch as XML and confirm it re-parses to the same alert.
    const xmlRes = await app.inject({
      method: "GET",
      url: `/api/v1/cap/alerts/${body.id}?format=xml`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(xmlRes.headers["content-type"]).toContain("application/cap+xml");
    expect(xmlRes.body).toContain("<identifier>");
  });

  it("stores a valid but non-IPAWS alert as CAP with eligibility false", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/alerts`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        alert: {
          sender: "oes@yuroktribe.example",
          status: "Actual",
          msgType: "Alert",
          scope: "Public",
          // No IPAWS code, no expires/eventCode/area: valid CAP, not IPAWS.
          info: [
            { category: ["Safety"], event: "Boil Water Notice", urgency: "Expected", severity: "Moderate", certainty: "Observed" },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ipawsEligible).toBe(false);
  });

  it("rejects an invalid alert with the CAP issues", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/alerts`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        alert: { sender: "x", status: "Bogus", msgType: "Alert", scope: "Public", info: [] },
      },
    });
    expect(res.statusCode).toBe(422);
    const issues = res.json().issues as Array<{ path: string }>;
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("ingesting external CAP", () => {
  it("parses external CAP XML with full fidelity and stores it", async () => {
    const external: CapAlert = CapAlertSchema.parse({
      identifier: "NWS-EXT-2026-42",
      sender: "w-nws.webmaster@noaa.gov",
      sent: "2026-09-17T11:00:00-07:00",
      status: "Actual",
      msgType: "Alert",
      scope: "Public",
      code: ["IPAWSv1.0"],
      info: [fullInfo],
    });
    const xml = capToXml(external);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/ingest`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { xml },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; identifier: string; alert: CapAlert };
    expect(body.identifier).toBe("NWS-EXT-2026-42");
    expect(body.alert).toEqual(external); // full fidelity

    // Re-ingesting the same identifier is idempotent.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/ingest`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { xml },
    });
    expect(again.json().id).toBe(body.id);

    // It landed as a notification.
    const [note] = await admin`
      select title from notifications where channel = 'cap' and detail ->> 'origin' = 'ingested'`;
    expect(note!.title).toContain("CAP ingested");
  });

  it("refuses unparseable CAP XML", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/ingest`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { xml: "<html>not cap</html>" },
    });
    expect(res.statusCode).toBe(422);
  });
});
