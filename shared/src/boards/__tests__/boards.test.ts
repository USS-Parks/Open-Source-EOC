import { describe, expect, it } from "vitest";
import {
  buildRecordSchema,
  effectiveFields,
  STANDARD_TEMPLATES,
  type FieldDef,
} from "../../index.js";

describe("standard board library (F1: boards as data)", () => {
  it("ships the full standard set, validated at load", () => {
    const keys = STANDARD_TEMPLATES.map((t) => t.key);
    expect(keys).toEqual([
      "activity_log",
      "significant_events",
      "resource_request",
      "shelters",
      "road_closures",
      "lifelines",
      "sign_in_out",
      "situation_report",
      "press_releases",
      "checklists",
      "after_action_review",
      "rumor_control",
      "talking_points",
      "field_reports",
    ]);
  });

  it("the field-reports board takes a photo attachment as a file id", () => {
    const fr = STANDARD_TEMPLATES.find((t) => t.key === "field_reports")!;
    const schema = buildRecordSchema(fr.fields);
    const good = schema.safeParse({
      summary: "Culvert washout",
      category: "damage",
      photo: "11111111-1111-4111-8111-111111111111",
      location: { type: "Point", coordinates: [-123.6, 41.3] },
    });
    expect(good.success).toBe(true);
    const bad = schema.safeParse({ summary: "x", category: "damage", photo: "not-a-uuid" });
    expect(bad.success).toBe(false);
  });

  it("every template builds a working record validator", () => {
    for (const t of STANDARD_TEMPLATES) expect(buildRecordSchema(t.fields)).toBeTruthy();
  });

  it("validates records against dictionary enums and rejects drift", () => {
    const sig = STANDARD_TEMPLATES.find((t) => t.key === "significant_events")!;
    const schema = buildRecordSchema(sig.fields);
    const good = {
      summary: "Bridge out on SR-169",
      occurred_at: "2026-09-17T10:00:00Z",
      severity: "critical",
    };
    expect(schema.parse(good)).toMatchObject(good);
    expect(() => schema.parse({ ...good, severity: "catastrophic" })).toThrow();
    expect(() => schema.parse({ ...good, smuggled: "data" })).toThrow();
    expect(() => schema.parse({ occurred_at: good.occurred_at, severity: "warning" })).toThrow();
  });
});

describe("template upgrade and re-convergence (INV-5)", () => {
  const v2 = {
    ...STANDARD_TEMPLATES.find((t) => t.key === "significant_events")!,
    version: 2,
    fields: [
      ...STANDARD_TEMPLATES.find((t) => t.key === "significant_events")!.fields,
      { key: "source", label: "Source", type: "text", required: false, read: "any", write: "member" } as FieldDef,
    ],
  };

  it("keeps local x_ fields through an upgrade", () => {
    const locals = [
      { key: "x_tribal_notes", label: "Tribal notes", type: "text", required: false, read: "any", write: "member" } as FieldDef,
    ];
    const { fields, dropped } = effectiveFields(v2, locals);
    expect(dropped).toEqual([]);
    expect(fields.map((f) => f.key)).toContain("x_tribal_notes");
    expect(fields.map((f) => f.key)).toContain("source");
  });

  it("re-converges: a local field the template now covers is dropped", () => {
    const locals = [
      { key: "x_source", label: "Source", type: "text", required: false, read: "any", write: "member" } as FieldDef,
    ];
    const { fields, dropped } = effectiveFields(v2, locals);
    expect(dropped).toEqual(["x_source"]);
    expect(fields.filter((f) => f.key === "x_source")).toHaveLength(0);
  });
});

// Signed-package tests live in the server package with the signing module
// (node:crypto is unavailable to this browser-bound package by design).
