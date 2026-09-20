// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { useRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MapSurface } from "../surfaces/MapSurface.js";
import type { ApiClient } from "../api/client.js";
vi.mock("../../cop/CopMap.js", () => ({
  CopMap: (props: { initialBounds: number[]; theme: string; boards: { id: string }[] }) => {
    const mountedTheme = useRef(props.theme);
    const mountedBoards = useRef(props.boards.map((b) => b.id).join(","));
    return <div data-testid="map" data-mounted-theme={mountedTheme.current} data-mounted-boards={mountedBoards.current}>{props.initialBounds.join(",")}</div>;
  },
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
