// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import {
  LIFELINE_DEFINITION,
  type IncidentAreaRevision,
  type LifelineAssessmentReport,
  type LifelineCurrentState,
} from "@openeoc/shared";
import type { ApiClient, LifelineAssessmentOverviewResponse } from "../api/client.js";
import { LifelinesSurface } from "../surfaces/LifelinesSurface.js";
import { PageChromeContext } from "../layout/page-chrome.js";
import { LIFELINE_KEYS, projectLifeline } from "../surfaces/lifeline-view.js";

// The assessment form reads the selected incident for its organization choices.
vi.mock("../incident/context.js", () => ({
  useIncident: () => ({ selectedIncident: { id: "00000000-0000-4000-8000-000000000020", jurisdictionId: "00000000-0000-4000-8000-000000000011", name: "Harbor Storm" } }),
}));

const PERIOD = {
  label: "OP 3",
  startsAt: "2026-09-21T06:00:00-07:00",
  endsAt: "2026-09-21T18:00:00-07:00",
} as const;

const attribution = {
  personId: "00000000-0000-4000-8000-000000000010",
  personName: "Jordan Diaz",
  positionId: null,
  positionTitle: "Utility Liaison",
  participationId: null,
  homeOrganizationId: "00000000-0000-4000-8000-000000000011",
  homeOrganizationName: "North Coast EOC",
  recordedAt: "2026-09-21T16:35:00.000Z",
};

function report(
  lifeline: string,
  condition: string,
  assessedAt: string,
  payload: Record<string, unknown> = {},
): LifelineAssessmentReport {
  return {
    id: `00000000-0000-4000-8000-${lifeline.padEnd(12, "0").slice(0, 12)}`,
    incidentId: "00000000-0000-4000-8000-000000000020",
    lifeline,
    definitionVersion: 1,
    condition,
    assessedAt,
    sourceKind: "native",
    legacyStatus: null,
    payload: {
      confidence: "confirmed",
      impactStatement: `${lifeline} impact statement`,
      stabilizationOutlook: `${lifeline} outlook`,
      components: [],
      evidence: [],
      actions: [],
      operationalPeriod: "OP 3",
      ...payload,
    },
    stabilizationObjective: null, nextUpdateAt: null, supersedesAssessmentId: null,
    legacyBoardId: null,
    legacyRecordId: null,
    attribution,
  };
}

function state(
  lifeline: string,
  condition: string | null,
  reports: readonly LifelineAssessmentReport[],
  conflict = false,
): LifelineCurrentState {
  return { lifeline, condition, conflict, reports, decision: null };
}

const states: readonly LifelineCurrentState[] = LIFELINE_KEYS.map((key) => {
  if (key === "hazardous_materials") return state(key, null, []);
  if (key === "energy") {
    return state(key, "stable", [report(key, "stable", "2026-09-20T16:35:00.000Z", {
      components: [
        { key: "electricity", label: "Electricity", condition: "stable", affectedGeography: "North district" },
        { key: "fuel", label: "Fuel", condition: "stable" },
      ],
      evidence: [{ kind: "reported", description: "Utility situation report" }],
      actions: [{ key: "inspect", title: "Inspect substation", status: "in_progress" }],
    })]);
  }
  const condition = key === "transportation" ? "unstable" : key === "water_systems" ? "stabilizing" : "stable";
  return state(key, condition, [report(key, condition, "2026-09-21T16:35:00.000Z")]);
});

const overview: LifelineAssessmentOverviewResponse = {
  definition: LIFELINE_DEFINITION,
  doctrineGaps: [],
  states,
};

const area: IncidentAreaRevision = {
  incidentId: "00000000-0000-4000-8000-000000000020",
  revision: 3,
  geometry: null,
  operationalPeriod: PERIOD,
  reason: "Current period",
  createdAt: "2026-09-21T13:00:00.000Z",
  createdBy: attribution.personId,
  positionId: null,
  createdByName: attribution.personName,
  positionTitle: attribution.positionTitle,
};

