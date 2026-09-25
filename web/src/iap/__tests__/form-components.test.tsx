// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ICS_COMPONENT_EDITION, type IcsComponentFormId } from "@openeoc/shared";
import type { IcsComponentDetail } from "../../app/api/client.js";
import { FormComponents } from "../FormComponents.js";

afterEach(cleanup);

const INCIDENT = "00000000-0000-4000-8000-000000000001";

const channels: IcsComponentDetail = {
  id: "c-205", incidentId: INCIDENT, formId: "ICS-205", title: "Incident Radio Communications Plan", label: "",
  periodRevision: 4, operationalPeriod: "OP 4", status: "draft", version: 1, preparedBy: "Rosa Planner",
  preparedRole: "Planning Section Chief", updatedAt: "2026-09-25T17:00:00Z", edition: ICS_COMPONENT_EDITION,
  incidentName: "Klamath River Flood",
  values: { channels: [["", "", "", "CMD-1", "Command", "154.2800", "", "154.2800", "", "", ""]], specialInstructions: "" },
};

function client() {
  return {
    listIcsComponents: vi.fn().mockResolvedValue([channels]),
    createIcsComponent: vi.fn(),
    getIcsComponent: vi.fn().mockResolvedValue(channels),
    saveIcsComponent: vi.fn().mockImplementation((_id: string, body: { values: unknown; status: "draft" | "ready" }) =>
      Promise.resolve({ ...channels, values: body.values, status: body.status, version: 2, plans: [] })),
    listIcsComponentVersions: vi.fn().mockResolvedValue([]),
    downloadIcsComponentPdf: vi.fn().mockResolvedValue(new Blob(["%PDF-1.4"])),
    createIap: vi.fn().mockResolvedValue({ id: "iap-1", content: { incidentName: "Klamath River Flood", operationalPeriod: "OP 4", preparedBy: "Rosa Planner", forms: [] } }),
  };
}

const summary = (id: string, formId: IcsComponentFormId, status: "draft" | "ready", label = "") =>
  ({ ...channels, id, formId, label, status });

