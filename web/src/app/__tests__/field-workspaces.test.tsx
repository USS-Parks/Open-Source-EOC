// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormDefinition } from "@openeoc/shared";
import type { ApiClient, EffectiveBoardResponse } from "../api/client.js";
import { SmartFormsSurface } from "../surfaces/SmartFormsSurface.js";
import { TrackingSurface } from "../surfaces/TrackingSurface.js";
import { formBoardData } from "../../field/FieldCapture.js";

const INCIDENT = "10000000-0000-4000-8000-000000000001";
const NEXT_INCIDENT = "10000000-0000-4000-8000-000000000005";
const JURISDICTION = "10000000-0000-4000-8000-000000000002";
const HOME_JURISDICTION = "10000000-0000-4000-8000-000000000006";
const PERSON = "10000000-0000-4000-8000-000000000003";
const BOARD = "10000000-0000-4000-8000-000000000004";

const queue = vi.hoisted(() => ({
  state: vi.fn().mockResolvedValue({ phase: "ready", pending: 0, receipt: null, message: "Ready." }),
  enqueue: vi.fn().mockResolvedValue({ phase: "queued", pending: 1, receipt: null, message: "1 queued." }),
  sync: vi.fn().mockResolvedValue({
    phase: "synced", pending: 0,
    receipt: { operationId: "operation", seq: 17, conflicts: 0, exact: true },
    message: "All field submissions synchronized at receipt 17.",
  }),
  close: vi.fn(),
}));

vi.mock("../../field/field-submissions.js", () => ({
  FieldSubmissionQueue: { open: vi.fn().mockResolvedValue(queue) },
}));
vi.mock("../auth/session.js", () => ({
  useSession: () => ({ me: { person: { id: PERSON } } }),
}));

const definition: FormDefinition = {
  key: "field_report",
  version: 3,
  title: "Rapid field report",
  boardTemplate: "field_reports",
  nodes: [
    { kind: "field", name: "summary", type: "text", label: "Summary", required: true },
    { kind: "field", name: "category", type: "select_one", label: "Category", required: true,
      choices: [{ name: "hazard", label: "Hazard" }, { name: "damage", label: "Damage" }] },
    { kind: "field", name: "location", type: "geopoint", label: "Location" },
    { kind: "field", name: "photo", type: "image", label: "Photo" },
  ],
};
const board: EffectiveBoardResponse = {
  id: BOARD,
  title: "Field Reports",
  templateKey: "field_reports",
  templateVersion: 1,
  role: "member",
  canContribute: true,
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true, read: "any", write: "member" },
    { key: "category", label: "Category", type: "enum", values: ["hazard", "damage"], required: true, read: "any", write: "member" },
    { key: "photo", label: "Photo", type: "attachment", required: false, read: "any", write: "member" },
    { key: "location", label: "Location", type: "geometry", geometryKind: "point", required: false, read: "any", write: "member" },
  ],
  views: [],
};

function formsClient(): ApiClient {
  return {
    listForms: vi.fn().mockResolvedValue([{ key: definition.key, version: 3, title: definition.title }]),
    incidentBoards: vi.fn().mockResolvedValue([{ id: BOARD, title: "Field Reports" }]),
    getBoard: vi.fn().mockResolvedValue(board),
    getForm: vi.fn().mockResolvedValue(definition),
    fieldSyncToken: vi.fn().mockReturnValue("transient-token"),
    uploadFile: vi.fn().mockResolvedValue({ id: "file", sha256: "hash", version: 1 }),
  } as unknown as ApiClient;
}

