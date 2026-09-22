// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MapSurface } from "../surfaces/MapSurface.js";
import type { ApiClient } from "../api/client.js";
vi.mock("../../cop/CopMap.js", () => {
  let mountCount = 0;
  return {
    CopMap: (props: { initialBounds: number[]; theme: string; boards: { id: string }[] }) => {
      const mountedTheme = useRef(props.theme);
      const mountedBoards = useRef(props.boards.map((b) => b.id).join(","));
      const mountId = useRef(++mountCount);
      return <div data-testid="map" data-mounted-theme={mountedTheme.current} data-mounted-boards={mountedBoards.current} data-mount-id={mountId.current}>{props.initialBounds.join(",")}</div>;
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

it("remounts the COP when the selected incident changes, and not when it stays", () => {
  const client = { listIncidentDatasets: vi.fn().mockResolvedValue([]) } as unknown as ApiClient;
  const props = { client, jurisdictionId: "j1", theme: "light" as const, collections: [], feeds: [] };
  const view = render(<MapSurface {...props} incidentId="a" incidentName="Fire A" />);
  const first = screen.getByTestId("map").getAttribute("data-mount-id");
  view.rerender(<MapSurface {...props} incidentId="a" incidentName="Fire A" />);
  expect(screen.getByTestId("map").getAttribute("data-mount-id")).toBe(first); // same incident: no remount
  view.rerender(<MapSurface {...props} incidentId="b" incidentName="Fire B" />);
  expect(screen.getByTestId("map").getAttribute("data-mount-id")).not.toBe(first); // switch tears down the old map
  expect(screen.getByText("Fire B")).toBeTruthy();
});

it("places a point from validated WGS84 coordinates with the keyboard", async () => {
  const client = {
    getBoard: vi.fn().mockResolvedValue({
      id: "roads",
      title: "Road Closures",
      role: "member",
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
