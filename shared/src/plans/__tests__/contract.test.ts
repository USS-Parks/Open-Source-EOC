import { describe, expect, it } from "vitest";
import { CONTINUITY_PLAN_TEMPLATE } from "../continuity-template.js";
import { PlanDefinitionSchema } from "../contract.js";

describe("plan definitions", () => {
  it("parses the continuity template, with every essential function's parts", () => {
    const plan = PlanDefinitionSchema.parse(CONTINUITY_PLAN_TEMPLATE.definition);
    expect(plan.kind).toBe("continuity");
    expect(plan.continuity!.essentialFunctions).toHaveLength(8);
    expect(new Set(plan.continuity!.essentialFunctions.map((fn) => fn.priority)).size).toBe(8);
    expect(plan.continuity!.recoveryLocations.map((location) => location.name)).toEqual(["Alternate site", "Devolution site"]);
  });

  it("gives essential functions to a continuity plan and to no other", () => {
    const issues = (value: unknown) => PlanDefinitionSchema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];
    expect(issues({ kind: "continuity", templateKey: "continuity_of_operations" }))
      .toContain("a continuity plan names its essential functions");
    expect(issues({ ...CONTINUITY_PLAN_TEMPLATE.definition, kind: "incident_response" }))
      .toContain("only a continuity plan has essential functions");
    expect(issues({ ...CONTINUITY_PLAN_TEMPLATE.definition, tasks: [{ position: "incident_commander", item: "Early", releaseMinutes: -5 }] }))
      .toContain("a plan without an event releases a task at activation or after it");
  });
});
