// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ImpactContributionPage,
  ImpactSourceAggregate,
  IncidentImpactAnalysis,
  ViewportBbox,
} from "@openeoc/shared";
import { ImpactKpiPanel, type ImpactKpiClient } from "../ImpactKpiPanel.js";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const SOURCE: ImpactSourceAggregate = {
  catalogSourceId: "humboldt-parcels",
  datasetId: "dataset-1",
  datasetKey: "humboldt_parcels",
  datasetName: "County parcels",
  owner: "County GIS",
  license: "Public domain",
  catalogCoverage: { label: "Humboldt County", statewide: false, bbox: [-124.5, 40, -123.3, 42] },
  availability: "available",
  loadedAt: "2026-09-21T12:00:00.000Z",
  sourceVintage: "2026-09-20T00:00:00.000Z",
  coverage: "complete",
  value: 2,
  contributingRecords: 2,
  registrationsConsidered: 1,
  reason: null,
};

function analysis(bbox: ViewportBbox, value: number): IncidentImpactAnalysis {
  const known = {
    unit: "records" as const,
    availability: "available" as const,
    coverage: "complete" as const,
    reason: null,
  };
  const unknown = {
    unit: "records" as const,
    availability: "awaiting" as const,
    value: null,
    coverage: "unknown" as const,
    reason: "no successful baseline is loaded",
    sources: [],
  };
  return {
    impact: {
      incidentId: "incident-1",
      scope: { kind: "viewport", bbox },
      areaRevision: 7,
      areaGeometryAvailable: true,
      categories: {
        structures_parcels: { category: "structures_parcels", ...known, value, sources: [{ ...SOURCE, value }] },
        infrastructure_facilities: { category: "infrastructure_facilities", ...unknown },
        shelters: { category: "shelters", ...known, availability: "stale", value: 4, sources: [] },
        closures: { category: "closures", ...unknown },
        population: { category: "population", ...unknown, unit: "people" },
      },
      method: {
        spatialPredicate: "ST_Intersects",
        populationEstimate: "source population multiplied by intersected polygon geography area divided by source polygon geography area",
        populationDenominator: "source polygon geography area in square metres",
        overlapDeduplication: "distinct source_id within one selected dataset; cross-source identities are not assumed equivalent",
      },
    },
    lifelines: [],
    lifelineInterpretation: "reported incident status only; geographic exposure does not imply lifeline failure",
  };
}

it("suppresses an older viewport response and keeps null aggregates visibly unknown", async () => {
  const oldRequest = deferred<IncidentImpactAnalysis>();
  const newRequest = deferred<IncidentImpactAnalysis>();
  const getIncidentImpact = vi.fn()
    .mockReturnValueOnce(oldRequest.promise)
    .mockReturnValueOnce(newRequest.promise);
  const client = { getIncidentImpact, getImpactContributions: vi.fn() } as unknown as ImpactKpiClient;
  const view = render(<ImpactKpiPanel client={client} incidentId="incident-1" bbox={[0, 0, 10, 10]} />);
  const panel = screen.getByRole("region", { name: "Map impact indicators" });
  expect(within(panel).getAllByTestId(/^impact-kpi-/)).toHaveLength(5);
  view.rerender(<ImpactKpiPanel client={client} incidentId="incident-1" bbox={[0, 0, 5, 5]} />);
  newRequest.resolve(analysis([0, 0, 5, 5], 1));
  expect(await within(await screen.findByTestId("impact-kpi-structures_parcels")).findByText("1")).toBeTruthy();
  expect(panel.getAttribute("data-analysis-bbox")).toBe("0,0,5,5");
  oldRequest.resolve(analysis([0, 0, 10, 10], 99));
  await waitFor(() => expect(screen.queryByText("99")).toBeNull());
  expect(panel.getAttribute("data-analysis-bbox")).toBe("0,0,5,5");
  const missing = screen.getByTestId("impact-kpi-infrastructure_facilities");
  expect(missing.getAttribute("data-value-state")).toBe("unknown");
  expect(missing.textContent).toContain("no successful baseline is loaded");
  const stale = screen.getByTestId("impact-kpi-shelters");
  expect(stale.getAttribute("data-value-state")).toBe("stale");
  expect(stale.textContent).not.toContain("4");
  expect(screen.getByText(/Geographic exposure does not set lifeline condition/)).toBeTruthy();
});

it("drills source provenance with the same area revision and viewport across pages", async () => {
  const first = deferred<ImpactContributionPage>();
  const second = deferred<ImpactContributionPage>();
  const getImpactContributions = vi.fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const client = {
    getIncidentImpact: vi.fn().mockResolvedValue(analysis([0, 0, 5, 5], 2)),
    getImpactContributions,
  } as ImpactKpiClient;
  render(<ImpactKpiPanel client={client} incidentId="incident-1" bbox={[0, 0, 5, 5]} />);
  const card = await screen.findByTestId("impact-kpi-structures_parcels");
  fireEvent.click(await within(card).findByRole("button", { name: "Sources" }));
  expect(screen.getByRole("region", { name: "Map impact indicators" }).getAttribute("data-analysis-bbox"))
    .toBe("0,0,5,5");
  expect(screen.getByText("County GIS · Public domain")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View contributing records" }));
  expect(getImpactContributions).toHaveBeenCalledWith("incident-1", "dataset-1", {
    revision: 7, bbox: [0, 0, 5, 5], limit: 50,
  });
  first.resolve({
    incidentId: "incident-1", scope: { kind: "viewport", bbox: [0, 0, 5, 5] },
    areaRevision: 7, category: "structures_parcels", source: SOURCE,
    records: [{ sourceId: "parcel-a", data: { name: "Parcel A" }, geometry: null, value: 1 }],
    nextCursor: "parcel-a",
  });
  expect(await screen.findByText("Parcel A")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(getImpactContributions).toHaveBeenLastCalledWith("incident-1", "dataset-1", {
    revision: 7, bbox: [0, 0, 5, 5], cursor: "parcel-a", limit: 50,
  });
  second.resolve({
    incidentId: "incident-1", scope: { kind: "viewport", bbox: [0, 0, 5, 5] },
    areaRevision: 7, category: "structures_parcels", source: SOURCE,
    records: [{ sourceId: "parcel-b", data: { name: "Parcel B" }, geometry: null, value: 1 }],
    nextCursor: null,
  });
  expect(await screen.findByText("Parcel B")).toBeTruthy();
  expect(screen.getByText("All contributing records loaded.")).toBeTruthy();
});