describe("ICS forms as components of a period", () => {
  it("edits a table block by block and saves it as the next version, marked ready", async () => {
    const api = client();
    const view = render(<FormComponents client={api} incidentId={INCIDENT} periodRevision={4} periodLabel="OP 4" />);
    const list = await view.findByRole("list", { name: "Forms for this period" });
    expect(list.textContent).toContain("ICS 205: Incident Radio Communications Plan");
    expect(list.textContent).toContain("Version 1 · Rosa Planner, Planning Section Chief");
    expect(api.listIcsComponents).toHaveBeenCalledWith(INCIDENT, 4);
    // The period already holds its 205, so the start button opens it.
    fireEvent.change(view.getByLabelText("Form to start"), { target: { value: "ICS-205" } });
    fireEvent.click(view.getByRole("button", { name: "Open the period's ICS 205" }));
    const form = await view.findByRole("form", { name: "Edit ICS 205: Incident Radio Communications Plan" });
    expect(api.createIcsComponent).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole("button", { name: "Add a row to Basic Radio Channel Use" }));
    fireEvent.change(within(form).getByLabelText("Basic Radio Channel Use, row 2, Channel Name/Trunked Radio System Talkgroup"),
      { target: { value: "TAC-2" } });
    fireEvent.change(within(form).getByLabelText("Basic Radio Channel Use, row 2, Assignment"), { target: { value: "Division A" } });
    fireEvent.change(within(form).getByLabelText("5. Special Instructions"), { target: { value: "Monitor CMD-1 at all times." } });
    expect(form.textContent).toContain("Unsaved changes. Printing uses the saved version.");
    // Enter in a field makes no version; only the save buttons do.
    fireEvent.submit(form);
    expect(api.saveIcsComponent).not.toHaveBeenCalled();
    expect((await axe.run(view.container)).violations).toEqual([]);
    fireEvent.click(within(form).getByRole("button", { name: "Save and mark ready" }));
    await view.findByText("Saved ICS 205: Incident Radio Communications Plan as version 2, ready.");
    expect(api.saveIcsComponent).toHaveBeenCalledWith("c-205", {
      values: {
        channels: [
          ["", "", "", "CMD-1", "Command", "154.2800", "", "154.2800", "", "", ""],
          ["", "", "", "TAC-2", "Division A", "", "", "", "", "", ""],
        ],
        specialInstructions: "Monitor CMD-1 at all times.",
      },
      status: "ready",
      expectedVersion: 1,
    });
    expect(view.getByRole("form").textContent).toContain("Version 2, ready");
  });

  it("asks for a name before starting a form a period holds several of", async () => {
    const api = client();
    api.createIcsComponent.mockResolvedValue({
      ...channels, id: "c-204", formId: "ICS-204", title: "Assignment List", label: "Division A",
      values: {
        branch: "", division: "", group: "", stagingArea: "", workAssignments: "", specialInstructions: "",
        personnel: [["Operations Section Chief", "", ""]], resources: [], communications: [],
      },
    });
    const view = render(<FormComponents client={api} incidentId={INCIDENT} periodRevision={4} periodLabel="OP 4" />);
    await view.findByRole("list", { name: "Forms for this period" });
    fireEvent.change(view.getByLabelText("Form to start"), { target: { value: "ICS-204" } });
    fireEvent.click(view.getByRole("button", { name: "Start form" }));
    await view.findByText("Name this ICS 204: Branch, division, group or staging area.");
    fireEvent.change(view.getByLabelText("Name (Branch, division, group or staging area)"), { target: { value: " Division A " } });
    fireEvent.click(view.getByRole("button", { name: "Start form" }));
    await view.findByRole("form", { name: "Edit ICS 204: Assignment List, Division A" });
    expect(api.createIcsComponent).toHaveBeenCalledWith(INCIDENT, { formId: "ICS-204", periodRevision: 4, label: "Division A" });
  });

  it("shows a save over someone else's version as refused, not lost", async () => {
    const api = client();
    api.saveIcsComponent.mockRejectedValue(new Error("the form changed after it was opened: version 3 is current"));
    const view = render(<FormComponents client={api} incidentId={INCIDENT} periodRevision={4} periodLabel="OP 4" />);
    fireEvent.click(await view.findByRole("button", { name: /ICS 205: Incident Radio Communications Plan/ }));
    const form = await view.findByRole("form");
    fireEvent.click(within(form).getByRole("button", { name: "Save as draft" }));
    expect((await view.findByRole("alert")).textContent).toBe("the form changed after it was opened: version 3 is current");
    expect(view.getByRole("form")).toBeTruthy();
  });

  it("assembles the plan from the default set of ready forms, plus any ticked", async () => {
    const api = client();
    api.listIcsComponents.mockResolvedValue([
      summary("c-202", "ICS-202", "ready"), summary("c-204a", "ICS-204", "ready", "Division A"),
      summary("c-205", "ICS-205", "ready"), summary("c-206", "ICS-206", "draft"), summary("c-215", "ICS-215", "ready"),
    ]);
    const onOpenIap = vi.fn();
    const view = render(<FormComponents client={api} incidentId={INCIDENT} periodRevision={4} periodLabel="OP 4" onOpenIap={onOpenIap} />);
    const choice = await view.findByRole("group", { name: "Assemble the IAP from these forms" });
    const box = (name: string) => within(choice).getByRole("checkbox", { name }) as HTMLInputElement;
    expect(box("ICS 202: Incident Objectives").checked).toBe(true);
    expect(box("ICS 204: Assignment List, Division A").checked).toBe(true);
    expect(box("ICS 206: Medical Plan (draft)").disabled).toBe(true);
    expect(box("ICS 215: Operational Planning Worksheet").checked).toBe(false);
    fireEvent.click(box("ICS 215: Operational Planning Worksheet"));
    expect((await axe.run(view.container)).violations).toEqual([]);
    fireEvent.click(within(choice).getByRole("button", { name: "Assemble IAP from 4 forms" }));
    await view.findByText("Assembled a draft IAP for OP 4 from 4 forms.");
    expect(api.createIap).toHaveBeenCalledWith(INCIDENT, {
      operationalPeriod: "OP 4", periodRevision: 4, componentIds: ["c-202", "c-204a", "c-205", "c-215"],
    });
    fireEvent.click(within(choice).getByRole("button", { name: "Review it in the IAP workspace" }));
    expect(onOpenIap).toHaveBeenCalledTimes(1);
  });

  it("says when a form marked ready starts the plan's next revision", async () => {
    const api = client();
    api.saveIcsComponent.mockResolvedValue({
      ...channels, status: "ready", version: 2,
      plans: [{ id: "iap-2", revisionNumber: 2, contentRevision: 1, changed: [{ formId: "ICS-205", label: "", version: 2 }] }],
    });
    const view = render(<FormComponents client={api} incidentId={INCIDENT} periodRevision={4} periodLabel="OP 4" />);
    fireEvent.click(await view.findByRole("button", { name: /ICS 205: Incident Radio Communications Plan/ }));
    fireEvent.click(within(await view.findByRole("form")).getByRole("button", { name: "Save and mark ready" }));
    await view.findByText("Saved ICS 205: Incident Radio Communications Plan as version 2, ready."
      + " The IAP's revision 2 started from it, a draft for approval.");
  });
});
