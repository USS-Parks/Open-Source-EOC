// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PoolResource, ResourceKind, ResourceRequestDetail, ResourceRequestSummary } from "@openeoc/shared";
import { ResourcesSurface } from "../surfaces/ResourcesSurface.js";
import type { ApiClient } from "../api/client.js";

afterEach(cleanup);

const request: ResourceRequestSummary = {
  id: "11111111-1111-4111-8111-111111111111", incidentId: "22222222-2222-4222-8222-222222222222",
  item: "Portable water tender", quantity: 2, priority: "immediate", state: "sourcing",
  receivingOrganization: { id: "33333333-3333-4333-8333-333333333333", name: "Receiving County" },
  supplyingOrganization: null, assignment: null,
  resourceKind: "water_tender", resourceType: 2, costCents: 540005,
};
const levels = (count: number) => Array.from({ length: count }, (_, index) => ({ type: index + 1, capability: "" }));
const kinds: ResourceKind[] = [
  { key: "engine", name: "Engine", discipline: "Fire", levels: levels(7), notes: "", source: "seed", rtltId: null, sourceNote: "starter" },
  { key: "water_tender", name: "Water Tender", discipline: "Fire", levels: levels(3), notes: "", source: "seed", rtltId: null, sourceNote: "starter" },
];
const pooled = (id: string, name: string, kind: string, type: number, extra: Partial<PoolResource> = {}): PoolResource => ({
  id, name, kind, type, status: "available", request: null, returnCondition: null, demobilizationChecks: [], updatedAt: "2026-09-23T12:00:00.000Z", ...extra,
});
const pool: PoolResource[] = [
  pooled("a1111111-1111-4111-8111-111111111111", "Engine 3", "engine", 3),
  pooled("a2222222-2222-4222-8222-222222222222", "Engine 44", "engine", 4, { status: "assigned", request: { id: "99999999-9999-4999-8999-999999999999", item: "Structure protection" } }),
  pooled("a3333333-3333-4333-8333-333333333333", "Tender 7", "water_tender", 1),
];
const detail: ResourceRequestDetail = {
  ...request,
  chronology: [{ fromState: "triaged", toState: "sourcing", note: "Local supply exhausted", by: "Logistics", at: "2026-09-21T12:00:00.000Z" }],
};

