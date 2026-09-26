// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyView, BoardTemplateSchema, type BoardTemplate } from "@openeoc/shared";
import { Designer } from "../Designer.js";
import { NO_REFINEMENT, refinedView, refinementQuery, ViewRefineControls } from "../ViewRefine.js";

/**
 * The condition editor and every view option in the designer (VC-18): all or
 * any, one level of groups, day and text operators and the time zone days
 * count in, built with selects, checkboxes and plain inputs only.
 */

afterEach(cleanup);

const claims = BoardTemplateSchema.parse({
  key: "claims",
  version: 1,
  title: "Claims",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "priority", label: "Priority", type: "enum", values: ["low", "high"] },
    { key: "amount", label: "Amount", type: "number" },
    { key: "due", label: "Due", type: "datetime" },
  ],
  views: [{ key: "all", title: "All", columns: ["summary", "priority"] }],
  workflow: {
    initialState: "open",
    states: [{ key: "open", label: "Open" }, { key: "closed", label: "Closed" }],
    transitions: [{ key: "close", label: "Close", from: "open", to: "closed", allowedActors: ["writer"] }],
  },
});

const change = (label: string, value: string, scope: HTMLElement = document.body) =>
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
const click = (name: string, scope: HTMLElement = document.body) =>
  fireEvent.click(within(scope).getByRole("button", { name }));

