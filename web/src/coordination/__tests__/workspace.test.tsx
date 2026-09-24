// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiClient, FileMetaRef, Thread } from "../../app/api/client.js";
import { FilesWorkspace } from "../FilesWorkspace.js";
import { MessagesWorkspace } from "../MessagesWorkspace.js";

afterEach(() => cleanup());

const incidentId = "11111111-1111-4111-8111-111111111111";
const jurisdictionId = "22222222-2222-4222-8222-222222222222";
const boardId = "33333333-3333-4333-8333-333333333333";
const recordId = "44444444-4444-4444-8444-444444444444";

const thread: Thread = {
  id: "thread-1",
  kind: "group",
  title: "Evacuation coordination",
  incidentId,
  recipients: [
    {
      kind: "position",
      id: "position-1",
      label: "Operations Section Chief",
      currentHolders: ["Morgan Lee"],
    },
  ],
};

const recordFile: FileMetaRef = {
  id: "file-1",
  name: "evacuation-route.txt",
  contentType: "text/plain",
  size: 28,
  sha256: "abc",
  version: 1,
  supersedes: null,
  attachedKind: "record",
  attachedId: recordId,
  attachedBoardId: boardId,
  attachedIncidentId: incidentId,
  createdAt: "2026-09-21T18:00:00.000Z",
  uploadedBy: {
    personId: "person-1",
    displayName: "Alex Operator",
    positionTitle: "Planning Section Chief",
  },
};

