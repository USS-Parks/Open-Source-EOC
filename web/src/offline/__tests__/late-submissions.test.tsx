// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LateSubmission } from "../../app/api/client.js";
import { Theme } from "../../design/components.js";
import { LateSubmissions } from "../LateSubmissions.js";

afterEach(cleanup);

const report: LateSubmission = {
  id: "late-1",
  incidentId: "incident-1",
  kind: "board",
  summary: "1 record on Significant Events",
  detail: {
    boardTitle: "Significant Events",
    records: [{ id: "record-1", fields: [
      { key: "summary", label: "Summary", value: "Culvert washed out" },
      { key: "location", label: "Location", value: { type: "Point", coordinates: [-123.9, 41.3] } },
    ] }],
  },
  status: "pending",
  submittedBy: { personId: "person-1", displayName: "L. Moreno", positionTitle: "Field Observer" },
  capturedAt: "2026-09-25T10:05:00.000Z",
  receivedAt: "2026-09-25T12:00:00.000Z",
  decidedBy: null,
  decidedAt: null,
  reason: null,
};
const message: LateSubmission = {
  ...report, id: "late-2", kind: "message", summary: "Message in Division B",
  detail: { threadTitle: "Division B", body: "Slide at mile 12" },
  status: "refused", decidedBy: { personId: "admin-1", displayName: "J. Lee" },
  decidedAt: "2026-09-25T12:30:00.000Z", reason: "Superseded by the demobilization brief",
};

function client() {
  return {
    listLateSubmissions: vi.fn().mockResolvedValue([report, message]),
    acceptLateSubmission: vi.fn().mockResolvedValue({ lateSubmission: { ...report, status: "accepted" }, conflicts: 0 }),
    refuseLateSubmission: vi.fn().mockResolvedValue({ lateSubmission: { ...report, status: "refused" } }),
  };
}

describe("late submissions", () => {
  it("shows what arrived after the close, by whom, and waits for the reopening to accept", async () => {
    const api = client();
    const view = render(<Theme name="light"><LateSubmissions client={api} incidentId="incident-1" canDecide closed /></Theme>);
    const item = await view.findByRole("listitem", { name: "1 record on Significant Events" });
    expect(within(item).getByText("Awaiting a decision")).toBeTruthy();
    expect(within(item).getByText(/Sent by L\. Moreno, Field Observer\./)).toBeTruthy();
    expect(within(item).getByText("Culvert washed out")).toBeTruthy();
    expect(within(item).getByText("Point at latitude 41.3, longitude -123.9")).toBeTruthy();
    expect((within(item).getByRole("button", { name: "Accept 1 record on Significant Events" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(item).getByText("Reopen the incident to accept: a closed incident takes no writes.")).toBeTruthy();
    const refused = view.getByRole("listitem", { name: "Message in Division B" });
    expect(within(refused).getByText(/Refused by J\. Lee .*: Superseded by the demobilization brief/)).toBeTruthy();
    expect(within(refused).queryByRole("button")).toBeNull();
    expect((await axe.run(view.container)).violations).toEqual([]);

    fireEvent.click(within(item).getByRole("button", { name: "Refuse 1 record on Significant Events" }));
    fireEvent.change(within(item).getByLabelText("Reason for refusing"), { target: { value: "Entered on the board by hand" } });
    expect((await axe.run(view.container)).violations).toEqual([]);
    fireEvent.click(within(item).getByRole("button", { name: "Confirm refusal" }));
    await view.findByText("Refused 1 record on Significant Events.");
    expect(api.refuseLateSubmission).toHaveBeenCalledWith("late-1", "Entered on the board by hand");
  });

  it("accepts once the incident is open again", async () => {
    const api = client();
    const view = render(<Theme name="dark"><LateSubmissions client={api} incidentId="incident-1" canDecide closed={false} /></Theme>);
    fireEvent.click(await view.findByRole("button", { name: "Accept 1 record on Significant Events" }));
    await view.findByText("Accepted 1 record on Significant Events.");
    expect(api.acceptLateSubmission).toHaveBeenCalledWith("late-1");
    // The list is read again in an effect after the notice renders.
    await waitFor(() => expect(api.listLateSubmissions).toHaveBeenCalledTimes(2));
  });

  it("shows a sender their own submissions without the decision controls", async () => {
    const view = render(<Theme name="light"><LateSubmissions client={client()} incidentId="incident-1" canDecide={false} closed /></Theme>);
    await view.findByText("1 record on Significant Events");
    expect(view.queryByRole("button", { name: /Accept/ })).toBeNull();
    expect(view.queryByRole("button", { name: /Refuse/ })).toBeNull();
  });
});
