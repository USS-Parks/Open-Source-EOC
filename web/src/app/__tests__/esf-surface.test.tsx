// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALIFORNIA_ESFS,
  EMERGENCY_SUPPORT_FUNCTIONS,
  ESF_CROSSWALK_V1,
  ESF_DEFINITIONS,
  ESF_DOCTRINE_GAPS,
  type CreateEsfAssessment,
  type EsfAssessmentReport,
  type EsfCurrentState,
} from "@openeoc/shared";
import type { ApiClient, EsfAssessmentOverviewResponse } from "../api/client.js";
import { EsfAssessmentForm } from "../surfaces/EsfAssessmentForm.js";
import { EsfSurface } from "../surfaces/EsfSurface.js";

const INCIDENT_ID = "00000000-0000-4000-8000-000000000020";
const HOME_ORG = "00000000-0000-4000-8000-000000000030";
const PARTNER_ORG = "00000000-0000-4000-8000-000000000031";
const RESOURCE_ID = "00000000-0000-4000-8000-000000000040";

const attribution = {
  personId: "00000000-0000-4000-8000-000000000010",
  personName: "Jordan Diaz",
  positionId: null,
  positionTitle: "ESF Coordinator",
  participationId: null,
  homeOrganizationId: HOME_ORG,
  homeOrganizationName: "North Coast EOC",
  recordedAt: "2026-09-21T16:35:00.000Z",
};

function report(
  framework: "california" | "federal",
  esf: string,
  id = "00000000-0000-4000-8000-000000000050",
): EsfAssessmentReport {
  return {
    id,
    incidentId: INCIDENT_ID,
    framework,
    esf,
    definitionVersion: 1,
    activation: "activated",
    capacity: "constrained",
    legacyStatus: null,
    assessedAt: "2026-09-21T16:30:00.000Z",
    sourceKind: "native",
    payload: {
      confidence: "confirmed",
      situation: "Mutual aid staffing is operating below the requested level.",
      operationalPeriod: "OP 3",
      coordinatorOrganizationId: HOME_ORG,
      supportingOrganizationIds: [PARTNER_ORG],
      missions: ["Coordinate route clearance"],
      priorities: ["Confirm night staffing"],
      evidence: [{ kind: "reported", description: "Coordinator briefing", sourceReference: "SITREP 3" }],
      relatedLifelines: ["transportation"],
      actions: [{
        key: "stage_crew",
        title: "Stage mutual aid crew",
        status: "in_progress",
        responsibleOrganizationId: PARTNER_ORG,
        linkedResourceRequestId: RESOURCE_ID,
      }],
    },
    supersedesAssessmentId: null,
    legacyBoardId: null,
    legacyRecordId: null,
    attribution,
  };
}

const activeReport = report("california", "ca_esf_1");
const states: readonly EsfCurrentState[] = [{
  framework: "california",
  esf: "ca_esf_1",
  activation: "activated",
  capacity: "constrained",
  conflict: false,
  reports: [activeReport],
  decision: null,
}];

const overview: EsfAssessmentOverviewResponse = {
  definitions: ESF_DEFINITIONS,
  crosswalk: ESF_CROSSWALK_V1,
  doctrineGaps: ESF_DOCTRINE_GAPS,
  states,
};

