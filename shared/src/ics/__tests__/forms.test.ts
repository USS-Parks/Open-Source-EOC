import { describe, expect, it } from "vitest";
import {
  assembleIap,
  buildIcsForm,
  DEFAULT_IAP_FORMS,
  ICS_FORM_IDS,
  iapToTextLines,
  type IncidentContext,
} from "../forms.js";
import { renderIapPdf, renderPdf } from "../pdf.js";

/**
 * ICS form prefill, IAP assembly, and PDF export (F5). The forms
 * derive purely from a normalized incident context; the golden expectations
 * below are the prefill contract, and the PDF is deterministic.
 */

const ctx: IncidentContext = {
  incidentName: "Bald Hills Fire",
  operationalPeriod: "OP 1 (0600-1800)",
  preparedBy: "Planning Section Chief",
  objectives: ["Protect life safety", "Establish the operational period"],
  org: [
    { section: "command", positionKey: "incident_commander", positionTitle: "Incident Commander", holder: "A. Rivers" },
    { section: "operations", positionKey: "operations_section_chief", positionTitle: "Operations Section Chief", holder: "B. Stone" },
    { section: "planning", positionKey: "planning_section_chief", positionTitle: "Planning Section Chief", holder: null },
  ],
  activityLog: [
    { time: "0605", entry: "Assumed command" },
    { time: "0630", entry: "Set initial objectives" },
  ],
  checkIns: [{ name: "Engine 21", time: "0555" }],
  comms: [{ channel: "CMD-1", frequency: "154.2800", assignment: "Command" }],
  resources: [{ item: "Type 3 Engine", quantity: "2", state: "assigned" }],
  safetyMessage: "Watch for rolling debris on the west flank.",
  medicalFacilities: ["Del Norte Regional (Level III), 25 min"],
};

describe("ICS form prefill", () => {
  it("builds every one of the twelve forms with the incident header", () => {
    for (const id of ICS_FORM_IDS) {
      const form = buildIcsForm(id, ctx);
      expect(form.id).toBe(id);
      expect(form.incidentName).toBe("Bald Hills Fire");
      expect(form.operationalPeriod).toBe("OP 1 (0600-1800)");
    }
  });

  it("prefills the 203 organization assignment list from the org chart", () => {
    const form = buildIcsForm("ICS-203", ctx);
    const rows = form.sections[0]!.rows!;
    expect(rows).toContainEqual(["Incident Commander", "A. Rivers"]);
    expect(rows).toContainEqual(["Planning Section Chief", "(unassigned)"]);
  });

  it("derives the 214 activity log automatically", () => {
    const form = buildIcsForm("ICS-214", ctx);
    const rows = form.sections[0]!.rows!;
    expect(rows).toEqual([
      ["0605", "Assumed command"],
      ["0630", "Set initial objectives"],
    ]);
  });

  it("puts only operations positions on the 204", () => {
    const form = buildIcsForm("ICS-204", ctx);
    const rows = form.sections[0]!.rows!;
    expect(rows).toEqual([["Operations Section Chief", "B. Stone"]]);
  });

  it("groups the 207 organization chart by section", () => {
    const form = buildIcsForm("ICS-207", ctx);
    const headings = form.sections.map((s) => s.heading);
    expect(headings).toContain("Command");
    expect(headings).toContain("Operations");
  });
});

describe("IAP assembly", () => {
  it("assembles the default IAP form set in order", () => {
    const iap = assembleIap(ctx);
    expect(iap.forms.map((f) => f.id)).toEqual(DEFAULT_IAP_FORMS as string[]);
    expect(iap.incidentName).toBe("Bald Hills Fire");
  });

  it("projects to deterministic text carrying the objectives and comms", () => {
    const lines = iapToTextLines(assembleIap(ctx));
    expect(lines).toContain("INCIDENT ACTION PLAN");
    expect(lines.some((l) => l.includes("Protect life safety"))).toBe(true);
    expect(lines.some((l) => l.includes("CMD-1"))).toBe(true);
  });
});

const decode = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};
const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe("PDF export", () => {
  it("renders a valid, deterministic PDF containing the incident name", () => {
    const iap = assembleIap(ctx);
    const pdf = renderPdf(`IAP - ${iap.incidentName}`, iapToTextLines(iap));
    const text = decode(pdf);
    expect(text.startsWith("%PDF-1.")).toBe(true);
    expect(text.includes("%%EOF")).toBe(true);
    expect(text).toContain("Bald Hills Fire");
    // Deterministic: the same input yields byte-identical output.
    const again = renderPdf(`IAP - ${iap.incidentName}`, iapToTextLines(iap));
    expect(bytesEqual(pdf, again)).toBe(true);
  });

  it("applies grayscale-safe identity, metadata, page counts, and opt-in handling", () => {
    const iap = assembleIap({
      ...ctx,
      incidentName: "Incendio José Muñoz",
      preparedBy: "Renée O’Connor",
    });
    const pdf = renderIapPdf(iap, {
      source: "Stored IAP snapshot",
      sourceTime: "2026-09-21T12:30:00.000Z",
      revision: "IAP revision 2; content revision 4; status approved",
    });
    const text = decode(pdf);

    expect(text).toContain("Open Source EOC");
    expect(text).toContain("Incident: Incendio José Muñoz");
    expect(text).toContain("Operational period: OP 1 \\(0600-1800\\)");
    expect(text).toContain("Source: Stored IAP snapshot");
    expect(text).toContain("Source time: 2026-09-21T12:30:00.000Z");
    expect(text).toContain("Revision: IAP revision 2; content revision 4;");
    expect(text).toContain("status approved");
    expect(text).toContain("Page 1 of 2");
    expect(text).toContain("/Encoding /WinAnsiEncoding");
    expect(text).toContain(String.fromCharCode(0x92));
    expect(text).not.toContain("Handling:");
    expect(text).not.toMatch(/\b(?:rg|RG)\b/);

    const marked = decode(renderIapPdf(iap, { handling: "FOUO" }));
    expect(marked).toContain("Handling: FOUO");
  });

  it("states the bounded WinAnsi fallback through deterministic output", () => {
    const pdf = decode(renderPdf("Encoding limit", ["Western: José – O’Connor", "Unsupported: 漢字"]));
    expect(pdf).toContain("Western: José ");
    expect(pdf).toContain(String.fromCharCode(0x96));
    expect(pdf).toContain(String.fromCharCode(0x92));
    expect(pdf).toContain("(Unsupported: ??) Tj");
  });

  it("paginates long documents into multiple pages", () => {
    const many = Array.from({ length: 200 }, (_, i) => `Log line ${i}`);
    const pdf = renderPdf("Big", many);
    const text = decode(pdf);
    const pageCount = (text.match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
    expect((text.match(/\(Open Source EOC\) Tj/g) ?? [])).toHaveLength(pageCount * 2);
    expect(text).toContain(`Page 1 of ${pageCount}`);
    expect(text).toContain(`Page ${pageCount} of ${pageCount}`);
  });
});
