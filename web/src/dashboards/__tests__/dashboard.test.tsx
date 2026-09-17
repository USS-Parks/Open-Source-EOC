// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardSnapshot } from "@openeoc/shared";
import { Theme } from "../../design/components.js";
import { Dashboard } from "../Dashboard.js";

const snapshot: DashboardSnapshot = {
  dashboardId: "d1",
  title: "EOC Status",
  computedAt: new Date().toISOString(),
  widgets: [
    { kind: "tile", key: "closed_roads", title: "Closed roads", value: 2, level: "warn" },
    {
      kind: "chart",
      key: "shelters_by_status",
      title: "Shelters by status",
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
    expect(screen.getByLabelText("normal: 2")).toBeTruthy();
    expect(screen.getByText("unstable")).toBeTruthy();
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
});
