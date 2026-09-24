// @vitest-environment jsdom
import { lazy, Suspense } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LoadBoundary, Loading } from "../screens/parts.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows a screen whose module failed to load with a reload, and leaves the rest usable", async () => {
  // React reports the caught load failure on the console.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const reload = vi.fn();
  vi.stubGlobal("location", { ...location, reload });
  const Reports = lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
  const openMap = vi.fn();
  render(<>
    <button type="button" onClick={openMap}>Map</button>
    <LoadBoundary name="Reports"><Suspense fallback={<Loading label="Loading reports…" />}><Reports /></Suspense></LoadBoundary>
  </>);

  expect((await screen.findByRole("alert")).textContent)
    .toBe("Reports could not be loaded. Check the network connection, then reload the page.");
  fireEvent.click(screen.getByRole("button", { name: "Map" }));
  expect(openMap).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
  expect(reload).toHaveBeenCalledTimes(1);
});

it("announces a loading note as a polite status", () => {
  render(<Loading label="Loading reports…" />);
  expect(screen.getByRole("status").textContent).toBe("Loading reports…");
});
