import { describe, expect, it } from "vitest";
import { OperationalRelationshipCreateSchema } from "../contract.js";

describe("operational relationship contract", () => {
  const source = { domain: "lifeline", framework: "fema_community_lifelines", definitionKey: "transportation" } as const;
  it("requires typed target identities instead of free-form links", () => {
    expect(OperationalRelationshipCreateSchema.parse({ source, target: { kind: "task", taskId: "11111111-1111-4111-8111-111111111111" } }).target.kind).toBe("task");
    expect(() => OperationalRelationshipCreateSchema.parse({ source, target: { kind: "task", taskId: "not-an-id" } })).toThrow();
    expect(() => OperationalRelationshipCreateSchema.parse({ source, target: { kind: "task", taskId: "11111111-1111-4111-8111-111111111111", label: "inferred" } })).toThrow();
  });
  it("pins planning objectives to a concrete IAP content revision", () => {
    const target = OperationalRelationshipCreateSchema.parse({ source, target: { kind: "iap_objective", iapId: "22222222-2222-4222-8222-222222222222", contentRevision: 3, objectiveIndex: 1 } }).target;
    expect(target).toMatchObject({ kind: "iap_objective", contentRevision: 3, objectiveIndex: 1 });
  });
});
