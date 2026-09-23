// @vitest-environment jsdom
import { useState } from "react";
import { STANDARD_TEMPLATES, type BoardWorkflow, type ViewRecord } from "@openeoc/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoardModeBody,
  BoardModeControls,
  calendarDays,
  calendarRange,
  CountChart,
  dayKey,
  initialModeState,
  isWorkflowStateField,
  modeQuery,
  placeRecords,
  shiftAnchor,
  valueColumns,
  type BoardModeBodyProps,
  type BoardModeState,
} from "../BoardModes.js";

afterEach(cleanup);

const roads = STANDARD_TEMPLATES.find((template) => template.key === "road_closures")!;
const status = roads.fields.find((field) => field.key === "status")!;
const records: ViewRecord[] = [
  { id: "r1", road: "SR-96", reason: "Debris", status: "closed", reopen_estimate: "2026-09-21T02:30:00.000Z" },
  { id: "r2", road: "US-101", reason: "Wind", status: "closed" },
  { id: "r3", road: "Bald Hills", reason: "Fire", status: "one_lane", reopen_estimate: "2026-09-22T18:00:00.000Z" },
];
const state = (patch: Partial<BoardModeState>): BoardModeState => ({ ...initialModeState(new Date("2026-09-23T12:00:00Z")), ...patch });

