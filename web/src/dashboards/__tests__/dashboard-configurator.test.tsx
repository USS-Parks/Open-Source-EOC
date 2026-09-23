// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardTemplate } from "@openeoc/shared";
import { DashboardConfigurator } from "../DashboardConfigurator.js";

const template: DashboardTemplate = {
  key: "eoc_status",
  version: 1,
  title: "EOC Status",
  widgets: [
    { kind: "tile", key: "closed_roads", title: "Closed roads", board: "road_closures" },
    {
      kind: "status", key: "lifelines", title: "Community Lifelines", board: "lifelines",
      groupBy: "lifeline", valueField: "status",
    },
    {
      kind: "list", key: "active_closures", title: "Active closures", board: "road_closures",
      columns: ["road", "status"], limit: 10,
    },
  ],
};

const dashboards = [{
  id: "10000000-0000-4000-8000-000000000001",
  title: "EOC Status",
  template,
}];

afterEach(cleanup);

describe("dashboard saved view configuration", () => {
  it("saves selected real widgets and an explicit map presentation", () => {
    const onSave = vi.fn();
    render(
      <DashboardConfigurator current={null} initialKey="incident-overview" dashboards={dashboards}
        saving={false} error={null} onSave={onSave} onCancel={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Closed roads/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Community Lifelines/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Active closures/ }));
    fireEvent.change(screen.getByLabelText("Active closures presentation"), { target: { value: "map" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toBe("incident-overview");
    expect(onSave.mock.calls[0]?.[1]).toBe(0);
    expect(onSave.mock.calls[0]?.[2]).toMatchObject({
      title: "Incident overview",
      panels: [
        { source: "dashboard", widgetKey: "closed_roads", presentation: "tile" },
        { source: "dashboard", widgetKey: "lifelines", presentation: "status" },
        { source: "dashboard", widgetKey: "active_closures", presentation: "map" },
      ],
    });
  });

  it("adds a kanban summary with the charts and upcoming calendar items with the lists", () => {
    const onSave = vi.fn();
    const views: DashboardTemplate = {
      key: "board_views", version: 1, title: "Board views",
      widgets: [
        { kind: "kanban", key: "by_status", title: "Closures by status", board: "road_closures", field: "status" },
        { kind: "calendar", key: "reopenings", title: "Reopenings", board: "road_closures", field: "reopen_estimate", labelField: "road", limit: 10 },
        { kind: "chart", key: "counts", title: "Closure counts", board: "road_closures", groupBy: "status", display: "bar" },
      ],
    };
    render(
      <DashboardConfigurator current={null} initialKey="board-views" dashboards={[{ ...dashboards[0]!, template: views }]}
        saving={false} error={null} onSave={onSave} onCancel={() => undefined} />,
    );
    for (const name of ["Closures by status", "Reopenings", "Closure counts"]) {
      fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(name) }));
    }
    expect([...(screen.getByLabelText("Reopenings presentation") as HTMLSelectElement).options].map((option) => option.value))
      .toEqual(["list"]);
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(onSave.mock.calls[0]?.[2].panels).toMatchObject([
      { widgetKey: "by_status", presentation: "chart" },
      { widgetKey: "reopenings", presentation: "list" },
      { widgetKey: "counts", presentation: "chart" },
    ]);
  });

  it("shows validation instead of silently saving an empty composition", () => {
    const onSave = vi.fn();
    render(
      <DashboardConfigurator current={null} initialKey="incident-overview" dashboards={dashboards}
        saving={false} error={null} onSave={onSave} onCancel={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBeTruthy();
  });
});
