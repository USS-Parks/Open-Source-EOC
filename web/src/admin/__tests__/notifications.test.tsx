// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "../../app/api/client.js";
import { Notifications } from "../Notifications.js";

afterEach(cleanup);

const boards = [{ id: "b1", title: "Activity log", templateKey: "activity_log", templateVersion: 1, hasGeometry: false }];

function setup(overrides: Record<string, unknown> = {}) {
  const client = {
    getNotificationAllowlist: vi.fn()
      .mockResolvedValueOnce({ entries: ["https://old.example.org"], updatedAt: null })
      .mockResolvedValue({ entries: ["http://127.0.0.1:9000", "*.example.org"], updatedAt: "2026-09-23T10:00:00Z" }),
    setNotificationAllowlist: vi.fn().mockResolvedValue({ entries: ["http://127.0.0.1:9000", "*.example.org"] }),
    createNotificationRule: vi.fn().mockResolvedValue({ id: "r1", webhookSecret: "s3cret" }),
    ...overrides,
  };
  render(<Notifications client={client as unknown as ApiClient} jurisdictionId="j1" boards={boards} />);
  return client;
}

it("saves the allowlist one destination per line and shows it as the server normalized it", async () => {
  const client = setup();
  const list = await screen.findByLabelText("Allowed destinations");
  await waitFor(() => expect((list as HTMLTextAreaElement).value).toBe("https://old.example.org"));
  fireEvent.change(list, { target: { value: " http://127.0.0.1:9000/ \n\n*.Example.org " } });
  fireEvent.click(screen.getByRole("button", { name: "Save allowlist" }));
  await screen.findByText("Allowlist saved with 2 destinations.");
  expect(client.setNotificationAllowlist).toHaveBeenCalledWith("j1", ["http://127.0.0.1:9000/", "*.Example.org"]);
  expect((screen.getByLabelText("Allowed destinations") as HTMLTextAreaElement).value).toBe("http://127.0.0.1:9000\n*.example.org");
  await screen.findByText(/^Last changed/);
  expect((screen.getByLabelText("Allowed destinations") as HTMLTextAreaElement).value).toBe("http://127.0.0.1:9000\n*.example.org");
});

it("authors a webhook rule and shows its signing secret once, with a copy button", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const client = setup();
  await screen.findByLabelText("Allowed destinations");
  fireEvent.change(screen.getByLabelText("Board"), { target: { value: "b1" } });
  fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "changed_to" } });
  fireEvent.change(screen.getByLabelText("Field key"), { target: { value: "status" } });
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "open" } });
  fireEvent.change(screen.getByLabelText("Channel kind"), { target: { value: "webhook" } });
  fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: " http://127.0.0.1:9000/hook " } });
  fireEvent.click(screen.getByRole("button", { name: "Add channel" }));
  fireEvent.change(screen.getByLabelText("Channel kind, channel 2"), { target: { value: "email" } });
  fireEvent.change(screen.getByLabelText("Email addresses, separated by commas, channel 2"), { target: { value: "duty@example.org, eoc@example.org" } });
  fireEvent.change(screen.getByLabelText("Most deliveries per window"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

  expect((await screen.findByLabelText("Webhook signing secret")).textContent).toBe("s3cret");
  expect(client.createNotificationRule).toHaveBeenCalledWith("j1", {
    boardId: "b1",
    event: "record.created",
    condition: { op: "changed_to", field: "status", value: "open" },
    channels: [{ kind: "webhook", url: "http://127.0.0.1:9000/hook" }, { kind: "email", to: ["duty@example.org", "eoc@example.org"] }],
    rateLimit: { max: 5, windowMinutes: 10 },
  });
  fireEvent.click(screen.getByRole("button", { name: "Copy secret" }));
  await screen.findByText("Secret copied.");
  expect(writeText).toHaveBeenCalledWith("s3cret");
  fireEvent.click(screen.getByRole("button", { name: "I have stored the secret" }));
  expect(screen.queryByText("s3cret")).toBeNull();
});

it("shows the server's refusal of an unlisted destination and keeps the draft", async () => {
  setup({ createNotificationRule: vi.fn().mockRejectedValue(new ApiError(422, "https://x.example.net/h is not on this jurisdiction's notification allowlist")) });
  await screen.findByLabelText("Allowed destinations");
  fireEvent.change(screen.getByLabelText("Channel kind"), { target: { value: "webhook" } });
  fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: "https://x.example.net/h" } });
  fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
  expect((await screen.findByRole("alert")).textContent).toContain("is not on this jurisdiction's notification allowlist");
  expect((screen.getByLabelText("Webhook URL") as HTMLInputElement).value).toBe("https://x.example.net/h");
  expect(screen.queryByLabelText("Webhook signing secret")).toBeNull();
});

it("sends a schedule interval only for scheduled rules and checks the rate cap before sending", async () => {
  const client = setup({ createNotificationRule: vi.fn().mockResolvedValue({ id: "r2", webhookSecret: null }) });
  await screen.findByLabelText("Allowed destinations");
  fireEvent.change(screen.getByLabelText("Most deliveries per window"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Most deliveries per window: enter a whole number from 1 to 600.");
  expect(client.createNotificationRule).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Most deliveries per window"), { target: { value: "60" } });
  fireEvent.change(screen.getByLabelText("When"), { target: { value: "scheduled" } });
  fireEvent.change(screen.getByLabelText("Run every (minutes)"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
  await screen.findByText("Notification rule created.");
  expect(client.createNotificationRule).toHaveBeenCalledWith("j1", expect.objectContaining({
    event: "scheduled", scheduleIntervalMinutes: 15, channels: [{ kind: "inapp", target: "requesting_position" }],
  }));
  expect(screen.queryByLabelText("Webhook signing secret")).toBeNull();
});
