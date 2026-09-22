// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeAar, type AarObservation } from "@openeoc/shared";
import type { ApiClient, CorrectiveAction } from "../api/client.js";
import { AarSurface } from "../surfaces/AarSurface.js";

const INCIDENT_ID = "00000000-0000-4000-8000-000000000020";
const JURISDICTION_ID = "00000000-0000-4000-8000-000000000030";
const POSITION_ID = "00000000-0000-4000-8000-000000000040";
const OBSERVATION_PLANNING = "00000000-0000-4000-8000-000000000050";
const OBSERVATION_WARNING = "00000000-0000-4000-8000-000000000051";
const ACTION_PLANNING = "00000000-0000-4000-8000-000000000060";
const ACTION_WARNING = "00000000-0000-4000-8000-000000000061";

const observations: readonly AarObservation[] = [
  {
    id: OBSERVATION_PLANNING,
    capability: "planning",
    capabilityElement: "training",
    kind: "improvement",
    observation: "The handoff checklist was not available at shift change.",
    recommendation: "Publish the handoff checklist.",
    operationalPeriodRevision: 1,
    createdAt: "2026-09-21T16:00:00.000Z",
  },
  {
    id: OBSERVATION_WARNING,
    capability: "public_information_and_warning",
    capabilityElement: "none",
    kind: "strength",
    observation: "The briefing reached all partner agencies on schedule.",
    recommendation: null,
    operationalPeriodRevision: 1,
    createdAt: "2026-09-21T16:15:00.000Z",
  },
];

const actions: readonly CorrectiveAction[] = [
  {
    id: ACTION_PLANNING,
    incidentId: INCIDENT_ID,
    capability: "planning",
    capabilityElement: "training",
    recommendation: "Publish the handoff checklist.",
    priority: "high",
    owner: "Planning Section Chief",
    assignment: {
      kind: "position",
      organizationId: JURISDICTION_ID,
      label: "Planning Section Chief",
      positionId: POSITION_ID,
    },
    dueDate: "2026-10-01",
    status: "open",
    revision: 2,
    operationalPeriodRevision: 1,
    completedAt: null,
    completedBy: null,
    createdAt: "2026-09-21T16:30:00.000Z",
  },
  {
    id: ACTION_WARNING,
    incidentId: INCIDENT_ID,
    capability: "public_information_and_warning",
    capabilityElement: "none",
    recommendation: "Retain the briefing distribution list.",
    priority: "low",
    owner: null,
    assignment: null,
    dueDate: null,
    status: "complete",
    revision: 1,
    operationalPeriodRevision: 1,
    completedAt: "2026-09-21T17:00:00.000Z",
    completedBy: "Jordan Diaz",
    createdAt: "2026-09-21T16:45:00.000Z",
  },
];

