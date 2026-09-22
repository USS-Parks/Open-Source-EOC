// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IncidentsSurface } from "../surfaces/IncidentsSurface.js";
import type { ApiClient } from "../api/client.js";

vi.mock("../../cop/CopMap.js", () => ({ CopMap: () => <div aria-label="Operational area map" /> }));

afterEach(cleanup);

const incident = {
  id: "incident-a", jurisdictionId: "j1", name: "River Fire", kind: "incident", closedAt: null,
  canManageParticipation: true, canEditArea: true,
};
const detail = {
  ...incident,
  positions: [{ id: "p1", key: "incident_commander", title: "Incident Commander" }],
  boards: [], checklists: [], libraries: [],
};

function setup() {
  const client = {
    listIncidents: vi.fn().mockResolvedValue([incident]),
    listIncidentTemplates: vi.fn().mockResolvedValue([{ key: "wildfire", title: "Wildfire" }]),
    activateIncident: vi.fn().mockResolvedValue({ incidentId: "incident-new" }),
    getIncident: vi.fn().mockResolvedValue(detail),
    closeIncident: vi.fn().mockResolvedValue({ ok: true }),
    getIncidentArea: vi.fn().mockResolvedValue({ incidentId: "incident-a", revision: 0, geometry: null, operationalPeriod: null, reason: "", createdAt: null, createdBy: null, positionId: null, createdByName: null, positionTitle: null }),
    incidentAreaHistory: vi.fn().mockResolvedValue([]),
    listIncidentParticipants: vi.fn().mockResolvedValue([]),
  };
  render(<IncidentsSurface client={client as unknown as ApiClient} jurisdictionId="j1" isAdmin theme="light" />);
  return client;
}

it("activates the selected incident type and presents explicit relationship context", async () => {
  const client = setup();
  await screen.findByRole("button", { name: "Activate" });
  fireEvent.change(screen.getByLabelText("Incident name"), { target: { value: "Planned shelter drill" } });
  fireEvent.change(screen.getByLabelText("Incident type"), { target: { value: "planned_event" } });
  fireEvent.click(screen.getByRole("button", { name: "Activate" }));
  await waitFor(() => expect(client.activateIncident).toHaveBeenCalledWith("j1", {
    templateKey: "wildfire", name: "Planned shelter drill", kind: "planned_event",
  }));

  fireEvent.click(await screen.findByRole("button", { name: "Operational area" }));
  expect(await screen.findByText("Incident Commander")).toBeTruthy();
  expect(screen.getByText(/they do not by themselves transfer ownership or establish unified command/i)).toBeTruthy();
  expect(screen.getByText("Host owner administrator")).toBeTruthy();
});

it("requires an explicit closeout confirmation", async () => {
  const client = setup();
  await screen.findByRole("button", { name: "Close incident" });
  fireEvent.click(screen.getByRole("button", { name: "Close incident" }));
  expect(await screen.findByText(/Closeout prevents new incident updates/i)).toBeTruthy();
  expect(client.closeIncident).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm closeout" }));
  await waitFor(() => expect(client.closeIncident).toHaveBeenCalledWith("incident-a"));
});
