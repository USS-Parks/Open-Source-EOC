// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeAar, type AarObservation, type AarRollup } from "@openeoc/shared";
import type { ApiClient, CorrectiveAction } from "../../app/api/client.js";
import { AarSurface } from "../../app/surfaces/AarSurface.js";
import { Theme } from "../../design/components.js";
import { AarDashboard } from "../AarDashboard.js";
import { dashboardCharts, dayBoundary, filterRecords, followThrough, type AarChart } from "../dashboard.js";

const TODAY = "2026-09-26";
const INCIDENT = "00000000-0000-4000-8000-000000000020";
const JURISDICTION = "00000000-0000-4000-8000-000000000030";

const observation = (id: string, capability: string, capabilityElement: string, kind: "strength" | "improvement"): AarObservation => ({
  id, capability, capabilityElement, kind, observation: `Observation ${id}`, recommendation: null,
  operationalPeriodRevision: null, createdAt: "2026-09-21T16:00:00.000Z",
});

const action = (id: string, fields: Partial<CorrectiveAction>): CorrectiveAction => ({
  id, incidentId: INCIDENT, capability: "planning", capabilityElement: "none", recommendation: `Action ${id}`,
  priority: "unspecified", owner: null, assignment: null, dueDate: null, status: "open", revision: 0,
  operationalPeriodRevision: null, completedAt: null, completedBy: null, createdAt: "2026-09-21T16:30:00.000Z", ...fields,
});

const observations = [
  observation("o1", "planning", "training", "improvement"),
  observation("o2", "mass_care_services", "equipment", "improvement"),
  observation("o3", "operational_communications", "none", "strength"),
];
const actions = [
  action("a1", { priority: "high", capabilityElement: "training", dueDate: "2026-09-20" }),
  action("a2", { priority: "high", capability: "mass_care_services", capabilityElement: "equipment", dueDate: "2026-10-30", status: "in_progress" }),
  action("a3", { priority: "low", capability: "mass_care_services", status: "complete", dueDate: "2026-09-01" }),
  action("a4", { priority: "critical", capability: "operational_communications", capabilityElement: "planning" }),
];
const data = { observations, correctiveActions: actions, analytics: summarizeAar(observations, actions) };

