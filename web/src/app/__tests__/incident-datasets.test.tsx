// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IncidentDatasets, recordsFromJson } from "../surfaces/IncidentDatasets.js";
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
  const available = screen.getByText("Road closures").closest("li")!;
  expect(within(available).getByText("5")).toBeTruthy();
  // The unavailable dataset shows a dash, not 0, and surfaces its reason.
  const unavailable = screen.getByText("Stream sensors").closest("li")!;
  expect(within(unavailable).getAllByText("—").length).toBeGreaterThan(0);
  expect(screen.getByText("Usable")).toBeTruthy();
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(screen.getByText(/source unreachable/)).toBeTruthy();
});

it("hides the onboarding form for a viewer who cannot manage", async () => {
  render(<IncidentDatasets client={client(datasets)} incidentId="i1" canManage={false} />);
  await waitFor(() => expect(screen.getByText("Road closures")).toBeTruthy());
  expect(screen.queryByText("Register a source")).toBeNull();
  expect(screen.queryByText("Load records")).toBeNull();
});

it("loads a GeoJSON file's features into the chosen dataset and reports the server's tally", async () => {
  const api = client(datasets);
  const loadDataset = vi.fn().mockResolvedValue({ key: "sensors", availability: "available", itemCount: 2, received: 3, accepted: 2, rejected: 1 });
  Object.assign(api, { loadDataset });
  render(<IncidentDatasets client={api} incidentId="i1" canManage />);
  fireEvent.change(await screen.findByLabelText("Dataset to load"), { target: { value: "ds-sensors" } });
  const features = [{ type: "Feature", properties: { id: "s1" }, geometry: null }];
  const file = new File([JSON.stringify({ type: "FeatureCollection", features })], "sensors.geojson");
  fireEvent.change(screen.getByLabelText("Records file"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Load records" }));
  await screen.findByText("2 of 3 records accepted, 1 rejected.");
  expect(loadDataset).toHaveBeenCalledWith("ds-sensors", features);
});

it("reads records from an array, a FeatureCollection or a records object, and refuses anything else", () => {
  expect(recordsFromJson("[1,2]")).toEqual([1, 2]);
  expect(recordsFromJson('{"type":"FeatureCollection","features":[{"a":1}]}')).toEqual([{ a: 1 }]);
  expect(recordsFromJson('{"records":[{"b":2}]}')).toEqual([{ b: 2 }]);
  expect(() => recordsFromJson("{")).toThrow("not valid JSON");
  expect(() => recordsFromJson('{"rows":[]}')).toThrow("must hold an array of records");
});
