// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient, NotificationChannelView } from "../../app/api/client.js";
import { Channels } from "../Channels.js";

afterEach(cleanup);

const gatewayView: NotificationChannelView = {
  kind: "sms",
  settings: { provider: "gateway", url: "http://192.168.1.20:8080", username: "sms" },
  credentialFingerprint: "fixture-fingerprint",
  updatedAt: "2026-09-25T17:00:00Z",
  secretStorageAvailable: true,
  fixtureMessages: [],
  replies: [
    { id: "s1", sender: "+17075550101", body: "1", receivedAt: "2026-09-25T17:03:00Z", readAt: "2026-09-25T17:03:10Z",
      outcome: "answered", recipient: "Avery First", subject: "Levee watch" },
    { id: "s2", sender: "+15550001111", body: "wrong number", receivedAt: "2026-09-25T17:04:00Z", readAt: "2026-09-25T17:04:10Z",
      outcome: "unmatched", recipient: null, subject: null },
  ],
};

function setup(smsView = gatewayView) {
  const client = {
    getNotificationChannel: vi.fn((_: string, kind: string) => Promise.resolve(kind === "sms" ? smsView
      : { kind, settings: null, credentialFingerprint: null, updatedAt: null, secretStorageAvailable: true })),
    getDeliveryHolds: vi.fn().mockResolvedValue({ holds: [{ kind: "sms", hours: 72, isDefault: true }] }),
    saveNotificationChannel: vi.fn().mockResolvedValue(gatewayView),
    readSmsReplies: vi.fn().mockResolvedValue({ read: 2, acknowledged: 0, answered: 1, notAnAnswer: 1, unmatched: 0 }),
    testNotificationChannel: vi.fn(),
  };
  const view = render(<Channels client={client as unknown as ApiClient} jurisdictionId="j1" />);
  return { client, view };
}

it("configures an SMS gateway on the site network, reads its replies now and lists what each did", async () => {
  const { client, view } = setup();
  const sms = await screen.findByRole("region", { name: "SMS" });
  expect((within(sms).getByLabelText("SMS provider") as HTMLSelectElement).value).toBe("gateway");
  expect((within(sms).getByLabelText("Gateway address") as HTMLInputElement).value).toBe("http://192.168.1.20:8080");
  within(sms).getByText(/Stored password fingerprint/);
  const replies = within(sms).getByRole("list", { name: "Replies read from the gateway" });
  const avery = within(replies).getByRole("listitem", { name: "Reply from +17075550101" });
  within(avery).getByText("Avery First (+17075550101)");
  within(avery).getByText("“1” to Levee watch");
  within(avery).getByText("Answered");
  within(within(replies).getByRole("listitem", { name: "Reply from +15550001111" })).getByText("No send to this number");
  expect((await axe.run(view.container)).violations).toEqual([]);

  fireEvent.click(within(sms).getByRole("button", { name: "Read replies now" }));
  await within(sms).findByText("Read 2 new replies: 1 recorded, 1 not one of the answers, 0 with no send to the number.");
  expect(client.readSmsReplies).toHaveBeenCalledWith("j1");

  fireEvent.change(within(sms).getByLabelText("Gateway address"), { target: { value: " http://192.168.1.21:8080 " } });
  fireEvent.change(within(sms).getByLabelText("Gateway password"), { target: { value: "phone-password" } });
  fireEvent.click(within(sms).getByRole("button", { name: "Save SMS settings" }));
  await within(sms).findByText("SMS settings saved.");
  expect(client.saveNotificationChannel).toHaveBeenCalledWith("j1", "sms", {
    settings: { provider: "gateway", url: "http://192.168.1.21:8080", username: "sms" },
    secret: "phone-password",
  });
});

it("turns texted activity logging on for the gateway and lists what each activity text did", async () => {
  const { client } = setup();
  const sms = await screen.findByRole("region", { name: "SMS" });
  const box = within(sms).getByLabelText("File texted activity on the ICS 214 activity log") as HTMLInputElement;
  expect(box.checked).toBe(false);
  fireEvent.click(box);
  within(sms).getByText(/LOG #north Arrived at staging/);
  fireEvent.click(within(sms).getByRole("button", { name: "Save SMS settings" }));
  await within(sms).findByText("SMS settings saved.");
  expect(client.saveNotificationChannel).toHaveBeenCalledWith("j1", "sms", {
    settings: { provider: "gateway", url: "http://192.168.1.20:8080", username: "sms", activityLog: true },
  });
});

it("shows an activity text filed on a log, and one refused with the reason", async () => {
  setup({ ...gatewayView, replies: [
    { id: "s3", sender: "+17075550201", body: "Arrived at staging", receivedAt: "2026-09-25T17:05:00Z", readAt: "2026-09-25T17:05:10Z",
      outcome: "logged", refusal: null, recipient: "Riley Responder", subject: null, incident: "North Coast Storm" },
    { id: "s4", sender: "+17075550203", body: "Arrived", receivedAt: "2026-09-25T17:06:00Z", readAt: "2026-09-25T17:06:10Z",
      outcome: "refused", refusal: "no_assignment", recipient: "Uma Unassigned", subject: null, incident: null },
  ] });
  const replies = await screen.findByRole("list", { name: "Replies read from the gateway" });
  const riley = within(replies).getByRole("listitem", { name: "Reply from +17075550201" });
  within(riley).getByText("“Arrived at staging” on North Coast Storm");
  within(riley).getByText("Filed on the activity log");
  const uma = within(replies).getByRole("listitem", { name: "Reply from +17075550203" });
  within(uma).getByText("“Arrived”: no current assignment");
  within(uma).getByText("Not filed");
});