const rollup: AarRollup = {
  incidents: [
    { id: "i1", name: "Bald Hills Fire", jurisdictionId: JURISDICTION, activatedAt: "2026-09-01T00:00:00.000Z", closedAt: null },
    { id: "i2", name: "Winter Storm", jurisdictionId: JURISDICTION, activatedAt: "2026-01-03T00:00:00.000Z", closedAt: "2026-01-10T00:00:00.000Z" },
  ],
  correctiveActions: [
    { id: "r1", incidentId: "i1", organizationId: JURISDICTION, organizationName: "Yurok Tribe OES", capability: "planning", capabilityElement: "planning",
      recommendation: "Publish the handoff checklist", priority: "high", status: "open", dueDate: "2026-10-01", owner: "Planning Section Chief",
      ownerOrganization: { id: JURISDICTION, name: "Yurok Tribe OES" }, createdAt: "2026-09-02T00:00:00.000Z" },
    { id: "r2", incidentId: "i1", organizationId: JURISDICTION, organizationName: "Yurok Tribe OES", capability: "operational_coordination", capabilityElement: "organization",
      recommendation: "Confirm the mutual-aid radio plan", priority: "critical", status: "in_progress", dueDate: null, owner: "Mutual Aid Liaison",
      ownerOrganization: { id: "aid", name: "Mutual Aid" }, createdAt: "2026-09-03T00:00:00.000Z" },
    { id: "r3", incidentId: "i2", organizationId: JURISDICTION, organizationName: "Yurok Tribe OES", capability: "planning", capabilityElement: "none",
      recommendation: "Revise the winter storm annex", priority: "medium", status: "complete", dueDate: "2026-02-01", owner: null,
      ownerOrganization: null, createdAt: "2026-01-05T00:00:00.000Z" },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CHARTS: readonly AarChart[] = ["priority", "status", "followThrough", "capability", "element", "organization"];

describe("after-action dashboard counts", () => {
  it("counts every category exactly as the list it filters holds", () => {
    for (const records of [{ observations, actions }, { observations: [], actions: rollup.correctiveActions }]) {
      const charts = dashboardCharts(records, TODAY);
      for (const chart of CHARTS) {
        for (const datum of charts[chart]) {
          const listed = filterRecords(records, chart, datum.key, TODAY);
          expect(listed.observations.length + listed.actions.length, `${chart}:${datum.key}`).toBe(datum.value);
        }
      }
    }
  });

  it("reads recorded fields only: priority, status, due date, capability and element", () => {
    const charts = dashboardCharts({ observations, actions }, TODAY);
    const counts = (chart: AarChart) => Object.fromEntries(charts[chart].map((datum) => [datum.key, datum.value]));
    expect(counts("priority")).toEqual({ critical: 1, high: 2, medium: 0, low: 1, unspecified: 0 });
    expect(counts("status")).toEqual({ open: 2, in_progress: 1, complete: 1 });
    expect(counts("followThrough")).toEqual({ complete: 1, on_schedule: 1, past_due: 1, no_due_date: 1 });
    // Observations and actions both count toward capability and element, as the records list's capability filter does.
    expect(counts("capability")["mass_care_services"]).toBe(3);
    expect(charts.capability).toHaveLength(32);
    expect(charts.element.map((datum) => datum.label)).toEqual(["Planning", "Organization", "Equipment", "Training", "Exercises", "None"]);
    expect(counts("element")).toMatchObject({ training: 2, equipment: 2, none: 2, planning: 1 });
    expect(followThrough(actions[0]!, "2026-09-20")).toBe("on_schedule");
    expect(followThrough(actions[0]!, "2026-09-21")).toBe("past_due");
  });

  it("names the responsible organization, or no owner", () => {
    const charts = dashboardCharts({ observations: [], actions: rollup.correctiveActions }, TODAY);
    expect(charts.organization.map((datum) => [datum.label, datum.value]))
      .toEqual([["Mutual Aid", 1], ["No owner assigned", 1], ["Yurok Tribe OES", 1]]);
  });

  it("sends a date range as the local day's first instant and the next day's", () => {
    expect(dayBoundary("2026-01-03")).toBe(new Date(2026, 0, 3).toISOString());
    expect(dayBoundary("2026-01-03", true)).toBe(new Date(2026, 0, 4).toISOString());
    expect(dayBoundary("")).toBeUndefined();
  });
});

describe("after-action dashboard", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`filters its list from a slice and opens the records list from VIEW (${theme})`, async () => {
      const onView = vi.fn();
      const client = { getAarRollup: vi.fn() };
      const { container } = render(<Theme name={theme}>
        <AarDashboard client={client} data={data} periodLabel={null} onView={onView} today={TODAY} />
      </Theme>);
      expect(screen.getByRole("status").textContent).toBe("3 observations and 4 corrective actions, all operational periods.");
      const priority = screen.getByRole("article", { name: "Actions by priority" });
      fireEvent.click(within(priority).getByRole("button", { name: "High 2 (50%)" }));
      const list = screen.getByRole("region", { name: /Actions by priority: High/ });
      expect(within(list).getAllByRole("listitem")).toHaveLength(2);
      expect(within(list).getByText("2 records")).toBeTruthy();
      fireEvent.click(within(screen.getByRole("article", { name: "Core capability" })).getByRole("button", { name: "Mass Care Services: 3" }));
      expect(within(screen.getByRole("region", { name: /Core capability: Mass Care Services/ })).getAllByRole("listitem")).toHaveLength(3);
      fireEvent.click(within(screen.getByRole("article", { name: "Improvement plan" })).getByRole("button", { name: "View Past due" }));
      expect(onView).toHaveBeenCalledWith({ dimension: "followThrough", key: "past_due" });
      expect(client.getAarRollup).not.toHaveBeenCalled();
      const results = await axe.run(container, { rules: { region: { enabled: false } } });
      expect(results.violations).toEqual([]);
    });
  }

  it("switches to every incident the server returns for the range, and nothing else", async () => {
    const client = { getAarRollup: vi.fn().mockResolvedValue(rollup) };
    render(<Theme name="dark"><AarDashboard client={client} data={data} periodLabel="OP 03" onView={vi.fn()} today={TODAY} /></Theme>);
    expect(screen.getByRole("status").textContent).toBe("3 observations and 4 corrective actions in OP 03.");
    expect(screen.queryByRole("article", { name: "Responsible organization" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "All incidents" }));
    await screen.findByText("3 corrective actions across 2 incidents you can read, active in this range.");
    expect(client.getAarRollup).toHaveBeenCalledWith({ from: dayBoundary("2025-09-26"), to: dayBoundary(TODAY, true) });
    const organizations = screen.getByRole("article", { name: "Responsible organization" });
    fireEvent.click(within(organizations).getByRole("button", { name: "Mutual Aid: 1" }));
    const list = screen.getByRole("region", { name: /Responsible organization: Mutual Aid/ });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText(/Bald Hills Fire/)).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: "Clear filter" }));
    expect(within(screen.getByRole("region", { name: /Every corrective action/ })).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    await waitFor(() => expect(client.getAarRollup).toHaveBeenLastCalledWith({ from: dayBoundary("2026-09-01"), to: dayBoundary(TODAY, true) }));
  });

  it("reads honestly with nothing recorded", () => {
    const empty = { observations: [], correctiveActions: [], analytics: summarizeAar([], []) };
    render(<AarDashboard client={{ getAarRollup: vi.fn() }} data={empty} periodLabel={null} onView={vi.fn()} today={TODAY} />);
    expect(screen.getAllByText("No corrective actions yet")).toHaveLength(3);
    expect(screen.getAllByText("No observations or corrective actions yet")).toHaveLength(2);
    expect(screen.getByText(/No observations or corrective actions are recorded for this incident yet/)).toBeTruthy();
  });
});

describe("the AAR workspace's Dashboard tab", () => {
  it("opens the records list filtered as the chart was, with the same count", async () => {
    const client = {
      getAarAnalytics: vi.fn().mockResolvedValue(data),
      incidentAreaHistory: vi.fn().mockResolvedValue([]),
      listPositions: vi.fn().mockResolvedValue([]),
      listIncidentParticipants: vi.fn().mockResolvedValue([]),
      listPlans: vi.fn().mockResolvedValue([]),
      getAarRollup: vi.fn(),
    } as unknown as ApiClient;
    const { container } = render(<AarSurface client={client} jurisdictionId={JURISDICTION} incidentId={INCIDENT} />);
    await screen.findByRole("heading", { name: "After-action review" });
    expect(screen.getByRole("tab", { name: "Records" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Dashboard" }));
    const element = screen.getByRole("article", { name: "Capability element" });
    fireEvent.click(within(element).getByRole("button", { name: "Training: 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Open in the records list" }));
    await screen.findByRole("heading", { name: "Element: Training" });
    expect(screen.getByRole("tab", { name: "Records" }).getAttribute("aria-selected")).toBe("true");
    expect([...container.querySelectorAll<HTMLElement>("[data-record-id]")].map((row) => row.dataset.recordId)).toEqual(["o1", "a1"]);
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Element: Training" }));
  });
});
