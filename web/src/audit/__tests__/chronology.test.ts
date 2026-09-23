import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  SIGNIFICANT_CATEGORIES,
  categoryLabel,
  chronologyCategories,
  entryDetail,
  type ChronologyEntry,
} from "../chronology.js";

const entry = (category: string, payload: Record<string, unknown>): ChronologyEntry => ({
  seq: 1, id: "e", at: "2026-09-23T10:00:00.000Z", personId: "p", person: "Duty Officer", positionId: null,
  position: null, incidentId: null, category, subjectTable: null, subjectId: null, payload, corrects: null, line: "",
});

describe("chronology labels", () => {
  it("reads a known category from the label table and humanizes an unknown one", () => {
    expect(categoryLabel("rr.submitted")).toBe("Resource request submitted");
    expect(categoryLabel("iap.ics204.revised")).toBe("IAP ICS 204 revised");
    expect(categoryLabel("widget.frobbed_twice")).toBe("Widget frobbed twice");
    expect(categoryLabel("")).toBe("Unnamed event");
  });

  it("labels every significant category explicitly", () => {
    for (const category of SIGNIFICANT_CATEGORIES) expect(CATEGORY_LABELS[category], category).toBeTruthy();
  });

  it("summarizes a correction note, a state change and a board record", () => {
    expect(entryDetail(entry("correction", { note: "Road reopened at 09:10" }))).toBe("Road reopened at 09:10");
    expect(entryDetail(entry("rr.transition", { from: "submitted", to: "in_transit" }))).toBe("Submitted to In transit");
    expect(entryDetail(entry("board.record.created", { board: "significant_events", data: { summary: "Bridge out" } })))
      .toBe("Significant events board: Bridge out");
    expect(entryDetail(entry("file.uploaded", {}))).toBe("");
  });
});

describe("significant-events filter", () => {
  it("sends the significant set, one chosen category, or no category filter", () => {
    expect(chronologyCategories(true, "all")).toEqual(SIGNIFICANT_CATEGORIES);
    expect(chronologyCategories(false, "all")).toBeUndefined();
    expect(chronologyCategories(true, "rr.submitted")).toEqual(["rr.submitted"]);
    expect(chronologyCategories(false, "file.uploaded")).toEqual(["file.uploaded"]);
  });

  it("keeps operational milestones and corrections, not routine record keeping", () => {
    expect(SIGNIFICANT_CATEGORIES).toEqual(expect.arrayContaining(["incident.activated", "incident.closed", "iap.submitted", "correction"]));
    expect(SIGNIFICANT_CATEGORIES).not.toContain("board.record.updated");
    expect(new Set(SIGNIFICANT_CATEGORIES).size).toBe(SIGNIFICANT_CATEGORIES.length);
  });
});
