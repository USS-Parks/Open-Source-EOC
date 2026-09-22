// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IncidentAreaRevision } from "@openeoc/shared";
import { IncidentAreaEditor } from "../surfaces/IncidentAreaEditor.js";
import { ApiError, type ApiClient } from "../api/client.js";

vi.mock("../../cop/CopMap.js", () => ({ CopMap: (props: { picking: boolean; onPickPoint: (p: [number, number]) => void }) => {
  const [index, setIndex] = useState(0);
  const points: [number, number][] = [[-122, 38], [-121, 38], [-121, 39]];
  return <button disabled={!props.picking} onClick={() => { props.onPickPoint(points[index % 3]!); setIndex(index + 1); }}>Place boundary point</button>;
} }));
afterEach(cleanup);
const empty: IncidentAreaRevision = { incidentId: "incident-a", revision: 0, geometry: null, operationalPeriod: null, reason: "", createdAt: null, createdBy: null, positionId: null, createdByName: null, positionTitle: null };
const geometry = { type: "Polygon" as const, coordinates: [[[-122, 38], [-121, 38], [-121, 39], [-122, 38]]] as [number, number][][] };
function setup(overrides: Record<string, unknown> = {}, canEdit = true) {
  const client = { getIncidentArea: vi.fn().mockResolvedValue(empty), incidentAreaHistory: vi.fn().mockResolvedValue([]),
    updateIncidentArea: vi.fn().mockResolvedValue({ ...empty, revision: 1, geometry, reason: "Initial area" }), ...overrides };
  render(<IncidentAreaEditor client={client as unknown as ApiClient} incidentId="incident-a" incidentName="River Fire" theme="light" canEdit={canEdit} />);
  return client;
}
it("draws and saves a boundary with the expected revision and attributed reason", async () => {
  const client = setup();
  fireEvent.click(await screen.findByRole("button", { name: "Draw replacement boundary" }));
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Place boundary point" }));
  fireEvent.click(screen.getByRole("button", { name: "Close boundary" }));
  fireEvent.change(screen.getByLabelText("Reason for revision"), { target: { value: "Initial area" } });
  fireEvent.click(screen.getByRole("button", { name: "Save area revision" }));
  await waitFor(() => expect(client.updateIncidentArea).toHaveBeenCalledWith("incident-a", { expectedRevision: 0, geometry, operationalPeriod: null, reason: "Initial area" }));
  expect(await screen.findByText(/Revision 1./)).toBeTruthy();
});
it("accepts an ordered coordinate boundary when pointer input is impractical", async () => {
  const client = setup();
  for (const [longitude, latitude] of [["-122", "38"], ["-121", "38"], ["-121", "39"]]) {
    fireEvent.change(await screen.findByLabelText("Longitude"), { target: { value: longitude } });
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: latitude } });
    fireEvent.click(screen.getByRole("button", { name: "Add coordinate" }));
  }
  fireEvent.click(screen.getByRole("button", { name: "Close boundary" }));
  fireEvent.change(screen.getByLabelText("Reason for revision"), { target: { value: "Coordinate entry" } });
  fireEvent.click(screen.getByRole("button", { name: "Save area revision" }));
  await waitFor(() => expect(client.updateIncidentArea).toHaveBeenCalledWith("incident-a", {
    expectedRevision: 0, geometry, operationalPeriod: null, reason: "Coordinate entry",
  }));
});
it("refuses an incomplete coordinate entry", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Add coordinate" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Enter both longitude and latitude"));
  expect(screen.queryByRole("button", { name: "Close boundary" })).toBeNull();
});
it("retains the operator draft after a revision conflict", async () => {
  setup({ updateIncidentArea: vi.fn().mockRejectedValue(new ApiError(409, "revision conflict")) });
  fireEvent.change(await screen.findByLabelText("Reason for revision"), { target: { value: "Awaiting aerial report" } });
  fireEvent.click(screen.getByRole("button", { name: "Save area revision" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Your draft is retained"));
  expect((screen.getByLabelText("Reason for revision") as HTMLInputElement).value).toBe("Awaiting aerial report");
});
it("does not let a history preview overwrite the current draft", async () => {
  setup({ incidentAreaHistory: vi.fn().mockResolvedValue([{ ...empty, revision: 1, reason: "Earlier boundary", geometry }]) });
  fireEvent.change(await screen.findByLabelText("Reason for revision"), { target: { value: "Current draft" } });
  fireEvent.click(await screen.findByRole("button", { name: "View revision 1" }));
  expect(screen.queryByRole("button", { name: "Save area revision" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Return to current draft" }));
  expect((screen.getByLabelText("Reason for revision") as HTMLInputElement).value).toBe("Current draft");
});
it("keeps closed or read-only incident areas inspectable without editing controls", async () => {
  setup({}, false);
  expect(await screen.findByText(/operational area is not yet defined/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save area revision" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Draw replacement boundary" })).toBeNull();
});
it("requires a complete operational period before sending an update", async () => {
  const client = setup();
  fireEvent.change(await screen.findByLabelText("Operational period"), { target: { value: "OP 1" } });
  fireEvent.change(screen.getByLabelText("Reason for revision"), { target: { value: "Period begins" } });
  fireEvent.click(screen.getByRole("button", { name: "Save area revision" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("period name, start and end"));
  expect(client.updateIncidentArea).not.toHaveBeenCalled();
});