function trackingClient(): ApiClient {
  return {
    reunify: vi.fn().mockResolvedValue([]),
    registerTrackedObject: vi.fn().mockResolvedValue({ id: "tracked", tag: "TRK-EXACT" }),
    scanTrackedObject: vi.fn().mockResolvedValue({ eventId: "event" }),
  } as unknown as ApiClient;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("D29 field reporting", () => {
  it("maps the first valid geopoint like the authoritative form service", () => {
    const multiplePoints: FormDefinition = { ...definition, nodes: [
      ...definition.nodes,
      { kind: "field", name: "second_location", type: "geopoint", label: "Second location" },
    ] };
    expect(formBoardData(multiplePoints, board.fields, {
      location: "40.802 -124.163", second_location: "41 -123",
    }).location).toEqual({ type: "Point", coordinates: [-124.163, 40.802] });
  });
  it("queues an incident-scoped board record before synchronization", async () => {
    const client = formsClient();
    const openMap = vi.fn();
    const { container } = render(<SmartFormsSurface client={client} jurisdictionId={JURISDICTION}
      incidentId={INCIDENT} onOpenMap={openMap} />);
    await screen.findByLabelText(/^Summary/);
    const form = screen.getByRole("form", { name: "Field report form" });
    fireEvent.change(within(form).getByLabelText(/^Summary/), { target: { value: "Power line across the access road" } });
    fireEvent.change(within(form).getByLabelText(/^Category/), { target: { value: "hazard" } });
    fireEvent.change(within(form).getByLabelText("Latitude and longitude"), { target: { value: "40.802 -124.163" } });
    fireEvent.click(within(form).getByRole("button", { name: "Queue field report" }));

    await waitFor(() => expect(queue.enqueue).toHaveBeenCalledOnce());
    const [scope, boardId, recordId, data] = queue.enqueue.mock.calls[0]!;
    expect(scope).toEqual({ personId: PERSON, incidentId: INCIDENT });
    expect(boardId).toBe(BOARD);
    expect(recordId).toMatch(/^[0-9a-f-]{36}$/);
    expect(data).toEqual({
      summary: "Power line across the access road",
      category: "hazard",
      location: { type: "Point", coordinates: [-124.163, 40.802] },
    });
    await waitFor(() => expect(queue.sync).toHaveBeenCalledWith(scope, "transient-token"));
    expect(await screen.findByText("Report synchronized with retained server attribution.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open map capture" }));
    expect(openMap).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Attachments require a connection");
    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("keeps a rejected sync queued and labels offline attachment limits", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    queue.state.mockResolvedValueOnce({ phase: "queued", pending: 1, receipt: null, message: "1 queued." });
    render(<SmartFormsSurface client={formsClient()} jurisdictionId={JURISDICTION} incidentId={INCIDENT} />);
    await screen.findByText("Offline capture");
    expect(await screen.findByText("Reconnect before adding an attachment.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Sync 1 queued" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears draft answers when the active incident changes", async () => {
    const client = formsClient();
    const view = render(<SmartFormsSurface client={client} jurisdictionId={JURISDICTION} incidentId={INCIDENT} />);
    await screen.findByLabelText(/^Summary/);
    const form = screen.getByRole("form", { name: "Field report form" });
    fireEvent.change(within(form).getByLabelText(/^Summary/), { target: { value: "Incident-specific observation" } });
    view.rerender(<SmartFormsSurface client={client} jurisdictionId={JURISDICTION} incidentId={NEXT_INCIDENT} />);
    await waitFor(() => expect((screen.getByLabelText(/^Summary/) as HTMLInputElement).value).toBe(""));
  });
  it("uses the participant home form library while keeping the board incident-scoped", async () => {
    const client = formsClient();
    render(<SmartFormsSurface client={client} jurisdictionId={HOME_JURISDICTION} incidentId={INCIDENT} />);
    await screen.findByLabelText(/^Photo/);

    expect(client.listForms).toHaveBeenCalledWith(HOME_JURISDICTION);
    expect(client.getForm).toHaveBeenCalledWith(HOME_JURISDICTION, definition.key);
    expect(client.incidentBoards).toHaveBeenCalledWith(INCIDENT);
    expect(client.getBoard).toHaveBeenCalledWith(BOARD, INCIDENT);
    expect(screen.getByText("Your organization's forms are submitted to the selected incident board.")).toBeTruthy();

    const image = new File(["field image"], "home-library-photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/^Photo/), { target: { files: [image] } });
    await waitFor(() => expect(client.uploadFile).toHaveBeenCalledWith(HOME_JURISDICTION,
      expect.objectContaining({ name: "home-library-photo.png", contentType: "image/png" })));
  });
});

describe("D29 tracking handoff", () => {
  it("registers a field-safe object and records a structured custody receipt", async () => {
    const client = trackingClient();
    const { container } = render(<TrackingSurface client={client} jurisdictionId={JURISDICTION} />);
    await screen.findByText("Keep each handoff attached to one tag");
    fireEvent.click(screen.getByRole("tab", { name: "Register" }));
    fireEvent.change(screen.getByLabelText("Tracked kind"), { target: { value: "evacuee" } });
    fireEvent.change(screen.getByLabelText("Field-safe label"), { target: { value: "Family group 12" } });
    fireEvent.change(screen.getByLabelText("Initial station"), { target: { value: "North shelter intake" } });
    fireEvent.click(screen.getByRole("button", { name: "Register tracked object" }));
    await waitFor(() => expect(client.registerTrackedObject).toHaveBeenCalledWith(JURISDICTION, {
      kind: "evacuee", label: "Family group 12", station: "North shelter intake",
    }));

    await screen.findByText("Registered TRK-EXACT. Continue with the first custody handoff.");
    fireEvent.change(screen.getByLabelText("Custody state"), { target: { value: "transferred" } });
    fireEvent.change(screen.getByLabelText("Agency"), { target: { value: "County Transit" } });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "South reception center" } });
    fireEvent.change(screen.getByLabelText("Handoff note"), { target: { value: "Bus 14 receipt confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "Record custody handoff" }));
    await waitFor(() => expect(client.scanTrackedObject).toHaveBeenCalledWith(JURISDICTION, {
      tag: "TRK-EXACT", custodyState: "transferred", station: "North shelter intake",
      agency: "County Transit", location: "South reception center", note: "Bus 14 receipt confirmed",
    }));
    expect(screen.queryByLabelText(/health|full identity/i)).toBeNull();
    expect((await axe.run(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
  });

  it("shows a manual-entry error when barcode detection rejects", async () => {
    const barcode = Object.getOwnPropertyDescriptor(globalThis, "BarcodeDetector");
    const bitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
    try {
      Object.defineProperty(globalThis, "BarcodeDetector", { configurable: true, value: class {
        async detect() { throw new Error("camera decode failed"); }
      } });
      Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: vi.fn().mockResolvedValue({ close: vi.fn() }) });
      render(<TrackingSurface client={trackingClient()} jurisdictionId={JURISDICTION} />);
      fireEvent.change(screen.getByLabelText("Scan barcode or QR"), {
        target: { files: [new File(["barcode"], "tag.png", { type: "image/png" })] },
      });
      expect(await screen.findByText("This image could not be read. Enter the tag manually.")).toBeTruthy();
    } finally {
      if (barcode) Object.defineProperty(globalThis, "BarcodeDetector", barcode);
      else delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
      if (bitmap) Object.defineProperty(globalThis, "createImageBitmap", bitmap);
      else delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    }
  });

  it("does not present a failed tracking search as an empty inventory", async () => {
    const client = { ...trackingClient(), reunify: vi.fn().mockRejectedValue(new Error("Tracking lookup unavailable")) } as unknown as ApiClient;
    render(<TrackingSurface client={client} jurisdictionId={JURISDICTION} />);
    fireEvent.click(screen.getByRole("tab", { name: "Find & reunify" }));
    fireEvent.change(screen.getByLabelText("Name, field-safe label, or #tag"), { target: { value: "Family group" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Tracking search unavailable")).toBeTruthy();
    expect(screen.queryByText("No tracked objects found")).toBeNull();
  });
});
