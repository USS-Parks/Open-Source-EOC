// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IapDisplayState, IapWorkspaceItem, IncidentTask, ResourceRequestSummary, TaskStatus } from "@openeoc/shared";
import { Theme } from "../../../design/components.js";
import { ChecklistDashboard, checklistCharts, checklists } from "../ChecklistDashboard.js";
import { IapDashboard, iapTiles } from "../IapDashboard.js";
import { RequestDashboard, requestStages, requestTiles } from "../RequestDashboard.js";

afterEach(cleanup);

const NOW = Date.parse("2026-09-26T16:42:00.000Z");
const hours = (value: number) => new Date(NOW + value * 60 * 60_000).toISOString();
const ORG = "44444444-4444-4444-8444-444444444444";

let taskNumber = 200;
function task(status: TaskStatus, assignment: "ic" | "ops" | "liaison" | null, extra: Partial<IncidentTask> = {}): IncidentTask {
  taskNumber += 1;
  const id = `00000000-0000-4000-8000-${String(taskNumber).padStart(12, "0")}`;
  const assigned = assignment === "ic"
    ? { kind: "position" as const, id: "10000000-0000-4000-8000-000000000001", title: "Incident Commander", personName: "Jordan Lee", personId: null }
    : assignment === "ops"
      ? { kind: "position" as const, id: "10000000-0000-4000-8000-000000000002", title: "Operations Section Chief", personName: null, personId: null }
      : assignment === "liaison"
        ? { kind: "incident_participant" as const, id: "10000000-0000-4000-8000-000000000003", title: "Shelter liaison", personName: "S. Patel", personId: "10000000-0000-4000-8000-000000000009" }
        : null;
  return {
    id, number: taskNumber, incidentId: "11111111-1111-4111-8111-111111111111", item: `Task ${taskNumber}`, category: "general",
    status, dueAt: null, revision: 1,
    assignment: assigned ? { ...assigned, organizationId: ORG, organizationName: "Humboldt County OES" } : null,
    dependencies: [], completedAt: null, completedBy: null, ...extra,
  };
}

// Four lists: the commander's, past due and under way; operations', not started; the liaison's, done; and one unassigned task.
const TASKS: IncidentTask[] = [
  task("open", "ic", { dueAt: hours(-1) }),
  task("open", "ic", { dueAt: hours(3) }),
  task("in_progress", "ic"),
  task("open", "ops", { dueAt: hours(5), category: "planning" }),
  task("open", "ops", { dueAt: hours(8) }),
  task("completed", "liaison", { dueAt: hours(-2), category: "planning" }),
  task("completed", "liaison", { category: "planning" }),
  task("open", null),
];

describe("checklist aggregation", () => {
  it("groups tasks into one list per position or participant, with an unassigned list", () => {
    const lists = checklists(TASKS, NOW);
    expect(lists.map((list) => [list.name, list.status, list.pastDue, list.completed, list.tasks.length])).toEqual([
      ["Incident Commander", "in_progress", true, 0, 3],
      ["Operations Section Chief", "not_started", false, 0, 2],
      ["Shelter liaison", "completed", false, 2, 2],
      ["Unassigned tasks", "not_started", false, 0, 1],
    ]);
    expect(lists[0]!.nextDue).toBe(hours(-1));
    expect(lists[1]!.holder).toBe("Vacant · Humboldt County OES");
    expect(lists[1]!.categories).toEqual(["general", "planning"]);
    // A completed task past its due time does not make its list past due.
    expect(lists[2]!.nextDue).toBeNull();
  });

  it("counts lists, pace, tasks and categories so every chart adds up to its total", () => {
    const charts = checklistCharts(TASKS, checklists(TASKS, NOW));
    const values = (data: readonly { key: string; value: number }[]) => Object.fromEntries(data.map((datum) => [datum.key, datum.value]));
    expect(values(charts.lists)).toEqual({ not_started: 2, in_progress: 1, completed: 1 });
    expect(values(charts.pace)).toEqual({ past_due: 1, on_time: 3 });
    expect(values(charts.tasks)).toEqual({ open: 5, in_progress: 1, completed: 2 });
    expect(charts.categories.map((datum) => [datum.label, datum.value])).toEqual([["General", 5], ["Planning", 3]]);
  });
});

