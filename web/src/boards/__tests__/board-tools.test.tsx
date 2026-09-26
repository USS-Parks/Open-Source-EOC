// @vitest-environment jsdom
import axe from "axe-core";
import { STANDARD_TEMPLATES } from "@openeoc/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardImportResult, BoardRecordDetailResponse } from "../../app/api/client.js";
import { BoardRecordDetailPane, type BoardRecordContext } from "../../app/surfaces/BoardSurface.js";
import { BoardImport } from "../BoardImport.js";
import { RecordHistory } from "../RecordHistory.js";
import {
  GroupCounts,
  NO_REFINEMENT,
  refinedView,
  refinementQuery,
  ViewRefineControls,
} from "../ViewRefine.js";

afterEach(cleanup);

const roads = STANDARD_TEMPLATES.find((template) => template.key === "road_closures")!;
const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("board view refinement", () => {
  it("builds conditions over the operators for each field type and refuses an incomplete one", () => {
    const onApply = vi.fn();
    render(<ViewRefineControls fields={roads.fields} value={NO_REFINEMENT} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    expect([...(screen.getByLabelText("Condition 1 field") as HTMLSelectElement).options].map((option) => option.value))
      .toEqual(["road", "reason", "status", "reopen_estimate"]);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert").textContent).toBe("Condition 1 needs a complete value.");
    expect(onApply).not.toHaveBeenCalled();
    set("Condition 1 value", "SR");

    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    set("Condition 2 field", "status");
    set("Condition 2 operator", "in");
    const choices = screen.getByRole("group", { name: "Condition 2 value" });
    fireEvent.click(within(choices).getByLabelText("closed"));
    fireEvent.click(within(choices).getByLabelText("one_lane"));

    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    set("Condition 3 field", "reopen_estimate");
    expect([...(screen.getByLabelText("Condition 3 operator") as HTMLSelectElement).options].map((option) => option.value))
      .toEqual(["after", "before", "between", "within_last", "within_next", "is_empty", "is_not_empty"]);
    set("Condition 3 operator", "between");
    set("Condition 3 value from", "now-7d");

    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    set("Condition 4 field", "reason");
    set("Condition 4 operator", "is_empty");
    expect(screen.queryByLabelText("Condition 4 value")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({
      where: [
        { field: "road", op: "contains", value: "SR" },
        { field: "status", op: "in", value: ["closed", "one_lane"] },
        { field: "reopen_estimate", op: "between", value: ["now-7d", "now"] },
        { field: "reason", op: "is_empty" },
      ],
      sorts: [], groupBy: null, archived: "exclude",
    });
  });

  it("sends a specific time as an instant with its offset", () => {
    const onApply = vi.fn();
    render(<ViewRefineControls fields={roads.fields} value={NO_REFINEMENT} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    set("Condition 1 field", "reopen_estimate");
    set("Condition 1 value", "specific");
    set("Condition 1 value, specific time", "2026-09-21T08:30");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply.mock.calls[0]![0].where).toEqual([
      { field: "reopen_estimate", op: "after", value: new Date("2026-09-21T08:30").toISOString() },
    ]);
  });

  it("orders by several sort keys, groups by a field and includes archived records", () => {
    const onApply = vi.fn();
    render(<ViewRefineControls fields={roads.fields} value={NO_REFINEMENT} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Add sort key" }));
    set("Sort 1 field", "status");
    fireEvent.click(screen.getByRole("button", { name: "Add sort key" }));
    set("Sort 2 field", "road");
    set("Sort 2 direction", "desc");
    expect([...(screen.getByLabelText("Group by") as HTMLSelectElement).options].map((option) => option.value))
      .toEqual(["", "road", "reason", "status", "reopen_estimate"]);
    set("Group by", "status");
    set("Archived records", "include");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const applied = onApply.mock.calls[0]![0];
    expect(applied).toEqual({
      where: [], sorts: [{ field: "status", dir: "asc" }, { field: "road", dir: "desc" }],
      groupBy: "status", archived: "include",
    });
    expect(refinementQuery(applied)).toEqual({ archived: "include", sorts: applied.sorts, groupBy: "status" });
    const view = refinedView({ ...roads.views[0]!, sort: { field: "road", dir: "asc" } }, applied);
    expect(view.sort).toBeUndefined();
    expect(view).toMatchObject({ sorts: applied.sorts, groupBy: "status", filter: roads.views[0]!.filter });
    expect(view.where).toEqual(roads.views[0]!.where);
    expect(refinementQuery(NO_REFINEMENT)).toEqual({});
  });

  it("shows the record count of each group", () => {
    render(<GroupCounts field={roads.fields.find((field) => field.key === "status")}
      groups={[{ value: "closed", count: 3 }, { value: null, count: 1 }]} />);
    const counts = screen.getByRole("region", { name: "Group counts" });
    expect(counts.textContent).toContain("Grouped by Status");
    expect(within(counts).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Closed 3", "No value 1"]);
  });
});

describe("board import mapping", () => {
  const result = (patch: Partial<BoardImportResult>): BoardImportResult => ({
    dryRun: true, rows: 2, created: 0, mapping: {}, ignored: [], errorCount: 0, errors: [], ...patch,
  });

  it("proposes a mapping, lists row errors and imports only after a clean check of the current mapping", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce(result({
        mapping: { Road: "road", Status: "status" }, ignored: ["id", "Notes"], errorCount: 1,
        errors: [{ row: 3, field: "status", message: "Invalid option" }],
      }))
      .mockResolvedValueOnce(result({ mapping: { Road: "road", Status: "status", Notes: "reason" }, ignored: ["id"] }))
      .mockResolvedValueOnce(result({ dryRun: false, created: 2 }));
    const onImported = vi.fn();
    render(<BoardImport fields={roads.fields} run={run} onImported={onImported} />);
    const file = new File(["id,Road,Status,Notes\n"], "roads.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("File to import"), { target: { files: [file] } });

    await screen.findByRole("heading", { name: "Map columns to fields" });
    expect(run).toHaveBeenCalledWith(file, { dryRun: true });
    expect((screen.getByLabelText("Field for column Road") as HTMLSelectElement).value).toBe("road");
    expect((screen.getByLabelText("Field for column id") as HTMLSelectElement).value).toBe("");
    const errors = screen.getByRole("table", { name: "Row errors" });
    expect(within(errors).getAllByRole("row")[1]!.textContent).toBe("3StatusInvalid option");
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);

    set("Field for column Notes", "reason");
    screen.getByText("The mapping changed; check the file again before importing.");
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    await screen.findByText("2 rows read. No errors: ready to import.");
    expect(run).toHaveBeenLastCalledWith(file, {
      dryRun: true, mapping: { Road: "road", Status: "status", id: null, Notes: "reason" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Import 2 records" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(2));
    expect(run).toHaveBeenLastCalledWith(file, {
      dryRun: false, mapping: { Road: "road", Status: "status", id: null, Notes: "reason" },
    });
  });

  it("reports a refused commit and keeps the mapping for a corrected file", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce(result({ mapping: {}, ignored: ["Item"] }))
      .mockResolvedValueOnce(result({ mapping: { Item: "road" } }))
      .mockRejectedValueOnce(new Error("import has row errors"))
      .mockResolvedValueOnce(result({ mapping: { Item: "road" } }));
    render(<BoardImport fields={roads.fields} run={run} onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("File to import"), { target: { files: [new File(["Item\n"], "r.csv")] } });
    await screen.findByLabelText("Field for column Item");
    set("Field for column Item", "road");
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import 2 records" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("import has row errors Nothing was imported; check the file again.");
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);

    const corrected = new File(["Item\nSR-96\n"], "r.csv");
    fireEvent.change(screen.getByLabelText("File to import"), { target: { files: [corrected] } });
    await screen.findByRole("button", { name: "Import 2 records" });
    expect(run).toHaveBeenLastCalledWith(corrected, { dryRun: true, mapping: { Item: "road" } });
  });
});

describe("Esri JSON import", () => {
  it("offers an Esri JSON file, maps its geometry column to the map field and reports rows by feature", async () => {
    const run = vi.fn().mockResolvedValueOnce({
      dryRun: true, rows: 2, created: 0, mapping: { road: "road", geometry: "location" }, ignored: ["OBJECTID"],
      errorCount: 1, errors: [{ row: 2, field: "location", message: "Location: spatial reference 2227 is not supported" }],
    } satisfies BoardImportResult);
    const view = render(<BoardImport fields={roads.fields} run={run} onImported={vi.fn()} />);
    const input = screen.getByLabelText("File to import") as HTMLInputElement;
    expect(input.accept.split(",")).toEqual(expect.arrayContaining([".json", "application/json"]));
    screen.getByText(/An Esri JSON file, such as an ArcGIS layer/);
    const file = new File([JSON.stringify({ features: [] })], "closures.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole("heading", { name: "Map columns to fields" });
    expect((screen.getByLabelText("Field for column geometry") as HTMLSelectElement).value).toBe("location");
    expect((screen.getByLabelText("Field for column OBJECTID") as HTMLSelectElement).value).toBe("");
    const errors = screen.getByRole("table", { name: "Row errors" });
    expect(within(errors).getAllByRole("row")[1]!.textContent).toBe("2LocationLocation: spatial reference 2227 is not supported");
    expect((await axe.run(view.container)).violations).toEqual([]);
  });
});

describe("record history and lifecycle", () => {
  it("pages a record's history with each field before and after", async () => {
    const actor = { personId: "p1", displayName: "A. Operator", positionId: "pos", positionTitle: "Planning" };
    const load = vi.fn()
      .mockResolvedValueOnce({ nextCursor: "c1", entries: [{ seq: 1, id: "e1", at: "2026-09-21T15:00:00.000Z",
        category: "board.record.created", corrects: null, actor, changes: [{ field: "road", before: null, after: "SR-96" }] }] })
      .mockResolvedValueOnce({ nextCursor: null, entries: [{ seq: 2, id: "e2", at: "2026-09-21T16:00:00.000Z",
        category: "board.record.updated", corrects: null, actor, changes: [{ field: "status", before: "closed", after: "reopened" }] }] });
    render(<RecordHistory load={load} fields={roads.fields} />);
    const list = await screen.findByRole("list", { name: "Record history" });
    expect(list.textContent).toMatch(/Created · .* · A\. Operator \(Planning\)Roadempty → SR-96/);
    fireEvent.click(screen.getByRole("button", { name: "Load more history" }));
    await screen.findByText("Closed → Reopened");
    expect(load).toHaveBeenLastCalledWith({ cursor: "c1" });
    expect(screen.queryByRole("button", { name: "Load more history" })).toBeNull();
  });

  it("archives, restores and deletes only after a stated confirmation", async () => {
    const detail: BoardRecordDetailResponse = {
      id: "record-1", incidentId: null, data: { id: "record-1", road: "SR-96" },
      createdAt: "2026-09-21T15:00:00.000Z",
      createdBy: { personId: "p1", displayName: "A. Operator", positionId: null, positionTitle: null },
      updatedAt: "2026-09-21T15:00:00.000Z", updatedBy: null, canEdit: true, history: [], archivedAt: null,
    };
    const onArchive = vi.fn(async () => undefined);
    const onDelete = vi.fn(async () => undefined);
    const context: Extract<BoardRecordContext, { status: "ready" }> = {
      status: "ready", record: detail.data, detail, fields: roads.fields, related: {}, attachments: {},
      canEdit: true, onEdit: vi.fn(), onDownloadAttachment: vi.fn(async () => undefined),
      lifecycle: { canArchive: true, canDelete: true, onArchive, onDelete },
      history: vi.fn(async () => ({ entries: [], nextCursor: null })),
    };
    const view = render(<BoardRecordDetailPane context={context} />);
    fireEvent.click(screen.getByRole("tab", { name: "Change history" }));
    await screen.findByText("No history is recorded for this record.");
    fireEvent.click(screen.getByRole("tab", { name: "Record" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive record" }));
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith(true));

    view.rerender(<BoardRecordDetailPane context={{ ...context, detail: { ...detail, archivedAt: "2026-09-21T16:00:00.000Z" } }} />);
    expect(screen.getByText(/left out of default views until it is restored/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore record" }));
    await waitFor(() => expect(onArchive).toHaveBeenLastCalledWith(false));

    fireEvent.click(screen.getByRole("button", { name: "Delete record" }));
    const confirm = screen.getByRole("dialog", { name: "Delete this record?" });
    expect(confirm.textContent).toMatch(/recorded in\s+its history .* cannot be undone from this screen/);
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete record" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });

  it("offers neither archive nor delete without the authority", () => {
    const detail = { id: "r", incidentId: null, data: { id: "r" }, createdAt: "2026-09-21T15:00:00.000Z",
      createdBy: { personId: "p", displayName: "P", positionId: null, positionTitle: null },
      updatedAt: "2026-09-21T15:00:00.000Z", updatedBy: null, canEdit: false, history: [] };
    render(<BoardRecordDetailPane context={{ status: "ready", record: detail.data, detail, fields: roads.fields,
      related: {}, attachments: {}, canEdit: false, onEdit: vi.fn(), onDownloadAttachment: vi.fn(async () => undefined),
      lifecycle: { canArchive: false, canDelete: false, onArchive: vi.fn(), onDelete: vi.fn() } }} />);
    expect(screen.queryByRole("button", { name: "Archive record" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete record" })).toBeNull();
  });
});
