// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardComposition, DashboardCompositionSnapshot } from "@openeoc/shared";
import { Theme } from "../../design/components.js";
import { CompositionDashboard } from "../CompositionDashboard.js";

vi.mock("../../cop/CopMap.js", () => ({
  CopMap: (props: { fetchItems: () => Promise<{ features: unknown[] }> }) => {
    void props.fetchItems();
    return <div data-testid="cop-map">COP map</div>;
  },
}));

const dashboardId = "10000000-0000-4000-8000-000000000001";
const composition: DashboardComposition = {
  title: "Incident overview",
  panels: [
    { key: "closed", source: "dashboard", dashboardId, widgetKey: "closed_roads", presentation: "tile" },
    { key: "map", source: "dashboard", dashboardId, widgetKey: "active_closures", presentation: "map" },
    { key: "lifelines", source: "dashboard", dashboardId, widgetKey: "lifelines", presentation: "status" },
    { key: "activity", source: "dashboard", dashboardId, widgetKey: "active_closures", presentation: "list" },
    { key: "population", source: "impact", category: "population", presentation: "tile" },
  ],
};

const snapshot: DashboardCompositionSnapshot = {
  key: "incident-overview",
  revision: 4,
  title: "Incident overview",
  computedAt: "2026-09-21T12:00:00.000Z",
  scope: { kind: "incident-area", bbox: null },
  filterMode: "inherit",
  filters: null,
  resolvedOperationalPeriod: null,
  panels: [
    {
      key: "closed", title: "Closed roads", source: "dashboard", presentation: "tile", state: "ready",
      reason: null, filterCapabilities: ["category", "date", "bbox"], contributionDrilldown: true, notApplied: [],
      data: { kind: "tile", key: "closed_roads", title: "Closed roads", value: 2, level: "warn" },
    },
    {
      key: "map", title: "Active closures map", source: "dashboard", presentation: "map", state: "ready",
      reason: null, filterCapabilities: ["category", "date", "bbox"], contributionDrilldown: true, notApplied: [],
      data: { kind: "list", key: "active_closures", title: "Active closures", columns: ["road", "status"], records: [] },
    },
    {
      key: "lifelines", title: "Community Lifelines", source: "dashboard", presentation: "status", state: "ready",
      reason: null, filterCapabilities: ["category", "date", "bbox"], contributionDrilldown: false, notApplied: [],
      data: { kind: "status", key: "lifelines", title: "Community Lifelines", groups: [
        { group: "safety_security", value: "unstable", at: "2026-09-21T11:00:00.000Z" },
      ] },
    },
    {
      key: "activity", title: "Priority activity", source: "dashboard", presentation: "list", state: "ready",
      reason: null, filterCapabilities: ["category", "date", "bbox"], contributionDrilldown: true, notApplied: [],
      data: { kind: "list", key: "active_closures", title: "Priority activity", columns: ["road", "status"], records: [
        { id: "30000000-0000-4000-8000-000000000003", road: "SR-96", status: "closed" },
      ] },
    },
    {
      key: "population", title: "population", source: "impact", presentation: "tile", state: "missing",
      reason: "No usable population baseline", filterCapabilities: ["operationalPeriod", "bbox"],
      contributionDrilldown: false, notApplied: [], data: null,
    },
  ],
};

afterEach(cleanup);

