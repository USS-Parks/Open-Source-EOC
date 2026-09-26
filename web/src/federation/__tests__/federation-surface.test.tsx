// @vitest-environment jsdom
import axe from "axe-core";
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

const PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAq1Wq9Yl3Tj0cQy7l3Y2d1c9p0Yh0m8m1m5l2k3j4h5g=\n-----END PUBLIC KEY-----\n";

const status: FederationStatus = {
  identity: { publicKey: PUBLIC_KEY, fingerprint: "ab".repeat(32) },
  peers: [{
    id: "p1", name: "State OES", createdAt: "2026-09-22T10:00:00.000Z", endpointUrl: "https://state.example",
    tokenStored: true, keyFingerprint: null,
    boards: [{
      id: "a1", boardId: "b1", boardTitle: "Activity log", canRead: true, canWrite: false,
      remoteBoardId: null, pending: 2, oldestPendingAt: "2026-09-22T10:00:00.000Z",
      nextAttemptAt: "2026-09-22T10:05:00.000Z", lastError: "peer responded 503", lastDeliveredAt: null,
    }],
  }],
  received: [{ at: "2026-09-22T11:00:00.000Z", peer: "State OES", boardId: "b2", boardTitle: "Shelters", updates: 3, deletes: 2, conflicts: 1, byFile: true }],
};

const BATCH_FILE = { format: "openeoc-federation-batches", version: 1, batches: [{ boardId: "rb", updates: ["AA=="], deletes: [], signature: "sig" }] };
const RECEIPT = { format: "openeoc-federation-receipt", version: 1, batches: ["ab".repeat(32)], signature: "receipt-sig" };

function client(): ApiClient {
  return {
    federationStatus: vi.fn().mockResolvedValue(status),
    registerPeer: vi.fn().mockResolvedValue({ id: "p2", token: "issued-once-token" }),
    setPeerLink: vi.fn().mockResolvedValue(undefined),
    createSharingAgreement: vi.fn().mockResolvedValue({ id: "a2" }),
    setPeerKey: vi.fn().mockResolvedValue({ fingerprint: "cd".repeat(32) }),
    revokeSharingAgreement: vi.fn().mockResolvedValue({ dropped: 2 }),
    exportBatchFile: vi.fn().mockResolvedValue({ file: BATCH_FILE, entries: 2, remaining: 1 }),
    importBatchFile: vi.fn().mockResolvedValue({ batches: 1, alreadyImported: 0, updates: 3, deleted: 1, conflicts: 0, receipt: RECEIPT }),
    importReceipt: vi.fn().mockResolvedValue({ batches: 1, delivered: 2, alreadyDelivered: 0 }),
  } as unknown as ApiClient;
}

/** Catch the browser download: each saved file's name and text. */
function catchDownloads(): Array<{ name: string; blob: Blob }> {
  const saved: Array<{ name: string; blob: Blob }> = [];
  const blobs: Blob[] = [];
  Object.assign(URL, { createObjectURL: (blob: Blob) => { blobs.push(blob); return "blob:saved"; }, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: blobs.at(-1)! });
  });
  return saved;
}

