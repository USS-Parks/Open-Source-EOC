// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LifelineAssessmentReport, LifelineCurrentState } from "@openeoc/shared";
import type { ApiClient } from "../api/client.js";
import { LifelineAssessmentForm } from "../surfaces/LifelineAssessmentForm.js";
import { LifelineAssessmentHistory } from "../surfaces/LifelineAssessmentHistory.js";

const INCIDENT_ID = "00000000-0000-4000-8000-000000000101";
const JURISDICTION_ID = "00000000-0000-4000-8000-000000000102";

vi.mock("../incident/context.js", () => ({
  useIncident: () => ({
    selectedIncident: {
      id: "00000000-0000-4000-8000-000000000101",
      jurisdictionId: "00000000-0000-4000-8000-000000000102",
      name: "Harbor Storm",
    },
  }),
}));

const attribution = {
  personId: "00000000-0000-4000-8000-000000000103",
  personName: "Jordan Diaz",
  positionId: "00000000-0000-4000-8000-000000000104",
  positionTitle: "Utility Liaison",
  participationId: null,
  homeOrganizationId: JURISDICTION_ID,
  homeOrganizationName: "North Coast EOC",
  recordedAt: "2026-09-21T17:05:00.000Z",
};

function report(id: string, condition = "stabilizing"): LifelineAssessmentReport {
  return {
    id,
    incidentId: INCIDENT_ID,
    lifeline: "energy",
    definitionVersion: 1,
    condition,
    assessedAt: "2026-09-21T17:00:00.000Z",
    sourceKind: "native",
    legacyStatus: null,
    payload: {
      confidence: "confirmed",
      impactStatement: "Substation access remains limited",
      stabilizationOutlook: "Crews expect staged restoration",
      operationalPeriod: "OP 3",
      components: [{ key: "electricity", label: "Electricity", condition, affectedGeography: "North district" }],
      evidence: [{ kind: "reported", description: "Utility field report", sourceReference: "EOC-17" }],
      actions: [{ key: "inspect", title: "Inspect feeder", status: "in_progress", dueAt: "2026-09-21T21:00:00.000Z" }],
    },
    supersedesAssessmentId: null,
    legacyBoardId: null,
    legacyRecordId: null,
    attribution,
  };
}

function formClient(create: ReturnType<typeof vi.fn>): ApiClient {
  return {
    createLifelineAssessment: create,
    listPositions: vi.fn().mockResolvedValue([{ id: attribution.positionId, key: "utility_liaison", title: "Utility Liaison" }]),
    listIncidentParticipants: vi.fn().mockResolvedValue([]),
    listResourceRequests: vi.fn().mockResolvedValue([{ id: "00000000-0000-4000-8000-000000000105", item: "Generator", quantity: 1, priority: "high", state: "approved" }]),
  } as unknown as ApiClient;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Community Lifeline assessment workflow", () => {
  it("retains a rejected draft and submits component, evidence, estimate, owner, and resource details", async () => {
    const created = report("00000000-0000-4000-8000-000000000106");
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("not authorized"))
      .mockResolvedValueOnce(created);
    const onSaved = vi.fn();
    render(
      <LifelineAssessmentForm
        client={formClient(create)}
        incidentId={INCIDENT_ID}
        lifeline="energy"
        period={{ label: "OP 3", startsAt: "2026-09-21T13:00:00.000Z", endsAt: "2026-09-22T01:00:00.000Z" }}
        currentReport={null}
        onSaved={onSaved}
        onCancel={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Impact explanation"), { target: { value: "Feeder damage limits service" } });
    fireEvent.change(screen.getByLabelText("Stabilization outlook"), { target: { value: "Estimated restoration by 21:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Add component" }));
    fireEvent.change(screen.getByLabelText("Component name"), { target: { value: "Electricity" } });
    fireEvent.change(screen.getByLabelText("Affected geography"), { target: { value: "North district" } });
    fireEvent.click(screen.getByRole("button", { name: "Add evidence" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Utility field report" } });
    fireEvent.change(screen.getByLabelText("Source reference"), { target: { value: "EOC-17" } });
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    fireEvent.change(screen.getByLabelText("Action title"), { target: { value: "Inspect feeder" } });
    fireEvent.change(screen.getByLabelText("Responsible organization"), { target: { value: JURISDICTION_ID } });
    await waitFor(() => expect(screen.getByLabelText("Assigned owner").querySelectorAll("option").length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText("Assigned owner"), { target: { value: `position:${attribution.positionId}` } });
    fireEvent.change(screen.getByLabelText("Linked resource request"), { target: { value: "00000000-0000-4000-8000-000000000105" } });
    fireEvent.change(screen.getByLabelText("Estimated completion"), { target: { value: "2026-09-21T21:00" } });

    fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Draft values are retained");
    expect((screen.getByLabelText("Impact explanation") as HTMLTextAreaElement).value).toBe("Feeder damage limits service");

    fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    const input = create.mock.calls[1]![1];
    expect(input).toMatchObject({
      lifeline: "energy",
      impactStatement: "Feeder damage limits service",
      operationalPeriod: "OP 3",
      components: [{ label: "Electricity", affectedGeography: "North district" }],
      evidence: [{ kind: "reported", description: "Utility field report", sourceReference: "EOC-17" }],
      actions: [{
        title: "Inspect feeder",
        responsibleOrganizationId: JURISDICTION_ID,
        assignment: { kind: "position", positionId: attribution.positionId },
        linkedResourceRequestId: "00000000-0000-4000-8000-000000000105",
      }],
    });
  });

  it("shows attributed history and retains a rejected conflict decision", async () => {
    const stable = report("00000000-0000-4000-8000-000000000107", "stable");
    const unstable = report("00000000-0000-4000-8000-000000000108", "unstable");
    const currentState: LifelineCurrentState = {
      lifeline: "energy",
      condition: null,
      conflict: true,
      reports: [stable, unstable],
      decision: null,
    };
    const decide = vi.fn().mockRejectedValue(new Error("admin approval required"));
    const client = {
      lifelineAssessmentHistory: vi.fn().mockResolvedValue({ reports: [unstable, stable] }),
      decideLifelineAssessment: decide,
    } as unknown as ApiClient;
    render(
      <LifelineAssessmentHistory
        client={client}
        incidentId={INCIDENT_ID}
        lifeline="energy"
        currentState={currentState}
        refreshToken={0}
        onDecision={() => undefined}
      />,
    );

    const decision = screen.getByRole("form", { name: "Resolve current conflict" });
    fireEvent.change(within(decision).getByLabelText("Decision rationale"), { target: { value: "Utility telemetry is the controlling source" } });
    fireEvent.click(within(decision).getByRole("button", { name: "Record assessment decision" }));
    expect((await within(decision).findByRole("alert")).textContent).toContain("retained");
    expect((within(decision).getByLabelText("Decision rationale") as HTMLTextAreaElement).value).toBe("Utility telemetry is the controlling source");
    expect(await screen.findAllByText(/Jordan Diaz/)).toHaveLength(2);
    expect(screen.getAllByText(/North Coast EOC/).length).toBeGreaterThanOrEqual(2);
  });
});