describe("incident overview composition", () => {
  it("composes server panels into statistics, COP, lifelines, and priority activity", async () => {
    const openMap = vi.fn();
    const loadMapRecords = vi.fn().mockResolvedValue({
      total: 2,
      records: [
        { id: "r1", at: "2026-09-21T10:00:00.000Z", data: { road: "SR-96" }, geometry: { type: "Point", coordinates: [-123, 41] } },
        { id: "r2", at: "2026-09-21T10:01:00.000Z", data: { road: "Bald Hills" }, geometry: null },
      ],
    });
    render(
      <Theme name="light">
        <CompositionDashboard snapshot={snapshot} composition={composition} theme="light"
          loadMapRecords={loadMapRecords} onDrill={() => undefined} onOpenMap={openMap} />
      </Theme>,
    );
    expect(screen.getByLabelText("Incident statistics").textContent).toContain("Closed roads");
    expect(screen.getByRole("region", { name: "Community Lifelines" }).textContent).toContain("Safety and Security");
    expect(screen.getByRole("region", { name: "Community Lifelines" }).textContent).toContain("Unstable");
    expect(screen.getByLabelText("Priority work and recent activity").textContent).toContain("SR-96");
    expect(screen.getByTestId("panel-population").textContent).toContain("Population exposed");
    expect(screen.getByTestId("panel-population").textContent).not.toContain("No usable population baseline");
    expect(screen.getByText("Source details").closest("details")?.textContent).toContain("No usable population baseline");
    await waitFor(() => expect(screen.getByText("1 mapped of 2 contributing records")).toBeTruthy());
    expect(loadMapRecords).toHaveBeenCalledWith(composition.panels[1]);
    fireEvent.click(screen.getByRole("button", { name: "Open full map" }));
    expect(openMap).toHaveBeenCalledTimes(1);
  });

  it("keeps an unknown impact value distinct from a numeric zero", () => {
    const unknown: DashboardCompositionSnapshot = {
      ...snapshot,
      panels: snapshot.panels.map((panel) => panel.key === "population" ? {
        ...panel,
        state: "ready" as const,
        reason: "Population polygons are unavailable",
        data: {
          category: "population" as const, value: null, unit: "people" as const, coverage: "unknown" as const,
          reason: "Population polygons are unavailable", availability: "awaiting" as const, sources: [],
        },
      } : panel),
    };
    render(
      <Theme name="dark">
        <CompositionDashboard snapshot={unknown} composition={composition} theme="dark"
          loadMapRecords={() => Promise.resolve({ total: 0, records: [] })} onDrill={() => undefined} />
      </Theme>,
    );
    expect(screen.getByTestId("panel-population").textContent).toContain("Unknown");
    expect(screen.getByTestId("panel-population").textContent).not.toContain("0 people");
  });

  it("keeps a stale zero visibly stale instead of presenting it as current", () => {
    const staleZero: DashboardCompositionSnapshot = {
      ...snapshot,
      panels: snapshot.panels.map((panel) => panel.key === "closed" ? {
        ...panel,
        state: "stale" as const,
        reason: "Source refresh overdue",
        data: { kind: "tile" as const, key: "closed_roads", title: "Closed roads", value: 0, level: "normal" as const },
      } : panel),
    };
    render(
      <Theme name="light">
        <CompositionDashboard snapshot={staleZero} composition={composition} theme="light"
          loadMapRecords={() => Promise.resolve({ total: 0, records: [] })} onDrill={() => undefined} />
      </Theme>,
    );
    expect(screen.getByTestId("panel-closed").getAttribute("data-value-state")).toBe("stale");
    expect(screen.getByTestId("panel-closed").textContent).toContain("Stale");
  });

  it("does not turn missing dashboard data into zero or fetch a missing-geometry map", () => {
    const missing: DashboardCompositionSnapshot = {
      ...snapshot,
      panels: snapshot.panels.map((panel) => panel.key === "closed" ? {
        ...panel,
        state: "missing" as const,
        reason: "Dashboard source unavailable",
        data: { kind: "tile" as const, key: "closed_roads", title: "Closed roads", missing: true, value: 0, level: "normal" as const },
      } : panel.key === "map" ? {
        ...panel,
        state: "missing" as const,
        reason: "Map geometry is unavailable",
        data: null,
      } : panel),
    };
    const loadMapRecords = vi.fn().mockResolvedValue({ total: 0, records: [] });
    render(
      <Theme name="light">
        <CompositionDashboard snapshot={missing} composition={composition} theme="light"
          loadMapRecords={loadMapRecords} onDrill={() => undefined} />
      </Theme>,
    );
    expect(screen.getByTestId("panel-closed").textContent).toContain("Dashboard source unavailable");
    expect(screen.getByTestId("panel-closed").getAttribute("data-value-state")).toBeNull();
    expect(screen.getByTestId("panel-map").textContent).toContain("Map geometry is unavailable");
    expect(loadMapRecords).not.toHaveBeenCalled();
  });
});
