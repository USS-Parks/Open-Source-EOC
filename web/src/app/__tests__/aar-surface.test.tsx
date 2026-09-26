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
const PLAN_ID = "00000000-0000-4000-8000-000000000070";

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
    listPlans: vi.fn().mockResolvedValue([{ id: PLAN_ID, title: "Severe Storm Plan" }]),
    getPlan: vi.fn().mockResolvedValue({
      id: PLAN_ID, title: "Severe Storm Plan",
      definition: { sections: [{ title: "Concept of operations" }, { title: "Warning" }] },
    }),
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
    fireEvent.change(await within(actionForm).findByLabelText("Plan to update"), { target: { value: PLAN_ID } });
    await within(actionForm).findByRole("option", { name: "Warning" });
    fireEvent.change(within(actionForm).getByLabelText("Plan section"), { target: { value: "Warning" } });
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
      plan: { id: PLAN_ID, section: "Warning" },
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

  it("links an action to the plan it changes, and shows the link", async () => {
    const api = client();
    const linked = { ...actions[0]!, plan: { id: PLAN_ID, title: "Severe Storm Plan", section: "Concept of operations" } };
    vi.mocked(api.getAarAnalytics).mockResolvedValue({
      observations, correctiveActions: [linked, actions[1]!], analytics: summarizeAar(observations, actions),
    });
    const { container } = render(<AarSurface client={api} jurisdictionId={JURISDICTION_ID} incidentId={INCIDENT_ID} />);
    await screen.findByRole("heading", { name: "After-action review" });
    const action = container.querySelector<HTMLElement>(`[data-record-id="${ACTION_PLANNING}"]`)!;
    expect(within(action).getByText("Severe Storm Plan, section Concept of operations")).toBeTruthy();
    await within(action).findByRole("option", { name: "Warning" });
    fireEvent.change(within(action).getByLabelText("Plan section"), { target: { value: "" } });
    fireEvent.click(within(action).getByRole("button", { name: "Save progress" }));
    await waitFor(() => expect(api.updateCorrectiveAction).toHaveBeenCalledWith(ACTION_PLANNING,
      expect.objectContaining({ plan: { id: PLAN_ID, section: null } })));
    const completed = container.querySelector<HTMLElement>(`[data-record-id="${ACTION_WARNING}"]`)!;
    expect(within(completed).getByText("No plan", { selector: "dd" })).toBeTruthy();
    expect((await axe.run(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
  });

  it("loads one action's latest revision from its detail route before saving over it", async () => {
    const api = client();
    const newer = { ...actions[0]!, revision: 5, status: "in_progress" as const, owner: "Operations Section Chief" };
    Object.assign(api, { getCorrectiveAction: vi.fn().mockResolvedValue(newer) });
    const { container } = render(<AarSurface client={api} jurisdictionId={JURISDICTION_ID} incidentId={INCIDENT_ID} />);
    await screen.findByRole("heading", { name: "After-action review" });
    const action = container.querySelector<HTMLElement>(`[data-record-id="${ACTION_PLANNING}"]`)!;
    fireEvent.click(within(action).getByRole("button", { name: "Load latest revision" }));
    await screen.findByText("Corrective action revision 5 loaded.");
    expect(api.getCorrectiveAction).toHaveBeenCalledWith(ACTION_PLANNING);
    const refreshed = container.querySelector<HTMLElement>(`[data-record-id="${ACTION_PLANNING}"]`)!;
    expect(within(refreshed).getByText("Revision 5")).toBeTruthy();
    expect(within(refreshed).getByText("Operations Section Chief")).toBeTruthy();
    await waitFor(() => expect((within(refreshed).getByLabelText("Status") as HTMLSelectElement).value).toBe("in_progress"));
    fireEvent.click(within(refreshed).getByRole("button", { name: "Save progress" }));
    await waitFor(() => expect(api.updateCorrectiveAction).toHaveBeenCalledWith(ACTION_PLANNING,
      expect.objectContaining({ expectedRevision: 5, status: "in_progress" })));
  });

  it("renders an explicit loading state instead of a false zero", () => {
    const api = client();
    vi.mocked(api.getAarAnalytics).mockReturnValue(new Promise(() => undefined));
    render(<AarSurface client={api} jurisdictionId={JURISDICTION_ID} incidentId={INCIDENT_ID} />);
    expect(screen.getByText("Loading after-action records")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });
});
