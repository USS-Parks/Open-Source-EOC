// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanDetail } from "@openeoc/shared";
import type { IncidentTemplateDefinition } from "../../app/api/client.js";
import { IncidentPlanSection, PlansPanel, definitionFrom, draftFrom, releaseLabel } from "../PlansPanel.js";

afterEach(cleanup);

const storm: IncidentTemplateDefinition = {
  key: "severe_storm",
  title: "Severe Storm",
  positions: ["incident_commander", "operations_section_chief"],
  boards: ["road_closures"],
  checklists: [],
  contactGroups: [{ name: "Road crews", positions: ["operations_section_chief"] }],
};

const plan: PlanDetail = {
  id: "p1", jurisdictionId: "j1", title: "Severe Storm Plan", kind: "incident_response", version: 2, templateKey: "severe_storm",
  sections: 1, tasks: 2, updatedAt: "2026-09-25T17:00:00Z", reviewEveryDays: 30, reviewedAt: null,
  reviewDueAt: "2026-09-01T17:00:00Z",
  definition: {
    kind: "incident_response", templateKey: "severe_storm",
    sections: [{ title: "Concept of operations", body: "Open at partial activation.", positions: ["operations_section_chief"], boards: ["road_closures"], contactGroups: [], rules: [] }],
    tasks: [
      { position: "operations_section_chief", item: "Stage the road crews", category: "general", releaseMinutes: 0, dueMinutes: 30 },
      { position: "incident_commander", item: "Set the second period", category: "general", releaseMinutes: 360 },
    ],
    notice: { contactGroups: ["Road crews"], positions: [], onCallPositions: [], channels: ["sms", "inapp"] },
    reviewEveryDays: 30,
  },
};

function client() {
  return {
    listPlans: vi.fn().mockResolvedValue([
      plan,
      { ...plan, id: "p2", title: "Salmon Festival", kind: "recurring_event", reviewEveryDays: null, reviewDueAt: null, sections: 0, tasks: 1 },
    ]),
    getPlan: vi.fn().mockResolvedValue(plan),
    listPlanVersions: vi.fn().mockResolvedValue([]),
    savePlan: vi.fn().mockResolvedValue({ ...plan, version: 3 }),
    markPlanReviewed: vi.fn().mockResolvedValue({ ...plan, reviewDueAt: "2026-10-25T17:00:00Z" }),
    activatePlan: vi.fn().mockResolvedValue({ incidentId: "i9", planVersion: 1, tasksReleased: 1, tasksScheduled: 2, notice: { massNotificationId: "m1", recipients: 4 } }),
    getIncidentTemplate: vi.fn().mockResolvedValue({ template: storm, version: 1, updatedAt: "2026-09-25T17:00:00Z" }),
    listTemplates: vi.fn().mockResolvedValue([{ key: "road_closures", version: 1, title: "Road Closures" }]),
  };
}

const templates = [
  { key: "severe_storm", title: "Severe Storm", version: 1, updatedAt: "2026-09-25T17:00:00Z", positions: 2, boards: 1, checklistItems: 0 },
];

