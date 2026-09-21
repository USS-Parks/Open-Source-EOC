// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { Theme } from "../components.js";
import {
  OperationalTable,
  createOperationalTableViewState,
  type OperationalTableColumn,
} from "../table.js";

afterEach(cleanup);

const columns: readonly OperationalTableColumn<{ id: string; request: string; owner: string | null }>[] = [
  { id: "request", header: "Request", value: (row) => row.request, sortable: true, filterable: true, width: 260 },
  { id: "owner", header: "Owner", value: (row) => row.owner, sortable: true, filterable: true, width: 160 },
];
const state = { ...createOperationalTableViewState(columns), pinned: { request: "start" as const } };

async function violations(container: Element) {
  return (await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations;
}

describe("D07 operational table accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme} table has no axe violations`, async () => {
      const { container } = render(
        <Theme name={theme}>
          <OperationalTable
            tableId="priority"
            caption="Priority work"
            columns={columns}
            rows={[
              { id: "one", request: "Coordinate shelter transportation", owner: "Avery" },
              { id: "two", request: "Stage potable water", owner: null },
            ]}
            rowId={(row) => row.id}
            datasetKey="incident-a:priority:v1"
            status="ready"
            viewState={state}
            onViewStateChange={() => undefined}
            totalRows={2}
            hasPreviousPage={false}
            hasNextPage={false}
            selectedIds={new Set()}
            onSelectionChange={() => undefined}
            bulkActions={[{ id: "assign", label: "Assign selected", onInvoke: () => undefined }]}
          />
        </Theme>,
      );
      const found = await violations(container);
      expect(found, found.map((item) => `${item.id}: ${item.nodes.length}`).join("; ")).toHaveLength(0);
    }, 30000);
  }

  it("keeps every resize, sort, filter, menu, selection, and paging control keyboard reachable", () => {
    const { container } = render(
      <OperationalTable
        tableId="priority"
        caption="Priority work"
        columns={columns}
        rows={[{ id: "one", request: "Coordinate shelter transportation", owner: "Avery" }]}
        rowId={(row) => row.id}
        datasetKey="priority"
        status="ready"
        viewState={state}
        onViewStateChange={() => undefined}
        totalRows={1}
        hasPreviousPage={false}
        hasNextPage={false}
        selectedIds={new Set()}
        onSelectionChange={() => undefined}
      />,
    );
    const focusables = container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]'
    );
    expect(focusables.length).toBeGreaterThan(10);
    for (const element of focusables) {
      const tabIndex = element.getAttribute("tabindex");
      expect(tabIndex === null || Number(tabIndex) <= 0).toBe(true);
    }
    expect(container.querySelectorAll('[role="separator"][tabindex="0"]')).toHaveLength(2);
  });
});
