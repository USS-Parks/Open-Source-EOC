// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { DashboardSurface } from "../surfaces/DashboardSurface.js";
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
  return { client: { dashboardData } as unknown as ApiClient, dashboardData };
}

it("scopes the request to the selected incident and displays its total", async () => {
  const { client, dashboardData } = fakeClient();
  render(
    <DashboardSurface client={client} dashboardId="d1" filter={null} incidentId="incident-a" onFilter={() => {}} />,
  );
  await waitFor(() => expect(screen.getByTestId("tile-closed_roads-value").textContent).toBe("2"));
  expect(dashboardData).toHaveBeenCalledWith("d1", null, "incident-a");
});

it("switches the scoped total when the selected incident changes", async () => {
  const { client, dashboardData } = fakeClient();
  const { rerender } = render(
    <DashboardSurface client={client} dashboardId="d1" filter={null} incidentId="incident-a" onFilter={() => {}} />,
  );
  await waitFor(() => expect(screen.getByTestId("tile-closed_roads-value").textContent).toBe("2"));
  rerender(
    <DashboardSurface client={client} dashboardId="d1" filter={null} incidentId="incident-b" onFilter={() => {}} />,
  );
  await waitFor(() => expect(screen.getByTestId("tile-closed_roads-value").textContent).toBe("0"));
  expect(dashboardData).toHaveBeenLastCalledWith("d1", null, "incident-b");
});
