// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import type { CatalogEntryStatus, DatasetStatus } from "@openeoc/shared";
import type { ApiClient, FeedHealth } from "../api/client.js";
import { IncidentDatasets } from "../surfaces/IncidentDatasets.js";
import { FeedsSurface } from "../surfaces/FeedsSurface.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const catalog: CatalogEntryStatus[] = [{
  id: "caltrans-road-closures", category: "roads_closures", name: "Caltrans road closures",
  owner: "California Department of Transportation", ownerSlug: "caltrans", license: "Public domain",
  coverage: { label: "California statewide", statewide: true, bbox: [-124.48, 32.53, -114.13, 42.01] },
  kind: "geojson", url: "https://example.test/closures", fieldMapping: {
    title: "properties.location", status: "properties.status", sourceId: "properties.id", geometry: "geometry",
  },
  refreshMethod: "poll", cadenceSeconds: 3600, staleAfterSeconds: 3600,
  available: true, coversIncident: true, onboarded: false,
}];

const datasets: DatasetStatus[] = [{
  id: "awaiting", key: "awaiting", name: "Registered only", kind: "geojson",
  organizationSlug: "yurok", organizationName: "Yurok Tribe OES", availability: "awaiting",
  itemCount: null, coverageArea: 100, lastSuccessAt: null, staleAfterSeconds: 3600,
  reason: null, lastReceived: null, lastRejected: null,
}, {
  id: "last-good", key: "last_good", name: "Road closures", kind: "geojson",
  organizationSlug: "yurok", organizationName: "Yurok Tribe OES", availability: "stale",
  itemCount: 7, coverageArea: 100, lastSuccessAt: "2026-09-21T18:00:00.000Z", staleAfterSeconds: 3600,
  reason: "upstream timeout", lastReceived: 9, lastRejected: 2,
}];

function datasetClient(): ApiClient {
  return {
    listIncidentDatasets: vi.fn().mockResolvedValue(datasets),
    incidentCatalog: vi.fn().mockResolvedValue(catalog),
    registerDataPack: vi.fn().mockResolvedValue({ pack: { id: "p1", datasetKeys: ["roads"] } }),
    onboardCatalogSource: vi.fn().mockResolvedValue({ pack: { id: "p2", datasetKeys: ["caltrans"] } }),
  } as unknown as ApiClient;
}

const feeds: FeedHealth[] = [{
  id: "feed-1", name: "County alerts", kind: "cap", mode: "poll", enabled: true,
  stale: true, ageSeconds: 7200, staleAfterSeconds: 900,
  lastSuccessAt: "2026-09-21T17:00:00.000Z", lastError: "feed responded 503",
  consecutiveFailures: 2, ingestAuthorized: true, currentItemCount: 4,
}, {
  id: "feed-2", name: "Registered feed", kind: "geojson", mode: "push", enabled: true,
  stale: true, ageSeconds: null, staleAfterSeconds: 900,
  lastSuccessAt: null, lastError: null, consecutiveFailures: 0, ingestAuthorized: true, currentItemCount: 0,
}, {
  id: "feed-3", name: "Demoted source owner", kind: "geojson", mode: "push", enabled: true,
  stale: true, ageSeconds: 7200, staleAfterSeconds: 900,
  lastSuccessAt: "2026-09-21T16:00:00.000Z", lastError: null, consecutiveFailures: 0,
  ingestAuthorized: false, currentItemCount: 3,
}];

function feedClient(): ApiClient {
  return {
    listFeeds: vi.fn().mockResolvedValue(feeds),
    pollFeed: vi.fn().mockResolvedValue({ ok: false, error: "feed responded 503" }),
    createFeed: vi.fn().mockResolvedValue({ id: "feed-2", ingestToken: "once-only" }),
  } as unknown as ApiClient;
}