describe("board view modes", () => {
  it("adds the group field for kanban and chart, and the calendar's range as a between condition", () => {
    const base = { incidentId: "i1", where: [{ field: "road", op: "contains" as const, value: "SR" }] };
    expect(modeQuery(base, state({ mode: "list" }), roads.fields)).toBe(base);
    expect(modeQuery(base, state({ mode: "kanban" }), roads.fields)).toEqual({ ...base, groupBy: "status" });
    // Chart counts by any groupable field; a geometry field does not fit and falls back to the first enum.
    expect(modeQuery(base, state({ mode: "chart", field: "reason" }), roads.fields).groupBy).toBe("reason");
    expect(modeQuery(base, state({ mode: "chart", field: "location" }), roads.fields).groupBy).toBe("status");
    const calendar = modeQuery(base, state({ mode: "calendar", span: "week", anchor: "2026-09-23" }), roads.fields);
    const range = calendarRange("week", "2026-09-23");
    expect(range).toEqual({
      from: new Date(2026, 8, 20).toISOString(),
      to: new Date(new Date(2026, 8, 27).getTime() - 1).toISOString(),
    });
    expect(calendar).toEqual({
      ...base,
      where: [...base.where, { field: "reopen_estimate", op: "between", value: [range.from, range.to] }],
      sorts: [{ field: "reopen_estimate", dir: "asc" }],
    });
  });

  it("assigns records to columns in the enum's order with the server's counts", () => {
    const columns = valueColumns(status, [...records, { id: "r4", road: "Old road", status: "washed_out" }, { id: "r5", road: "Blank" }],
      [{ value: "closed", count: 7 }, { value: "one_lane", count: 1 }, { value: "washed_out", count: 1 }, { value: null, count: 1 }]);
    expect(columns.map((column) => [column.value, column.label, column.count, column.records.map((record) => record.id)])).toEqual([
      ["closed", "Closed", 7, ["r1", "r2"]],
      ["one_lane", "One lane", 1, ["r3"]],
      ["reopened", "Reopened", 0, []],
      ["washed_out", "Washed out", 1, ["r4"]],
      [null, "No value", 1, ["r5"]],
    ]);
    // Without the server's groups the counts are the loaded records.
    expect(valueColumns(status, records).map((column) => column.count)).toEqual([2, 1, 0]);
  });

  it("places a record on the day its time falls on in the viewer's timezone", () => {
    const at = (timeZone: string) => [...placeRecords(records, "reopen_estimate", timeZone)]
      .map(([day, list]) => [day, list.map((record) => record.id)]);
    expect(at("UTC")).toEqual([["2026-09-21", ["r1"]], ["2026-09-22", ["r3"]]]);
    expect(at("America/Los_Angeles")).toEqual([["2026-09-20", ["r1"]], ["2026-09-22", ["r3"]]]);
    expect(at("Asia/Tokyo")).toEqual([["2026-09-21", ["r1"]], ["2026-09-23", ["r3"]]]);
    expect(dayKey("2026-12-31T23:30:00-08:00", "Pacific/Auckland")).toBe("2027-01-01");
  });

  it("lays out whole weeks for a month and pages by month or week", () => {
    const month = calendarDays("month", "2026-09-23");
    expect([month.length, month[0], month.at(-1)]).toEqual([35, "2026-08-30", "2026-10-03"]);
    expect(calendarDays("month", "2026-08-05").length).toBe(42);
    expect(calendarDays("week", "2026-09-23")).toEqual([
      "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26",
    ]);
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-01");
    expect(shiftAnchor("week", "2026-09-23", 1)).toBe("2026-09-30");
  });

  it("charts the server's counts as bars with the same numbers in a table", () => {
    render(<CountChart field={status} groups={[{ value: "closed", count: 3 }, { value: "one_lane", count: 1 }]} />);
    const chart = screen.getByRole("figure", { name: "Records by Status" });
    expect(within(chart).getByText("4 in total")).toBeTruthy();
    const bars = chart.querySelectorAll(".board-chart__bars li");
    expect([...bars].map((bar) => bar.getAttribute("title"))).toEqual([
      "Closed: 3 records, 75%", "One lane: 1 records, 25%", "Reopened: 0 records, 0%",
    ]);
    expect((bars[0]!.querySelector(".board-chart__bar") as HTMLElement).style.width).toBe("100%");
    expect((bars[2]!.querySelector(".board-chart__bar") as HTMLElement).style.width).toBe("0%");
    const rows = within(screen.getByRole("table")).getAllByRole("row").map((row) => row.textContent);
    expect(rows).toEqual(["StatusRecordsShare", "Closed375%", "One lane125%", "Reopened00%"]);
  });

  it("switches modes and offers only the fields that fit", () => {
    function Controls() {
      const [value, setValue] = useState(state({}));
      return <><BoardModeControls value={value} fields={roads.fields} onChange={setValue} /><output>{JSON.stringify(value)}</output></>;
    }
    render(<Controls />);
    expect(screen.queryByLabelText("Columns from")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(screen.getByRole("button", { name: "Kanban" }).getAttribute("aria-pressed")).toBe("true");
    expect([...(screen.getByLabelText("Columns from") as HTMLSelectElement).options].map((option) => option.value)).toEqual(["status"]);
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect([...(screen.getByLabelText("Dates from") as HTMLSelectElement).options].map((option) => option.value)).toEqual(["reopen_estimate"]);
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    expect([...(screen.getByLabelText("Count by") as HTMLSelectElement).options].map((option) => option.value))
      .toEqual(["status", "road", "reason", "reopen_estimate"]);
  });

  it("draws each dated record on its day and pages the range", () => {
    const onChange = vi.fn();
    render(<BoardModeBody state={state({ mode: "calendar" })} onChange={onChange} fields={roads.fields}
      columns={["road", "status"]} records={records} groups={null} loading={false} error={null} canWrite
      workflow={null} onMove={vi.fn()} onSelectRecord={vi.fn()} selectedRecordId={null} />);
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeTruthy();
    for (const record of [records[0]!, records[2]!]) {
      const day = document.querySelector(`li[data-day="${dayKey(String(record.reopen_estimate))}"]`)!;
      expect(within(day as HTMLElement).getByRole("button", { name: new RegExp(`${String(record.road)}$`) })).toBeTruthy();
    }
    expect(document.querySelectorAll(".board-calendar__grid li li")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ anchor: "2026-10-01" }));
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ span: "week" }));
  });
});

