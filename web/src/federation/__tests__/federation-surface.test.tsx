// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiClient, BoardListItem } from "../../app/api/client.js";
import { FederationSurface } from "../FederationSurface.js";
import { waitedFor, type FederationStatus } from "../model.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const boards: BoardListItem[] = [
  { id: "b1", title: "Activity log", templateKey: "activity_log", templateVersion: 1, hasGeometry: false },
  { id: "b2", title: "Shelters", templateKey: "shelters", templateVersion: 1, hasGeometry: true },
];

const status: FederationStatus = {
  peers: [{
    id: "p1", name: "State OES", createdAt: "2026-09-22T10:00:00.000Z", endpointUrl: "https://state.example",
    tokenStored: true,
    boards: [{
      id: "a1", boardId: "b1", boardTitle: "Activity log", canRead: true, canWrite: false,
      remoteBoardId: null, pending: 2, oldestPendingAt: "2026-09-22T10:00:00.000Z",
      nextAttemptAt: "2026-09-22T10:05:00.000Z", lastError: "peer responded 503", lastDeliveredAt: null,
    }],
  }],
  received: [{ at: "2026-09-22T11:00:00.000Z", peer: "State OES", boardId: "b2", boardTitle: "Shelters", updates: 3, deletes: 2, conflicts: 1 }],
};

function client(): ApiClient {
  return {
    federationStatus: vi.fn().mockResolvedValue(status),
    registerPeer: vi.fn().mockResolvedValue({ id: "p2", token: "issued-once-token" }),
    setPeerLink: vi.fn().mockResolvedValue(undefined),
    createSharingAgreement: vi.fn().mockResolvedValue({ id: "a2" }),
  } as unknown as ApiClient;
}

describe("federation screen", () => {
  it("shows outbox standing per shared board, received batches and why entries are held", async () => {
    render(<FederationSurface client={client()} jurisdictionId="j" isAdmin boards={boards} />);
    const peer = await screen.findByRole("listitem", { name: "Partner State OES" });
    expect(within(peer).getByText("Pushing to https://state.example")).toBeTruthy();
    expect(within(peer).getByText("2 waiting")).toBeTruthy();
    const shared = within(peer).getByRole("listitem", { name: "Activity log shared with State OES" });
    expect(shared.textContent).toContain("peer responded 503");
    expect(within(shared).getByText("Held until a receiving board is set")).toBeTruthy();
    const batch = screen.getByRole("listitem", { name: "Received from State OES" });
    expect(batch.textContent).toContain("3 updates, 2 deleted, 1 conflicts reconciled");
    expect(screen.getByText(/Resource escalation keeps no stored targets/)).toBeTruthy();
  });

  it("shows a new token once, stores a link without echoing its token, and shares an unshared board", async () => {
    const api = client();
    render(<FederationSurface client={api} jurisdictionId="j" isAdmin boards={boards} />);
    const peer = await screen.findByRole("listitem", { name: "Partner State OES" });

    fireEvent.change(screen.getByLabelText("Partner name"), { target: { value: "County OES" } });
    fireEvent.click(screen.getByRole("button", { name: "Register partner" }));
    const token = await screen.findByRole("region", { name: "New partner token" });
    expect(within(token).getByText("issued-once-token")).toBeTruthy();
    fireEvent.click(within(token).getByRole("button", { name: "I have saved the token" }));
    expect(screen.queryByText("issued-once-token")).toBeNull();

    const secret = within(peer).getByLabelText("Token issued by the partner");
    expect(secret.getAttribute("type")).toBe("password");
    fireEvent.change(within(peer).getByLabelText("Partner address"), { target: { value: "https://state.example" } });
    fireEvent.change(secret, { target: { value: "partner-issued" } });
    fireEvent.click(within(peer).getByRole("button", { name: "Save push link" }));
    await screen.findByText("Push link saved for State OES.");
    expect(api.setPeerLink).toHaveBeenCalledWith("p1", "https://state.example", "partner-issued");
    expect((secret as HTMLInputElement).value).toBe("");

    // Only the board not yet shared with this partner is offered.
    const picker = within(peer).getByLabelText("Board") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Shelters"]);
    fireEvent.change(within(peer).getByLabelText("Partner access"), { target: { value: "write" } });
    fireEvent.change(within(peer).getByLabelText("Receiving board ID on the partner"), { target: { value: "not-an-id" } });
    fireEvent.click(within(peer).getByRole("button", { name: "Share board" }));
    await screen.findByRole("alert");
    expect(api.createSharingAgreement).not.toHaveBeenCalled();
    const remote = "3f2b8c1e-0d4a-4c6b-9a7e-1b2c3d4e5f60";
    fireEvent.change(within(peer).getByLabelText("Receiving board ID on the partner"), { target: { value: remote } });
    fireEvent.click(within(peer).getByRole("button", { name: "Share board" }));
    await waitFor(() => expect(api.createSharingAgreement).toHaveBeenCalledWith("p1",
      { boardId: "b2", canRead: true, canWrite: true, remoteBoardId: remote }));
  });

  it("is refused to a non-administrator without a request", () => {
    const api = client();
    render(<FederationSurface client={api} jurisdictionId="j" isAdmin={false} boards={boards} />);
    expect(screen.getByText("Federation is available to administrators.")).toBeTruthy();
    expect(api.federationStatus).not.toHaveBeenCalled();
  });

  it("words how long an entry has waited", () => {
    const now = Date.parse("2026-09-23T12:00:00.000Z");
    expect(waitedFor("2026-09-23T11:59:30.000Z", now)).toBe("under a minute");
    expect(waitedFor("2026-09-23T11:56:00.000Z", now)).toBe("4 min");
    expect(waitedFor("2026-09-23T09:55:00.000Z", now)).toBe("2 h 5 min");
    expect(waitedFor("2026-09-23T10:00:00.000Z", now)).toBe("2 h");
    expect(waitedFor("2026-09-20T12:00:00.000Z", now)).toBe("3 d");
  });
});