describe("messages workspace", () => {
  it("exposes selected recipient context and reports persistence without invented receipts", async () => {
    const postMessage = vi.fn(async () => ({ id: "message-2", deduplicated: false }));
    const createThread = vi.fn(async () => ({ id: "thread-2" }));
    const client = {
      listThreads: vi.fn(async () => [thread]),
      listIncidentThreads: vi.fn(async () => [thread]),
      listPositions: vi.fn(async () => [{ id: "position-1", key: "operations", title: "Operations Section Chief" }]),
      listMessages: vi.fn(async () => [{
        id: "message-1",
        seq: 1,
        sender: "Alex Operator",
        senderPosition: "Planning Section Chief",
        body: "Confirm the accessible transport route.",
        at: "2026-09-21T18:05:00.000Z",
      }]),
      postMessage,
      createThread,
    } as unknown as ApiClient;

    render(
      <MessagesWorkspace
        client={client}
        jurisdictionId={jurisdictionId}
        incidentId={incidentId}
        incidentName="Redwood Fire"
      />,
    );

    const selected = await screen.findByRole("button", { name: /Evacuation coordination/ });
    expect(selected.getAttribute("aria-current")).toBe("true");
    const conversation = screen.getByRole("region", { name: "Conversation" });
    expect(within(conversation).getByText(/Operations Section Chief \(current: Morgan Lee\)/)).toBeTruthy();
    expect(screen.getByText(/Delivery, read, and acknowledgement receipts are not available/)).toBeTruthy();
    expect(await screen.findByText("Confirm the accessible transport route.")).toBeTruthy();
    expect(screen.getByText("Stored", { exact: true })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Route confirmed." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith("thread-1", "Route confirmed."));
    expect((await screen.findByRole("status")).textContent).toContain("stored in the thread");
  });

  it("creates an incident-scoped position thread", async () => {
    const createThread = vi.fn(async () => ({ id: "thread-new" }));
    const client = {
      listThreads: vi.fn(async () => []),
      listIncidentThreads: vi.fn(async () => []),
      listPositions: vi.fn(async () => [{ id: "position-1", key: "operations", title: "Operations Section Chief" }]),
      listMessages: vi.fn(async () => []),
      createThread,
      postMessage: vi.fn(),
    } as unknown as ApiClient;

    render(
      <MessagesWorkspace
        client={client}
        jurisdictionId={jurisdictionId}
        incidentId={incidentId}
        incidentName="Redwood Fire"
      />,
    );
    await screen.findByText("No threads for this incident.");
    fireEvent.change(screen.getByLabelText("Thread title"), { target: { value: "Incident logistics" } });
    fireEvent.click(screen.getByRole("button", { name: "Start thread" }));
    await waitFor(() => expect(createThread).toHaveBeenCalledWith(
      jurisdictionId,
      expect.objectContaining({ incidentId, members: [{ kind: "position", id: "position-1" }] }),
    ));
  });

  it("gives a partner the incident's threads and incident-wide threads only", async () => {
    const createThread = vi.fn(async () => ({ id: "thread-wide" }));
    const wide: Thread = { id: "thread-wide", kind: "group", title: "Storm coordination", incidentId, audience: "incident", recipients: [] };
    const client = {
      listThreads: vi.fn(),
      listIncidentThreads: vi.fn(async () => [wide]),
      listPositions: vi.fn(),
      listMessages: vi.fn(async () => [{
        id: "message-1", seq: 1, sender: "A. Brooks", senderPosition: null,
        senderOrganization: "CA Energy Commission", body: "Substation 4 is flooded.", at: "2026-09-21T18:05:00.000Z",
      }]),
      createThread,
      postMessage: vi.fn(),
    } as unknown as ApiClient;

    render(<MessagesWorkspace client={client} jurisdictionId={jurisdictionId} incidentId={incidentId} incidentName="Redwood Fire" isMember={false} />);
    const listed = await screen.findByRole("button", { name: /Storm coordination/ });
    expect(listed.textContent).toContain("Everyone on the incident");
    expect((await screen.findByText("Substation 4 is flooded.")).closest("li")?.textContent).toContain("CA Energy Commission");
    expect(client.listThreads).not.toHaveBeenCalled();
    expect(client.listPositions).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Recipient position")).toBeNull();

    fireEvent.change(screen.getByLabelText("Thread title"), { target: { value: "Utility restoration" } });
    fireEvent.click(screen.getByRole("button", { name: "Start thread" }));
    await waitFor(() => expect(createThread).toHaveBeenCalledWith(jurisdictionId,
      { kind: "group", title: "Utility restoration", incidentId, audience: "incident", members: [] }));
  });

  it("exports the selected thread, and lets only an administrator save message settings", async () => {
    const exportThread = vi.fn(async () => ["2026-09-21T18:05:00.000Z Alex Operator: Confirm the route."]);
    const setMessagingSettings = vi.fn(async () => ({ ok: true as const }));
    const client = {
      listThreads: vi.fn(async () => [thread]),
      listIncidentThreads: vi.fn(async () => []),
      listPositions: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
      exportThread,
      setMessagingSettings,
    } as unknown as ApiClient;
    const saved: string[] = [];
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:thread"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download); });

    const view = render(<MessagesWorkspace client={client} jurisdictionId={jurisdictionId} incidentId={incidentId} isAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Export thread" }));
    expect((await screen.findByText("Thread exported with 1 message.")).getAttribute("role")).toBe("status");
    expect(exportThread).toHaveBeenCalledWith("thread-1");
    expect(saved).toEqual(["evacuation-coordination.txt"]);

    fireEvent.change(screen.getByLabelText("Message retention in days (empty keeps all)"), { target: { value: "30" } });
    fireEvent.click(screen.getByLabelText("Record incident thread messages in the incident audit trail"));
    fireEvent.click(screen.getByRole("button", { name: "Save message settings" }));
    await screen.findByText("Message settings saved.");
    expect(setMessagingSettings).toHaveBeenCalledWith(jurisdictionId, { retentionDays: 30, inIncidentRecord: false });

    view.unmount();
    render(<MessagesWorkspace client={client} jurisdictionId={jurisdictionId} incidentId={incidentId} />);
    await screen.findByRole("button", { name: "Export thread" });
    expect(screen.queryByRole("button", { name: "Save message settings" })).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("files workspace", () => {
  it("previews contextual files, links to their record, searches, and uploads to the exact record", async () => {
    const onOpenRecord = vi.fn();
    const uploadFile = vi.fn(async () => ({ id: "file-1", sha256: "abc", version: 1 }));
    const client = {
      listFiles: vi.fn(async () => ({ files: [recordFile], nextCursor: null })),
      downloadFile: vi.fn(async () => new Blob(["Evacuation staging route"], { type: "text/plain" })),
      fileMeta: vi.fn(async () => recordFile),
      searchJurisdiction: vi.fn(async () => [
        { kind: "record", id: recordId, boardId, incidentId, title: "Evacuation route record" },
      ]),
      uploadFile,
    } as unknown as ApiClient;

    render(
      <FilesWorkspace
        client={client}
        jurisdictionId={jurisdictionId}
        incidentId={incidentId}
        incidentName="Redwood Fire"
        recordContext={{ boardId, recordId, label: "Evacuation route" }}
        onOpenRecord={onOpenRecord}
      />,
    );

    const library = await screen.findByRole("region", { name: "File library" });
    fireEvent.click(within(library).getByRole("button", { name: /evacuation-route\.txt/ }));
    expect(await screen.findByText("Evacuation staging route")).toBeTruthy();
    expect(screen.getByText(/Uploaded by Alex Operator \(Planning Section Chief\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open source record" }));
    expect(onOpenRecord).toHaveBeenCalledWith(boardId, recordId, incidentId);

    fireEvent.change(screen.getByLabelText("Search records and files"), { target: { value: "evacuation" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const searchResult = await screen.findByText("Evacuation route record");
    fireEvent.click(within(searchResult.closest("li")!).getByRole("button", { name: "Open record" }));
    await waitFor(() => expect(onOpenRecord).toHaveBeenLastCalledWith(boardId, recordId, incidentId));

    const upload = new File(["supporting detail"], "route-detail.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("File"), { target: { files: [upload] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledWith(
      jurisdictionId,
      expect.objectContaining({ attachedKind: "record", attachedId: recordId }),
    ));
    expect((await screen.findByRole("status")).textContent).toContain("Stored route-detail.txt");
  });

  it("opens the incident attached to the selected file", async () => {
    const sourceIncidentId = "55555555-5555-4555-8555-555555555555";
    const incidentFile: FileMetaRef = {
      ...recordFile,
      id: "incident-file-1",
      name: "incident-brief.txt",
      attachedKind: "incident",
      attachedId: sourceIncidentId,
      attachedBoardId: null,
      attachedIncidentId: null,
    };
    const onOpenIncident = vi.fn();
    const client = {
      listFiles: vi.fn(async () => ({ files: [incidentFile], nextCursor: null })),
      downloadFile: vi.fn(async () => new Blob(["Incident briefing"], { type: "text/plain" })),
    } as unknown as ApiClient;

    render(
      <FilesWorkspace
        client={client}
        jurisdictionId={jurisdictionId}
        incidentId={incidentId}
        incidentName="Redwood Fire"
        onOpenIncident={onOpenIncident}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Open incident" }));
    expect(onOpenIncident).toHaveBeenCalledWith(sourceIncidentId);
  });
});
