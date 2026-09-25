// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MapSurface } from "../surfaces/MapSurface.js";
import type { ApiClient } from "../api/client.js";
vi.mock("../../cop/CopMap.js", () => {
  let mountCount = 0;
  return {
    CopMap: (props: {
      initialBounds: number[];
      theme: string;
      boards: { id: string }[];
      requestedFeature?: { datasetId: string; featureId: string } | null;
      onInspectFeature?: (feature: { datasetId: string; featureId: string; title: string }) => void;
      exportContext?: { incidentName?: string | null; operationalPeriod?: string | null; handling?: string | null };
      overlay?: React.ReactNode;
      inspectorExtra?: React.ReactNode;
    }) => {
      const mountedTheme = useRef(props.theme);
      const mountedBoards = useRef(props.boards.map((b) => b.id).join(","));
      const mountId = useRef(++mountCount);
      return <div data-testid="map" data-mounted-theme={mountedTheme.current} data-mounted-boards={mountedBoards.current} data-mount-id={mountId.current}
        data-export-incident={props.exportContext?.incidentName ?? ""} data-export-period={props.exportContext?.operationalPeriod ?? ""}
        data-export-handling={props.exportContext?.handling ?? ""}
        data-requested-feature={props.requestedFeature ? `${props.requestedFeature.datasetId}/${props.requestedFeature.featureId}` : undefined}>
        {props.initialBounds.join(",")}
        {props.requestedFeature && props.onInspectFeature ? <button type="button" onClick={() => props.onInspectFeature?.({
          datasetId: props.requestedFeature!.datasetId,
          featureId: props.requestedFeature!.featureId,
          title: "County Route 7 closure",
        })}>Inspect routed feature</button> : null}
        {props.overlay}
        {props.inspectorExtra ? <aside aria-label="Selected map feature">{props.inspectorExtra}</aside> : null}
      </div>;
    },
  };
});
vi.mock("../../boards/RecordForm.js", () => ({
  RecordForm: (props: { initial: Record<string, unknown> }) => (
    <output data-testid="record-initial">{JSON.stringify(props.initial)}</output>
  ),
}));
afterEach(() => { cleanup(); delete (globalThis as { OPENEOC?: unknown }).OPENEOC; });
it("keeps a California basemap available for a new jurisdiction with no operational layers", async () => {
  render(<MapSurface client={{} as ApiClient} theme="light" jurisdictionId="new" collections={[]} feeds={[]} />);
  expect(await screen.findByTestId("map")).toBeTruthy();
  expect(screen.getByTestId("map").textContent).toBe("-124.5,32.5,-114.1,42.01");
  expect(screen.getByText("No operational layers yet")).toBeTruthy();
});
it("uses the deployment jurisdiction extent", () => {
  (globalThis as { OPENEOC?: unknown }).OPENEOC = { OPENEOC_MAP_BOUNDS: "-117.3,32.5,-116.8,33.1" };
  render(<MapSurface client={{} as ApiClient} theme="dark" jurisdictionId="san-diego" collections={[]} feeds={[]} />);
  expect(screen.getByTestId("map").textContent).toBe("-117.3,32.5,-116.8,33.1");
});

it("remounts the map style when the operator changes theme", () => {
  const props = { client: {} as ApiClient, jurisdictionId: "new", collections: [], feeds: [] };
  const view = render(<MapSurface {...props} theme="light" />);
  view.rerender(<MapSurface {...props} theme="dark" />);
  expect(screen.getByTestId("map").getAttribute("data-mounted-theme")).toBe("dark");
});

it("remounts when operational layers arrive after the empty map", () => {
  const props = { client: {} as ApiClient, jurisdictionId: "new", theme: "light" as const, feeds: [] };
  const view = render(<MapSurface {...props} collections={[]} />);
  view.rerender(<MapSurface {...props} collections={[{ id: "damage", title: "Damage assessments" }]} />);
  expect(screen.getByTestId("map").getAttribute("data-mounted-boards")).toBe("damage");
});

it("passes the selected incident and operational period to the PNG export receipt", () => {
  const client = { listIncidentDatasets: vi.fn().mockResolvedValue([]) } as unknown as ApiClient;
  render(<MapSurface client={client} theme="light" jurisdictionId="j1" collections={[]} feeds={[]}
    incidentId="incident-1" incidentName="North Coast Storm" operationalPeriod="OP 3 · 1800-0600" handlingMarking="FOUO" />);
  expect(screen.getByTestId("map").getAttribute("data-export-incident")).toBe("North Coast Storm");
  expect(screen.getByTestId("map").getAttribute("data-export-period")).toBe("OP 3 · 1800-0600");
  expect(screen.getByTestId("map").getAttribute("data-export-handling")).toBe("FOUO");
});

