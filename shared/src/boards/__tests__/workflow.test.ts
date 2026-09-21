import { describe, expect, it } from "vitest";
import {
  BoardTemplateSchema,
  BoardWorkflowSchema,
  WorkflowAssignmentRequestSchema,
  workflowDueAt,
  workflowEscalationAt,
} from "../../index.js";

const workflow = {
  initialState: "submitted",
  states: [
    { key: "submitted", label: "Submitted" },
    { key: "in_review", label: "In review" },
    { key: "approved", label: "Approved", terminal: true },
  ],
  transitions: [
    {
      key: "send_to_review",
      label: "Send to review",
      from: "submitted",
      to: "in_review",
      allowedActors: ["writer"],
      assignment: { required: true, allowedTargets: ["position", "incident_participant"] },
      approvals: [{ key: "operations", label: "Operations approval",
        approver: { kind: "position_key", positionKey: "operations_section_chief" } }],
      due: { kind: "record_field", field: "needed_by" },
      escalations: [{ key: "overdue", afterMinutes: 60,
        assignment: { required: true, allowedTargets: ["position"] } }],
    },
    {
      key: "approve",
      label: "Approve",
      from: "in_review",
      to: "approved",
      allowedActors: ["jurisdiction_admin"],
    },
  ],
};

const board = {
  key: "routed_request",
  version: 1,
  title: "Routed request",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "needed_by", label: "Needed by", type: "datetime" },
  ],
  views: [{ key: "all", title: "All", columns: ["summary", "needed_by"] }],
  workflow,
};

describe("declarative board workflow contract", () => {
  it("validates transitions, assignments, approvals, due rules, and escalations", () => {
    const parsed = BoardTemplateSchema.parse(board);
    expect(parsed.workflow?.initialState).toBe("submitted");
    expect(parsed.workflow?.transitions[0]?.assignment?.allowedTargets)
      .toEqual(["position", "incident_participant"]);
  });

  it("rejects unknown states, terminal exits, duplicate keys, and invalid due fields", () => {
    expect(() => BoardWorkflowSchema.parse({ ...workflow,
      transitions: [{ ...workflow.transitions[0], to: "missing" }] })).toThrow();
    expect(() => BoardWorkflowSchema.parse({ ...workflow,
      transitions: [...workflow.transitions,
        { key: "reopen", label: "Reopen", from: "approved", to: "submitted", allowedActors: ["writer"] }] })).toThrow();
    expect(() => BoardWorkflowSchema.parse({ ...workflow,
      states: [...workflow.states, workflow.states[0]] })).toThrow();
    expect(() => BoardTemplateSchema.parse({ ...board,
      workflow: { ...workflow, transitions: [{ ...workflow.transitions[0],
        due: { kind: "record_field", field: "summary" } }, workflow.transitions[1]] } })).toThrow();
  });

  it("computes due and escalation schedules from explicit timestamps", () => {
    const input = {
      createdAt: "2026-09-21T10:00:00Z",
      transitionedAt: "2026-09-21T11:00:00Z",
      record: { needed_by: "2026-09-22T12:00:00-07:00" },
    };
    expect(workflowDueAt({ kind: "relative", minutes: 90, anchor: "transitioned" }, input))
      .toBe("2026-09-21T12:30:00.000Z");
    expect(workflowDueAt({ kind: "record_field", field: "needed_by" }, input))
      .toBe("2026-09-22T19:00:00.000Z");
    expect(workflowDueAt({ kind: "record_field", field: "missing" }, input)).toBeNull();
    expect(() => workflowDueAt({ kind: "record_field", field: "needed_by" },
      { ...input, record: { needed_by: "tomorrow" } })).toThrow(/not an ISO timestamp/);

    const escalation = { key: "late", afterMinutes: 30, repeatEveryMinutes: 15, maxOccurrences: 3 };
    expect(workflowEscalationAt(escalation, input.transitionedAt, 2))
      .toBe("2026-09-21T12:00:00.000Z");
    expect(() => workflowEscalationAt(escalation, input.transitionedAt, 3)).toThrow();
  });

  it("keeps concrete assignment requests strict and explicit", () => {
    expect(WorkflowAssignmentRequestSchema.parse({ kind: "position",
      positionId: "11111111-1111-4111-8111-111111111111" }).kind).toBe("position");
    expect(WorkflowAssignmentRequestSchema.parse({ kind: "incident_participant",
      incidentId: "22222222-2222-4222-8222-222222222222",
      participantId: "33333333-3333-4333-8333-333333333333" }).kind)
      .toBe("incident_participant");
    expect(() => WorkflowAssignmentRequestSchema.parse({ kind: "incident_participant",
      participantId: "33333333-3333-4333-8333-333333333333" })).toThrow();
  });
});