function client(): ApiClient {
  return {
    listIncidentEsfAssessments: vi.fn().mockResolvedValue(overview),
    listEsfAssessmentHistory: vi.fn().mockResolvedValue([activeReport]),
    createEsfAssessment: vi.fn().mockResolvedValue(activeReport),
    decideEsfAssessment: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000060" }),
    listIncidentParticipants: vi.fn().mockResolvedValue([{
      id: "00000000-0000-4000-8000-000000000070",
      incidentId: INCIDENT_ID,
      organizationId: PARTNER_ORG,
      organizationSlug: "partner",
      organizationName: "Mutual Aid Partner",
      personId: "00000000-0000-4000-8000-000000000071",
      personEmail: "partner@example.org",
      personName: "Pat Lee",
      incidentPositionTitle: "Agency Representative",
      role: "coordinator",
      expiresAt: "2099-09-21T16:35:00.000Z",
      revokedAt: null,
      createdAt: "2026-09-21T16:35:00.000Z",
    }]),
  } as unknown as ApiClient;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ESF workspace", () => {
  it("keeps all California and federal functions visible, distinct, and separate from Lifelines", async () => {
    const api = client();
    const open = vi.fn();
    const openLifelines = vi.fn();
    const { container } = render(
      <EsfSurface client={api} incidentId={INCIDENT_ID} incidentJurisdictionId={HOME_ORG}
        selectedEsf={null} operationalPeriod="OP 3" onOpen={open} onOpenLifelines={openLifelines}
        onClose={() => undefined} />,
    );

    await screen.findByRole("heading", { name: "Emergency Support Functions" });
    let cards = [...container.querySelectorAll<HTMLElement>(".eoc-esf-card")];
    expect(cards).toHaveLength(CALIFORNIA_ESFS.values.length);
    expect(new Set(cards.map((card) => card.dataset.esf))).toEqual(new Set(CALIFORNIA_ESFS.values));
    expect(new Set(cards.map((card) => card.querySelector("svg")?.getAttribute("data-icon"))).size).toBe(18);
    expect(within(container.querySelector('[data-esf="ca_esf_2"]')!).getByText("Not assessed")).toBeTruthy();
    expect(screen.getByText("Geography and Lifeline conditions do not activate a function.", { exact: false })).toBeTruthy();

    expect(within(container.querySelector('[data-esf="ca_esf_9"]')!).getByText("Merged into California ESF 4 and California ESF 13")).toBeTruthy();
    expect(within(container.querySelector('[data-esf="ca_esf_16"]')!).getByText("Merged into California ESF 13")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open California ESF 1: Transportation workspace" }));
    expect(open).toHaveBeenCalledWith("ca_esf_1");
    fireEvent.click(screen.getByRole("button", { name: "Community Lifelines" }));
    expect(openLifelines).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("tab", { name: "Federal (15)" }));
    cards = [...container.querySelectorAll<HTMLElement>(".eoc-esf-card")];
    expect(cards).toHaveLength(EMERGENCY_SUPPORT_FUNCTIONS.values.length);
    expect(cards[0]?.textContent).toContain("Federal ESF 1: Transportation");

    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("presents activation, capacity, organizations, workload, links, and attributed handoff history", async () => {
    const { container } = render(
      <EsfSurface client={client()} incidentId={INCIDENT_ID} incidentJurisdictionId={HOME_ORG}
        selectedEsf="ca_esf_1" operationalPeriod="OP 3" onOpen={() => undefined}
        onOpenLifelines={() => undefined} onClose={() => undefined} />,
    );
    const detail = await screen.findByRole("complementary", { name: "California ESF 1: Transportation" });
    const currentBadges = detail.querySelector<HTMLElement>(".eoc-esf-detail-badges")!;
    const coordination = within(detail).getByRole("heading", { name: "Coordination" }).closest("section")!;
    const actions = within(detail).getByRole("heading", { name: "Actions and resource requests" }).closest("section")!;
    expect(within(currentBadges).getByText("Activated", { exact: true })).toBeTruthy();
    expect(within(currentBadges).getByText("Capacity: Constrained")).toBeTruthy();
    expect(within(coordination).getByText("North Coast EOC", { exact: true })).toBeTruthy();
    expect(within(coordination).getByText("Mutual Aid Partner", { exact: true })).toBeTruthy();
    expect(within(detail).getByText("Coordinate route clearance")).toBeTruthy();
    expect(within(detail).getByText("Confirm night staffing")).toBeTruthy();
    expect(within(actions).getByText(`Request ${RESOURCE_ID}`)).toBeTruthy();
    expect(within(detail).getByText(/Jordan Diaz, ESF Coordinator/)).toBeTruthy();
    expect(within(detail).getByText("OP 3", { exact: true })).toBeTruthy();
    expect(container.querySelector('[data-esf="ca_esf_1"]')?.getAttribute("data-activation")).toBe("activated");
  });

  it("freezes the editing baseline across a newer poll and preserves its immutable links", async () => {
    const submit = vi.fn<(input: CreateEsfAssessment) => void>();
    const common = {
      framework: "california" as const,
      esf: "ca_esf_1",
      operationalPeriod: "OP 3",
      organizations: [{ id: HOME_ORG, label: "North Coast EOC" }],
      saving: false,
      error: null,
      onSubmit: submit,
      onCancel: () => undefined,
    };
    const { rerender } = render(<EsfAssessmentForm {...common} baseline={activeReport} />);
    const situation = screen.getByLabelText("Staffing, capacity, and coordination situation");
    fireEvent.change(situation, { target: { value: "Draft coordination update retained during polling" } });
    rerender(<EsfAssessmentForm {...common} baseline={{
      ...activeReport,
      id: "00000000-0000-4000-8000-000000000051",
      payload: { ...activeReport.payload, situation: "Newer server assessment" },
    }} />);
    expect((screen.getByLabelText("Staffing, capacity, and coordination situation") as HTMLTextAreaElement).value)
      .toBe("Draft coordination update retained during polling");
    expect(screen.getByText("1 prior evidence item will be preserved.")).toBeTruthy();
    expect(screen.getByText(/1 prior action; validated assignments and links remain attached/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Status for Stage mutual aid crew"), { target: { value: "complete" } });

    fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const saved = submit.mock.calls[0]![0];
    expect(saved.situation).toBe("Draft coordination update retained during polling");
    expect(saved.evidence).toEqual(activeReport.payload.evidence);
    expect(saved.actions[0]).toMatchObject({
      linkedResourceRequestId: RESOURCE_ID,
      responsibleOrganizationId: PARTNER_ORG,
      status: "complete",
    });
    expect(saved.supersedesAssessmentId).toBe(activeReport.id);
  });
});
