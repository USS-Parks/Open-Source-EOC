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
    { capability: "Operational Communications", kind: "strength", observation: "Radio net held throughout.", recommendation: null },
    { capability: "Mass Care", kind: "improvement", observation: "Shelter opened late.", recommendation: "Pre-stage shelter kits." },
  ],
  correctiveActions: [
    { capability: "Mass Care", recommendation: "Pre-stage shelter kits", owner: "Logistics", dueDate: "2026-12-01", status: "open" },
  ],
  chronologyLines: ["2026-09-17T12:00:00Z Duty Officer: incident.activated", "2026-09-17T12:05:00Z IC: checklist.completed"],
};

describe("composeAar", () => {
  it("splits observations by kind and carries evidence", () => {
    const doc = composeAar(input);
    expect(doc.strengths).toHaveLength(1);
    expect(doc.improvements).toHaveLength(1);
    expect(doc.strengths[0]!.capability).toBe("Operational Communications");
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
});