describe("kanban moves", () => {
  const transfer = () => ({ setData: vi.fn(), effectAllowed: "", dropEffect: "" });
  function kanban(patch: Partial<BoardModeBodyProps>) {
    const props: BoardModeBodyProps = {
      state: state({ mode: "kanban" }), onChange: vi.fn(), fields: roads.fields, columns: ["road", "reason", "status"],
      records, groups: [{ value: "closed", count: 2 }, { value: "one_lane", count: 1 }], loading: false, error: null,
      canWrite: true, workflow: null, onMove: vi.fn(async () => undefined), onSelectRecord: vi.fn(), selectedRecordId: null,
      ...patch,
    };
    render(<BoardModeBody {...props} />);
    return props;
  }
  const column = (name: string) => screen.getByRole("heading", { name: new RegExp(`^${name}`) }).closest("section")!;
  const card = (road: string) => screen.getByRole("button", { name: road }).closest("li")!;

  it("moves a dragged card through the update path", async () => {
    const props = kanban({});
    expect(within(column("Closed")).getByLabelText("2 records")).toBeTruthy();
    expect(card("SR-96").textContent).toContain("Reason: Debris");
    fireEvent.dragStart(card("SR-96"), { dataTransfer: transfer() });
    fireEvent.dragOver(column("Reopened"), { dataTransfer: transfer() });
    fireEvent.drop(column("Reopened"), { dataTransfer: transfer() });
    await waitFor(() => expect(props.onMove).toHaveBeenCalledWith("r1", "status", "reopened"));
    await waitFor(() => expect(card("SR-96").getAttribute("aria-busy")).toBeNull());
    // A drop back on its own column is not a move; the keyboard path moves too.
    fireEvent.dragStart(card("US-101"), { dataTransfer: transfer() });
    fireEvent.drop(column("Closed"), { dataTransfer: transfer() });
    fireEvent.change(screen.getByLabelText("Move Bald Hills to"), { target: { value: "closed" } });
    await waitFor(() => expect(props.onMove).toHaveBeenLastCalledWith("r3", "status", "closed"));
    expect(props.onMove).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "SR-96" }));
    expect(props.onSelectRecord).toHaveBeenCalledWith("r1");
  });

  it("shows the server's refusal and leaves the card where it was", async () => {
    kanban({ onMove: vi.fn(async () => { throw new Error("record edit rule does not admit this change"); }) });
    fireEvent.dragStart(card("SR-96"), { dataTransfer: transfer() });
    fireEvent.drop(column("One lane"), { dataTransfer: transfer() });
    expect((await screen.findByRole("alert")).textContent).toBe("The card was not moved. record edit rule does not admit this change");
    expect(within(column("Closed")).getByRole("button", { name: "SR-96" })).toBeTruthy();
  });

  it("does not move cards for a reader or while the workflow is unknown", () => {
    const reader = kanban({ canWrite: false });
    expect(screen.getByRole("note").textContent).toMatch(/read this board but not change it/);
    expect(card("SR-96").getAttribute("draggable")).toBe("false");
    expect(screen.queryByLabelText("Move SR-96 to")).toBeNull();
    fireEvent.dragStart(card("SR-96"), { dataTransfer: transfer() });
    fireEvent.drop(column("Reopened"), { dataTransfer: transfer() });
    expect(reader.onMove).not.toHaveBeenCalled();
    cleanup();
    kanban({ workflow: undefined });
    expect(card("SR-96").getAttribute("draggable")).toBe("false");
  });

  it("keeps a workflow state field to the workflow section", () => {
    const workflow = {
      initialState: "closed",
      states: ["closed", "one_lane", "reopened"].map((key) => ({ key, label: key, terminal: false })),
      transitions: [],
    } as unknown as BoardWorkflow;
    expect(isWorkflowStateField(status, workflow)).toBe(true);
    expect(isWorkflowStateField(status, { ...workflow, states: [...workflow.states, { key: "detour", label: "Detour", terminal: false }] })).toBe(false);
    const props = kanban({ workflow });
    expect(screen.getByRole("note").textContent).toMatch(/follows the board's workflow.*Workflow section/);
    expect(card("SR-96").getAttribute("draggable")).toBe("false");
    fireEvent.dragStart(card("SR-96"), { dataTransfer: transfer() });
    fireEvent.drop(column("Reopened"), { dataTransfer: transfer() });
    expect(props.onMove).not.toHaveBeenCalled();
  });
});
