// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../app/api/client.js";
import { CollabSettings, IncidentCollaboration } from "../collab.js";
import { IncidentMeetings, MeetingSettings } from "../meetings.js";

afterEach(cleanup);

const status = (over: Record<string, unknown> = {}) => ({ configured: false, enabled: false, kind: null, baseUrl: null, ...over });

describe("collaboration settings", () => {
  it("saves the backend, keeps the token out of the page and never shows it", async () => {
    const client = {
      collabStatus: vi.fn()
        .mockResolvedValueOnce(status())
        .mockResolvedValue(status({ configured: true, enabled: true, kind: "mattermost", baseUrl: "https://chat.example.org" })),
      configureCollab: vi.fn().mockResolvedValue(status()),
    };
    render(<CollabSettings client={client as unknown as ApiClient} jurisdictionId="j1" />);
    await screen.findByText("No access token is stored.");
    fireEvent.change(screen.getByLabelText("Chat server address"), { target: { value: "https://chat.example.org" } });
    fireEvent.click(screen.getByLabelText("Use this backend for incident channels"));
    fireEvent.click(screen.getByRole("button", { name: "Save collaboration settings" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Enter the access token the chat server issued for this platform.");
    expect(client.configureCollab).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Access token"), { target: { value: "bot-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save collaboration settings" }));
    await waitFor(() => expect(client.configureCollab).toHaveBeenCalledWith("j1", {
      kind: "mattermost", baseUrl: "https://chat.example.org", enabled: true, token: "bot-secret",
    }));
    await screen.findByText("Collaboration settings saved.");
    await screen.findByText("An access token is stored. It is never shown; leave the field blank to keep it.");
    expect((screen.getByLabelText("Access token") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain("bot-secret");
  });

  it("asks for the Matrix homeserver only for Matrix", async () => {
    const client = { collabStatus: vi.fn().mockResolvedValue(status()), configureCollab: vi.fn().mockResolvedValue(status()) };
    render(<CollabSettings client={client as unknown as ApiClient} jurisdictionId="j1" />);
    await screen.findByLabelText("Chat backend");
    expect(screen.queryByLabelText("Matrix homeserver domain")).toBeNull();
    fireEvent.change(screen.getByLabelText("Chat backend"), { target: { value: "matrix" } });
    fireEvent.change(screen.getByLabelText("Chat server address"), { target: { value: "https://matrix.example.org" } });
    fireEvent.change(screen.getByLabelText("Matrix homeserver domain"), { target: { value: "example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Save collaboration settings" }));
    await waitFor(() => expect(client.configureCollab).toHaveBeenCalledWith("j1", {
      kind: "matrix", baseUrl: "https://matrix.example.org", enabled: false, homeserver: "example.org",
    }));
  });
});

function collabClient() {
  return {
    collabStatus: vi.fn().mockResolvedValue(status({ configured: true, enabled: true, kind: "mattermost", baseUrl: "https://chat.example.org" })),
    provisionCollab: vi.fn().mockResolvedValue({ degraded: false, backend: "mattermost", channels: 6 }),
    syncCollab: vi.fn().mockResolvedValue({ degraded: false, added: 1, removed: 2 }),
    announceCollab: vi.fn().mockResolvedValue({ degraded: false }),
    archiveCollab: vi.fn().mockResolvedValue({ archived: true }),
  };
}

describe("incident collaboration", () => {
  it("sets up, updates, announces into and archives the incident's channels", async () => {
    const client = collabClient();
    render(<IncidentCollaboration client={client as unknown as ApiClient} jurisdictionId="j1" incidentId="i1"
      incidentName="River Fire" canAdmin canWrite closed={false} />);
    await screen.findByText(/Channels run on Mattermost at https:\/\/chat\.example\.org\./);
    fireEvent.click(screen.getByRole("button", { name: "Set up channels" }));
    await screen.findByText("6 channels are ready on Mattermost.");
    fireEvent.click(screen.getByRole("button", { name: "Update membership" }));
    await screen.findByText("Membership matches the position holders: 1 added, 2 removed.");
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "operations" } });
    fireEvent.change(screen.getByLabelText("Announcement"), { target: { value: "Levee overtopping reported" } });
    fireEvent.click(screen.getByRole("button", { name: "Post announcement" }));
    await screen.findByText("Announcement posted to Operations.");
    expect(client.announceCollab).toHaveBeenCalledWith("i1", { section: "operations", text: "Levee overtopping reported" });
    fireEvent.click(screen.getByRole("button", { name: "Archive channels" }));
    await screen.findByText("Channels archived.");
    expect(client.provisionCollab).toHaveBeenCalledWith("i1");
    expect(client.syncCollab).toHaveBeenCalledWith("i1");
    expect(client.archiveCollab).toHaveBeenCalledWith("i1");
  });

  it("says when the holders were notified in the app instead", async () => {
    const client = { ...collabClient(), collabStatus: vi.fn().mockResolvedValue(status()),
      provisionCollab: vi.fn().mockResolvedValue({ degraded: true, backend: null, channels: 6 }) };
    render(<IncidentCollaboration client={client as unknown as ApiClient} jurisdictionId="j1" incidentId="i1"
      incidentName="River Fire" canAdmin canWrite closed={false} />);
    await screen.findByText(/No chat backend is in use\./);
    fireEvent.click(screen.getByRole("button", { name: "Set up channels" }));
    await screen.findByText("No chat backend is in use, so the position holders were notified in the app.");
  });

  it("offers a member only the announcement, and a viewer nothing", async () => {
    const client = collabClient();
    const { unmount } = render(<IncidentCollaboration client={client as unknown as ApiClient} jurisdictionId="j1" incidentId="i1"
      incidentName="River Fire" canAdmin={false} canWrite closed={false} />);
    await screen.findByRole("button", { name: "Post announcement" });
    expect(screen.queryByRole("button", { name: "Set up channels" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive channels" })).toBeNull();
    unmount();
    render(<IncidentCollaboration client={client as unknown as ApiClient} jurisdictionId="j1" incidentId="i1"
      incidentName="River Fire" canAdmin={false} canWrite={false} closed={false} />);
    await screen.findByText(/Channels run on Mattermost/);
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

describe("meeting settings", () => {
  it("saves the bridge with an app id and keeps the secret out of the page", async () => {
    const saved = { configured: true, enabled: true, baseUrl: "https://meet.example.org", appId: "openeoc", authenticated: true };
    const client = {
      meetingConfig: vi.fn()
        .mockResolvedValueOnce({ configured: false, enabled: false, baseUrl: null, appId: null, authenticated: false })
        .mockResolvedValue(saved),
      configureMeetings: vi.fn().mockResolvedValue(saved),
    };
    render(<MeetingSettings client={client as unknown as ApiClient} jurisdictionId="j1" />);
    await screen.findByText(/No token secret is stored/);
    fireEvent.change(screen.getByLabelText("Jitsi server address"), { target: { value: "https://meet.example.org" } });
    fireEvent.change(screen.getByLabelText("Token secret"), { target: { value: "jitsi-secret" } });
    fireEvent.click(screen.getByLabelText("Offer meeting bridges for incidents"));
    fireEvent.click(screen.getByRole("button", { name: "Save meeting settings" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Enter the app id that goes with the token secret.");
    fireEvent.change(screen.getByLabelText("App id"), { target: { value: "openeoc" } });
    fireEvent.click(screen.getByRole("button", { name: "Save meeting settings" }));
    await waitFor(() => expect(client.configureMeetings).toHaveBeenCalledWith("j1", {
      baseUrl: "https://meet.example.org", enabled: true, appId: "openeoc", secret: "jitsi-secret",
    }));
    await screen.findByText(/A token secret is stored\. It is never shown/);
    expect((screen.getByLabelText("Token secret") as HTMLInputElement).value).toBe("");
  });
});

describe("incident meetings", () => {
  it("opens a section bridge and schedules a briefing", async () => {
    const bridge = { room: "eoc-1", section: "operations", url: "https://meet.example.org/eoc-1" };
    const briefing = { id: "b1", title: "Morning brief", section: null, scheduledAt: "2026-09-24T15:00:00.000Z", notifiedAt: null };
    const client = {
      listMeetingBridges: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([bridge]),
      openMeetingBridge: vi.fn().mockResolvedValue(bridge),
      listBriefings: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([briefing]),
      scheduleBriefing: vi.fn().mockResolvedValue({ id: "b1" }),
    };
    render(<IncidentMeetings client={client as unknown as ApiClient} incidentId="i1" incidentName="River Fire" canWrite closed={false} />);
    await screen.findByText("No bridge is open for this incident.");
    fireEvent.change(screen.getByLabelText("Bridge for"), { target: { value: "operations" } });
    fireEvent.click(screen.getByRole("button", { name: "Open bridge" }));
    await screen.findByText("The operations bridge is open.");
    expect(client.openMeetingBridge).toHaveBeenCalledWith("i1", "operations");
    const link = await screen.findByRole("link", { name: "Join the operations bridge" });
    expect(link.getAttribute("href")).toBe(bridge.url);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    fireEvent.change(screen.getByLabelText("Briefing title"), { target: { value: "Morning brief" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-24T08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule briefing" }));
    await waitFor(() => expect(client.scheduleBriefing).toHaveBeenCalledWith("i1", {
      title: "Morning brief", scheduledAt: new Date("2026-09-24T08:00").toISOString(),
    }));
    await screen.findByRole("table", { name: "Scheduled briefings" });
    expect(screen.getByRole("row", { name: /Morning brief Whole incident .* Not yet/ })).toBeTruthy();
  });

  it("shows a viewer the bridges and briefings with no controls", async () => {
    const client = {
      listMeetingBridges: vi.fn().mockResolvedValue([{ room: "eoc-1", section: "incident", url: "https://meet.example.org/eoc-1" }]),
      listBriefings: vi.fn().mockResolvedValue([]),
    };
    render(<IncidentMeetings client={client as unknown as ApiClient} incidentId="i1" incidentName="River Fire" canWrite={false} closed={false} />);
    await screen.findByRole("link", { name: "Join the whole incident bridge" });
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});
