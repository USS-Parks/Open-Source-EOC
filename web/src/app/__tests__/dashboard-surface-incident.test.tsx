// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { DashboardSurface, parseDashboardViewState } from "../surfaces/DashboardSurface.js";
import type { ApiClient } from "../api/client.js";
import type { DashboardSnapshot } from "@openeoc/shared";

/**
 * The dashboard surface scopes its request to the selected incident and shows
 * that incident's totals (VEOC-79B2). Switching the incident refetches and the
 * displayed total changes, so the operator never reads a stale count.
 */

afterEach(() => cleanup());

// The closed-roads tile carries a per-incident total, so a test can tell which
// incident the surface asked the server to scope to.
const snapshotFor = (incidentId: string | null): DashboardSnapshot => ({
  dashboardId: "d1",
  title: "EOC Status",
  computedAt: "2026-09-20T10:00:00Z",
  widgets: [
    {
      kind: "tile",
      key: "closed_roads",
      title: "Closed roads",
      value: incidentId === "incident-a" ? 2 : incidentId === "incident-b" ? 0 : 9,
      level: "normal",
    },
  ],
  filter: null,
});

function fakeClient() {
  const dashboardData = vi.fn((_id: string, _filter: unknown, incidentId?: string | null) =>
    Promise.resolve(snapshotFor(incidentId ?? null)),
  );
  return {
    client: {
      dashboardData,
      listDashboardConfigs: vi.fn().mockResolvedValue({ configs: [], nextCursor: null }),
      getIncidentArea: vi.fn().mockResolvedValue({ geometry: null }),
    } as unknown as ApiClient,
    dashboardData,
  };
}

const surfaceProps = {
  theme: "light" as const,
  dashboards: [],
  configKey: null,
  onConfigKey: () => undefined,
  onViewStateChange: () => undefined,
};

it("scopes the request to the selected incident and displays its total", async () => {
  const { client, dashboardData } = fakeClient();
  render(
    <DashboardSurface {...surfaceProps} client={client} dashboardId="d1" filter={null}
      incidentId="incident-a" onFilter={() => undefined} />,
  );
  await waitFor(() => expect(screen.getByTestId("tile-closed_roads-value").textContent).toBe("2"));
  expect(dashboardData).toHaveBeenCalledWith("d1", null, "incident-a");
});

it("switches the scoped total when the selected incident changes", async () => {
  const { client, dashboardData } = fakeClient();
  const { rerender } = render(
    <DashboardSurface {...surfaceProps} client={client} dashboardId="d1" filter={null}
      incidentId="incident-a" onFilter={() => undefined} />,
  );
  await waitFor(() => expect(screen.getByTestId("tile-closed_roads-value").textContent).toBe("2"));
  rerender(
    <DashboardSurface {...surfaceProps} client={client} dashboardId="d1" filter={null}
      incidentId="incident-b" onFilter={() => undefined} />,
  );
  await waitFor(() => expect(screen.getByTestId("tile-closed_roads-value").textContent).toBe("0"));
  expect(dashboardData).toHaveBeenLastCalledWith("d1", null, "incident-b");
});

it("parses only bounded, schema-valid saved dashboard route state", () => {
  expect(parseDashboardViewState(JSON.stringify({
    scope: "saved",
    filterMode: "replace",
    filters: { category: { field: "status", equals: "closed" } },
    bbox: [-124, 40, -120, 43],
  }))).toEqual({
    scope: "saved",
    filterMode: "replace",
    filters: { category: { field: "status", equals: "closed" } },
    bbox: [-124, 40, -120, 43],
  });
  expect(parseDashboardViewState(JSON.stringify({ scope: "incident", bbox: [-124, 40, -120, 43] }))).toBeUndefined();
  expect(parseDashboardViewState(JSON.stringify({ scope: "saved", filters: { category: { field: "bad field", equals: 1 } } })))
    .toBeUndefined();
  expect(parseDashboardViewState(`{"scope":"saved","extra":"${"x".repeat(260)}"}`)).toBeUndefined();
});