/** The rows the list beside the charts shows. */
const rows = (name: string) => within(screen.getByRole("region", { name })).queryAllByRole("listitem");
const legendCount = (button: HTMLElement) => Number(/(\d+) \(/.exec(button.textContent ?? "")![1]);

describe("the checklist dashboard", () => {
  it("filters the list to exactly what each chip, slice and legend row counts", () => {
    render(<Theme name="dark"><ChecklistDashboard tasks={TASKS} now={NOW} onView={() => undefined} /></Theme>);
    expect(rows("Checklists")).toHaveLength(4);
    for (const [card, region] of [["Lists by status", "Checklists"], ["Pace", "Checklists"], ["Tasks by status", "Tasks"], ["Tasks by category", "Tasks"]] as const) {
      const legend = within(screen.getByRole("list", { name: `${card} legend` }));
      for (const button of legend.getAllByRole("button", { pressed: false })) {
        fireEvent.click(button);
        expect(rows(region), `${card}: ${button.textContent}`).toHaveLength(legendCount(button));
        fireEvent.click(button);
      }
    }
    const chips = within(screen.getByRole("list", { name: "Filter lists by status" }));
    for (const chip of chips.getAllByRole("button")) {
      fireEvent.click(chip);
      expect(rows("Checklists"), chip.textContent!).toHaveLength(Number(/^\d+/.exec(chip.textContent!)![0]));
      expect(chip.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(chip);
    }
    fireEvent.click(chips.getByRole("button", { name: /Past due/ }));
    expect(rows("Checklists").map((row) => within(row).getByText(/Incident Commander/, { selector: "strong" }).textContent)).toEqual(["Incident Commander"]);
    expect(screen.getByText(/Showing 1 past due lists\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(rows("Checklists")).toHaveLength(4);
  });

  it("opens the task list from VIEW with the slice's status or category, or one list", () => {
    const onView = vi.fn();
    render(<Theme name="light"><ChecklistDashboard tasks={TASKS} now={NOW} onView={onView} /></Theme>);
    fireEvent.click(within(screen.getByRole("list", { name: "Tasks by status legend" })).getByRole("button", { name: "View In progress" }));
    expect(onView).toHaveBeenLastCalledWith({ status: "in_progress" });
    fireEvent.click(within(screen.getByRole("list", { name: "Tasks by category legend" })).getByRole("button", { name: "View Planning" }));
    expect(onView).toHaveBeenLastCalledWith({ category: "planning" });
    fireEvent.click(screen.getByRole("button", { name: "View the Operations Section Chief tasks" }));
    expect(onView).toHaveBeenLastCalledWith({ assignment: { key: "10000000-0000-4000-8000-000000000002", name: "Operations Section Chief" } });
  });

  it("reads honestly with no tasks: no rings, a plain message", () => {
    render(<Theme name="dark"><ChecklistDashboard tasks={[]} now={NOW} onView={() => undefined} /></Theme>);
    expect(screen.getByText(/No checklist tasks on this incident yet/)).toBeTruthy();
    expect(document.querySelector(".eoc-donut-ring")).toBeNull();
    expect(screen.getAllByText("No lists yet")).toHaveLength(2);
  });

  for (const theme of ["light", "dark"] as const) {
    it(`passes axe (${theme})`, async () => {
      const { container } = render(<Theme name={theme}><ChecklistDashboard tasks={TASKS} now={NOW} onView={() => undefined} /></Theme>);
      expect((await axe.run(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
    });
  }
});

let planNumber = 0;
function plan(status: IapDisplayState, completed: number, extra: Partial<IapWorkspaceItem> = {}): IapWorkspaceItem {
  const required = ["ICS-202", "ICS-203", "ICS-204", "ICS-205", "ICS-206", "ICS-207", "ICS-208"];
  planNumber += 1;
  const id = `20000000-0000-4000-8000-${String(planNumber).padStart(12, "0")}`;
  return {
    id, revisionRootId: id, revisionNumber: 1, contentRevision: 1, supersedesIapId: null,
    operationalPeriod: "OP 03", period: { revision: 3, label: "OP 03", startsAt: "2026-09-26T13:00:00.000Z", endsAt: "2026-09-27T01:00:00.000Z" },
    status, formCount: completed, targetForms: 7,
    progress: {
      requiredFormIds: required, completedFormIds: required.slice(0, completed), missingFormIds: required.slice(completed),
      completed, required: 7, percent: Math.round((completed / 7) * 100),
    },
    preparedBy: "Taylor Kim",
    preparedAttribution: { organizationId: ORG, organizationName: "Humboldt County OES", roleKey: "planning_section_chief", roleLabel: "Planning Section Chief", positionId: null, participationId: null },
    submittedBy: null, submittedAt: null, approvedBy: status === "approved" || status === "complete" ? "Jordan Lee" : null,
    approvedAt: null, createdAt: "2026-09-26T13:30:00.000Z", ...extra,
  };
}

const PLANS = [plan("not_started", 0), plan("in_progress", 3), plan("in_progress", 5), plan("in_approval", 7), plan("approved", 7), plan("complete", 7)];

describe("the IAP dashboard", () => {
  it("tiles count the rows, and a tile filters the rows to its count", () => {
    expect(iapTiles(PLANS).map((tile) => tile.value)).toEqual([1, 2, 1, 1, 1]);
    const onOpen = vi.fn();
    render(<Theme name="dark"><IapDashboard items={PLANS} scope="All plans, every operational period" onOpen={onOpen} /></Theme>);
    expect(rows("Plans")).toHaveLength(6);
    const tiles = within(screen.getByRole("list", { name: "Plans by status" }));
    for (const tile of tiles.getAllByRole("button")) {
      fireEvent.click(tile);
      expect(rows("Plans"), tile.textContent!).toHaveLength(Number(/^\d+/.exec(tile.textContent!)![0]));
      fireEvent.click(tile);
    }
    fireEvent.click(tiles.getByRole("button", { name: /In progress/ }));
    const first = rows("Plans")[0]!;
    expect(within(first).getByRole("progressbar", { name: "OP 03 forms in the plan" }).getAttribute("aria-valuetext")).toBe("3 of 7, 42%");
    expect(within(first).getByText("Planning Section Chief")).toBeTruthy();
    expect(within(first).getByText("Not approved")).toBeTruthy();
    fireEvent.click(within(first).getByRole("button", { name: "Open OP 03, revision 1" }));
    expect(onOpen).toHaveBeenCalledWith(PLANS[1]!.id);
  });

  it("reads honestly with no plans", () => {
    render(<Theme name="light"><IapDashboard items={[]} scope="All plans" onOpen={() => undefined} /></Theme>);
    expect(screen.getByText(/No plans in this view yet/)).toBeTruthy();
    expect(iapTiles([]).every((tile) => tile.value === 0)).toBe(true);
  });

  for (const theme of ["light", "dark"] as const) {
    it(`passes axe (${theme})`, async () => {
      const { container } = render(<Theme name={theme}><IapDashboard items={PLANS} scope="All plans" onOpen={() => undefined} /></Theme>);
      expect((await axe.run(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
    });
  }
});

let requestNumber = 1020;
function request(state: string, extra: Partial<ResourceRequestSummary> = {}): ResourceRequestSummary {
  requestNumber += 1;
  return {
    id: `30000000-0000-4000-8000-${String(requestNumber).padStart(12, "0")}`, number: requestNumber,
    incidentId: "11111111-1111-4111-8111-111111111111", item: `Request ${requestNumber}`, quantity: 1, priority: "priority", state,
    receivingOrganization: { id: ORG, name: "Humboldt County OES" }, supplyingOrganization: null, assignment: null,
    resourceKind: null, resourceType: null, costCents: null, neededBy: null, notes: null,
    createdAt: hours(-30), updatedAt: hours(-30), requestedByName: "Jordan Lee", acceptance: null, ...extra,
  };
}

const REQUESTS = [
  request("submitted", { createdAt: hours(-2), updatedAt: hours(-2), neededBy: hours(-1) }),
  request("accepted", { neededBy: hours(4) }),
  request("triaged"),
  request("deployed", { neededBy: hours(-3), costCents: 120_000 }),
  request("closed", { updatedAt: hours(-5), costCents: 30_050 }),
  request("cancelled", { updatedAt: hours(-40), neededBy: hours(-50) }),
];

describe("the requests dashboard", () => {
  it("counts each tile by its rule and filters the list to that count", () => {
    const values = Object.fromEntries(requestTiles(REQUESTS, NOW).map((tile) => [tile.key, tile.value]));
    expect(values).toEqual({ active: 4, ended: 2, all: 6, deployed: 1, new_24h: 1, ended_24h: 1, overdue: 2 });
    expect(requestStages(REQUESTS).filter((stage) => stage.value).map((stage) => [stage.label, stage.value])).toEqual([
      ["Received", 1], ["Accepted", 2], ["In progress", 1], ["Closed", 1], ["Cancelled", 1],
    ]);
    const onOpen = vi.fn();
    render(<Theme name="dark"><RequestDashboard requests={REQUESTS} now={NOW} onOpen={onOpen} /></Theme>);
    expect(rows("Requests")).toHaveLength(6);
    for (const tile of within(screen.getByRole("list", { name: "Requests by count" })).getAllByRole("button")) {
      fireEvent.click(tile);
      expect(rows("Requests"), tile.textContent!).toHaveLength(Number(/^\d+/.exec(tile.textContent!)![0]));
      fireEvent.click(tile);
    }
    for (const bar of within(screen.getByRole("article", { name: "Requests by stage" })).getAllByRole("button", { pressed: false })) {
      fireEvent.click(bar);
      expect(rows("Requests"), bar.getAttribute("aria-label")!).toHaveLength(Number(/(\d+)$/.exec(bar.getAttribute("aria-label")!)![1]));
      fireEvent.click(bar);
    }
    fireEvent.click(screen.getByRole("button", { name: /\$1,501 Recorded cost/ }));
    expect(rows("Requests")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Overdue/ }));
    expect(rows("Requests").map((row) => within(row).getByText("Overdue").textContent)).toHaveLength(2);
    fireEvent.click(within(rows("Requests")[0]!).getByRole("button", { name: /^Open REQ-/ }));
    expect(onOpen).toHaveBeenCalledWith(REQUESTS[0]!.id);
  });

  it("shows no cost tile without costs and reads honestly with no requests", () => {
    render(<Theme name="light"><RequestDashboard requests={[]} now={NOW} onOpen={() => undefined} /></Theme>);
    expect(screen.queryByRole("button", { name: /Recorded cost/ })).toBeNull();
    expect(screen.getByText("No resource requests on this incident yet.")).toBeTruthy();
    expect(screen.getByText("No requests yet")).toBeTruthy();
  });

  for (const theme of ["light", "dark"] as const) {
    it(`passes axe (${theme})`, async () => {
      const { container } = render(<Theme name={theme}><RequestDashboard requests={REQUESTS} now={NOW} onOpen={() => undefined} /></Theme>);
      expect((await axe.run(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
    });
  }
});
