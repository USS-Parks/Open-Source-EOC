// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Theme } from "../../../design/components.js";
import type { CapAlertDetail, CapAlertSummary, RawNotification } from "../../api/client.js";
import { AlertsSurface, type AlertsClient } from "../AlertsSurface.js";
import { NotificationTray } from "../../../notifications/NotificationTray.js";

afterEach(cleanup);

const note = (overrides: Partial<RawNotification> = {}): RawNotification => ({
  id: "note-1",
  channel: "workflow",
  title: "Approval requested",
  body: "Review the shelter request.",
  status: "delivered",
  detail: { incidentId: "incident-1" },
  person_id: "person-1",
  position_id: null,
  destination: "Person · Duty Officer",
  incident_id: "incident-1",
  incident_name: "Bald Hills Fire",
  created_at: "2026-09-21T18:00:00.000Z",
  read_at: null,
  acknowledged_at: null,
  acknowledged_by: null,
  acknowledged_by_name: null,
  assigned_to_current_actor: true,
  ...overrides,
});

const alertSummary = (overrides: Partial<CapAlertSummary> = {}): CapAlertSummary => ({
  id: "alert-1",
  identifier: "LOCAL-1",
  origin: "authored",
  status: "Draft",
  msgType: "Alert",
  scope: "Public",
  ipawsEligible: false,
  incidentId: "incident-1",
  headline: "Shelter information",
  event: "Shelter opening",
  createdAt: "2026-09-21T18:00:00.000Z",
  review: { revision: 1, state: "draft", actorName: "Duty Officer", createdAt: "2026-09-21T18:00:00.000Z" },
  transmission: { state: "not_attempted", environment: null, submittedAt: null, submittedByName: null },
  ...overrides,
});

const alertDetail = (overrides: Partial<CapAlertDetail> = {}): CapAlertDetail => ({
  alert: {
    identifier: "LOCAL-1",
    sender: "duty@example.org",
    sent: "2026-09-21T18:00:00.000Z",
    status: "Draft",
    msgType: "Alert",
    scope: "Public",
    info: [{ language: "en-US", category: ["Safety"], event: "Shelter opening", urgency: "Expected", severity: "Moderate", certainty: "Likely", headline: "Shelter information", description: "The high school shelter is available." }],
  },
  xml: "<alert />",
  ipawsEligible: false,
  origin: "authored",
  incidentId: "incident-1",
  createdAt: "2026-09-21T18:00:00.000Z",
  review: { revision: 1, state: "draft", actorName: "Duty Officer", createdAt: "2026-09-21T18:00:00.000Z" },
  transmission: { state: "not_attempted", environment: null, submittedAt: null, submittedByName: null },
  ...overrides,
});

function makeClient() {
  let notification = note();
  let summary = alertSummary();
  let detail = alertDetail();
  const client: AlertsClient = {
    notifications: vi.fn(async () => [notification]),
    fieldSyncToken: () => {
      throw new Error("no live stream in this test");
    },
    markNotificationRead: vi.fn(async () => {
      notification = { ...notification, read_at: "2026-09-21T18:01:00.000Z" };
      return { ok: true as const };
    }),
    acknowledgeNotification: vi.fn(async () => {
      notification = { ...notification, acknowledged_at: "2026-09-21T18:02:00.000Z", acknowledged_by: "person-1", acknowledged_by_name: "Duty Officer" };
      return { ok: true as const, acknowledged_at: notification.acknowledged_at!, acknowledged_by: "person-1" };
    }),
    listCapAlerts: vi.fn(async () => [summary]),
    getCapAlert: vi.fn(async () => detail),
    createCapDraft: vi.fn(async () => ({ id: "new-alert" })),
    reviewCapAlert: vi.fn(async (_id, state) => {
      const review = { revision: 2, state, actorName: "Duty Officer", createdAt: "2026-09-21T18:03:00.000Z" };
      summary = { ...summary, review };
      detail = { ...detail, review };
      return review;
    }),
    getIpawsStatus: vi.fn(async () => ({
      enabled: false, environment: "test" as const, configured: false, cogId: null, endpointUrl: null,
      credentialFingerprint: null, certificateExpiresAt: null, moaAcknowledged: false, moaReference: null,
      moaAcknowledgedAt: null, secretStorageAvailable: true,
    })),
    configureIpaws: vi.fn(),
    acknowledgeIpawsMoa: vi.fn(),
    setIpawsEnabled: vi.fn(),
    requestIpawsSend: vi.fn(),
    listIpawsSends: vi.fn(async () => []),
    confirmIpawsSend: vi.fn(),
    cancelIpawsSend: vi.fn(),
    ipawsAuditTrail: vi.fn(async () => []),
  };
  return client;
}

