import { describe, expect, it } from "vitest";
import { aarToTextLines, composeAar, type AarComposeInput } from "../aar.js";

/**
 * AAR composition (VEOC-36). Observations split into strengths and areas for
 * improvement; corrective actions and the chronology evidence carry through;
 * the text projection is HSEEP-ordered.
 */

const input: AarComposeInput = {
  incidentName: "Bald Hills Fire",
  period: "2026-09-17 to 2026-09-19",
  overview: "A fast-moving wildfire on the ridge above the lower service area.",
  objectives: ["Protect life safety", "Coordinate evacuation"],
  observations: [
    { capability: "operational_communications", capabilityElement: "none", kind: "strength", observation: "Radio net held throughout.", recommendation: null },
    { capability: "mass_care_services", capabilityElement: "training", kind: "improvement", observation: "Shelter opened late.", recommendation: "Pre-stage shelter kits." },
  ],
  correctiveActions: [
    { capability: "mass_care_services", capabilityElement: "equipment", recommendation: "Pre-stage shelter kits", owner: "Logistics", dueDate: "2026-12-01", status: "open" },
  ],
  chronologyLines: ["2026-09-17T12:00:00Z Duty Officer: incident.activated", "2026-09-17T12:05:00Z IC: checklist.completed"],
};

describe("composeAar", () => {
  it("splits observations by kind and carries evidence", () => {
    const doc = composeAar(input);
    expect(doc.strengths).toHaveLength(1);
    expect(doc.improvements).toHaveLength(1);
    expect(doc.strengths[0]!.capability).toBe("operational_communications");
    expect(doc.correctiveActions).toHaveLength(1);
    expect(doc.chronologyCount).toBe(2);
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
});