function client(): ApiClient {
  return {
    getAarAnalytics: vi.fn().mockResolvedValue({
      observations,
      correctiveActions: actions,
      analytics: summarizeAar(observations, actions),
    }),
    incidentAreaHistory: vi.fn().mockResolvedValue([{
      incidentId: INCIDENT_ID,
      revision: 1,
      geometry: null,
      operationalPeriod: {
        label: "Operational Period 1",
        startsAt: "2026-09-21T08:00:00.000Z",
        endsAt: "2026-09-21T20:00:00.000Z",
      },
      reason: "Initial period",
      createdAt: "2026-09-21T07:45:00.000Z",
      createdBy: null,
      positionId: null,
      createdByName: null,
      positionTitle: null,
    }]),
    listPositions: vi.fn().mockResolvedValue([{ id: POSITION_ID, key: "planning", title: "Planning Section Chief" }]),
    listIncidentParticipants: vi.fn().mockResolvedValue([]),
    recordAarObservation: vi.fn().mockResolvedValue({ id: "new-observation" }),
    createCorrectiveAction: vi.fn().mockResolvedValue({ id: "new-action" }),
    updateCorrectiveAction: vi.fn().mockResolvedValue(actions[0]),
    composeAar: vi.fn().mockResolvedValue({ id: "aar-snapshot", content: {} }),
    downloadAarPdf: vi.fn().mockResolvedValue(new Blob(["%PDF-1.4"])),
  } as unknown as ApiClient;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("after-action workspace", () => {
  it("uses server totals and drills each aggregate to its exact records", async () => {
    const api = client();
    const { container } = render(<AarSurface client={api} jurisdictionId={JURISDICTION_ID} incidentId={INCIDENT_ID} />);

    await screen.findByRole("heading", { name: "After-action review" });
    expect(screen.getByText("4")).toBeTruthy();
    expect(container.querySelectorAll("[data-record-id]")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: /2 Planning Drill into records/ }));
    expect(screen.getByRole("heading", { name: "Capability: Planning" })).toBeTruthy();
    const ids = [...container.querySelectorAll<HTMLElement>("[data-record-id]")].map((element) => element.dataset.recordId);
    expect(ids).toEqual([OBSERVATION_PLANNING, ACTION_PLANNING]);

    fireEvent.click(screen.getByRole("button", { name: /1 High Drill into records/ }));
    expect(container.querySelectorAll("[data-record-id]")).toHaveLength(1);
    expect(container.querySelector(`[data-record-id="${ACTION_PLANNING}"]`)).toBeTruthy();

    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("keeps failed observation drafts and uses structured assignment inputs", async () => {
    const api = client();
    vi.mocked(api.recordAarObservation).mockRejectedValueOnce(new Error("network unavailable"));
    render(<AarSurface client={api} jurisdictionId={JURISDICTION_ID} incidentId={INCIDENT_ID} />);
    await screen.findByRole("heading", { name: "After-action review" });

    const observationForm = screen.getByRole("form", { name: "Record an observation" });
    const observation = within(observationForm).getByLabelText("Observation") as HTMLTextAreaElement;
    fireEvent.change(observation, { target: { value: "Draft evidence survives a failed request." } });
    fireEvent.change(within(observationForm).getByLabelText("Recommendation"), {
      target: { value: "Retry when connectivity returns." },
    });
    fireEvent.click(within(observationForm).getByRole("button", { name: "Record observation" }));
    await screen.findByRole("alert");
    expect(observation.value).toBe("Draft evidence survives a failed request.");

    fireEvent.click(within(observationForm).getByRole("button", { name: "Record observation" }));
    await waitFor(() => expect(api.recordAarObservation).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(observation.value).toBe(""));

    fireEvent.click(screen.getByRole("button", { name: "Create action from this observation" }));
    const actionForm = screen.getByRole("form", { name: "Create a corrective action" });
    expect(within(actionForm).getByText(`Observation ${OBSERVATION_PLANNING}`)).toBeTruthy();
    fireEvent.change(within(actionForm).getByLabelText("Priority"), { target: { value: "critical" } });
    fireEvent.change(within(actionForm).getByLabelText("Owner"), { target: { value: `position:${POSITION_ID}` } });
    fireEvent.change(within(actionForm).getByLabelText("Due date"), { target: { value: "2026-10-15" } });
    fireEvent.click(within(actionForm).getByRole("button", { name: "Create corrective action" }));

    await waitFor(() => expect(api.createCorrectiveAction).toHaveBeenCalledOnce());
    expect(vi.mocked(api.createCorrectiveAction).mock.calls[0]?.[1]).toMatchObject({
      incidentId: INCIDENT_ID,
      capability: "planning",
      capabilityElement: "training",
      recommendation: "Publish the handoff checklist.",
      priority: "critical",
      dueDate: "2026-10-15",
      assignment: { kind: "position", positionId: POSITION_ID },
    });
    expect(actionForm.querySelector("textarea")?.value).toBe("");
    expect(document.querySelector("[data-json-input]")).toBeNull();
  });

  it("updates action progress with compare-and-swap metadata and keeps first-completion evidence visible", async () => {
    const api = client();
    const { container } = render(<AarSurface client={api} jurisdictionId={JURISDICTION_ID} incidentId={INCIDENT_ID} />);
    await screen.findByRole("heading", { name: "After-action review" });
    const action = container.querySelector<HTMLElement>(`[data-record-id="${ACTION_PLANNING}"]`)!;

    fireEvent.change(within(action).getByLabelText("Status"), { target: { value: "in_progress" } });
    fireEvent.change(within(action).getByLabelText("Priority"), { target: { value: "critical" } });
    fireEvent.click(within(action).getByRole("button", { name: "Save progress" }));
    await waitFor(() => expect(api.updateCorrectiveAction).toHaveBeenCalledWith(ACTION_PLANNING, {
      expectedRevision: 2,
      status: "in_progress",
      priority: "critical",
      dueDate: "2026-10-01",
    }));

    const completed = container.querySelector<HTMLElement>(`[data-record-id="${ACTION_WARNING}"]`)!;
    expect(within(completed).getByText(/First completed .* by Jordan Diaz/)).toBeTruthy();
  });

  it("renders an explicit loading state instead of a false zero", () => {
    const api = client();
    vi.mocked(api.getAarAnalytics).mockReturnValue(new Promise(() => undefined));
    render(<AarSurface client={api} jurisdictionId={JURISDICTION_ID} incidentId={INCIDENT_ID} />);
    expect(screen.getByText("Loading after-action records")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });
});