function choose(input: HTMLElement, content: string, name: string): void {
  fireEvent.change(input, { target: { files: [new File([content], name, { type: "application/json" })] } });
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
    expect(batch.textContent).toContain("From State OES by file");
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

  it("shows this instance's key to copy, records a partner's key and revokes a share after confirming", async () => {
    const api = client();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const view = render(<FederationSurface client={api} jurisdictionId="j" isAdmin boards={boards} />);
    const peer = await screen.findByRole("listitem", { name: "Partner State OES" });

    const own = screen.getByRole("region", { name: "This instance's key" });
    expect(within(own).getByText("ab".repeat(32))).toBeTruthy();
    expect(within(own).getByLabelText("This instance's public key").textContent).toBe(PUBLIC_KEY.trim());
    fireEvent.click(within(own).getByRole("button", { name: "Copy public key" }));
    await within(own).findByText("Public key copied.");
    expect(writeText).toHaveBeenCalledWith(PUBLIC_KEY);

    // A partner with no recorded key is refused, and the card says so.
    expect(within(peer).getByText("Not recorded")).toBeTruthy();
    expect(within(peer).getByText(/Batches from State OES are refused until its public key is recorded/)).toBeTruthy();
    fireEvent.click(within(peer).getByRole("button", { name: "Save partner key" }));
    await screen.findByRole("alert");
    expect(api.setPeerKey).not.toHaveBeenCalled();
    fireEvent.change(within(peer).getByLabelText("Partner's public key"), { target: { value: PUBLIC_KEY } });
    fireEvent.click(within(peer).getByRole("button", { name: "Save partner key" }));
    await screen.findByText(`Key recorded for State OES, fingerprint ${"cd".repeat(32)}.`);
    expect(api.setPeerKey).toHaveBeenCalledWith("p1", PUBLIC_KEY);
    expect((within(peer).getByLabelText("Partner's public key") as HTMLTextAreaElement).value).toBe("");

    // Revoking asks first, and says what stops and what is dropped.
    const shared = within(peer).getByRole("listitem", { name: "Activity log shared with State OES" });
    fireEvent.click(within(shared).getByRole("button", { name: "Revoke sharing" }));
    const confirm = within(shared).getByRole("group", { name: "Confirm revoke" });
    expect(confirm.textContent).toContain("Nothing more is sent to State OES or accepted from it for this board, and the 2 waiting updates are dropped.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Keep sharing" }));
    expect(api.revokeSharingAgreement).not.toHaveBeenCalled();
    fireEvent.click(within(shared).getByRole("button", { name: "Revoke sharing" }));
    fireEvent.click(within(shared).getByRole("button", { name: "Revoke agreement" }));
    await screen.findByText("Activity log is no longer shared with State OES.");
    expect(api.revokeSharingAgreement).toHaveBeenCalledWith("p1", "a1");
    expect((await axe.run(view.container)).violations).toEqual([]);
  });

  it("exchanges by file: exports the waiting batch, imports a batch file and exports its receipt, imports a receipt", async () => {
    const api = client();
    const saved = catchDownloads();
    const view = render(<FederationSurface client={api} jurisdictionId="j" isAdmin boards={boards} />);
    const peer = await screen.findByRole("listitem", { name: "Partner State OES" });
    expect(within(peer).getByText("2 updates waiting for State OES.")).toBeTruthy();

    // Export: the file is saved and the notice says what it holds and what stays.
    fireEvent.click(within(peer).getByRole("button", { name: "Export waiting updates" }));
    const exported = await screen.findByText(/^Exported 2 updates for State OES as openeoc-batches-for-state-oes-/);
    expect(exported.textContent).toContain("Carry it to State OES and import it there. 1 more update stays waiting");
    expect(api.exportBatchFile).toHaveBeenCalledWith("p1");
    expect(saved[0]!.name).toMatch(/^openeoc-batches-for-state-oes-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(await saved[0]!.blob.text())).toEqual(BATCH_FILE);

    // Import a batch file: refused without a file, then applied, and the receipt offered.
    expect(within(peer).queryByRole("button", { name: "Export receipt" })).toBeNull();
    fireEvent.click(within(peer).getByRole("button", { name: "Import batch file" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose the batch file first.");
    choose(within(peer).getByLabelText("Batch file from State OES"), JSON.stringify(BATCH_FILE), "batches.json");
    fireEvent.click(within(peer).getByRole("button", { name: "Import batch file" }));
    await screen.findByText("Imported 1 batch from State OES: 3 updates, 1 deleted. Export the receipt and carry it back to State OES.");
    expect(api.importBatchFile).toHaveBeenCalledWith("p1", BATCH_FILE);

    // Export the receipt for that file.
    fireEvent.click(within(peer).getByRole("button", { name: "Export receipt" }));
    await screen.findByText(/^Receipt saved as openeoc-receipt-for-state-oes-.*\. Carry it to State OES and import it there/);
    expect(JSON.parse(await saved[1]!.blob.text())).toEqual(RECEIPT);

    // Import a receipt: the updates it names are marked delivered.
    choose(within(peer).getByLabelText("Receipt from State OES"), JSON.stringify(RECEIPT), "receipt.json");
    fireEvent.click(within(peer).getByRole("button", { name: "Import receipt" }));
    await screen.findByText("Receipt from State OES imported: 2 updates marked delivered.");
    expect(api.importReceipt).toHaveBeenCalledWith("p1", RECEIPT);
    expect((await axe.run(view.container)).violations).toEqual([]);
  });

  it("says when a file changed nothing, and when a file or receipt is refused, that nothing was applied", async () => {
    const api = client();
    (api.importBatchFile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ batches: 2, alreadyImported: 2, updates: 0, deleted: 0, conflicts: 0, receipt: RECEIPT })
      .mockRejectedValueOnce(new Error("the batch signature does not verify under this peer's key"));
    (api.importReceipt as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("the receipt names a batch this instance never sent to State OES"))
      .mockResolvedValueOnce({ batches: 1, delivered: 0, alreadyDelivered: 2 });
    render(<FederationSurface client={api} jurisdictionId="j" isAdmin boards={boards} />);
    const peer = await screen.findByRole("listitem", { name: "Partner State OES" });

    choose(within(peer).getByLabelText("Batch file from State OES"), JSON.stringify(BATCH_FILE), "batches.json");
    fireEvent.click(within(peer).getByRole("button", { name: "Import batch file" }));
    await screen.findByText("This file from State OES was imported before; nothing changed. Export the receipt again if State OES did not get it.");
    expect(within(peer).getByRole("button", { name: "Export receipt" })).toBeTruthy();

    choose(within(peer).getByLabelText("Batch file from State OES"), JSON.stringify(BATCH_FILE), "tampered.json");
    fireEvent.click(within(peer).getByRole("button", { name: "Import batch file" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("Nothing was imported: the batch signature does not verify under this peer's key.");

    choose(within(peer).getByLabelText("Batch file from State OES"), "not json", "notes.txt");
    fireEvent.click(within(peer).getByRole("button", { name: "Import batch file" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That file is not a batch file."));
    expect(api.importBatchFile).toHaveBeenCalledTimes(2);

    choose(within(peer).getByLabelText("Receipt from State OES"), JSON.stringify(RECEIPT), "receipt.json");
    fireEvent.click(within(peer).getByRole("button", { name: "Import receipt" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent)
      .toBe("Nothing was marked delivered: the receipt names a batch this instance never sent to State OES."));
    choose(within(peer).getByLabelText("Receipt from State OES"), JSON.stringify(RECEIPT), "receipt.json");
    fireEvent.click(within(peer).getByRole("button", { name: "Import receipt" }));
    await screen.findByText("This receipt from State OES changed nothing: its updates were already marked delivered.");
  });

  it("says why there is no instance key when the server cannot keep one", async () => {
    const api = client();
    (api.federationStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...status, identity: null });
    render(<FederationSurface client={api} jurisdictionId="j" isAdmin boards={boards} />);
    const own = await screen.findByRole("region", { name: "This instance's key" });
    await within(own).findByText(/The server needs OPENEOC_SECRET_KEY set to keep its private key/);
    expect(within(own).queryByRole("button", { name: "Copy public key" })).toBeNull();
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
