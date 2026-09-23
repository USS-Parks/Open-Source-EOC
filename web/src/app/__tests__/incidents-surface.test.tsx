// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function setup(options: { isAdmin?: boolean; positionKey?: string | null; detail?: object } = {}) {
  const client = {
    listIncidents: vi.fn().mockResolvedValue([incident]),
    listIncidentTemplates: vi.fn().mockResolvedValue([{ key: "wildfire", title: "Wildfire" }]),
    activateIncident: vi.fn().mockResolvedValue({ incidentId: "incident-new" }),
    getIncident: vi.fn().mockResolvedValue(options.detail ?? detail),
    closeIncident: vi.fn().mockResolvedValue({ ok: true }),
    getIncidentArea: vi.fn().mockResolvedValue({ incidentId: "incident-a", revision: 0, geometry: null, operationalPeriod: null, reason: "", createdAt: null, createdBy: null, positionId: null, createdByName: null, positionTitle: null }),
    incidentAreaHistory: vi.fn().mockResolvedValue([]),
    listIncidentParticipants: vi.fn().mockResolvedValue([]),
    createLibrary: vi.fn().mockResolvedValue({ id: "lib-1" }),
    completeChecklistItem: vi.fn().mockResolvedValue({ ok: true }),
  };
  render(<IncidentsSurface client={client as unknown as ApiClient} jurisdictionId="j1" isAdmin={options.isAdmin ?? true}
    theme="light" positionKey={options.positionKey ?? null} />);
  return client;
}

const checklistItem = (id: string, positionKey: string, status: string) => ({
  id, positionKey, item: `Item ${id}`, category: "general", status, dueAt: null, revision: 1,
  assignedParticipantId: null, completedAt: null, completedByPosition: null,
});

it("adds a library for a scenario template, admin only", async () => {
  const client = setup();
  fireEvent.change(await screen.findByLabelText("Library title"), { target: { value: "Evacuation plan" } });
  fireEvent.change(screen.getByLabelText("Library kind"), { target: { value: "plan" } });
  fireEvent.change(screen.getByLabelText("Attach to incidents from"), { target: { value: "wildfire" } });
  fireEvent.change(screen.getByLabelText("Library content"), { target: { value: "Zones A to C" } });
  fireEvent.click(screen.getByRole("button", { name: "Add library" }));
  await screen.findByText("Library added. It attaches to each incident activated from Wildfire.");
  expect(client.createLibrary).toHaveBeenCalledWith("j1", { title: "Evacuation plan", kind: "plan", body: "Zones A to C", forTemplate: "wildfire" });
  cleanup();
  setup({ isAdmin: false });
  await screen.findByText("River Fire");
  expect(screen.queryByRole("button", { name: "Add library" })).toBeNull();
});

it("offers checklist completion only on items of the signed-in position", async () => {
  const withChecklists = {
    ...detail,
    checklists: [checklistItem("c1", "incident_commander", "open"), checklistItem("c2", "safety_officer", "open"),
      { ...checklistItem("c3", "incident_commander", "completed"), completedByPosition: "Incident Commander" }],
    libraries: [{ id: "lib-1", title: "Evacuation plan", kind: "plan" }],
  };
  const client = setup({ positionKey: "incident_commander", detail: withChecklists });
  fireEvent.click(await screen.findByRole("button", { name: "Operational area" }));
  const mine = await screen.findByRole("listitem", { name: "Item c1" });
  expect(within(screen.getByRole("listitem", { name: "Item c2" })).queryByRole("button")).toBeNull();
  expect(within(screen.getByRole("listitem", { name: "Item c3" })).getByText("Completed by Incident Commander")).toBeTruthy();
  expect(screen.getByText("Evacuation plan · plan")).toBeTruthy();
  fireEvent.click(within(mine).getByRole("button", { name: "Mark complete" }));
  await screen.findByText("Item c1 completed.");
  expect(client.completeChecklistItem).toHaveBeenCalledWith("c1");
});

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

it("offers collaboration and meeting actions only where each integration runs, to members of the incident's jurisdiction", async () => {
  const client = {
    listIncidents: vi.fn().mockResolvedValue([incident]),
    listIncidentTemplates: vi.fn().mockResolvedValue([]),
    getIncident: vi.fn().mockResolvedValue(detail),
    getIncidentArea: vi.fn().mockResolvedValue({ incidentId: "incident-a", revision: 0, geometry: null, operationalPeriod: null, reason: "", createdAt: null, createdBy: null, positionId: null, createdByName: null, positionTitle: null }),
    incidentAreaHistory: vi.fn().mockResolvedValue([]),
    listIncidentParticipants: vi.fn().mockResolvedValue([]),
    collabStatus: vi.fn().mockResolvedValue({ configured: false, enabled: false, kind: null, baseUrl: null }),
    listMeetingBridges: vi.fn().mockResolvedValue([]),
    listBriefings: vi.fn().mockResolvedValue([]),
  };
  const open = async (integrations: readonly string[], role?: "admin" | "member" | "viewer") => {
    cleanup();
    render(<IncidentsSurface client={client as unknown as ApiClient} jurisdictionId="j1" isAdmin={false} theme="light"
      integrations={new Set(integrations)} memberships={role ? [{ jurisdictionId: "j1", role }] : []} />);
    fireEvent.click(await screen.findByRole("button", { name: "Operational area" }));
    await screen.findByText("Incident Commander");
  };

  await open([], "admin");
  expect(screen.queryByRole("region", { name: "River Fire: collaboration channels" })).toBeNull();
  expect(screen.queryByRole("region", { name: "River Fire: meetings and briefings" })).toBeNull();

  await open(["collab", "meetings"], "member");
  await screen.findByRole("region", { name: "River Fire: collaboration channels" });
  await screen.findByRole("region", { name: "River Fire: meetings and briefings" });
  expect(screen.queryByRole("button", { name: "Set up channels" })).toBeNull();
  expect(screen.getByRole("button", { name: "Post announcement" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open bridge" })).toBeTruthy();

  await open(["collab", "meetings"]);
  expect(screen.queryByRole("region", { name: "River Fire: collaboration channels" })).toBeNull();
  expect(screen.queryByRole("region", { name: "River Fire: meetings and briefings" })).toBeNull();
});
