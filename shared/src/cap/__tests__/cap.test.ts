import { describe, expect, it } from "vitest";
import { CapAlertSchema, type CapAlert } from "../model.js";
import { validateCap12, validateIpawsProfile, isIpawsEligible } from "../validate.js";
import { capToXml, capFromXml } from "../xml.js";

/**
 * CAP 1.2 conformance and IPAWS profile (VEOC-26): a golden alert
 * round-trips XML with full fidelity and validates against both the base
 * schema and the IPAWS profile; profile violations are caught.
 */

const ipawsAlert: CapAlert = CapAlertSchema.parse({
  identifier: "OPENEOC-2026-0917-001",
  sender: "oes@yuroktribe.example",
  sent: "2026-09-17T12:00:00-07:00",
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
      effective: "2026-09-17T12:00:00-07:00",
      onset: "2026-09-17T13:00:00-07:00",
      expires: "2026-09-17T18:00:00-07:00",
      senderName: "Yurok Tribe OES",
      headline: "Flood Warning for the Lower Klamath",
      description: "Rising water along the Lower Klamath River through the evening.",
      instruction: "Move to higher ground. Avoid the SR-169 river crossing.",
      parameter: [{ valueName: "BLOCKCHANNEL", value: "EAS" }],
      area: [
        {
          areaDesc: "Lower Klamath River corridor",
          polygon: ["41.20,-123.80 41.20,-123.40 41.45,-123.40 41.45,-123.80 41.20,-123.80"],
          geocode: [{ valueName: "SAME", value: "006015" }],
        },
      ],
    },
  ],
});

describe("CAP 1.2 base validation", () => {
  it("accepts a well-formed alert", () => {
    expect(validateCap12(ipawsAlert)).toEqual([]);
  });

  it("rejects bad enums and a missing info block on an Alert", () => {
    const bad = { ...ipawsAlert, status: "Bogus", info: [] };
    const issues = validateCap12(bad);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.path === "status")).toBe(true);
  });
});

describe("IPAWS profile validation", () => {
  it("passes a profile-complete alert", () => {
    expect(validateIpawsProfile(ipawsAlert)).toEqual([]);
    expect(isIpawsEligible(ipawsAlert)).toBe(true);
  });

  it("flags a missing IPAWS code, expires, SAME eventCode, and area", () => {
    const stripped = CapAlertSchema.parse({
      ...ipawsAlert,
      code: [],
      info: [
        {
          ...ipawsAlert.info[0],
          expires: undefined,
          eventCode: [],
          area: [],
        },
      ],
    });
    const issues = validateIpawsProfile(stripped);
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("code");
    expect(paths).toContain("info[0].expires");
    expect(paths).toContain("info[0].eventCode");
    expect(paths).toContain("info[0].area");
    expect(isIpawsEligible(stripped)).toBe(false);
  });
});

describe("CAP XML round-trip", () => {
  it("serializes to CAP-namespaced XML and parses back with full fidelity", () => {
    const xml = capToXml(ipawsAlert);
    expect(xml).toContain('xmlns="urn:oasis:names:tc:emergency:cap:1.2"');
    expect(xml).toContain("<identifier>OPENEOC-2026-0917-001</identifier>");
    expect(xml).toContain("<valueName>SAME</valueName>");

    const back = capFromXml(xml);
    expect(back).toEqual(ipawsAlert);
    // And the parsed alert is still IPAWS-eligible: nothing lost.
    expect(isIpawsEligible(back)).toBe(true);
  });

  it("ingests an external alert with multiple info blocks and areas faithfully", () => {
    const multi = CapAlertSchema.parse({
      ...ipawsAlert,
      info: [
        ipawsAlert.info[0],
        {
          language: "es-US",
          category: ["Met"],
          event: "Aviso de Inundación",
          urgency: "Expected",
          severity: "Severe",
          certainty: "Likely",
          expires: "2026-09-17T18:00:00-07:00",
          area: [
            { areaDesc: "Zona 1", geocode: [{ valueName: "SAME", value: "006015" }] },
            { areaDesc: "Zona 2", circle: ["41.3,-123.6 5"] },
          ],
        },
      ],
    });
    const back = capFromXml(capToXml(multi));
    expect(back.info).toHaveLength(2);
    expect(back.info[1]!.language).toBe("es-US");
    expect(back.info[1]!.area).toHaveLength(2);
    expect(back.info[1]!.area![1]!.circle).toEqual(["41.3,-123.6 5"]);
    expect(back).toEqual(multi);
  });
});
