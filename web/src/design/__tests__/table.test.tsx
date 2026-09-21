// @vitest-environment jsdom
import { useMemo, useState } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Theme } from "../components.js";
import {
  OperationalTable,
  createOperationalTableViewState,
  type OperationalTableColumn,
  type OperationalTableStatus,
  type OperationalTableViewState,
} from "../table.js";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly owner: string | null;
  readonly status: string;
}

const rows: readonly Row[] = [
  { id: "one", name: "Coordinate the exceptionally long multi-agency shelter transportation request", owner: "Avery", status: "Open" },
  { id: "two", name: "Stage water", owner: null, status: "Assigned" },
  { id: "three", name: "Clear route", owner: "Morgan", status: "Open" },
];

const columns: readonly OperationalTableColumn<Row>[] = [
  { id: "name", header: "Request", value: (row) => row.name, sortable: true, filterable: true, width: 240 },
  { id: "owner", header: "Owner", value: (row) => row.owner, sortable: true, filterable: true, width: 160 },
  { id: "status", header: "Status", value: (row) => row.status, sortable: true, filterable: true, width: 140 },
];

function filteredRows(source: readonly Row[], state: OperationalTableViewState): readonly Row[] {
  const filtered = source.filter((row) => Object.entries(state.filters).every(([key, value]) => {
    const column = columns.find((candidate) => candidate.id === key);
    return String(column?.value(row) ?? "").toLowerCase().includes(value.toLowerCase());
  }));
  const sortColumn = state.sort && columns.find((column) => column.id === state.sort?.columnId);
  if (!sortColumn || !state.sort) return filtered;
  const direction = state.sort.direction === "asc" ? 1 : -1;
  return [...filtered].sort((left, right) => String(sortColumn.value(left) ?? "").localeCompare(String(sortColumn.value(right) ?? "")) * direction);
}

function Harness(props: {
  readonly initialSelected?: readonly string[];
  readonly onBulk?: (ids: readonly string[]) => void;
  readonly status?: OperationalTableStatus;
}) {
  const [state, setState] = useState(() => createOperationalTableViewState(columns, { pageSize: 10 }));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(props.initialSelected ?? []));
  const visible = useMemo(() => filteredRows(rows, state), [state]);
  return (
    <Theme name="light">
      <OperationalTable
        tableId="work"
        caption="Priority work"
        columns={columns}
        rows={visible}
        rowId={(row) => row.id}
        datasetKey="incident-a:work:v1"
        status={props.status ?? (visible.length ? "ready" : "empty")}
        viewState={state}
        onViewStateChange={setState}
        totalRows={visible.length}
        hasPreviousPage={false}
        hasNextPage={false}
        selectedIds={selected}
        onSelectionChange={setSelected}
        bulkActions={[{ id: "assign", label: "Assign selected", onInvoke: props.onBulk ?? (() => undefined) }]}
      />
    </Theme>
  );
}

afterEach(cleanup);

