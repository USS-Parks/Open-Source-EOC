import { describe, expect, it } from "vitest";
import {
  BoardTemplateSchema,
  buildRecordSchema,
  deriveRecordValues,
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
      "damage_assessment",
      "esf_status",
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

describe("declarative board authoring", () => {
  const authored = BoardTemplateSchema.parse({
    key: "needs_estimate", version: 1, title: "Needs estimate",
    fields: [
      { key: "kind", label: "Kind", type: "enum", values: ["routine", "urgent"], required: true },
      { key: "units", label: "Units", type: "number", required: true },
      { key: "unit_cost", label: "Unit cost", type: "number", required: true },
      { key: "total", label: "Total", type: "number", calculation: { op: "multiply", inputs: ["units", "unit_cost"] } },
      { key: "urgent_note", label: "Urgent note", type: "text", required: true,
        condition: { field: "kind", op: "eq", value: "urgent" } },
    ],
    views: [{ key: "all", title: "All", columns: ["kind", "total"] }],
    inputLayout: { sections: [{ key: "request", title: "Request", fields: ["kind", "units", "unit_cost", "urgent_note"] }] },
    detailLayout: { sections: [{ key: "summary", title: "Summary", fields: ["kind", "total"] }] },
  });

  it("validates conditional required fields and rejects supplied computed values", () => {
    const schema = buildRecordSchema(authored.fields);
    expect(schema.safeParse({ kind: "routine", units: 2, unit_cost: 5 }).success).toBe(true);
    expect(schema.safeParse({ kind: "urgent", units: 2, unit_cost: 5 }).success).toBe(false);
    expect(schema.safeParse({ kind: "routine", units: 2, unit_cost: 5, total: 10 }).success).toBe(false);
  });

  it("derives bounded numeric output without changing stored input", () => {
    const stored = { kind: "routine", units: 3, unit_cost: 4 };
    expect(deriveRecordValues(authored.fields, stored)).toMatchObject({ ...stored, total: 12 });
    expect(stored).not.toHaveProperty("total");
    const stale = deriveRecordValues(authored.fields, { kind: "routine", units: 3, total: 999 });
    expect(stale).not.toHaveProperty("total");
  });

  it("requires a conditional calculated value only when active", () => {
    const conditional = BoardTemplateSchema.parse({
      ...authored,
      fields: [
        { key: "kind", label: "Kind", type: "enum", values: ["routine", "urgent"], required: true },
        { key: "units", label: "Units", type: "number" },
        { key: "unit_cost", label: "Unit cost", type: "number" },
        { key: "total", label: "Total", type: "number", required: true,
          condition: { field: "kind", op: "eq", value: "urgent" },
          calculation: { op: "multiply", inputs: ["units", "unit_cost"] } },
      ],
      views: [{ key: "all", title: "All", columns: ["kind", "total"] }],
      inputLayout: undefined,
      detailLayout: undefined,
    });
    const schema = buildRecordSchema(conditional.fields);
    expect(schema.safeParse({ kind: "urgent", units: 2, unit_cost: 5 }).success).toBe(true);
    expect(schema.safeParse({ kind: "urgent", units: 2 }).success).toBe(false);
    expect(schema.safeParse({ kind: "routine" }).success).toBe(true);
  });

  it("rejects unsafe dependencies, cycles, and division by zero", () => {
    expect(() => BoardTemplateSchema.parse({ ...authored, fields: [
      { key: "secret", label: "Secret", type: "number", read: "admin" },
      { key: "public_total", label: "Public total", type: "number", read: "any",
        calculation: { op: "sum", inputs: ["secret"] } },
    ], views: [{ key: "all", title: "All", columns: ["public_total"] }] })).toThrow();
    expect(() => BoardTemplateSchema.parse({ ...authored, fields: [
      { key: "a", label: "A", type: "number", calculation: { op: "sum", inputs: ["b"] } },
      { key: "b", label: "B", type: "number", calculation: { op: "sum", inputs: ["a"] } },
    ], views: [{ key: "all", title: "All", columns: ["a"] }] })).toThrow();
    const divide = BoardTemplateSchema.parse({ ...authored, fields: [
      { key: "a", label: "A", type: "number" }, { key: "b", label: "B", type: "number" },
      { key: "ratio", label: "Ratio", type: "number", calculation: { op: "divide", inputs: ["a", "b"] } },
    ], views: [{ key: "all", title: "All", columns: ["ratio"] }],
      inputLayout: undefined, detailLayout: undefined });
    expect(buildRecordSchema(divide.fields).safeParse({ a: 1, b: 0 }).success).toBe(false);
  });

  it("validates condition literals with the referenced field schema", () => {
    const invalidSources = [
      { field: { key: "source", label: "Source", type: "enum", values: ["open", "closed"] }, value: "other" },
      { field: { key: "source", label: "Source", type: "person_ref" }, value: "not-a-uuid" },
      { field: { key: "source", label: "Source", type: "datetime" }, value: "tomorrow" },
    ];
    for (const item of invalidSources) {
      expect(() => BoardTemplateSchema.parse({
        key: "condition_literals", version: 1, title: "Condition literals",
        fields: [item.field, { key: "detail", label: "Detail", type: "text",
          condition: { field: "source", op: "eq", value: item.value } }],
        views: [{ key: "all", title: "All", columns: ["detail"] }],
      })).toThrow();
    }
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
