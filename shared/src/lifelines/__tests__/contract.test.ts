import { describe, expect, it } from "vitest";
import {
  CALIFORNIA_ESF_MERGED_INTO,
  CALIFORNIA_ESF_TITLES,
  CreateEsfAssessmentSchema,
  CreateLifelineAssessmentSchema,
  ESF_CROSSWALK_V1,
  ESF_DOCTRINE_GAPS,
} from "../../index.js";

describe("operational assessment contracts", () => {
  it("keeps ESF activation and capacity independent", () => {
    const input = CreateEsfAssessmentSchema.parse({
      identity: { framework: "california", esf: "ca_esf_18" },
      activation: "not_activated",
      capacity: "critical",
      assessedAt: "2026-09-21T12:00:00.000Z",
      confidence: "confirmed",
      situation: "Capacity report remains independent of activation.",
      relatedLifelines: ["energy"],
    });
    expect(input.activation).toBe("not_activated");
    expect(input.capacity).toBe("critical");
  });

  it("keeps verified California titles, mergers, and unresolved effective dates explicit", () => {
    expect(ESF_CROSSWALK_V1).toEqual([expect.objectContaining({
      fromKey: "ca_esf_16",
      toKey: "ca_esf_13",
      relationship: "merged_into",
    })]);
    expect(CALIFORNIA_ESF_TITLES.ca_esf_18).toBe("Cybersecurity");
    expect(CALIFORNIA_ESF_MERGED_INTO.ca_esf_9).toEqual(["ca_esf_4", "ca_esf_13"]);
    expect(CALIFORNIA_ESF_MERGED_INTO.ca_esf_16).toEqual(["ca_esf_13"]);
    expect(ESF_DOCTRINE_GAPS.join(" ")).toContain("effective dates");
    expect(ESF_DOCTRINE_GAPS.join(" ")).not.toContain("federal-to-California");
  });

  it("validates bounded components, actions, evidence, and references", () => {
    const input = CreateLifelineAssessmentSchema.parse({
      lifeline: "energy",
      condition: "stable",
      assessedAt: "2026-09-21T12:00:00.000Z",
      confidence: "estimated",
      impactStatement: "Power remains available in the assessed area.",
      components: [{ key: "distribution", label: "Distribution", condition: "stable" }],
      evidence: [{ kind: "impact", category: "population", areaRevision: 2 }],
      actions: [{
        key: "verify_substations",
        title: "Verify substations",
        status: "planned",
        dueAt: "2026-09-22T12:00:00.000Z",
      }],
    });
    expect(input.definitionVersion).toBe(1);
    expect(input.actions[0]?.status).toBe("planned");
    expect(() => CreateLifelineAssessmentSchema.parse({
      ...input,
      actions: [input.actions[0], input.actions[0]],
    })).toThrow(/duplicate stabilization action key/);
  });

  it("rejects fabricated framework identities and malformed timestamps", () => {
    expect(() => CreateEsfAssessmentSchema.parse({
      identity: { framework: "california", esf: "esf_1_transportation" },
      activation: "activated",
      capacity: "adequate",
      assessedAt: "yesterday",
      confidence: "confirmed",
      situation: "Invalid identity",
    })).toThrow();
  });
});
