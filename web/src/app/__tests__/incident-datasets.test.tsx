// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { IncidentDatasets } from "../surfaces/IncidentDatasets.js";
import type { ApiClient } from "../api/client.js";
import type { DatasetStatus } from "@openeoc/shared";

afterEach(() => cleanup());

const datasets: DatasetStatus[] = [
  {
    id: "ds-closures", key: "closures", name: "Road closures", kind: "geojson",
    organizationSlug: "valley-mutual-aid", organizationName: "Valley Mutual Aid",
    availability: "available", itemCount: 5, coverageArea: 1234,
    lastSuccessAt: "2026-09-20T10:00:00Z", staleAfterSeconds: 3600, reason: null,
  },
  {
    id: "ds-sensors", key: "sensors", name: "Stream sensors", kind: "geojson",
    organizationSlug: "valley-mutual-aid", organizationName: "Valley Mutual Aid",
    availability: "unavailable", itemCount: null, coverageArea: null,
    lastSuccessAt: null, staleAfterSeconds: 3600, reason: "source unreachable",
  },
];

const client = (rows: DatasetStatus[]) =>
  ({
    listIncidentDatasets: vi.fn().mockResolvedValue(rows),
    incidentCatalog: vi.fn().mockResolvedValue([]),
  }) as unknown as ApiClient;

it("prompts to pick an incident when none is selected", () => {
  render(<IncidentDatasets client={client([])} incidentId={null} canManage={false} />);
  expect(screen.getByText("No incident selected.")).toBeTruthy();
});

it("shows a real count for available data and a dash (never zero) for missing", async () => {
  render(<IncidentDatasets client={client(datasets)} incidentId="i1" canManage={false} />);
  await waitFor(() => expect(screen.getByText("Road closures")).toBeTruthy());
  expect(screen.getByText(/items: 5/)).toBeTruthy();
  // The unavailable dataset shows a dash, not 0, and surfaces its reason.
  expect(screen.getByText(/items: —/)).toBeTruthy();
  expect(screen.getByText("Available")).toBeTruthy();
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(screen.getByText(/source unreachable/)).toBeTruthy();
});

it("hides the onboarding form for a viewer who cannot manage", async () => {
  render(<IncidentDatasets client={client(datasets)} incidentId="i1" canManage={false} />);
  await waitFor(() => expect(screen.getByText("Road closures")).toBeTruthy());
  expect(screen.queryByText("Onboard a data pack")).toBeNull();
});
