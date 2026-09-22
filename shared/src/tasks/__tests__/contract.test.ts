import { describe, expect, it } from "vitest";
import {
  TaskCompletionReceiptSchema,
  TaskListQuerySchema,
  TaskMetadataPatchSchema,
  TaskTemplateItemSchema,
} from "../contract.js";

describe("task contracts", () => {
  it("preserves legacy template strings and accepts keyed declarative prerequisites", () => {
    expect(TaskTemplateItemSchema.parse("Open the incident board")).toBe(
      "Open the incident board",
    );
    expect(TaskTemplateItemSchema.parse({
      item: "Confirm overnight staffing",
      key: "confirm_staffing",
      category: "staffing",
      due: { kind: "relative", anchor: "created", minutes: 30 },
      dependsOn: ["open_command"],
    })).toMatchObject({ category: "staffing", key: "confirm_staffing", dependsOn: ["open_command"] });
  });

  it("requires revision CAS and at least one metadata change", () => {
    expect(TaskMetadataPatchSchema.safeParse({ expectedRevision: 0 }).success).toBe(false);
    expect(TaskMetadataPatchSchema.parse({
      expectedRevision: 2,
      status: "in_progress",
    }).status).toBe("in_progress");
    expect(TaskMetadataPatchSchema.safeParse({
      expectedRevision: 2,
      status: "completed",
    }).success).toBe(false);
    expect(TaskMetadataPatchSchema.parse({
      expectedRevision: 2,
      dependencyIds: ["11111111-1111-4111-8111-111111111111"],
    }).dependencyIds).toHaveLength(1);
    expect(TaskMetadataPatchSchema.safeParse({
      expectedRevision: 2,
      dependencyIds: ["11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111111"],
    }).success).toBe(false);
  });

  it("accepts bounded filters and rejects arbitrary assignment selectors", () => {
    expect(TaskListQuerySchema.parse({ status: "open", due: "next_24_hours" })).toEqual({
      status: "open",
      due: "next_24_hours",
    });
    expect(TaskListQuerySchema.safeParse({ due: "today" }).success).toBe(false);
    expect(TaskListQuerySchema.safeParse({ assignment: "everybody" }).success).toBe(false);
  });

  it("requires a complete authoritative receipt", () => {
    const receipt = {
      operationId: "11111111-1111-4111-8111-111111111111",
      taskId: "22222222-2222-4222-8222-222222222222",
      incidentId: "33333333-3333-4333-8333-333333333333",
      status: "completed",
      revision: 3,
      completedAt: "2026-09-21T12:00:00.000Z",
      completedBy: {
        personId: "44444444-4444-4444-8444-444444444444",
        positionId: null,
        organizationId: "55555555-5555-4555-8555-555555555555",
        participationId: "66666666-6666-4666-8666-666666666666",
        title: "Logistics liaison",
      },
    };
    expect(TaskCompletionReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(TaskCompletionReceiptSchema.safeParse({ ...receipt, completedBy: null }).success).toBe(
      false,
    );
  });
});
