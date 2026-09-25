// @vitest-environment jsdom
import { BoardWorkflowSchema, type BoardTemplate } from "@openeoc/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "../../app/api/client.js";
import { RecordWorkflowPanel, type RecordWorkflowSource } from "../RecordWorkflow.js";
import {
  historyAction,
  historyNote,
  workflowPanelModel,
  type RecordWorkflow,
  type WorkflowHistoryEvent,
} from "../workflow.js";

afterEach(cleanup);

const definition = BoardWorkflowSchema.parse({
  initialState: "submitted",
  states: [
    { key: "submitted", label: "Submitted" },
    { key: "released", label: "Released" },
    { key: "closed", label: "Closed", terminal: true },
  ],
  transitions: [
    {
      key: "release",
      label: "Release request",
      from: "submitted",
      to: "released",
      allowedActors: ["writer"],
      approvals: [{ key: "chief", label: "Chief review", approver: { kind: "jurisdiction_admin" }, count: 2 }],
      due: { kind: "record_field", field: "due_by" },
      escalations: [{ key: "late_release", afterMinutes: 10, repeatEveryMinutes: 10, maxOccurrences: 3 }],
    },
    {
      key: "route",
      label: "Route request",
      from: "submitted",
      to: "released",
      allowedActors: ["writer"],
      assignment: { required: true, allowedTargets: ["position"] },
    },
    { key: "close", label: "Close request", from: "released", to: "closed", allowedActors: ["writer"] },
  ],
});

let sequence = 0;
function event(partial: Partial<WorkflowHistoryEvent> & Pick<WorkflowHistoryEvent, "eventKind" | "eventKey">): WorkflowHistoryEvent {
  sequence += 1;
  return {
    id: `history-${sequence}`,
    sequence,
    stateRevision: 1,
    fromState: "submitted",
    toState: "released",
    actorPersonId: "member",
    actorPositionId: null,
    actorParticipationId: null,
    detail: {},
    createdAt: "2026-09-23T10:00:00.000Z",
    ...partial,
  };
}

const pendingRuntime: RecordWorkflow = {
  recordId: "record-1",
  state: "submitted",
  stateRevision: 0,
  pendingTransition: "release",
  dueAt: null,
  dueStatus: "none",
  assignment: null,
  pinnedTemplateVersion: 1,
  history: [
    event({ eventKind: "transition_requested", eventKey: "release" }),
    event({ eventKind: "approval_recorded", eventKey: "chief", actorPersonId: "admin", detail: { transitionKey: "release" } }),
    event({ eventKind: "approval_recorded", eventKey: "chief", actorPersonId: "admin", detail: { transitionKey: "release" } }),
    // An approval from an earlier request cycle does not count toward this one.
    event({ eventKind: "approval_recorded", eventKey: "chief", actorPersonId: "old", stateRevision: 0, detail: { transitionKey: "release" } }),
  ],
};

const releasedRuntime: RecordWorkflow = {
  recordId: "record-1",
  state: "released",
  stateRevision: 1,
  pendingTransition: null,
  dueAt: "2026-09-23T09:00:00.000Z",
  dueStatus: "scheduled",
  assignment: null,
  pinnedTemplateVersion: 1,
  history: [
    event({ eventKind: "transition_requested", eventKey: "release" }),
    event({ eventKind: "approval_recorded", eventKey: "chief", actorPersonId: "admin", detail: { transitionKey: "release" } }),
    event({ eventKind: "transition_completed", eventKey: "release", actorPersonId: "admin",
      detail: { dueAt: "2026-09-23T09:00:00.000Z", dueStatus: "scheduled", assignment: null } }),
    event({ eventKind: "escalation", eventKey: "late_release:0", fromState: "released", actorPersonId: "admin",
      detail: { scheduledAt: "2026-09-23T10:10:00.000Z" } }),
  ],
};

