import { describe, expect, it } from "vitest";
import {
  addressedTo,
  distributionFromXml,
  distributionToXml,
  resourceRequestToRm,
  rmToResourceRequest,
  DistributionSchema,
  type ResourceRequest,
} from "../edxl.js";

/**
 * EDXL round-trip: a 213RR maps to EDXL-RM and back without
 * loss, the DE envelope serializes and parses with full fidelity, and
 * explicit addresses gate consumption.
 */

const rr: ResourceRequest = {
  item: "Type 1 water tender",
  quantity: 3,
  priority: "immediate",
  state: "submitted",
  needed_by: "2026-09-18T06:00:00-07:00",
  notes: "Staging at Weitchpec; gravel road access only.",
};

describe("213RR ↔ EDXL-RM mapping", () => {
  it("maps every field and maps back without loss", () => {
    const rm = resourceRequestToRm(rr, {
      messageID: "MSG-1",
      sentDateTime: "2026-09-17T12:00:00-07:00",
      incidentID: "INC-42",
    });
    expect(rm.resource.name).toBe("Type 1 water tender");
    expect(rm.assignmentInformation?.quantityAmount).toBe("3");
    expect(rm.assignmentInformation?.priorityLevel).toBe("immediate");
    expect(rm.scheduleInformation?.[0]?.scheduleType).toBe("RequestedArrival");

    expect(rmToResourceRequest(rm)).toEqual(rr);
  });
});

describe("EDXL-DE envelope round-trip", () => {
  const de = DistributionSchema.parse({
    distributionID: "DE-2026-0917-1",
    senderID: "yurok",
    dateTimeSent: "2026-09-17T12:00:00-07:00",
    distributionStatus: "Actual",
    distributionType: "Request",
    combinedConfidentiality: "Unclassified",
    explicitAddress: [{ explicitAddressScheme: "openeoc", explicitAddressValue: "downriver" }],
    content: resourceRequestToRm(rr, { messageID: "MSG-1", sentDateTime: "2026-09-17T12:00:00-07:00" }),
  });

  it("serializes to DE/RM-namespaced XML and parses back identically", () => {
    const xml = distributionToXml(de);
    expect(xml).toContain('xmlns="urn:oasis:names:tc:emergency:EDXL:DE:1.0"');
    expect(xml).toContain('xmlns="urn:oasis:names:tc:emergency:EDXL:RM:1.0"');
    expect(xml).toContain("<embeddedXMLContent>");
    const back = distributionFromXml(xml);
    expect(back).toEqual(de);
    // The embedded resource request survives the whole trip.
    expect(rmToResourceRequest(back.content)).toEqual(rr);
  });

  it("honors explicit-address routing scope", () => {
    expect(addressedTo(de, "downriver")).toBe(true);
    expect(addressedTo(de, "yurok")).toBe(false);
    const broadcast = { ...de, explicitAddress: [] };
    expect(addressedTo(broadcast, "anyone")).toBe(true);
  });
});