it("remounts the COP when the selected incident changes, and not when it stays", () => {
  const client = { listIncidentDatasets: vi.fn().mockResolvedValue([]) } as unknown as ApiClient;
  const props = { client, jurisdictionId: "j1", theme: "light" as const, collections: [], feeds: [] };
  const view = render(<MapSurface {...props} incidentId="a" incidentName="Fire A" />);
  const first = screen.getByTestId("map").getAttribute("data-mount-id");
  view.rerender(<MapSurface {...props} incidentId="a" incidentName="Fire A" />);
  expect(screen.getByTestId("map").getAttribute("data-mount-id")).toBe(first); // same incident: no remount
  view.rerender(<MapSurface {...props} incidentId="b" incidentName="Fire B" />);
  expect(screen.getByTestId("map").getAttribute("data-mount-id")).not.toBe(first); // switch tears down the old map
  expect(screen.getByTestId("map").getAttribute("data-export-incident")).toBe("Fire B");
});

it("places a point from validated WGS84 coordinates with the keyboard", async () => {
  const client = {
    getBoard: vi.fn().mockResolvedValue({
      id: "roads",
      title: "Road Closures",
      role: "member",
      canContribute: true,
      fields: [{ key: "location", label: "Location", type: "geometry", geometryKind: "point" }],
      views: [],
    }),
  } as unknown as ApiClient;
  render(
    <MapSurface
      client={client}
      theme="light"
      jurisdictionId="j1"
      collections={[{ id: "roads", title: "Road Closures" }]}
      feeds={[]}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Add point" }));
  fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "181" } });
  fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "41.3" } });
  fireEvent.click(screen.getByRole("button", { name: "Use coordinates" }));
  expect(screen.getByRole("alert").textContent).toContain("finite WGS84 coordinates");

  fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-123.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Use coordinates" }));
  expect(await screen.findByText("New map record")).toBeTruthy();
  expect(screen.getByTestId("record-initial").textContent).toContain(
    '"location":{"type":"Point","coordinates":[-123.5,41.3]}',
  );
});

it("reads an incident board's form in the incident's scope, so a partner who is not a member can place a point", async () => {
  const getBoard = vi.fn().mockResolvedValue({
    id: "roads", title: "Road Closures", role: "member", canContribute: true,
    fields: [{ key: "location", label: "Location", type: "geometry", geometryKind: "point" }], views: [],
  });
  const client = { getBoard, listIncidentDatasets: vi.fn().mockResolvedValue([]) } as unknown as ApiClient;
  render(<MapSurface client={client} theme="light" jurisdictionId="partner-org" feeds={[]}
    collections={[{ id: "roads", title: "Road Closures" }]} incidentId="incident-a" incidentBoardIds={new Set(["roads"])} />);
  fireEvent.click(screen.getByRole("button", { name: "Add point" }));
  await waitFor(() => expect(getBoard).toHaveBeenCalledWith("roads", "incident-a"));
});

it("says why the record panel is empty when the board's form fails to load", async () => {
  const client = { getBoard: vi.fn().mockRejectedValue(new Error("HTTP 500: board unavailable")) } as unknown as ApiClient;
  render(<MapSurface client={client} theme="light" jurisdictionId="j1" feeds={[]}
    collections={[{ id: "roads", title: "Road Closures" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Add point" }));
  fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-123.5" } });
  fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "41.3" } });
  fireEvent.click(screen.getByRole("button", { name: "Use coordinates" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("The form for Road Closures could not be loaded: HTTP 500: board unavailable");
});

it("links an exact routed dataset feature to a recorded assessment", async () => {
  const datasetId = "11111111-1111-4111-8111-111111111111";
  const createOperationalRelationship = vi.fn().mockResolvedValue({ id: "relationship-1" });
  const client = {
    listIncidentDatasets: vi.fn().mockResolvedValue([{
      id: datasetId,
      key: "roads",
      name: "Road closures",
      availability: "available",
      coverageArea: null,
      lastSuccessAt: "2026-09-21T12:00:00.000Z",
    }]),
    listIncidentLifelineAssessments: vi.fn().mockResolvedValue({
      states: [{ lifeline: "energy", reports: [{ id: "assessment-1" }] }],
    }),
    listIncidentEsfAssessments: vi.fn().mockResolvedValue({ states: [] }),
    createOperationalRelationship,
  } as unknown as ApiClient;
  render(<MapSurface client={client} theme="light" jurisdictionId="j1" collections={[]} feeds={[]}
    incidentId="22222222-2222-4222-8222-222222222222" focusDatasetId={datasetId} focusFeatureId="route/7" />);

  const map = await screen.findByTestId("map");
  expect(map.getAttribute("data-requested-feature")).toBe(`${datasetId}/route/7`);
  fireEvent.click(screen.getByRole("button", { name: "Inspect routed feature" }));
  // The link sits in the selected feature's panel, not over the map where that panel would cover it.
  const panel = screen.getByRole("complementary", { name: "Selected map feature" });
  expect(within(panel).getByRole("heading", { name: "Link selected dataset feature" })).toBeTruthy();
  fireEvent.change(await screen.findByLabelText("Recorded assessment"), {
    target: { value: "lifeline|fema_community_lifelines|energy" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Link selected feature" }));
  await waitFor(() => expect(createOperationalRelationship).toHaveBeenCalledWith(
    "22222222-2222-4222-8222-222222222222",
    {
      source: { domain: "lifeline", framework: "fema_community_lifelines", definitionKey: "energy" },
      target: { kind: "map_feature", datasetId, featureId: "route/7" },
    },
  ));
});
