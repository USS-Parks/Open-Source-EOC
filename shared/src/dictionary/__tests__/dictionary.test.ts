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
  RESOURCE_KIND_SEED,
  RESOURCE_STATUSES,
  RESOURCE_STATUS_TRANSITIONS,
  DEMOBILIZATION_CHECKS,
  DEMOBILIZATION_CHECK_LABELS,
  toJsonSchemas,
  typeSatisfies,
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

  it("resource status moves stay inside the statuses and demobilized is terminal", () => {
    const statuses = RESOURCE_STATUSES.values;
    expect(Object.keys(RESOURCE_STATUS_TRANSITIONS).sort()).toEqual([...statuses].sort());
    for (const [from, targets] of Object.entries(RESOURCE_STATUS_TRANSITIONS)) {
      for (const t of targets) expect(statuses, `${from} -> ${t}`).toContain(t);
    }
    expect(RESOURCE_STATUS_TRANSITIONS["demobilized"]).toHaveLength(0);
    expect(Object.keys(DEMOBILIZATION_CHECK_LABELS).sort()).toEqual([...DEMOBILIZATION_CHECKS.values].sort());
  });

  it("seed kinds have unique unprefixed keys and consecutive type levels from 1", () => {
    const keys = RESOURCE_KIND_SEED.map((kind) => kind.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const kind of RESOURCE_KIND_SEED) {
      expect(kind.key, kind.key).toMatch(/^[a-z_]+$/);
      expect(kind.levels.map((level) => level.type)).toEqual(kind.levels.map((_, index) => index + 1));
    }
  });

  it("a more capable type, a lower number, fills a request for a less capable one", () => {
    expect(typeSatisfies(2, 3)).toBe(true);
    expect(typeSatisfies(3, 3)).toBe(true);
    expect(typeSatisfies(4, 3)).toBe(false);
    expect(typeSatisfies(null, 3)).toBe(false);
    expect(typeSatisfies(null, null)).toBe(true);
    expect(typeSatisfies(5, null)).toBe(true);
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