describe("workflow panel model", () => {
  it("counts distinct approvers for the pending request and offers no transition meanwhile", () => {
    const model = workflowPanelModel(definition, pendingRuntime, new Date("2026-09-23T10:05:00.000Z"));
    expect(model.stateLabel).toBe("Submitted");
    expect(model.pending?.transition.key).toBe("release");
    expect(model.pending?.requestedBy).toBe("member");
    expect(model.pending?.approvals[0]?.approvedBy).toEqual(["admin"]);
    expect(model.transitions).toEqual([]);
    expect(model.escalations).toEqual([]);
  });

  it("offers only transitions leaving the current state, and reads due and escalation schedules", () => {
    const model = workflowPanelModel(definition, releasedRuntime, new Date("2026-09-23T10:25:00.000Z"));
    expect(model.transitions.map((transition) => transition.key)).toEqual(["close"]);
    expect(model.due).toEqual({ kind: "scheduled", at: "2026-09-23T09:00:00.000Z", overdue: true });
    expect(model.escalations.map((step) => [step.occurrence, step.escalated, step.due])).toEqual([
      [0, true, true],
      [1, false, true],
      [2, false, false],
    ]);
    const onTime = workflowPanelModel(definition, releasedRuntime, new Date("2026-09-23T08:00:00.000Z"));
    expect(onTime.due).toMatchObject({ overdue: false });
    expect(workflowPanelModel(definition, { ...releasedRuntime, dueStatus: "missing", dueAt: null }, new Date()).due)
      .toEqual({ kind: "missing" });
  });

  it("keeps the completed transition's escalations after a later request is rejected", () => {
    const later: RecordWorkflow = {
      ...releasedRuntime,
      stateRevision: 2,
      history: [
        ...releasedRuntime.history,
        event({ eventKind: "transition_requested", eventKey: "close", stateRevision: 2, fromState: "released", toState: "closed" }),
        event({ eventKind: "transition_rejected", eventKey: "close", stateRevision: 2, fromState: "released", toState: "closed",
          actorPersonId: "admin", detail: { note: "Still in use" } }),
      ],
    };
    const model = workflowPanelModel(definition, later, new Date("2026-09-23T10:25:00.000Z"));
    expect(model.pending).toBeNull();
    expect(model.transitions.map((transition) => transition.key)).toEqual(["close"]);
    expect(model.escalations.map((step) => [step.occurrence, step.escalated])).toEqual([[0, true], [1, false], [2, false]]);
    const rejected = later.history[later.history.length - 1]!;
    expect(historyAction(definition, rejected)).toBe("Rejected Close request; stays Released");
    expect(historyNote(rejected, (iso) => iso)).toBe("Still in use");
    expect(historyAction(definition, { ...rejected, eventKind: "transition_cancelled", detail: {} }))
      .toBe("Cancelled the request for Close request; stays Released");
  });

  it("describes every history event in plain words with its recorded detail", () => {
    const [requested, approved, completed, escalated] = releasedRuntime.history;
    expect(historyAction(definition, requested!)).toBe("Requested Release request: Submitted to Released");
    expect(historyAction(definition, approved!)).toBe("Approved Chief review for Release request");
    expect(historyAction(definition, completed!)).toBe("Moved Submitted to Released by Release request");
    expect(historyAction(definition, escalated!)).toBe("Escalated Late release, occurrence 1");
    expect(historyNote(completed!, (iso) => iso)).toBe("Due 2026-09-23T09:00:00.000Z");
    expect(historyNote(escalated!, (iso) => iso)).toBe("Scheduled 2026-09-23T10:10:00.000Z");
    expect(historyNote(event({ eventKind: "transition_completed", eventKey: "route",
      detail: { assignment: { kind: "position", positionId: "p", positionTitle: "Operations" } } }), (iso) => iso))
      .toBe("Assigned to Operations");
  });
});

describe("workflow client methods", () => {
  it("reads the record workflow and sends each command to its route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK", json: async () => ({}) });
    const client = new ApiClient({ fetchImpl });
    await client.recordWorkflow("board/a", "record b");
    await client.requestWorkflowTransition("board/a", "record b", {
      transitionKey: "route", assignment: { kind: "position", positionId: "p" }, idempotencyKey: "k1",
    });
    await client.approveWorkflowTransition("board/a", "record b", { transitionKey: "route", ruleKey: "chief", idempotencyKey: "k2" });
    await client.escalateWorkflow("board/a", "record b", { ruleKey: "late", occurrence: 0, idempotencyKey: "k3" });
    const base = "/api/v1/boards/board%2Fa/records/record%20b/workflow";
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, (init as RequestInit).method, (init as RequestInit).body ?? null]))
      .toEqual([
        [base, "GET", null],
        [`${base}/transitions`, "POST", JSON.stringify({ transitionKey: "route", assignment: { kind: "position", positionId: "p" }, idempotencyKey: "k1" })],
        [`${base}/approvals`, "POST", JSON.stringify({ transitionKey: "route", ruleKey: "chief", idempotencyKey: "k2" })],
        [`${base}/escalations`, "POST", JSON.stringify({ ruleKey: "late", occurrence: 0, idempotencyKey: "k3" })],
      ]);
  });
});

function source(client: Partial<ApiClient>, canAct = true): RecordWorkflowSource {
  return {
    client: client as ApiClient,
    boardId: "board-1",
    recordId: "record-1",
    templateKey: "requests",
    templateVersion: 1,
    jurisdictionId: "jurisdiction-1",
    incidentId: null,
    canAct,
    people: { member: "M. Requester", admin: "A. Approver" },
  };
}

const template = { key: "requests", version: 1, workflow: definition } as unknown as BoardTemplate;

