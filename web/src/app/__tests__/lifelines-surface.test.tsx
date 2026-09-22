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
import { LIFELINE_KEYS, projectLifeline } from "../surfaces/lifeline-view.js";

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
    supersedesAssessmentId: null,
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
    await screen.findByRole("heading", { name: "Community Lifelines" });
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
    expect(unknown.querySelector(".eoc-lifeline-impact")?.textContent).toBe("No current assessment");

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
    expect(within(drawer).getByText("1 open action")).toBeTruthy();

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

