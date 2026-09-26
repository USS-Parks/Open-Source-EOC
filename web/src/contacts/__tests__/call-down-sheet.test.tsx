// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CallDownSheet, timeReached } from "../CallDownSheet.js";
import type { MassNotificationDetail, MassRecipient } from "../model.js";

afterEach(cleanup);

const recipient = (id: string, name: string, part: Partial<MassRecipient> = {}): MassRecipient => ({
  id, priority: Number(id.slice(1)), contactId: null, name, email: null, phone: "+17075550101", inApp: false, reachedThrough: null,
  response: null, notifiedAt: "2026-09-25T17:00:00Z", linkExpiresAt: null, acknowledgedAt: null, acknowledgedVia: null,
  replies: [], deliveries: [], ...part,
});

const send: MassNotificationDetail = {
  id: "m1", subject: "Levee watch", message: "Seepage at mile 4. Can you staff the levee?", mode: "broadcast", channels: ["sms"],
  groupName: "Duty officers", audience: "Group: Duty officers", incidentId: null, intervalMinutes: null, fallbackMinutes: null,
  acknowledgementsNeeded: 1, sentBy: "Member", createdAt: "2026-09-25T17:00:00Z", completedAt: null, contactCount: 3, notified: 3,
  acknowledged: 1, state: "sent",
  responses: [{ option: "Available", count: 1 }, { option: "Not available", count: 0 }],
  recipients: [
    recipient("r1", "Avery First", { response: "Available", acknowledgedVia: "sms", acknowledgedAt: "2026-09-25T17:02:00Z" }),
    recipient("r2", "Bailey Second", { phone: "+17075550102" }),
    recipient("r3", "Cameron Third", { phone: null }),
  ],
};

describe("the call-down sheet", () => {
  it("reads a time on the sheet as the latest such moment not after now", () => {
    const now = new Date(2026, 8, 25, 10, 0);
    expect(timeReached("09:30", now)).toBe(new Date(2026, 8, 25, 9, 30).toISOString());
    expect(timeReached("23:50", now)).toBe(new Date(2026, 8, 24, 23, 50).toISOString());
    expect(timeReached("half past", now)).toBeUndefined();
  });

  it("prints the list with blank columns and enters who was reached, when and their answer", async () => {
    const client = { recordMassAcknowledgements: vi.fn().mockResolvedValue({ recorded: 1 }) };
    const onRecorded = vi.fn();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const view = render(<CallDownSheet client={client} send={send} canEnter onRecorded={onRecorded} />);

    const paper = document.body.querySelector(".contacts-sheet-print")!;
    expect(paper.querySelector("h1")?.textContent).toBe("Call-down sheet: Levee watch");
    expect(paper.textContent).toContain("Ask for an answer: 1 Available, 2 Not available.");
    const rows = [...paper.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows).toEqual([
      ["1", "Avery First", "+17075550101", "Answered Available by text reply", "", "☐ 1 Available  ☐ 2 Not available", ""],
      ["2", "Bailey Second", "+17075550102", "", "", "☐ 1 Available  ☐ 2 Not available", ""],
      ["3", "Cameron Third", "No phone", "", "", "☐ 1 Available  ☐ 2 Not available", ""],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Print call-down sheet" }));
    expect(print).toHaveBeenCalledOnce();

    const form = screen.getByRole("group", { name: "Enter from the call-down sheet" });
    fireEvent.click(within(form).getByRole("button", { name: "Enter acknowledgements" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Tick each person you reached.");
    fireEvent.click(within(form).getByRole("checkbox", { name: "Reached Bailey Second" }));
    fireEvent.change(within(form).getByLabelText("Time Bailey Second was reached"), { target: { value: "14:05" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enter acknowledgements" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose Bailey Second's answer.");
    fireEvent.change(within(form).getByLabelText("Answer from Bailey Second"), { target: { value: "Not available" } });
    expect((await axe.run(view.container)).violations).toEqual([]);
    fireEvent.click(within(form).getByRole("button", { name: "Enter acknowledgements" }));
    await screen.findByText("1 acknowledgement entered from the call-down sheet.");
    expect(client.recordMassAcknowledgements).toHaveBeenCalledWith("m1", [
      { recipientId: "r2", at: timeReached("14:05"), response: "Not available" },
    ]);
    expect(onRecorded).toHaveBeenCalledOnce();
    expect((within(form).getByRole("checkbox", { name: "Reached Bailey Second" }) as HTMLInputElement).checked).toBe(false);
    print.mockRestore();
  });

  it("offers a viewer the printed sheet but not the entry", () => {
    render(<CallDownSheet client={{ recordMassAcknowledgements: vi.fn() }} send={{ ...send, responses: [] }} canEnter={false} onRecorded={() => undefined} />);
    expect(screen.getByRole("button", { name: "Print call-down sheet" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Enter from the call-down sheet" })).toBeNull();
    expect(document.body.querySelector(".contacts-sheet-print")?.textContent).toContain("Ask each person to confirm they received the message.");
  });
});
