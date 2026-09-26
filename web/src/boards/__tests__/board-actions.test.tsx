// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardTemplateSchema, type BoardActionRun, type BoardTemplate, type FieldDef } from "@openeoc/shared";
import type { ApiClient, BoardRecordChange } from "../../app/api/client.js";
import { Designer } from "../Designer.js";
import { RecordHistory } from "../RecordHistory.js";

afterEach(cleanup);

const reports = BoardTemplateSchema.parse({
  key: "damage_reports",
  version: 1,
  title: "Damage reports",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "status", label: "Status", type: "enum", values: ["new", "confirmed"] },
    { key: "confirmed_at", label: "Confirmed at", type: "datetime" },
    { key: "cost", label: "Cost", type: "number" },
  ],
  views: [{ key: "all", title: "All", columns: ["summary"] }],
  workflow: {
    initialState: "draft",
    states: [{ key: "draft", label: "Draft" }, { key: "review", label: "In review" }],
    transitions: [{ key: "send_review", label: "Send for review", from: "draft", to: "review", allowedActors: ["writer"] }],
  },
});

const followUps = BoardTemplateSchema.parse({
  key: "follow_ups",
  version: 1,
  title: "Follow-ups",
  fields: [
    { key: "task", label: "Task", type: "text" },
    { key: "report", label: "Report", type: "record_ref", targetBoardKey: "damage_reports", labelField: "summary" },
  ],
  views: [{ key: "all", title: "All", columns: ["task"] }],
});

function client(): ApiClient {
  return {
    listTemplates: vi.fn().mockResolvedValue([
      { key: "damage_reports", version: 1, title: "Damage reports" },
      { key: "follow_ups", version: 1, title: "Follow-ups" },
    ]),
    getTemplateVersion: vi.fn().mockResolvedValue(followUps),
  } as unknown as ApiClient;
}

const change = (label: string, value: string, scope: HTMLElement = document.body) =>
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });

describe("board actions in the designer (VC-17)", () => {
  it("writes each step of the catalog with structured controls and publishes them", async () => {
    const onSave = vi.fn();
    const view = render(<Designer base={reports} positions={[{ key: "planning", title: "Planning Chief" }]}
      client={client()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Actions" }));
    expect(screen.getByText("This board has no actions.")).toBeTruthy();

    // Set a field when another changes, under a condition.
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    change("Action 1 label", "Stamp the confirmation");
    change("Action 1 runs when", "field_changed");
    change("Action 1 field that changes", "status");
    const conditions = screen.getByRole("group", { name: "Conditions for action 1" });
    fireEvent.click(within(conditions).getByLabelText("Run only when conditions on the record hold"));
    change("Condition 1 field", "status", conditions);
    change("Condition 1 operator", "eq", conditions);
    expect(within(conditions).getByRole("status").textContent)
      .toBe("Condition 1 is left out of the action's conditions until its value is complete.");
    change("Condition 1 value", "confirmed", conditions);
    change("Action 1 does", "set_field");
    change("Action 1 field to set", "confirmed_at");
    expect((screen.getByLabelText("Action 1 value") as HTMLSelectElement).value).toBe("now");

    // Create a linked record on another board, choosing its board, reference and copied field.
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    change("Action 2 does", "create_record");
    fireEvent.change(await screen.findByRole("combobox", { name: "Action 2 board to add the record to" }),
      { target: { value: "follow_ups" } });
    const link = await screen.findByRole("combobox", { name: "Action 2 reference back to this record" });
    fireEvent.change(link, { target: { value: "report" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy a field into the new record" }));
    expect((screen.getByLabelText("Action 2 copy 1 into") as HTMLSelectElement).value).toBe("task");
    change("Action 2 copy 1 from", "summary");

    // Notify a position when the record enters a state.
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    change("Action 3 runs when", "state_entered");
    change("Action 3 state entered", "review");
    change("Action 3 notifies", "position:planning");
    change("Action 3 message", "A report is ready for review.");

    // Request a transition.
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    change("Action 4 does", "transition");

    const panel = document.getElementById("board-designer-actions-panel")!;
    expect(panel.querySelectorAll("textarea, [contenteditable]")).toHaveLength(0);
    for (const input of panel.querySelectorAll("input")) expect(["text", "checkbox", "number"]).toContain(input.type);
    expect((await axe.run(view.container)).violations).toEqual([]);

    fireEvent.click(screen.getByRole("tab", { name: "Review & preview" }));
    expect(screen.getByText("4 actions configured.")).toBeTruthy();
    fireEvent.click(screen.getByText("Publish version 2"));
    const saved = onSave.mock.calls[0]![0] as BoardTemplate;
    expect(BoardTemplateSchema.safeParse(saved).success).toBe(true);
    expect(saved.actions).toEqual([
      { key: "action", label: "Stamp the confirmation", trigger: { kind: "field_changed", field: "status" },
        condition: { match: "all", conditions: [{ field: "status", op: "eq", value: "confirmed" }] },
        step: { kind: "set_field", field: "confirmed_at", value: "now" } },
      { key: "action_2", label: "New action", trigger: { kind: "record_created" },
        step: { kind: "create_record", board: "follow_ups", link: "report", mapping: [{ to: "task", from: "summary" }] } },
      { key: "action_3", label: "New action", trigger: { kind: "state_entered", state: "review" },
        step: { kind: "notify", to: { kind: "position", positionKey: "planning" }, message: "A report is ready for review." } },
      { key: "action_4", label: "New action", trigger: { kind: "record_created" },
        step: { kind: "transition", transition: "send_review" } },
    ]);
  });

  it("removes an action and keeps the rest", () => {
    const onSave = vi.fn();
    const base = { ...reports, actions: [
      { key: "one", label: "One", trigger: { kind: "record_created" as const },
        step: { kind: "notify" as const, to: { kind: "creator" as const }, message: "First" } },
      { key: "two", label: "Two", trigger: { kind: "record_created" as const },
        step: { kind: "set_field" as const, field: "cost", value: 5 } },
    ] };
    render(<Designer base={base} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Actions" }));
    expect((screen.getByLabelText("Action 2 value") as HTMLInputElement).value).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "Remove action 1" }));
    fireEvent.click(screen.getByText("Publish version 2"));
    expect((onSave.mock.calls[0]![0] as BoardTemplate).actions?.map((action) => action.key)).toEqual(["two"]);
  });
});

const fields = [
  { key: "summary", label: "Summary", type: "text" },
  { key: "status", label: "Status", type: "enum", values: ["new", "confirmed"] },
  { key: "confirmed_at", label: "Confirmed at", type: "datetime" },
  { key: "a", label: "A", type: "number" },
] as FieldDef[];

const actor = { personId: "p1", displayName: "Rae Member", positionId: null, positionTitle: null };
const run = (id: string, value: Partial<BoardActionRun> & Pick<BoardActionRun, "action" | "trigger" | "step" | "outcome">): BoardRecordChange => ({
  seq: Number(id.slice(1)), id, at: "2026-09-25T17:00:00Z", category: "board.action.run", corrects: null, actor, changes: [],
  action: null, run: { reason: null, chain: "c1", depth: 1, result: null, ...value },
});

describe("board actions in the record history", () => {
  it("names an action's write and says what each run did, or why it did not", async () => {
    const stamp = { key: "stamp", label: "Stamp the confirmation" };
    const entries: BoardRecordChange[] = [
      { seq: 1, id: "e1", at: "2026-09-25T17:00:00Z", category: "board.record.updated", corrects: null, actor,
        changes: [{ field: "confirmed_at", before: null, after: "2026-09-25T17:00:00Z" }], action: stamp, run: null },
      run("e2", { action: stamp, trigger: { kind: "field_changed", field: "status", state: null, byAction: null },
        step: "set_field", outcome: "done", result: { field: "confirmed_at" } }),
      run("e3", { action: { key: "follow_up", label: "Open a follow-up" },
        trigger: { kind: "field_changed", field: "status", state: null, byAction: null },
        step: "create_record", outcome: "done", result: { recordId: "r2", boardId: "b2", board: "Follow-ups" } }),
      run("e4", { action: { key: "rename", label: "Rename when closed" },
        trigger: { kind: "state_entered", field: null, state: "Closed", byAction: null }, step: "set_field", outcome: "refused",
        reason: "Summary cannot change while the record is Closed" }),
      run("e5", { action: { key: "ping", label: "Ping" }, trigger: { kind: "field_changed", field: "a", state: null, byAction: "Pong" },
        step: "set_field", outcome: "stopped", depth: 3, reason: "Ping already ran in this chain; running it again would loop." }),
      run("e6", { action: { key: "tell", label: "Tell planning" }, trigger: { kind: "state_entered", field: null, state: "In review", byAction: null },
        step: "notify", outcome: "done", result: { to: "Planning Chief" } }),
    ];
    const view = render(<RecordHistory load={async () => ({ entries, nextCursor: null })} fields={fields} />);
    const list = await view.findByRole("list", { name: "Record history" });
    expect(within(list).getByText("Updated by action Stamp the confirmation")).toBeTruthy();
    const lines = [...list.querySelectorAll(".board-history__run")].map((node) => node.textContent);
    expect(lines).toEqual([
      "When Status changed: set Confirmed at.",
      "When Status changed: created a linked record on Follow-ups.",
      "When the record entered Closed: refused. Summary cannot change while the record is Closed",
      "When A changed, by action Pong: stopped. Ping already ran in this chain; running it again would loop.",
      "When the record entered In review: notified Planning Chief.",
    ]);
    expect(within(list).getByText("Action: Ping")).toBeTruthy();
    expect((await axe.run(view.container)).violations).toEqual([]);
  });
});