describe("every view option in the designer", () => {
  it("sets columns and their order, any-of conditions with a group and a day, the time zone, sorts and a group field", async () => {
    const onSave = vi.fn();
    const view = render(<Designer base={claims} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Views" }));
    fireEvent.click(screen.getByText("all: 2 columns"));
    change("all view title", "Due soon");
    fireEvent.click(within(screen.getByRole("group", { name: "all view columns" })).getByLabelText("Amount"));
    const order = screen.getByRole("group", { name: "all view column order" });
    expect(within(order).getAllByRole("listitem").map((item) => item.querySelector("span")!.textContent)).toEqual(["Summary", "Priority", "Amount"]);
    click("Move Amount up", order);
    expect((within(order).getByRole("button", { name: "Move Summary up" }) as HTMLButtonElement).disabled).toBe(true);

    const conditions = screen.getByRole("group", { name: "Conditions for view all" });
    click("Add condition", conditions);
    change("Condition 1 field", "due", conditions);
    expect([...(within(conditions).getByLabelText("Condition 1 operator") as HTMLSelectElement).options].map((option) => option.value))
      .toEqual(["after", "before", "on", "between", "within_last", "within_next", "is_empty", "is_not_empty"]);
    change("Condition 1 operator", "on", conditions);
    expect((within(conditions).getByLabelText("Condition 1 value") as HTMLSelectElement).value).toBe("today");
    change("Records shown need", "any", conditions);
    click("Add group", conditions);
    change("Group 1 condition 1 field", "priority", conditions);
    change("Group 1 condition 1 operator", "eq", conditions);
    change("Group 1 condition 1 value", "high", conditions);
    click("Add condition to group 1", conditions);
    change("Group 1 condition 2 field", "amount", conditions);
    change("Group 1 condition 2 operator", "gte", conditions);
    expect(within(conditions).getByRole("status").textContent)
      .toBe("Group 1 condition 2 is left out of the view until its value is complete.");
    change("Group 1 condition 2 value", "5", conditions);
    change("Group 1 needs", "all", conditions);
    expect((within(conditions).getByLabelText("Days counted in time zone") as HTMLSelectElement).value).toBe("America/Los_Angeles");
    change("Days counted in time zone", "America/Denver", conditions);

    const details = conditions.closest("details")!;
    click("Add sort key", details);
    change("Sort 1 field", "due", details);
    change("Sort 1 direction", "desc", details);
    change("Group by", "priority", details);
    expect([...(within(details).getByLabelText("Group by") as HTMLSelectElement).options].map((option) => option.value))
      .toEqual(["", "summary", "priority", "amount", "due"]);
    const panel = document.getElementById("board-designer-views-panel")!;
    expect(panel.querySelectorAll("textarea, [contenteditable]")).toHaveLength(0);
    expect((await axe.run(view.container)).violations).toEqual([]);

    fireEvent.click(screen.getByText("Publish version 2"));
    const saved = onSave.mock.calls[0]![0] as BoardTemplate;
    expect(BoardTemplateSchema.safeParse(saved).success).toBe(true);
    expect(saved.views[0]).toEqual({
      key: "all", title: "Due soon", kind: "list", columns: ["summary", "amount", "priority"], filter: [],
      where: [
        { field: "due", op: "on", value: "today" },
        { match: "all", conditions: [{ field: "priority", op: "eq", value: "high" }, { field: "amount", op: "gte", value: 5 }] },
      ],
      match: "any", timeZone: "America/Denver", sorts: [{ field: "due", dir: "desc" }], groupBy: "priority",
    });
  });

  it("reads a stored view back into the same controls, and clears its conditions", () => {
    const stored = BoardTemplateSchema.parse({ ...claims, views: [{ key: "all", title: "All", columns: ["summary"], match: "any",
      timeZone: "Asia/Kolkata", sort: { field: "amount", dir: "asc" },
      where: [{ field: "due", op: "between", value: ["today-7d", "2026-10-01"] }, { match: "any", conditions: [{ field: "summary", op: "eq_ignore_case", value: "Levee" }] }] }] });
    const onSave = vi.fn();
    render(<Designer base={stored} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Views" }));
    const conditions = screen.getByRole("group", { name: "Conditions for view all" });
    expect((within(conditions).getByLabelText("Records shown need") as HTMLSelectElement).value).toBe("any");
    expect((within(conditions).getByLabelText("Condition 1 value from") as HTMLSelectElement).value).toBe("days");
    expect((within(conditions).getByLabelText("Condition 1 value from, days from today (negative for earlier days)") as HTMLInputElement).value).toBe("-7");
    expect((within(conditions).getByLabelText("Condition 1 value to") as HTMLSelectElement).value).toBe("date");
    expect((within(conditions).getByLabelText("Condition 1 value to, date") as HTMLInputElement).value).toBe("2026-10-01");
    expect((within(conditions).getByLabelText("Group 1 condition 1 operator") as HTMLSelectElement).value).toBe("eq_ignore_case");
    expect((within(conditions).getByLabelText("Days counted in time zone") as HTMLSelectElement).value).toBe("Asia/Kolkata");
    expect((screen.getByLabelText("Sort 1 field") as HTMLSelectElement).value).toBe("amount");
    click("Remove condition 1", conditions);
    click("Remove group 1", conditions);
    fireEvent.click(screen.getByText("Publish version 2"));
    const saved = (onSave.mock.calls[0]![0] as BoardTemplate).views[0]!;
    expect(saved).not.toHaveProperty("where");
    expect(saved).not.toHaveProperty("match");
    expect(saved).not.toHaveProperty("timeZone");
    // An older single sort stays as it was until the sort keys are changed.
    expect(saved.sort).toEqual({ field: "amount", dir: "asc" });
  });
});

describe("the same editor for guards and actions", () => {
  it("guards a transition with a day from today and a group, and runs an action within the last days", async () => {
    const onSave = vi.fn();
    const view = render(<Designer base={claims} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Routing" }));
    const guard = screen.getByRole("group", { name: "Guard for transition 1" });
    fireEvent.click(within(guard).getByLabelText("Guard this transition with conditions on the record"));
    change("Condition 1 field", "due", guard);
    change("Condition 1 operator", "before", guard);
    change("Condition 1 value", "days", guard);
    change("Condition 1 value, days from today (negative for earlier days)", "3", guard);
    click("Add group", guard);
    change("Group 1 condition 1 operator", "eq_ignore_case", guard);
    expect(within(guard).getByRole("status").textContent)
      .toBe("Group 1 condition 1 is left out of the guard until its value is complete.");
    change("Group 1 condition 1 value", "urgent", guard);
    expect(within(guard).queryByRole("status")).toBeNull();
    expect((await axe.run(view.container)).violations).toEqual([]);

    fireEvent.click(screen.getByRole("tab", { name: "Actions" }));
    click("Add action");
    const conditions = screen.getByRole("group", { name: "Conditions for action 1" });
    fireEvent.click(within(conditions).getByLabelText("Run only when conditions on the record hold"));
    change("Condition 1 field", "due", conditions);
    change("Condition 1 operator", "within_last", conditions);
    expect((within(conditions).getByLabelText("Condition 1 value, number of days") as HTMLInputElement).value).toBe("7");
    change("Condition 1 value, number of days", "3", conditions);
    // A rolling window counts no calendar days, so it needs no time zone.
    expect(within(conditions).queryByLabelText("Days counted in time zone")).toBeNull();
    expect((await axe.run(view.container)).violations).toEqual([]);

    fireEvent.click(screen.getByText("Publish version 2"));
    const saved = onSave.mock.calls[0]![0] as BoardTemplate;
    expect(BoardTemplateSchema.safeParse(saved).success).toBe(true);
    expect(saved.workflow?.transitions[0]?.guard).toEqual({
      match: "all", timeZone: "America/Los_Angeles",
      conditions: [
        { field: "due", op: "before", value: "today+3d" },
        { match: "any", conditions: [{ field: "summary", op: "eq_ignore_case", value: "urgent" }] },
      ],
    });
    expect(saved.actions?.[0]?.condition).toEqual({ match: "all", conditions: [{ field: "due", op: "within_last", value: 3 }] });
  });
});

describe("an operator's refinement", () => {
  it("matches any condition and counts days in the viewer's time zone, the same in the browser as on the server", async () => {
    const onApply = vi.fn();
    const view = render(<ViewRefineControls fields={claims.fields} value={NO_REFINEMENT} onApply={onApply} anyOf />);
    click("Add condition");
    change("Condition 1 field", "due");
    change("Condition 1 operator", "on");
    click("Add condition");
    change("Condition 2 field", "summary");
    change("Condition 2 operator", "eq_ignore_case");
    change("Condition 2 value", "levee");
    change("Records need", "any");
    expect(screen.queryByRole("button", { name: "Add group" })).toBeNull();
    expect((await axe.run(view.container)).violations).toEqual([]);
    click("Apply");
    const applied = onApply.mock.calls[0]![0];
    expect(applied).toEqual({
      where: [{ field: "due", op: "on", value: "today" }, { field: "summary", op: "eq_ignore_case", value: "levee" }],
      match: "any", timeZone: "America/Los_Angeles", sorts: [], groupBy: null, archived: "exclude",
    });
    expect(refinementQuery(applied).where).toEqual([{ match: "any", timeZone: "America/Los_Angeles", conditions: applied.where }]);
    const own = { ...claims.views[0]!, where: [{ field: "priority", op: "eq" as const, value: "high" }] };
    const refined = refinedView(own, applied);
    expect(refined.where).toEqual([{ match: "all", conditions: own.where }, ...refinementQuery(applied).where!]);
    // 06:30 UTC is 23:30 the day before in Los Angeles.
    const now = new Date("2026-09-25T06:30:00Z");
    const rows = [
      { id: "a", priority: "high", summary: "x", due: "2026-09-24T23:00:00Z" },
      { id: "b", priority: "high", summary: "LEVEE", due: "2026-09-20T00:00:00Z" },
      { id: "c", priority: "high", summary: "x", due: "2026-09-25T07:00:00Z" },
      { id: "d", priority: "low", summary: "levee" },
    ];
    expect(applyView(refined, rows, { now }).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("leaves any-of and days out of a report's all-of list", () => {
    render(<ViewRefineControls fields={claims.fields} value={NO_REFINEMENT} onApply={vi.fn()} />);
    click("Add condition");
    change("Condition 1 field", "due");
    expect([...(screen.getByLabelText("Condition 1 operator") as HTMLSelectElement).options].map((option) => option.value)).not.toContain("on");
    expect([...(screen.getByLabelText("Condition 1 value") as HTMLSelectElement).options].map((option) => option.value)).not.toContain("today");
    expect(screen.queryByLabelText("Records need")).toBeNull();
  });
});