function client(): ApiClient {
  return {
    listIncidentLifelineAssessments: vi.fn().mockResolvedValue(overview),
    getIncidentArea: vi.fn().mockResolvedValue(area),
    lifelineAssessmentHistory: vi.fn().mockResolvedValue({ reports: [] }),
    listIncidentEsfAssessments: vi.fn().mockResolvedValue({ states: [] }),
    listIncidentParticipants: vi.fn().mockResolvedValue([]),
    listPositions: vi.fn().mockResolvedValue([]),
    listResourceRequests: vi.fn().mockResolvedValue([]),
  } as unknown as ApiClient;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Community Lifelines overview", () => {
  it("renders eight distinct cards and keeps stale Stable separate from current green", async () => {
    const onOpen = vi.fn();
    const { container, rerender } = render(
      <LifelinesSurface
        client={client()}
        incidentId={area.incidentId}
        selectedLifeline={null}
        onOpen={onOpen}
        onClose={() => undefined}
      />,
    );
    await screen.findByRole("navigation", { name: "ESFs and Lifelines views" });
    const cards = [...container.querySelectorAll<HTMLElement>(".eoc-lifeline-card")];
    expect(cards).toHaveLength(8);
    expect(new Set(cards.map((card) => card.dataset.lifeline))).toEqual(new Set(LIFELINE_KEYS));
    expect(new Set(cards.map((card) => card.querySelector("svg")?.getAttribute("data-icon"))).size).toBe(8);

    const energy = container.querySelector<HTMLElement>('[data-lifeline="energy"]')!;
    expect(energy.dataset.condition).toBe("stable");
    expect(energy.dataset.freshness).toBe("stale");
    expect(within(energy).getByText("Stable")).toBeTruthy();
    expect(within(energy).getByText("Outside OP 3")).toBeTruthy();

    const unknown = container.querySelector<HTMLElement>('[data-lifeline="hazardous_materials"]')!;
    expect(unknown.dataset.condition).toBe("unknown");
    expect(unknown.querySelector(".eoc-lw-card-impact")?.textContent).toBe("No current assessment");

    fireEvent.click(within(energy).getByRole("button", { name: "Open Energy details" }));
    expect(onOpen).toHaveBeenCalledWith("energy");
    rerender(
      <LifelinesSurface
        client={client()}
        incidentId={area.incidentId}
        selectedLifeline="energy"
        onOpen={onOpen}
        onClose={() => undefined}
      />,
    );
    const drawer = await screen.findByRole("complementary", { name: "Energy" });
    expect(within(drawer).getByText("North district")).toBeTruthy();
    expect(within(drawer).getByText("Confirmed · 1 evidence item")).toBeTruthy();
    expect(within(drawer).getByRole("heading", { name: "Linked actions (1)" })).toBeTruthy();

    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("does not promote an unresolved conflict or missing period to a current condition", () => {
    const conflicting = state("energy", null, [
      report("energy", "stable", "2026-09-21T16:35:00.000Z"),
      report("energy", "unstable", "2026-09-21T16:36:00.000Z"),
    ], true);
    const view = projectLifeline(conflicting, "energy", PERIOD, new Date("2026-09-21T17:00:00.000Z"));
    expect(view).toMatchObject({
      condition: "unknown",
      freshness: "unknown",
      impact: "Conflicting assessments require a decision",
      report: null,
    });
    const noPeriod = projectLifeline(states[0], "safety_security", null);
    expect(noPeriod.freshnessLabel).toBe("No current operational period");
    expect(noPeriod.freshness).toBe("unknown");
  });

  it("filters, switches period, compares, and shows the objective, next update and linked actions", async () => {
    const earlier = { revision: 2, label: "OP 2", startsAt: "2026-09-20T18:00:00-07:00", endsAt: "2026-09-21T06:00:00-07:00" };
    const current = { revision: 3, ...PERIOD };
    const energyNow = {
      ...report("energy", "unstable", "2026-09-21T16:35:00.000Z", {
        components: [{ key: "electricity", label: "Electricity", condition: "unstable", affectedGeography: "Arcata", dependencies: ["Substation crews"] }],
        actions: [
          { key: "generator", title: "Generator request", status: "in_progress", linkedResourceRequestId: "11111111-1111-4111-8111-111111111111" },
          { key: "inspect", title: "Inspect substation", status: "planned", assignment: { kind: "position", positionTitle: "Utility liaison" } },
        ],
      }),
      stabilizationObjective: "Restore power to critical facilities.",
      nextUpdateAt: "2026-09-21T17:30:00.000Z",
    };
    const energyEarlier = { ...report("energy", "stabilizing", "2026-09-21T06:00:00.000Z", { operationalPeriod: "OP 2" }), id: "00000000-0000-4000-8000-00000000e002" };
    const overviewNow: LifelineAssessmentOverviewResponse = {
      ...overview,
      states: states.map((item) => item.lifeline === "energy" ? state("energy", "unstable", [energyNow]) : item),
    };
    const api = {
      ...client(),
      listIncidentLifelineAssessments: vi.fn().mockResolvedValue(overviewNow),
      lifelineAssessmentHistory: vi.fn((_incident: string, key: string) =>
        Promise.resolve({ reports: key === "energy" ? [energyNow, energyEarlier] : [] })),
    } as unknown as ApiClient;
    const onSelectPeriod = vi.fn();
    const onOpenResourceRequest = vi.fn();
    const onView = vi.fn();
    const actions = document.body.appendChild(document.createElement("div"));
    const surface = (props: Partial<Parameters<typeof LifelinesSurface>[0]>) => (
      <PageChromeContext.Provider value={{ actions, subtitle: null }}>
        <LifelinesSurface client={api} incidentId={area.incidentId} selectedLifeline={null} periods={[earlier, current]}
          selectedPeriodRevision={3} onSelectPeriod={onSelectPeriod} onOpen={() => undefined} onClose={() => undefined}
          onView={onView} onOpenResourceRequest={onOpenResourceRequest} {...props} />
      </PageChromeContext.Provider>
    );
    const { container, rerender } = render(surface({}));
    await waitFor(() => expect(container.querySelectorAll(".eoc-lifeline-card")).toHaveLength(8));

    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "unstable" } });
    expect([...container.querySelectorAll<HTMLElement>(".eoc-lifeline-card")].map((card) => card.dataset.lifeline))
      .toEqual(["energy", "transportation"]);
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Incident area"), { target: { value: "Arcata" } });
    expect(container.querySelectorAll(".eoc-lifeline-card")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Incident area"), { target: { value: "" } });

    fireEvent.change(screen.getByLabelText("Current period"), { target: { value: "2" } });
    expect(onSelectPeriod).toHaveBeenCalledWith(2);
    await waitFor(() => expect(api.lifelineAssessmentHistory).toHaveBeenCalledTimes(8));
    fireEvent.click(screen.getByRole("button", { name: "Compare periods" }));
    const energyCard = container.querySelector<HTMLElement>('[data-lifeline="energy"]')!;
    await waitFor(() => expect(energyCard.querySelector(".eoc-lw-card-compare")?.textContent).toBe("OP 2: Stabilizing · worsened"));

    rerender(surface({ selectedPeriodRevision: 2 }));
    await waitFor(() => expect(container.querySelector<HTMLElement>('[data-lifeline="energy"]')!.dataset.condition).toBe("stabilizing"));
    expect(container.querySelector<HTMLElement>('[data-lifeline="safety_security"]')!.dataset.condition).toBe("unknown");

    rerender(surface({ selectedPeriodRevision: 3, selectedLifeline: "energy" }));
    const drawer = await screen.findByRole("complementary", { name: "Energy" });
    expect(within(drawer).getByText("Restore power to critical facilities.")).toBeTruthy();
    expect(drawer.querySelector(".eoc-lw-drawer-assessed")?.textContent).toContain("Utility Liaison");
    expect(within(drawer).getByText("Assigned")).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: /Generator request/ }));
    expect(onOpenResourceRequest).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(within(drawer).queryByRole("button", { name: /Inspect substation/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dependencies" }));
    expect(onView).toHaveBeenCalledWith("dependencies");
    rerender(surface({ view: "dependencies" }));
    expect(await screen.findByText("Substation crews")).toBeTruthy();
    rerender(surface({ view: "history" }));
    const history = await screen.findByRole("table");
    expect(within(history).getAllByRole("row")).toHaveLength(3);
    expect(within(history).getByText("Superseded")).toBeTruthy();

    rerender(surface({}));
    fireEvent.click(screen.getByRole("button", { name: "New assessment" }));
    const created = await screen.findByRole("complementary", { name: "New assessment" });
    fireEvent.change(within(created).getByLabelText("Lifeline"), { target: { value: "water_systems" } });
    expect(within(created).getByLabelText("Next update")).toBeTruthy();
    expect(within(created).getByLabelText("Stabilization objective")).toBeTruthy();
  });

  it("clears the prior incident cards while a changed incident is loading", async () => {
    const first = client();
    const never = new Promise<LifelineAssessmentOverviewResponse>(() => undefined);
    const second = {
      listIncidentLifelineAssessments: vi.fn(() => never),
      getIncidentArea: vi.fn(() => new Promise<IncidentAreaRevision>(() => undefined)),
    } as unknown as ApiClient;
    const { container, rerender } = render(
      <LifelinesSurface client={first} incidentId="incident-a" selectedLifeline={null} onOpen={() => undefined} onClose={() => undefined} />,
    );
    await waitFor(() => expect(container.querySelectorAll(".eoc-lifeline-card")).toHaveLength(8));
    rerender(
      <LifelinesSurface client={second} incidentId="incident-b" selectedLifeline={null} onOpen={() => undefined} onClose={() => undefined} />,
    );
    expect(container.querySelectorAll(".eoc-lifeline-card")).toHaveLength(0);
    expect(screen.getByText("Loading Community Lifelines")).toBeTruthy();
  });
});