describe("executable plans on screen", () => {
  it("says when a task releases, and round-trips a plan through the editor's draft", () => {
    expect(releaseLabel(0, "incident_response")).toBe("at activation");
    expect(releaseLabel(360, "incident_response")).toBe("6 hours after activation");
    expect(releaseLabel(-2880, "recurring_event")).toBe("2 days before the event starts");
    expect(releaseLabel(0, "recurring_event")).toBe("when the event starts");
    expect(definitionFrom(draftFrom(plan, plan.id, plan.version))).toEqual(plan.definition);
    const draft = draftFrom(plan, plan.id, plan.version);
    expect(() => definitionFrom({ ...draft, tasks: [{ ...draft.tasks[0]!, releaseHours: "soon" }] })).toThrow("Task 1 release: enter a number of hours.");
  });

  it("edits a plan's sections, tasks and notice and saves it over the version opened", async () => {
    const api = client();
    const view = render(<PlansPanel client={api} jurisdictionId="j1" isAdmin templates={templates} />);
    await view.findByText("Severe Storm Plan");
    expect(view.getByText("Review due")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Edit Severe Storm Plan" }));
    const form = await view.findByRole("form", { name: "Edit Severe Storm Plan" });
    await within(form).findByText("Road Closures");
    fireEvent.click(within(form).getByRole("button", { name: "Add a task" }));
    fireEvent.change(within(form).getByLabelText("Task 3 position"), { target: { value: "operations_section_chief" } });
    fireEvent.change(within(form).getByLabelText("Task 3 description"), { target: { value: "Check the culverts" } });
    fireEvent.change(within(form).getByLabelText("Task 3 release (hours)"), { target: { value: "1.5" } });
    expect((await axe.run(view.container)).violations).toEqual([]);
    fireEvent.click(within(form).getByRole("button", { name: "Save plan" }));
    await view.findByText("Saved Severe Storm Plan as version 3.");
    expect(api.savePlan).toHaveBeenCalledWith("j1", "p1", expect.objectContaining({
      title: "Severe Storm Plan", expectedVersion: 2,
      definition: expect.objectContaining({
        tasks: [...plan.definition.tasks, { position: "operations_section_chief", item: "Check the culverts", category: "general", releaseMinutes: 90 }],
        notice: { contactGroups: ["Road crews"], positions: [], onCallPositions: [], channels: ["sms", "inapp"] },
      }),
    }));
  });

  it("activates a recurring event plan for an occurrence and reports what it released", async () => {
    const api = client();
    const onActivated = vi.fn();
    const onSwitch = vi.fn();
    const view = render(<PlansPanel client={api} jurisdictionId="j1" isAdmin templates={templates} onActivated={onActivated} onSwitch={onSwitch} />);
    fireEvent.click(await view.findByRole("button", { name: "Activate Salmon Festival" }));
    const form = view.getByRole("form", { name: "Activate Salmon Festival" });
    fireEvent.change(within(form).getByLabelText("Incident name"), { target: { value: "Salmon Festival 2026" } });
    fireEvent.change(within(form).getByLabelText("Event starts"), { target: { value: "2026-10-03T09:00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Activate the plan" }));
    await view.findByText(/Salmon Festival 2026 is activated from Salmon Festival, version 1: 1 task released now, 2 tasks waiting/);
    expect(api.activatePlan).toHaveBeenCalledWith("p2", { name: "Salmon Festival 2026", eventAt: new Date("2026-10-03T09:00").toISOString() });
    expect(onActivated).toHaveBeenCalledWith("i9");
    expect(onSwitch).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Switch to Salmon Festival 2026" }));
    expect(onSwitch).toHaveBeenCalledWith("i9");
  });

  it("keeps the activation report when the console remounts the screen for the new incident", async () => {
    const api = client();
    const first = render(<PlansPanel client={api} jurisdictionId="j1" isAdmin templates={templates} />);
    fireEvent.click(await first.findByRole("button", { name: "Activate Severe Storm Plan" }));
    fireEvent.change(first.getByLabelText("Incident name"), { target: { value: "River Road Storm" } });
    fireEvent.click(first.getByRole("button", { name: "Activate the plan" }));
    await first.findByText(/River Road Storm is activated from Severe Storm Plan/);
    first.unmount();
    const onActivated = vi.fn();
    const again = render(<PlansPanel client={api} jurisdictionId="j1" isAdmin templates={templates} onActivated={onActivated} onSwitch={vi.fn()} />);
    await again.findByText(/River Road Storm is activated from Severe Storm Plan/);
    expect(again.getByRole("button", { name: "Switch to River Road Storm" })).toBeTruthy();
    expect(onActivated).toHaveBeenCalledWith("i9");
    again.unmount();
    // Another jurisdiction's panel does not show it.
    const elsewhere = render(<PlansPanel client={api} jurisdictionId="j2" isAdmin templates={templates} />);
    await elsewhere.findByText("Severe Storm Plan");
    expect(elsewhere.queryByText(/River Road Storm is activated/)).toBeNull();
  });

  it("shows the report to the panel mounted when the activation answers, after a remount cut the first off", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const api = { ...client(), activatePlan: vi.fn().mockReturnValue(new Promise((resolve) => { answer = resolve; })) };
    const first = render(<PlansPanel client={api} jurisdictionId="j1" isAdmin templates={templates} />);
    fireEvent.click(await first.findByRole("button", { name: "Activate Severe Storm Plan" }));
    fireEvent.change(first.getByLabelText("Incident name"), { target: { value: "Coast Storm" } });
    fireEvent.click(first.getByRole("button", { name: "Activate the plan" }));
    first.unmount();
    const again = render(<PlansPanel client={api} jurisdictionId="j1" isAdmin templates={templates} />);
    await again.findByText("Severe Storm Plan");
    answer({ incidentId: "i10", planVersion: 2, tasksReleased: 1, tasksScheduled: 2 });
    await again.findByText(/Coast Storm is activated from Severe Storm Plan, version 2/);
  });

  it("lets a member read plans but not change them", async () => {
    const api = client();
    const view = render(<PlansPanel client={api} jurisdictionId="j1" isAdmin={false} templates={[]} />);
    fireEvent.click(await view.findByRole("button", { name: "Read Severe Storm Plan" }));
    const reading = await view.findByRole("region", { name: "Severe Storm Plan, version 2" });
    expect(reading.textContent).toContain("Carried out by: Operations Section Chief, Road Closures board.");
    expect(reading.textContent).toContain("Set the second period · Incident Commander · 6 hours after activation");
    expect(view.queryByRole("button", { name: /Edit|Activate|New plan/ })).toBeNull();
  });

  it("shows an incident's plan and the tasks it has still to release", async () => {
    const api = {
      incidentPlan: vi.fn().mockResolvedValue({
        planId: "p1", title: "Severe Storm Plan", kind: "incident_response", version: 2, eventAt: null,
        sections: plan.definition.sections,
        scheduled: [{ item: "Set the second period", positionTitle: "Incident Commander", releaseAt: "2026-09-25T23:00:00Z" }],
      }),
      listTemplates: vi.fn().mockResolvedValue([{ key: "road_closures", version: 1, title: "Road Closures" }]),
    };
    const view = render(<IncidentPlanSection client={api} incidentId="i1" />);
    const section = await view.findByRole("region", { name: "Incident plan" });
    expect(section.textContent).toContain("Plan: Severe Storm Plan, version 2");
    expect(section.textContent).toContain("Set the second period · Incident Commander · releases");
    await view.findByText("Carried out by: Operations Section Chief, Road Closures board.");
    expect((await axe.run(view.container)).violations).toEqual([]);
  });
});
