// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot } from "@openeoc/shared";
import { Theme } from "../../design/components.js";
import { Dashboard } from "../Dashboard.js";

const snapshot: DashboardSnapshot = {
  dashboardId: "d1",
  title: "EOC Status",
  computedAt: new Date().toISOString(),
  widgets: [
    { kind: "tile", key: "closed_roads", title: "Closed roads", value: 2, level: "warn", trend: 3 },
    {
      kind: "chart",
      key: "shelters_by_status",
      title: "Shelters by status",
      display: "donut",
      groups: [
        { value: "normal", count: 2 },
        { value: "closed", count: 1 },
      ],
    },
    {
      kind: "status",
      key: "lifelines",
      title: "Community Lifelines",
      groups: [
        { group: "energy", value: "unstable", at: new Date().toISOString() },
        { group: "water_systems", value: "stabilizing", at: new Date().toISOString() },
      ],
    },
    {
      kind: "list",
      key: "active_closures",
      title: "Active closures",
      columns: ["road", "status"],
      records: [{ id: "r1", road: "SR-169", status: "closed" }],
    },
    { kind: "tile", key: "gone", title: "Absent board", missing: true, value: 0, level: "normal" },
  ],
};

afterEach(cleanup);

describe("the dashboard renders a computed snapshot and nothing else", () => {
  it("shows every widget kind from snapshot data alone", () => {
    render(
      <Theme name="light">
        <Dashboard snapshot={snapshot} />
      </Theme>,
    );
    expect(screen.getByTestId("tile-closed_roads-value").textContent).toBe("2");
    expect(screen.getByText("warn")).toBeTruthy();
    expect(screen.getByText("+3 last 24h")).toBeTruthy();
    expect(screen.getByLabelText("Shelters by status: 3 total")).toBeTruthy();
    expect(screen.getByText("unstable")).toBeTruthy();
    expect(document.querySelector('svg[data-icon="energy"]')).toBeTruthy();
    expect(screen.getByText("SR-169")).toBeTruthy();
  });

  it("marks a widget whose board is absent instead of blanking the picture", () => {
    render(
      <Theme name="light">
        <Dashboard snapshot={snapshot} />
      </Theme>,
    );
    const gone = screen.getByTestId("widget-gone");
    expect(gone.textContent).toContain("No matching board");
  });

  it("drills into a chart group by its field when onDrill is given", () => {
    const drillSnap: DashboardSnapshot = {
      dashboardId: "d1",
      title: "EOC Status",
      computedAt: new Date().toISOString(),
      widgets: [
        {
          kind: "chart",
          key: "shelters_by_status",
          title: "Shelters by status",
          display: "bar",
          field: "status",
          groups: [
            { value: "normal", count: 2 },
            { value: "closed", count: 1 },
          ],
        },
      ],
    };
    const onDrill = vi.fn();
    render(
      <Theme name="light">
        <Dashboard snapshot={drillSnap} onDrill={onDrill} />
      </Theme>,
    );
    fireEvent.click(screen.getByLabelText("Filter by normal"));
    expect(onDrill).toHaveBeenCalledWith("status", "normal");
  });

  it("does not offer a drilldown when a chart has no group field", () => {
    render(
      <Theme name="light">
        <Dashboard snapshot={snapshot} onDrill={() => undefined} />
      </Theme>,
    );
    // The seeded chart carries no field, so its groups are not buttons.
    expect(screen.queryByLabelText("Filter by normal")).toBeNull();
  });

  it("shows kanban column counts in order and the upcoming calendar items", () => {
    const at = "2026-09-24T16:00:00.000Z";
    render(
      <Theme name="light">
        <Dashboard snapshot={{
          dashboardId: "d1", title: "Board views", computedAt: new Date().toISOString(),
          widgets: [
            { kind: "kanban", key: "by_status", title: "Closures by status", field: "status", columns: [
              { value: "closed", count: 2 }, { value: "one_lane", count: 0 }, { value: null, count: 1 },
            ] },
            { kind: "calendar", key: "reopenings", title: "Reopenings", field: "reopen_estimate", items: [
              { id: "r1", at, label: "SR-96" }, { id: "r2", at, label: null },
            ] },
            { kind: "calendar", key: "empty", title: "Nothing due", field: "reopen_estimate", items: [] },
          ],
        }} />
      </Theme>,
    );
    expect([...screen.getByTestId("widget-by_status").querySelectorAll("li")].map((item) => item.textContent))
      .toEqual(["Closed2", "One lane0", "No value1"]);
    const upcoming = screen.getByTestId("widget-reopenings");
    expect(upcoming.querySelector("time")!.getAttribute("dateTime")).toBe(at);
    expect([...upcoming.querySelectorAll("li > span")].map((item) => item.textContent)).toEqual(["SR-96", "Untitled record"]);
    expect(screen.getByTestId("widget-empty").textContent).toContain("Nothing scheduled from now on.");
  });
});