function setup(
  options: { canMutate?: boolean; closed?: boolean } = {},
  requests: readonly ResourceRequestSummary[] = [request],
  canManage = false,
) {
  const client = {
    listResourceKinds: vi.fn().mockResolvedValue({ kinds, canManage }),
    listResources: vi.fn().mockResolvedValue(pool),
    addResource: vi.fn().mockResolvedValue({ id: "a4444444-4444-4444-8444-444444444444" }),
    transitionResource: vi.fn().mockResolvedValue({ status: "assigned" }),
    addResourceKind: vi.fn().mockResolvedValue({ key: "local:sandbag-machine" }),
    importResourceKinds: vi.fn().mockResolvedValue({ imported: 2 }),
    listResourceRequests: vi.fn().mockResolvedValue(requests),
    listPositions: vi.fn().mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444", key: "logistics", title: "Logistics Section Chief" }]),
    listIncidentParticipants: vi.fn().mockResolvedValue([{ id: "55555555-5555-4555-8555-555555555555", organizationId: "66666666-6666-4666-8666-666666666666", organizationName: "Mutual Aid", personName: "Morgan Lee", incidentPositionTitle: "Mutual Aid Logistics", role: "contributor", revokedAt: null, expiresAt: "2099-09-21T00:00:00.000Z" }]),
    getResourceRequest: vi.fn().mockResolvedValue(detail),
    submitResourceRequest: vi.fn().mockResolvedValue({ id: request.id }),
    transitionResourceRequest: vi.fn().mockResolvedValue({ state: "triaged" }),
    assignResourceRequest: vi.fn().mockResolvedValue({ state: "assigned" }),
    addResourceRequestCost: vi.fn().mockResolvedValue({ id: "88888888-8888-4888-8888-888888888888" }),
    exportResourceRequestCosts: vi.fn().mockResolvedValue(new Blob(["Request,Item\n"], { type: "text/csv" })),
    escalateResourceRequest: vi.fn().mockResolvedValue({ ok: true }),
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

it("records a cost in cents, exports the costs, and escalates to a peer tier after a failed delivery", async () => {
  const client = setup();
  client.escalateResourceRequest.mockRejectedValueOnce(new Error("escalation delivery failed"));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:costs") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  fireEvent.click(await screen.findByRole("button", { name: "History" }));
  const costs = await screen.findByRole("region", { name: "Reimbursement costs" });
  fireEvent.change(within(costs).getByLabelText("Cost category"), { target: { value: "equipment" } });
  fireEvent.change(within(costs).getByLabelText("Amount (USD)"), { target: { value: "$5,400.05" } });
  fireEvent.change(within(costs).getByLabelText("Incurred on"), { target: { value: "2026-09-21" } });
  fireEvent.click(within(costs).getByRole("button", { name: "Record cost" }));
  await waitFor(() => expect(client.addResourceRequestCost).toHaveBeenCalledWith(request.id, {
    category: "equipment", amountCents: 540005, incurredAt: "2026-09-21",
  }));
  expect(await screen.findByText("Cost recorded: equipment, $5400.05.")).toBeTruthy();
  fireEvent.click(within(costs).getByRole("button", { name: "Export costs (CSV)" }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  expect(client.exportResourceRequestCosts).toHaveBeenCalledWith(request.id);

  const escalation = screen.getByRole("region", { name: "Escalate to another tier" });
  fireEvent.change(within(escalation).getByLabelText("Peer name"), { target: { value: "State OES" } });
  fireEvent.change(within(escalation).getByLabelText("Peer address"), { target: { value: "https://state.example" } });
  fireEvent.change(within(escalation).getByLabelText("Peer token"), { target: { value: "issued-token" } });
  fireEvent.click(within(escalation).getByRole("button", { name: "Escalate request" }));
  expect((await screen.findByRole("alert")).textContent).toBe("escalation delivery failed");
  expect(client.getResourceRequest).toHaveBeenCalledTimes(1);
  fireEvent.click(within(escalation).getByRole("button", { name: "Escalate request" }));
  await waitFor(() => expect(client.escalateResourceRequest).toHaveBeenLastCalledWith(request.id, {
    peerName: "State OES", peerBaseUrl: "https://state.example", peerToken: "issued-token",
  }));
  expect(await screen.findByText(/Escalated to State OES/)).toBeTruthy();
  await waitFor(() => expect(client.getResourceRequest).toHaveBeenCalledTimes(2));
  expect((within(escalation).getByLabelText("Peer token") as HTMLInputElement).value).toBe("");
});

it("refuses an unreadable cost amount without calling the server", async () => {
  const client = setup();
  fireEvent.click(await screen.findByRole("button", { name: "History" }));
  const costs = await screen.findByRole("region", { name: "Reimbursement costs" });
  fireEvent.change(within(costs).getByLabelText("Cost category"), { target: { value: "fuel" } });
  fireEvent.change(within(costs).getByLabelText("Amount (USD)"), { target: { value: "12.345" } });
  fireEvent.click(within(costs).getByRole("button", { name: "Record cost" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Enter the amount in dollars, for example 5400.00.");
  expect(client.addResourceRequestCost).not.toHaveBeenCalled();
});

it("keeps request history visible while an incident is closed or access is read-only", async () => {
  setup({ canMutate: false, closed: true });
  expect(await screen.findByText("This incident is closed. Request history remains available.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Submit request" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Assign and advance" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  expect(await screen.findByRole("button", { name: "Export costs (CSV)" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Record cost" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Escalate to another tier" })).toBeNull();
});

it("refreshes request data without discarding another row's selected assignee", async () => {
  const nextRequest: ResourceRequestSummary = { ...request, id: "77777777-7777-4777-8777-777777777777", item: "Medical oxygen", state: "submitted", costCents: 0 };
  const client = setup({}, [request, nextRequest]);
  const assignment = await screen.findByLabelText("Assignment for Portable water tender") as HTMLSelectElement;
  fireEvent.change(assignment, { target: { value: "participant:55555555-5555-4555-8555-555555555555" } });
  fireEvent.click(within(screen.getByText("Medical oxygen").closest("li")!).getByRole("button", { name: "Advance" }));
  await waitFor(() => expect(client.transitionResourceRequest).toHaveBeenCalledWith(nextRequest.id, "triaged", ""));
  await waitFor(() => expect(client.listResourceRequests).toHaveBeenCalledTimes(2));
  expect(assignment.value).toBe("participant:55555555-5555-4555-8555-555555555555");
});

it("submits a typed request and adds a typed resource to the pool", async () => {
  const client = setup();
  const intake = screen.getByRole("region", { name: "Request intake" });
  fireEvent.change(within(intake).getByLabelText("Requested item"), { target: { value: "Engine strike team" } });
  await within(intake).findByRole("option", { name: "Engine" });
  fireEvent.change(within(intake).getByLabelText("Resource kind"), { target: { value: "engine" } });
  fireEvent.change(within(intake).getByLabelText("Resource type"), { target: { value: "3" } });
  fireEvent.click(within(intake).getByRole("button", { name: "Submit request" }));
  await waitFor(() => expect(client.submitResourceRequest).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333",
    expect.objectContaining({ item: "Engine strike team", resourceKind: "engine", resourceType: 3 })));

  const poolPanel = screen.getByRole("region", { name: "Resource pool" });
  fireEvent.change(within(poolPanel).getByLabelText("Resource name"), { target: { value: "Tender 9" } });
  fireEvent.click(within(poolPanel).getByRole("button", { name: "Add to pool" }));
  expect((await within(poolPanel).findByRole("alert")).textContent).toBe("Enter the resource name and choose its kind.");
  expect(client.addResource).not.toHaveBeenCalled();
  fireEvent.change(within(poolPanel).getByLabelText("Resource kind"), { target: { value: "water_tender" } });
  fireEvent.change(within(poolPanel).getByLabelText("Resource type"), { target: { value: "1" } });
  fireEvent.click(within(poolPanel).getByRole("button", { name: "Add to pool" }));
  await waitFor(() => expect(client.addResource).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333", { name: "Tender 9", kind: "water_tender", type: 1 }));
});

it("offers a resource only the requests its kind and type can fill, and demobilizes with checks", async () => {
  const client = setup();
  const engine3 = within(await screen.findByLabelText("Request for Engine 3") as HTMLSelectElement);
  expect(engine3.getAllByRole("option").map((option) => option.textContent)).toEqual(["No open request of this kind and type"]);
  const tender = screen.getByLabelText("Request for Tender 7") as HTMLSelectElement;
  expect([...tender.options].map((option) => option.textContent)).toEqual(["Choose a request", "Portable water tender (Water Tender, Type 2)"]);
  fireEvent.change(tender, { target: { value: request.id } });
  fireEvent.click(within(tender.closest("li")!).getByRole("button", { name: "Update status" }));
  await waitFor(() => expect(client.transitionResource).toHaveBeenCalledWith("a3333333-3333-4333-8333-333333333333", { to: "assigned", requestId: request.id }));

  const engine44 = screen.getByText("Engine 44").closest("li")!;
  expect(within(engine44).getByText("Assigned to request: Structure protection")).toBeTruthy();
  fireEvent.change(within(engine44).getByLabelText("Next status for Engine 44"), { target: { value: "demobilized" } });
  fireEvent.change(within(engine44).getByLabelText("Return condition for Engine 44"), { target: { value: "needs_service" } });
  fireEvent.click(within(engine44).getByLabelText("Equipment and supplies returned"));
  fireEvent.click(within(engine44).getByLabelText("Time and cost records submitted"));
  fireEvent.click(within(engine44).getByRole("button", { name: "Update status" }));
  await waitFor(() => expect(client.transitionResource).toHaveBeenCalledWith("a2222222-2222-4222-8222-222222222222", {
    to: "demobilized", returnCondition: "needs_service", checks: ["equipment_returned", "records_submitted"],
  }));
});

it("totals recorded costs by kind and shows catalog changes to administrators only", async () => {
  setup();
  const rollup = await screen.findByRole("region", { name: "Cost rollup" });
  await within(rollup).findByText("Water Tender total");
  expect(within(rollup).getAllByText("$5,400.05")).toHaveLength(3);
  const catalog = await screen.findByRole("region", { name: "Resource typing catalog" });
  expect(within(catalog).getByText("Show the 2 kinds")).toBeTruthy();
  expect(within(catalog).queryByRole("region", { name: "Add a local kind" })).toBeNull();
  cleanup();

  const client = setup({}, [request], true);
  const add = await screen.findByRole("region", { name: "Add a local kind" });
  fireEvent.change(within(add).getByLabelText("Kind name"), { target: { value: "Sandbag Machine" } });
  fireEvent.change(within(add).getByLabelText("Type levels (blank for a single type)"), { target: { value: "2" } });
  fireEvent.click(within(add).getByRole("button", { name: "Add kind" }));
  await waitFor(() => expect(client.addResourceKind).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333", {
    name: "Sandbag Machine", discipline: "", notes: "", levels: [{ type: 1, capability: "" }, { type: 2, capability: "" }],
  }));
  expect(await screen.findByText("Added Sandbag Machine to the catalog.")).toBeTruthy();
  expect(client.listResourceKinds).toHaveBeenCalledTimes(2);
});