describe("source readiness", () => {
  it("separates registration from usable ingestion and explains last-good data", async () => {
    const client = datasetClient();
    const { container } = render(<IncidentDatasets client={client} incidentId="incident-1" canManage />);
    await screen.findByText("Registered only");
    expect(screen.getByText("Registered · awaiting ingestion")).toBeTruthy();
    const stale = screen.getByText("Road closures").closest("li")!;
    expect(within(stale).getByText("Last-good data")).toBeTruthy();
    expect(within(stale).getByText("Stored items").parentElement?.querySelector("dd")?.textContent).toBe("7");
    expect(within(stale).getByText("Last-good accepted").parentElement?.querySelector("dd")?.textContent).toBe("7");
    expect(within(stale).getByText("Last-good rejected").parentElement?.querySelector("dd")?.textContent).toBe("2");
    expect(within(stale).getByText("2")).toBeTruthy();
    expect(stale.textContent).toContain("upstream timeout");
    expect(stale.textContent).toContain("Stored last-good items remain available");

    fireEvent.click(screen.getByText("Mapping preview"));
    expect(screen.getByText("properties.location")).toBeTruthy();
    expect(screen.getByText("properties.status")).toBeTruthy();
    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("builds structured mapping and coverage without operator JSON", async () => {
    const client = datasetClient();
    render(<IncidentDatasets client={client} incidentId="incident-1" canManage />);
    await screen.findByText("Caltrans road closures");
    fireEvent.change(screen.getByLabelText("Pack name"), { target: { value: "County operations" } });
    fireEvent.change(screen.getByLabelText("Owning organization code"), { target: { value: "yurok" } });
    fireEvent.change(screen.getByLabelText("Dataset key"), { target: { value: "county_roads" } });
    fireEvent.change(screen.getByLabelText("Dataset name"), { target: { value: "County roads" } });
    fireEvent.change(screen.getByLabelText("Coverage definition"), { target: { value: "bbox" } });
    for (const [label, value] of [["West", "-124.2"], ["South", "40.1"], ["East", "-123.7"], ["North", "41.1"]] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText("Status path"), { target: { value: "properties.state" } });
    fireEvent.click(screen.getByRole("button", { name: "Register source" }));
    await waitFor(() => expect(client.registerDataPack).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.registerDataPack).mock.calls[0]![1]).toMatchObject({
      datasets: [{
        fieldMapping: { title: "properties.name", status: "properties.state", geometry: "geometry" },
        coverage: { type: "Polygon" },
      }],
    });
    expect(screen.queryByLabelText(/JSON/i)).toBeNull();
  });

  it("shows feed errors beside retained items and keeps rejected counts honest", async () => {
    const client = feedClient();
    const { container } = render(<FeedsSurface client={client} jurisdictionId="jurisdiction-1" isAdmin />);
    await screen.findByText("County alerts");
    const row = screen.getByText("County alerts").closest("li")!;
    expect(within(row).getByText("Last-good data")).toBeTruthy();
    expect(within(row).getByText("4")).toBeTruthy();
    expect(within(row).getByText("Unavailable")).toBeTruthy();
    expect(row.textContent).toContain("feed responded 503");
    expect(row.textContent).toContain("per-record rejected count is not available");
    const awaiting = screen.getByText("Registered feed").closest("li")!;
    expect(within(awaiting).getByText("Awaiting first update")).toBeTruthy();
    expect(within(awaiting).getAllByText("—").length).toBeGreaterThan(0);
    const unauthorized = screen.getByText("Demoted source owner").closest("li")!;
    expect(within(unauthorized).getByText("Authorization required")).toBeTruthy();
    expect(unauthorized.textContent).toContain("Stored last-good items remain available");
    fireEvent.click(within(row).getByRole("button", { name: "Poll now" }));
    await waitFor(() => expect(client.pollFeed).toHaveBeenCalledWith("feed-1"));
    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("uses explicit push delivery and displays the token once", async () => {
    const client = feedClient();
    render(<FeedsSurface client={client} jurisdictionId="jurisdiction-1" isAdmin />);
    await screen.findByText("County alerts");
    fireEvent.change(screen.getByLabelText("Feed name"), { target: { value: "Field positions" } });
    fireEvent.change(screen.getByLabelText("Delivery"), { target: { value: "push" } });
    expect(screen.queryByLabelText("Source URL")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add feed" }));
    await screen.findByText("Push ingest token · shown once");
    expect(screen.getByText("once-only")).toBeTruthy();
    expect(client.createFeed).toHaveBeenCalledWith("jurisdiction-1", expect.objectContaining({ push: true }));
  });
});
