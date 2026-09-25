// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IncidentTemplateDefinition } from "../../app/api/client.js";
import { IncidentTemplatesPanel, keyFrom } from "../IncidentTemplatesPanel.js";

afterEach(cleanup);

const flood: IncidentTemplateDefinition = {
  key: "river_flood",
  title: "River Flood",
  positions: ["incident_commander", "tribal_liaison"],
  positionTitles: { tribal_liaison: "Tribal Liaison" },
  boards: ["activity_log"],
  checklists: [{
    position: "incident_commander",
    items: [
      { item: "Confirm the gauge readings", category: "intelligence", key: "gauges" },
      { item: "Order the evacuation", category: "evacuation", dependsOn: ["gauges"] },
    ],
  }],
};

function client() {
  return {
    listIncidentTemplates: vi.fn().mockResolvedValue([
      { key: "river_flood", title: "River Flood", version: 3, updatedAt: "2026-09-25T17:00:00Z", positions: 2, boards: 1, checklistItems: 1 },
    ]),
    getIncidentTemplate: vi.fn().mockResolvedValue({ template: flood, version: 3, updatedAt: "2026-09-25T17:00:00Z" }),
    listIncidentTemplateVersions: vi.fn().mockResolvedValue([]),
    saveIncidentTemplate: vi.fn().mockResolvedValue({ key: "river_flood", version: 4 }),
    listTemplates: vi.fn().mockResolvedValue([{ key: "activity_log", version: 1, title: "Activity Log" }]),
    listPositions: vi.fn().mockResolvedValue([]),
  };
}

describe("incident templates on screen", () => {
  it("makes a key from a title", () => {
    expect(keyFrom("Tsunami Warning")).toBe("tsunami_warning");
    expect(keyFrom("  2026 King Tide / Coastal Flood! ")).toBe("king_tide_coastal_flood");
  });

  it("saves an edit over the version opened, keeping each item's category, key and dependencies", async () => {
    const api = client();
    const onSaved = vi.fn();
    const view = render(<IncidentTemplatesPanel client={api} jurisdictionId="j1" onSaved={onSaved} />);
    await view.findByText("1 checklist item");
    expect(view.getByText("2 positions")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Edit River Flood" }));
    const form = await view.findByRole("form", { name: "Edit River Flood" });
    expect(form.textContent).toContain("Edit River Flood, version 3");
    const ic = view.getByLabelText("Checklist for Incident Commander") as HTMLTextAreaElement;
    expect(ic.value).toBe("Confirm the gauge readings\nOrder the evacuation");
    fireEvent.change(ic, { target: { value: `${ic.value}\nOpen the Klamath shelter` } });
    fireEvent.change(view.getByLabelText("Checklist for Tribal Liaison"), { target: { value: "Call the village representatives" } });
    expect((await axe.run(view.container)).violations).toEqual([]);
    fireEvent.click(view.getByRole("button", { name: "Save template" }));
    await view.findByText("Saved River Flood as version 4.");
    expect(api.saveIncidentTemplate).toHaveBeenCalledWith("river_flood", {
      title: "River Flood",
      positions: ["incident_commander", "tribal_liaison"],
      positionTitles: { tribal_liaison: "Tribal Liaison" },
      boards: ["activity_log"],
      checklists: [
        {
          position: "incident_commander",
          items: [
            { item: "Confirm the gauge readings", category: "intelligence", key: "gauges" },
            { item: "Order the evacuation", category: "evacuation", dependsOn: ["gauges"] },
            "Open the Klamath shelter",
          ],
        },
        { position: "tribal_liaison", items: ["Call the village representatives"] },
      ],
    }, 3);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("starts a new template at version 0 with a key from its title, and shows a refusal", async () => {
    const api = client();
    api.saveIncidentTemplate.mockRejectedValueOnce(new Error("boards: no board template levee_gauges"));
    const view = render(<IncidentTemplatesPanel client={api} jurisdictionId="j1" />);
    fireEvent.click(await view.findByRole("button", { name: "New template" }));
    fireEvent.change(view.getByLabelText("Template title"), { target: { value: "King Tide" } });
    expect((view.getByLabelText("Template key") as HTMLInputElement).value).toBe("king_tide");
    fireEvent.click(view.getByRole("checkbox", { name: "Activity Log" }));
    fireEvent.click(view.getByRole("button", { name: "Save template" }));
    expect((await view.findByRole("alert")).textContent).toBe("boards: no board template levee_gauges");
    expect(api.saveIncidentTemplate).toHaveBeenCalledWith("king_tide", expect.objectContaining({
      title: "King Tide", positions: ["incident_commander"], boards: ["activity_log"], checklists: [],
    }), 0);
  });
});
