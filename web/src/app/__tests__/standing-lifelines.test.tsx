// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { COMMUNITY_LIFELINES } from "@openeoc/shared";
import { ApiError, type ApiClient } from "../api/client.js";
import { JurisdictionLifelines } from "../surfaces/JurisdictionLifelines.js";

afterEach(cleanup);

const rows = COMMUNITY_LIFELINES.values.map((lifeline) => ({
  lifeline, status: lifeline === "energy" ? "unstable" : "unknown", note: lifeline === "energy" ? "Substation 4 down" : null,
  at: lifeline === "energy" ? "2026-09-23T10:00:00Z" : null,
}));

it("lists every lifeline's standing status and records a new one for a writer", async () => {
  const client = {
    jurisdictionLifelines: vi.fn().mockResolvedValue(rows),
    setJurisdictionLifeline: vi.fn().mockResolvedValue(rows),
  };
  render(<JurisdictionLifelines client={client as unknown as ApiClient} jurisdictionId="j1" canWrite />);
  const energy = await screen.findByRole("listitem", { name: "Energy" });
  expect(within(energy).getByText("Unstable")).toBeTruthy();
  expect(within(energy).getByText("Substation 4 down")).toBeTruthy();
  expect(within(screen.getByRole("listitem", { name: "Water Systems" })).getByText("Never recorded")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Lifeline"), { target: { value: "water_systems" } });
  fireEvent.change(screen.getByLabelText("Standing status"), { target: { value: "stabilizing" } });
  fireEvent.change(screen.getByLabelText("Status note"), { target: { value: " Boil notice in effect " } });
  fireEvent.click(screen.getByRole("button", { name: "Record status" }));
  await screen.findByText("Water Systems recorded as stabilizing.");
  expect(client.setJurisdictionLifeline).toHaveBeenCalledWith("j1", { lifeline: "water_systems", status: "stabilizing", note: "Boil notice in effect" });
  expect(client.jurisdictionLifelines).toHaveBeenCalledTimes(2);
});

it("hides recording from a viewer and shows the server's refusal to a writer", async () => {
  const client = {
    jurisdictionLifelines: vi.fn().mockResolvedValue(rows),
    setJurisdictionLifeline: vi.fn().mockRejectedValue(new ApiError(409, "jurisdiction has no lifelines board")),
  };
  const view = render(<JurisdictionLifelines client={client as unknown as ApiClient} jurisdictionId="j1" canWrite={false} />);
  await screen.findByRole("listitem", { name: "Energy" });
  expect(screen.queryByRole("button", { name: "Record status" })).toBeNull();
  view.unmount();
  render(<JurisdictionLifelines client={client as unknown as ApiClient} jurisdictionId="j1" canWrite />);
  fireEvent.click(await screen.findByRole("button", { name: "Record status" }));
  expect((await screen.findByRole("alert")).textContent).toBe("jurisdiction has no lifelines board");
});
