// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient, SmsActivityNumber } from "../api/client.js";
import { TextActivityNumbers } from "../settings/SettingsSections.js";

afterEach(cleanup);

const unconfirmed: SmsActivityNumber = {
  jurisdictionId: "j1", jurisdictionName: "Yurok Tribe OES", phone: "+17075550201", confirmedAt: null, codeExpiresAt: null,
};

it("texts a code to a registered number and confirms it with the code the person enters", async () => {
  const client = {
    mySmsNumbers: vi.fn()
      .mockResolvedValueOnce({ numbers: [unconfirmed] })
      .mockResolvedValueOnce({ numbers: [unconfirmed] })
      .mockResolvedValue({ numbers: [{ ...unconfirmed, confirmedAt: "2026-09-26T17:00:00Z" }] }),
    sendSmsNumberCode: vi.fn().mockResolvedValue({ expiresAt: "2026-09-26T17:15:00Z" }),
    confirmSmsNumber: vi.fn().mockResolvedValue({ confirmed: true }),
  };
  render(<TextActivityNumbers client={client as unknown as ApiClient} />);
  await screen.findByText(/not confirmed/);
  fireEvent.click(screen.getByRole("button", { name: "Text me a code" }));
  await screen.findByText("A code was texted to +17075550201.");
  expect(client.sendSmsNumberCode).toHaveBeenCalledWith("j1", "+17075550201");
  fireEvent.change(screen.getByLabelText("Code for +17075550201"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm +17075550201" }));
  await screen.findByText("+17075550201 is confirmed.");
  expect(client.confirmSmsNumber).toHaveBeenCalledWith("j1", "+17075550201", "123456");
  await screen.findByText(/: confirmed/);
});

it("shows nothing when the person has no number where texted activity is on", async () => {
  const client = { mySmsNumbers: vi.fn().mockResolvedValue({ numbers: [] }) };
  const view = render(<TextActivityNumbers client={client as unknown as ApiClient} />);
  await vi.waitFor(() => expect(client.mySmsNumbers).toHaveBeenCalled());
  expect(view.container.textContent).toBe("");
});