describe("record workflow panel", () => {
  it("requests a transition with its assignee, then shows the server's refusal and pending approval", async () => {
    let runtime: RecordWorkflow = { ...pendingRuntime, pendingTransition: null, history: [] };
    const client = {
      getTemplateVersion: vi.fn().mockResolvedValue(template),
      recordWorkflow: vi.fn(async () => runtime),
      listPositions: vi.fn().mockResolvedValue([{ id: "position-1", key: "operations", title: "Operations" }]),
      listIncidentParticipants: vi.fn(),
      requestWorkflowTransition: vi.fn(async () => {
        runtime = pendingRuntime;
        return pendingRuntime;
      }),
      approveWorkflowTransition: vi.fn().mockRejectedValue(new ApiError(403, "requester cannot approve this transition")),
    };
    render(<RecordWorkflowPanel source={source(client)} />);
    const transitions = await screen.findByRole("group", { name: "Available transitions" });
    const route = within(transitions).getByRole("button", { name: "Route request" });
    expect((route as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(transitions).getByLabelText("Assign Route request to"), { target: { value: "position:position-1" } });
    expect((route as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(transitions).getByRole("button", { name: "Release request" }));
    await waitFor(() => expect(client.requestWorkflowTransition).toHaveBeenCalledWith("board-1", "record-1",
      expect.objectContaining({ transitionKey: "release", idempotencyKey: expect.any(String) })));
    expect(client.listIncidentParticipants).not.toHaveBeenCalled();

    const pending = await screen.findByRole("group", { name: "Awaiting approval" });
    expect(pending.textContent).toContain("requested by M. Requester");
    expect(pending.textContent).toContain("Chief review: 1 of 2 from Organization administrator, approved by A. Approver");
    fireEvent.click(within(pending).getByRole("button", { name: "Approve Chief review" }));
    expect((await screen.findByRole("alert")).textContent).toBe("requester cannot approve this transition");
  });

  it("shows overdue, due escalations and a read-only history, with no actions for a reader", async () => {
    const client = {
      getTemplateVersion: vi.fn().mockResolvedValue(template),
      recordWorkflow: vi.fn().mockResolvedValue(releasedRuntime),
      listPositions: vi.fn().mockRejectedValue(new ApiError(403, "forbidden")),
    };
    render(<RecordWorkflowPanel source={source(client, false)} />);
    await screen.findByText("Overdue");
    expect(screen.getByText("Released")).toBeTruthy();
    expect(screen.getByText(/Late release, occurrence 1: escalated/)).toBeTruthy();
    const history = screen.getByRole("list", { name: "Workflow history" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(4);
    expect(history.textContent).toContain("A. Approver · Moved Submitted to Released by Release request");
    expect(history.querySelectorAll("button, input, select, textarea")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("holds back a transition the record does not meet the guard of, and says why", async () => {
    const guarded = BoardWorkflowSchema.parse({
      initialState: "submitted",
      states: [{ key: "submitted", label: "Submitted" }, { key: "closed", label: "Closed", terminal: true }],
      transitions: [{
        key: "close", label: "Close claim", from: "submitted", to: "closed", allowedActors: ["writer"],
        guard: { conditions: [{ field: "amount", op: "gt", value: 0 }, { field: "note", op: "is_not_empty" }] },
      }],
    });
    const client = {
      getTemplateVersion: vi.fn().mockResolvedValue({ ...template, workflow: guarded }),
      recordWorkflow: vi.fn().mockResolvedValue({ ...pendingRuntime, pendingTransition: null, history: [] }),
      listPositions: vi.fn().mockResolvedValue([]),
    };
    const fields = [
      { key: "amount", label: "Amount", type: "number" as const, required: false, read: "any" as const, write: "member" as const },
      { key: "note", label: "Reviewer note", type: "text" as const, required: false, read: "any" as const, write: "member" as const },
    ];
    const view = render(<RecordWorkflowPanel source={{ ...source(client), record: { amount: 0, note: "Seen" }, fields }} />);
    const close = await view.findByRole("button", { name: "Close claim" });
    expect((close as HTMLButtonElement).disabled).toBe(true);
    expect(close.getAttribute("aria-describedby")).toBeTruthy();
    expect(view.getByText("Not yet: Amount is more than 0")).toBeTruthy();
    cleanup();
    const ready = render(<RecordWorkflowPanel source={{ ...source(client), record: { amount: 40, note: "Seen" }, fields }} />);
    expect(((await ready.findByRole("button", { name: "Close claim" })) as HTMLButtonElement).disabled).toBe(false);
    expect(ready.queryByText(/Not yet/)).toBeNull();
  });

  it("stays out of the record detail when the board template has no workflow", async () => {
    const client = {
      getTemplateVersion: vi.fn().mockResolvedValue({ ...template, workflow: undefined }),
      recordWorkflow: vi.fn(),
    };
    const view = render(<RecordWorkflowPanel source={source(client)} />);
    await waitFor(() => expect(client.getTemplateVersion).toHaveBeenCalled());
    expect(client.recordWorkflow).not.toHaveBeenCalled();
    expect(view.container.textContent).toBe("");
  });
});