function renderSurface(client = makeClient()) {
  const view = render(
    <Theme name="light">
      <AlertsSurface client={client} jurisdictionId="jurisdiction-1" incidentId="incident-1" canAuthor actorEmail="duty@example.org" />
    </Theme>,
  );
  return { client, ...view };
}

describe("notification tray", () => {
  it("summarizes state without marking items read", () => {
    const onOpen = vi.fn();
    const { getByText, getByRole } = render(
      <Theme name="dark">
        <NotificationTray items={[note({ read_at: "2026-09-21T18:01:00.000Z" })]} onOpenCenter={onOpen} />
      </Theme>,
    );
    expect(getByText("Read, acknowledgement pending")).not.toBeNull();
    fireEvent.click(getByRole("button", { name: "Open center" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("notification states", () => {
  it("marks an explicitly opened notification read without acknowledging it", async () => {
    const { client, findByRole, getByRole, getByText } = renderSurface();
    const item = await findByRole("button", { name: /Approval requested/ });
    fireEvent.click(item);
    await waitFor(() => expect(client.markNotificationRead).toHaveBeenCalledWith("note-1"));
    expect(client.acknowledgeNotification).not.toHaveBeenCalled();
    expect(getByText("Not acknowledged")).not.toBeNull();
    fireEvent.click(getByRole("button", { name: "Acknowledge notification" }));
    await waitFor(() => expect(client.acknowledgeNotification).toHaveBeenCalledWith("note-1"));
    await waitFor(() => expect(getByText(/by Duty Officer/)).not.toBeNull());
  });

  it("filters acknowledgement-pending items independently from unread state", async () => {
    const client = makeClient();
    client.notifications = vi.fn(async () => [
      note({ id: "read-pending", title: "Read pending", read_at: "2026-09-21T18:01:00.000Z" }),
      note({ id: "acked", title: "Acknowledged item", read_at: "2026-09-21T18:01:00.000Z", acknowledged_at: "2026-09-21T18:02:00.000Z" }),
    ]);
    const { findByText, getByLabelText, queryByText } = renderSurface(client);
    await findByText("Read pending");
    fireEvent.change(getByLabelText("Show"), { target: { value: "unacknowledged" } });
    expect(queryByText("Read pending")).not.toBeNull();
    expect(queryByText("Acknowledged item")).toBeNull();
  });

  it("keeps a notification unread when the read mutation fails", async () => {
    const client = makeClient();
    client.markNotificationRead = vi.fn(async () => { throw new Error("Read state unavailable"); });
    const { findByRole, findByText, getAllByText } = renderSurface(client);
    fireEvent.click(await findByRole("button", { name: /Approval requested/ }));
    expect(await findByText("Read state unavailable")).not.toBeNull();
    expect(getAllByText("Unread").length).toBeGreaterThan(0);
  });

  it("does not expose read or acknowledgement actions to a viewer who is not the recipient", async () => {
    const client = makeClient();
    client.notifications = vi.fn(async () => [note({ assigned_to_current_actor: false })]);
    const { findByRole, queryByRole } = renderSurface(client);
    fireEvent.click(await findByRole("button", { name: /Approval requested/ }));
    expect(client.markNotificationRead).not.toHaveBeenCalled();
    expect(queryByRole("button", { name: "Acknowledge notification" })).toBeNull();
  });
});

describe("local CAP drafting and review", () => {
  it("reviews then stores a local draft without exposing an enabled external action", async () => {
    const { client, findByRole, getByLabelText, getByRole, getByText } = renderSurface();
    await findByRole("button", { name: "Compose local alert" });
    fireEvent.click(getByRole("button", { name: "Compose local alert" }));
    fireEvent.change(getByLabelText("Event"), { target: { value: "Shelter opening" } });
    fireEvent.change(getByLabelText("Headline"), { target: { value: "High school shelter open" } });
    fireEvent.change(getByLabelText("Description"), { target: { value: "Shelter opens at 19:00." } });
    fireEvent.click(getByRole("button", { name: "Review local draft" }));
    expect(getByText("Local workspace only")).not.toBeNull();
    expect(getByText("Not sent")).not.toBeNull();
    const external = getByRole("button", { name: "External send unavailable" }) as HTMLButtonElement;
    expect(external.disabled).toBe(true);
    fireEvent.click(getByRole("button", { name: "Save local draft" }));
    await waitFor(() => expect(client.createCapDraft).toHaveBeenCalledTimes(1));
    const draft = vi.mocked(client.createCapDraft).mock.calls[0]![1];
    expect(draft.status).toBe("Draft");
    expect(draft.info[0]?.headline).toBe("High school shelter open");
  });

  it("closes and clears an unsaved composer when incident scope changes", async () => {
    const client = makeClient();
    const view = render(
      <Theme name="light">
        <AlertsSurface client={client} jurisdictionId="jurisdiction-1" incidentId="incident-1" canAuthor actorEmail="duty@example.org" />
      </Theme>,
    );
    fireEvent.click(await view.findByRole("button", { name: "Compose local alert" }));
    fireEvent.change(view.getByLabelText("Headline"), { target: { value: "Incident one draft" } });
    view.rerender(
      <Theme name="light">
        <AlertsSurface client={client} jurisdictionId="jurisdiction-1" incidentId="incident-2" canAuthor actorEmail="duty@example.org" />
      </Theme>,
    );
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Compose local alert" }));
    expect((view.getByLabelText("Headline") as HTMLInputElement).value).toBe("");
  });

  it("moves an existing local draft into review while reporting no outbound attempt", async () => {
    const { client, findByRole, getByRole, getAllByText } = renderSurface();
    fireEvent.click(await findByRole("tab", { name: /Alert records/ }));
    fireEvent.click(await findByRole("button", { name: /Shelter information/ }));
    expect((await findByRole("heading", { name: "Shelter information" })).getAttribute("tabindex")).toBe("-1");
    expect(getAllByText(/No workspace outbound attempt recorded/).length).toBeGreaterThan(0);
    fireEvent.click(getByRole("button", { name: "Submit for local review" }));
    await waitFor(() => expect(client.reviewCapAlert).toHaveBeenCalledWith("alert-1", "in_review"));
    await waitFor(() => expect(getByRole("button", { name: "Approve local alert" })).not.toBeNull());
  });

  it("shows the latest rejected IPAWS attempt instead of a blanket unsent label", async () => {
    const client = makeClient();
    const transmission = {
      state: "rejected" as const,
      environment: "production",
      submittedAt: "2026-09-21T18:05:00.000Z",
      submittedByName: "Duty Officer",
    };
    client.listCapAlerts = vi.fn(async () => [alertSummary({ transmission })]);
    client.getCapAlert = vi.fn(async () => alertDetail({ transmission }));
    const { findByRole, findAllByText } = renderSurface(client);
    fireEvent.click(await findByRole("tab", { name: /Alert records/ }));
    fireEvent.click(await findByRole("button", { name: /Shelter information/ }));
    expect((await findAllByText(/Rejected by IPAWS · production/)).length).toBeGreaterThan(0);
  });

  it("supports keyboard tab navigation between inbox and alert records", async () => {
    const { findByRole } = renderSurface();
    const inbox = await findByRole("tab", { name: /Inbox/ });
    inbox.focus();
    fireEvent.keyDown(inbox, { key: "ArrowRight" });
    const alerts = await findByRole("tab", { name: /Alert records/ });
    expect(alerts.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(alerts);
  });
});