describe("D07 operational table", () => {
  it("sorts and filters through controlled state and distinguishes missing values", () => {
    const { getByRole, getByText, queryByText } = render(<Harness />);
    expect(getByText("Not provided").closest("td")?.getAttribute("data-missing")).toBe("true");

    fireEvent.change(getByRole("searchbox", { name: "Filter Status" }), { target: { value: "Assigned" } });
    expect(getByText("Stage water")).not.toBeNull();
    expect(queryByText("Clear route")).toBeNull();

    fireEvent.change(getByRole("searchbox", { name: "Filter Status" }), { target: { value: "" } });
    const sort = getByRole("button", { name: "Request" });
    fireEvent.click(sort);
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(sort);
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(sort);
    expect(sort.closest("th")?.hasAttribute("aria-sort")).toBe(false);
  });

  it("passes only exact present filtered IDs to bulk actions", async () => {
    const onBulk = vi.fn();
    const { getByRole } = render(<Harness initialSelected={["one", "two", "deleted"]} onBulk={onBulk} />);
    await waitFor(() => expect(getByTextSelection(getByRole("button", { name: "Assign selected" }))).toContain("2 selected"));

    fireEvent.change(getByRole("searchbox", { name: "Filter Status" }), { target: { value: "Assigned" } });
    await waitFor(() => expect(getByTextSelection(getByRole("button", { name: "Assign selected" }))).toContain("1 selected"));
    fireEvent.click(getByRole("button", { name: "Assign selected" }));
    expect(onBulk).toHaveBeenCalledWith(["two"]);

    fireEvent.click(getByRole("checkbox", { name: "Select all records on this page" }));
    expect(getByRole("button", { name: "Assign selected" }).hasAttribute("disabled")).toBe(true);
    expect(onBulk).toHaveBeenCalledTimes(1);
  });

  it("does not treat stale rows as the new query while loading", async () => {
    const selection = vi.fn();
    const bulk = vi.fn();
    const state = createOperationalTableViewState(columns);
    const { getByRole, rerender } = render(
      <Theme name="light">
        <OperationalTable
          tableId="work"
          caption="Work"
          columns={columns}
          rows={rows}
          rowId={(row) => row.id}
          datasetKey="incident-a:query-two"
          status="loading"
          viewState={state}
          onViewStateChange={() => undefined}
          totalRows={3}
          hasPreviousPage={false}
          hasNextPage={false}
          selectedIds={new Set(["one"])}
          onSelectionChange={selection}
          bulkActions={[{ id: "bulk", label: "Run bulk action", onInvoke: bulk }]}
        />
      </Theme>,
    );
    expect(getByRole("button", { name: "Run bulk action" }).hasAttribute("disabled")).toBe(true);
    await Promise.resolve();
    expect(selection).not.toHaveBeenCalledWith(expect.anything(), "rows-reconciled");

    rerender(
      <Theme name="light">
        <OperationalTable
          tableId="work"
          caption="Work"
          columns={columns}
          rows={[rows[1]!]}
          rowId={(row) => row.id}
          datasetKey="incident-a:query-two"
          status="ready"
          viewState={state}
          onViewStateChange={() => undefined}
          totalRows={1}
          hasPreviousPage={false}
          hasNextPage={false}
          selectedIds={new Set(["one"])}
          onSelectionChange={selection}
          bulkActions={[{ id: "bulk", label: "Run bulk action", onInvoke: bulk }]}
        />
      </Theme>,
    );
    await waitFor(() => expect(selection).toHaveBeenCalledWith(new Set(), "rows-reconciled"));
  });

  it("clears selection on dataset identity changes without acting on stale rows", async () => {
    const selection = vi.fn();
    const state = createOperationalTableViewState(columns);
    const renderTable = (datasetKey: string, status: OperationalTableStatus) => (
      <OperationalTable
        tableId="work"
        caption="Work"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        datasetKey={datasetKey}
        status={status}
        viewState={state}
        onViewStateChange={() => undefined}
        totalRows={3}
        hasPreviousPage={false}
        hasNextPage={false}
        selectedIds={new Set(["one"])}
        onSelectionChange={selection}
      />
    );
    const { rerender } = render(renderTable("incident-a", "ready"));
    rerender(renderTable("incident-b", "loading"));
    await waitFor(() => expect(selection).toHaveBeenCalledWith(new Set(), "dataset-changed"));
    expect(selection).not.toHaveBeenCalledWith(new Set(["one"]), "rows-reconciled");
  });

  it("does not reintroduce an overlapping ID while a dataset clear awaits controlled acknowledgement", async () => {
    const selection = vi.fn();
    const bulk = vi.fn();
    const state = createOperationalTableViewState(columns);
    const renderTable = (datasetKey: string, status: OperationalTableStatus) => (
      <OperationalTable
        tableId="work"
        caption="Work"
        columns={columns}
        rows={[rows[0]!, rows[2]!]}
        rowId={(row) => row.id}
        datasetKey={datasetKey}
        status={status}
        viewState={state}
        onViewStateChange={() => undefined}
        totalRows={2}
        hasPreviousPage={false}
        hasNextPage={false}
        selectedIds={new Set(["one", "stale"])}
        onSelectionChange={selection}
        bulkActions={[{ id: "bulk", label: "Run bulk action", onInvoke: bulk }]}
      />
    );
    const { getByRole, rerender } = render(renderTable("incident-a", "loading"));
    rerender(renderTable("incident-b", "ready"));
    await waitFor(() => expect(selection).toHaveBeenCalledWith(new Set(), "dataset-changed"));
    expect(selection).not.toHaveBeenCalledWith(new Set(["one"]), "rows-reconciled");
    expect(getByRole("button", { name: "Run bulk action" }).hasAttribute("disabled")).toBe(true);

    rerender(renderTable("incident-b", "ready"));
    await Promise.resolve();
    expect(selection).not.toHaveBeenCalledWith(new Set(["one"]), "rows-reconciled");
    fireEvent.click(getByRole("button", { name: "Run bulk action" }));
    expect(bulk).not.toHaveBeenCalled();
  });

  it("resizes and pins a column from the keyboard without losing focus", () => {
    const { getByRole } = render(<Harness />);
    const resize = getByRole("separator", { name: "Resize Request column" });
    resize.focus();
    fireEvent.keyDown(resize, { key: "ArrowRight" });
    expect(document.activeElement).toBe(resize);
    expect(resize.getAttribute("aria-valuenow")).toBe("248");
    fireEvent.keyDown(resize, { key: "End" });
    expect(resize.getAttribute("aria-valuenow")).toBe("520");

    const menu = getByRole("button", { name: "Request column actions" });
    const header = menu.closest("th");
    fireEvent.click(menu);
    fireEvent.click(getByRole("menuitem", { name: "Pin to start" }));
    expect(header?.getAttribute("data-pin")).toBe("start");
  });

  it("reports pagination scope without claiming an unknown total", () => {
    const state = { ...createOperationalTableViewState(columns), page: 2, pageSize: 10 };
    const { getByText, getByRole } = render(
      <OperationalTable
        tableId="work"
        caption="Work"
        columns={columns}
        rows={[rows[0]!]}
        rowId={(row) => row.id}
        datasetKey="work"
        status="ready"
        viewState={state}
        onViewStateChange={() => undefined}
        totalRows={null}
        hasPreviousPage
        hasNextPage
        selectedIds={new Set()}
        onSelectionChange={() => undefined}
      />,
    );
    expect(getByText("1 loaded; total unknown")).not.toBeNull();
    expect(getByText("Page 3")).not.toBeNull();
    expect(getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(false);
    expect(getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(false);
  });

  it("renders explicit loading, empty, and failed states", () => {
    const { getByRole, rerender, getByText } = render(<Harness status="loading" />);
    expect(getByRole("status").textContent).toContain("Loading Priority work");
    rerender(<Harness status="empty" />);
    expect(getByText("No matching records")).not.toBeNull();
    rerender(<Harness status="error" />);
    expect(getByRole("alert").textContent).toContain("Could not load Priority work");
  });
});

function getByTextSelection(button: HTMLElement): string {
  return button.closest(".eoc-operational-table-bulk")?.textContent ?? "";
}
