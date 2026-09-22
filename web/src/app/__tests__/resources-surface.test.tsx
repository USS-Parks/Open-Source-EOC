// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ResourceRequestDetail, ResourceRequestSummary } from "@openeoc/shared";
import { ResourcesSurface } from "../surfaces/ResourcesSurface.js";
import type { ApiClient } from "../api/client.js";

afterEach(cleanup);

const request: ResourceRequestSummary = {
  id: "11111111-1111-4111-8111-111111111111", incidentId: "22222222-2222-4222-8222-222222222222",
  item: "Portable water tender", quantity: 2, priority: "immediate", state: "sourcing",
  receivingOrganization: { id: "33333333-3333-4333-8333-333333333333", name: "Receiving County" },
  supplyingOrganization: null, assignment: null,
};
const detail: ResourceRequestDetail = {
  ...request,
  chronology: [{ fromState: "triaged", toState: "sourcing", note: "Local supply exhausted", by: "Logistics", at: "2026-09-21T12:00:00.000Z" }],
};

function setup(
  options: { canMutate?: boolean; closed?: boolean } = {},
  requests: readonly ResourceRequestSummary[] = [request],
) {
  const client = {
    listResourceRequests: vi.fn().mockResolvedValue(requests),
    listPositions: vi.fn().mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444", key: "logistics", title: "Logistics Section Chief" }]),
    listIncidentParticipants: vi.fn().mockResolvedValue([{ id: "55555555-5555-4555-8555-555555555555", organizationId: "66666666-6666-4666-8666-666666666666", organizationName: "Mutual Aid", personName: "Morgan Lee", incidentPositionTitle: "Mutual Aid Logistics", role: "contributor", revokedAt: null, expiresAt: "2099-09-21T00:00:00.000Z" }]),
    getResourceRequest: vi.fn().mockResolvedValue(detail),
    submitResourceRequest: vi.fn().mockResolvedValue({ id: request.id }),
    transitionResourceRequest: vi.fn().mockResolvedValue({ state: "triaged" }),
    assignResourceRequest: vi.fn().mockResolvedValue({ state: "assigned" }),
  };
  render(<ResourcesSurface client={client as unknown as ApiClient} jurisdictionId="33333333-3333-4333-8333-333333333333" incidentId={request.incidentId} {...options} />);
  return client;
}

it("shows receiving ownership and assigns a sourcing request to a named incident participant", async () => {
  const client = setup();
  expect(await screen.findByText("Receiving: Receiving County")).toBeTruthy();
  expect(screen.getByText("Supplying: Not identified")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Assignment for Portable water tender"), { target: { value: "participant:55555555-5555-4555-8555-555555555555" } });
  fireEvent.click(screen.getByRole("button", { name: "Assign and advance" }));
  await waitFor(() => expect(client.assignResourceRequest).toHaveBeenCalledWith(request.id, {
    kind: "incident_participant", incidentId: request.incidentId, participantId: "55555555-5555-4555-8555-555555555555",
  }));
});

it("keeps intake and immutable request history in the same coordination workspace", async () => {
  const client = setup();
  fireEvent.change(screen.getByLabelText("Requested item"), { target: { value: "Portable generator" } });
  fireEvent.change(screen.getByLabelText("Request notes"), { target: { value: "Shelter backup" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  await waitFor(() => expect(client.submitResourceRequest).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333", expect.objectContaining({ item: "Portable generator", notes: "Shelter backup", incidentId: request.incidentId })));
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  expect(await screen.findByRole("heading", { name: "History" })).toBeTruthy();
  expect(screen.getByText("Local supply exhausted")).toBeTruthy();
});

it("keeps request history visible while an incident is closed or access is read-only", async () => {
  setup({ canMutate: false, closed: true });
  expect(await screen.findByText("This incident is closed. Request history remains available.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Submit request" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Assign and advance" })).toBeNull();
  expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
});

it("refreshes request data without discarding another row's selected assignee", async () => {
  const nextRequest: ResourceRequestSummary = { ...request, id: "77777777-7777-4777-8777-777777777777", item: "Medical oxygen", state: "submitted" };
  const client = setup({}, [request, nextRequest]);
  const assignment = await screen.findByLabelText("Assignment for Portable water tender") as HTMLSelectElement;
  fireEvent.change(assignment, { target: { value: "participant:55555555-5555-4555-8555-555555555555" } });
  fireEvent.click(within(screen.getByText("Medical oxygen").closest("li")!).getByRole("button", { name: "Advance" }));
  await waitFor(() => expect(client.transitionResourceRequest).toHaveBeenCalledWith(nextRequest.id, "triaged", ""));
  await waitFor(() => expect(client.listResourceRequests).toHaveBeenCalledTimes(2));
  expect(assignment.value).toBe("participant:55555555-5555-4555-8555-555555555555");
});
