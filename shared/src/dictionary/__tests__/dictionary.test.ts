import { describe, expect, it } from "vitest";
import {
  allEnums,
  COMMUNITY_LIFELINES,
  DAMAGE_DEGREES,
  IaAssessmentSchema,
  ICS_FORMS,
  ICS_SECTIONS,
  RESOURCE_REQUEST_STATES,
  RESOURCE_REQUEST_TRANSITIONS,
  toJsonSchemas,
} from "../index.js";

describe("citation lint", () => {
  it("every enumeration carries a non-empty citation and unique id", () => {
    const enums = allEnums();
    expect(enums.length).toBeGreaterThanOrEqual(14);
    const ids = new Set<string>();
    for (const e of enums) {
      expect(e.id.length, e.id).toBeGreaterThan(0);
      expect(ids.has(e.id), `duplicate id ${e.id}`).toBe(false);
      ids.add(e.id);
      expect(e.citation.authority.length, e.id).toBeGreaterThan(0);
      expect(e.citation.document.length, e.id).toBeGreaterThan(0);
      expect(e.values.length, e.id).toBeGreaterThan(0);
      expect(new Set(e.values).size, `duplicate values in ${e.id}`).toBe(e.values.length);
    }
  });
});

describe("doctrine shape", () => {
  it("has all eight FEMA community lifelines", () => {
    expect(COMMUNITY_LIFELINES.values).toHaveLength(8);
    expect(COMMUNITY_LIFELINES.values).toContain("water_systems");
  });

  it("covers the core ICS sections and forms including the 213RR", () => {
    for (const s of ["command", "operations", "planning", "logistics", "finance_admin"]) {
      expect(ICS_SECTIONS.values).toContain(s);
    }
    const ids = ICS_FORMS.map((f) => f.id);
    expect(ids).toContain("ICS-213RR");
    expect(ids).toContain("ICS-214");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resource request transitions only reference valid states, terminals have no exits", () => {
    const states = RESOURCE_REQUEST_STATES.values;
    expect(Object.keys(RESOURCE_REQUEST_TRANSITIONS).sort()).toEqual([...states].sort());
    for (const [from, targets] of Object.entries(RESOURCE_REQUEST_TRANSITIONS)) {
      for (const t of targets) expect(states, `${from} -> ${t}`).toContain(t);
    }
    expect(RESOURCE_REQUEST_TRANSITIONS["closed"]).toHaveLength(0);
    expect(RESOURCE_REQUEST_TRANSITIONS["cancelled"]).toHaveLength(0);
  });
});

describe("schema round-trips", () => {
  it("every enum value parses through its own zod schema", () => {
    for (const e of allEnums()) {
      for (const v of e.values) expect(e.schema.parse(v)).toBe(v);
      expect(() => e.schema.parse("__not_a_value__")).toThrow();
    }
  });

  it("JSON Schema export lists every value for every enum", () => {
    const schemas = toJsonSchemas();
    for (const e of allEnums()) {
      const js = schemas[e.id] as { enum?: string[] };
      expect(js, e.id).toBeDefined();
      expect(js.enum, e.id).toBeDefined();
      expect([...(js.enum ?? [])].sort()).toEqual([...e.values].sort());
    }
  });

  it("accepts a valid IA assessment and rejects a bad degree", () => {
    const valid = {
      structureType: "single_family",
      ownership: "owned",
      degree: "major",
      insured: false,
      waterDepthInches: 18,
      habitable: false,
    };
    expect(IaAssessmentSchema.parse(valid).degree).toBe("major");
    expect(() => IaAssessmentSchema.parse({ ...valid, degree: "obliterated" })).toThrow();
  });

  it("rejects damage degrees outside the PDA guide vocabulary", () => {
    expect(() => DAMAGE_DEGREES.schema.parse("catastrophic")).toThrow();
  });
});
