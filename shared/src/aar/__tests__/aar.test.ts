import { describe, expect, it } from "vitest";
import { aarToTextLines, composeAar, type AarComposeInput } from "../aar.js";
import { renderAarPdf } from "../../ics/pdf.js";

/**
 * AAR composition. Observations split into strengths and areas for
 * improvement; corrective actions and the chronology evidence carry through;
 * the text projection is HSEEP-ordered.
 */

const input: AarComposeInput = {
  incidentName: "Bald Hills Fire",
  period: "Operational Period 1",
  operationalPeriod: {
    revision: 3,
    label: "Operational Period 1",
    startsAt: "2026-09-17T12:00:00.000Z",
    endsAt: "2026-09-18T00:00:00.000Z",
  },
  overview: "A fast-moving wildfire on the ridge above the lower service area.",
  objectives: ["Protect life safety", "Coordinate evacuation"],
  observations: [
    { id: "observation-1", capability: "operational_communications", capabilityElement: "none", kind: "strength", observation: "Radio net held throughout.", recommendation: null, operationalPeriodRevision: 3, createdAt: "2026-09-17T13:00:00.000Z" },
    { id: "observation-2", capability: "mass_care_services", capabilityElement: "training", kind: "improvement", observation: "Shelter opened late.", recommendation: "Pre-stage shelter kits.", operationalPeriodRevision: 3, createdAt: "2026-09-17T14:00:00.000Z" },
  ],
  correctiveActions: [
    { id: "action-1", capability: "mass_care_services", capabilityElement: "equipment", recommendation: "Pre-stage shelter kits", priority: "high", owner: "Logistics", assignment: { kind: "position", organizationId: "org-1", positionId: "position-1", label: "Logistics" }, dueDate: "2026-12-01", status: "complete", revision: 2, operationalPeriodRevision: 3, completedAt: "2026-09-20T10:00:00.000Z", completedBy: "Alex Rivera" },
  ],
  chronologyLines: ["2026-09-17T12:00:00Z Duty Officer: incident.activated", "2026-09-17T12:05:00Z IC: checklist.completed"],
};

function pdfPhysicalLines(pdf: string): string[] {
  return [...pdf.matchAll(/\((.*?)\) Tj/g)].map((match) =>
    match[1]!.replace(/\\([\\()])/g, "$1"),
  );
}

function pdfBytesToLatin1(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return text;
}

describe("composeAar", () => {
  it("splits observations by kind and carries evidence", () => {
    const doc = composeAar(input);
    expect(doc.strengths).toHaveLength(1);
    expect(doc.improvements).toHaveLength(1);
    expect(doc.strengths[0]!.capability).toBe("operational_communications");
    expect(doc.correctiveActions).toHaveLength(1);
    expect(doc.chronologyCount).toBe(2);
    expect(doc.analytics.totals).toEqual({ observations: 2, correctiveActions: 1, records: 3 });
    expect(doc.analytics.byCapability.find((item) => item.key === "mass_care_services")).toMatchObject({
      count: 2,
      observationIds: ["observation-2"],
      correctiveActionIds: ["action-1"],
    });
  });

  it("renders an HSEEP-ordered document", () => {
    const lines = aarToTextLines(composeAar(input));
    expect(lines[0]).toBe("AFTER-ACTION REPORT / IMPROVEMENT PLAN");
    expect(lines.some((l) => l.includes("1. Incident Overview"))).toBe(true);
    expect(lines.some((l) => l.includes("4. Areas for Improvement"))).toBe(true);
    expect(lines.some((l) => l.includes("5. Improvement Plan"))).toBe(true);
    expect(lines.some((l) => l.includes("Pre-stage shelter kits"))).toBe(true);
    expect(lines.some((l) => l.includes("6. Evidence: chronology (2 events)"))).toBe(true);
  });

  it("renders capability ids as labels and tags the POETE element when set", () => {
    const lines = aarToTextLines(composeAar(input));
    expect(lines.some((l) => l.includes("[Mass Care Services / Training]"))).toBe(true);
    expect(lines.some((l) => l.includes("[Mass Care Services / Equipment]"))).toBe(true);
    expect(lines.some((l) => l.includes("[Operational Communications]"))).toBe(true);
    expect(lines.some((l) => l.includes("[Operational Communications / none]"))).toBe(false);
    // The raw snake_case id never reaches the finished report.
    expect(lines.some((l) => l.includes("mass_care_services"))).toBe(false);
  });

  it("keeps operational period and action follow-through in the PDF", () => {
    const pdf = pdfBytesToLatin1(renderAarPdf(composeAar(input)));
    const text = pdfPhysicalLines(pdf).join(" ");
    expect(text).toContain("Operational Period Revision: 3");
    expect(text).toContain("priority: high; owner: Logistics; due: 2026-12-01");
    expect(text).toContain("status: complete; revision: 2");
    expect(text).toContain("First completed: 2026-09-20T10:00:00.000Z by Alex Rivera");
  });

  it("wraps long AAR fields before paginating without dropping action metadata", () => {
    const longToken = "SUPERCALIFRAGILISTICEXPIALIDOCIOUSSUPERCALIFRAGILISTICEXPIALIDOCIOUS";
    const document = composeAar({
      ...input,
      incidentName: `Extended regional coordination incident ${longToken}`,
      correctiveActions: [
        {
          ...input.correctiveActions[0]!,
          recommendation: "Coordinate shelter supply staging with every participating operational partner before the next activation window",
          owner: "Regional logistics and mutual aid coordination section",
        },
      ],
      chronologyLines: Array.from(
        { length: 65 },
        (_, index) => `2026-09-17T12:${String(index % 60).padStart(2, "0")}:00Z Duty Officer: operational coordination event ${index + 1}`,
      ),
    });

    const pdf = pdfBytesToLatin1(renderAarPdf(document));
    const physicalLines = pdfPhysicalLines(pdf);
    const text = physicalLines.join(" ");

    expect(physicalLines.every((line) => line.length <= 50)).toBe(true);
    expect(text).toContain("priority: high; owner: Regional logistics and mutual aid coordination section; due: 2026-12-01; status: complete; revision: 2");
    expect(physicalLines.join("")).toContain(longToken);
    const pageCount = Number(pdf.match(/\/Count (\d+)/)?.[1]);
    expect(pageCount).toBeGreaterThan(1);
  });
});
