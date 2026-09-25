// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import axe from "axe-core";
import type {
  IncidentActivityEntry,
  IncidentOverviewSummary,
  IncidentTask,
  LifelineAssessmentReport,
  ResourceRequestSummary,
} from "@openeoc/shared";
import { Theme } from "../../design/components.js";
import type { ThemeName } from "../../design/tokens.js";
import type { ApiClient } from "../api/client.js";
import { PageChromeContext } from "../layout/page-chrome.js";
import { IncidentOverview, activityItem, dayLabel, priorityWork } from "../surfaces/IncidentOverview.js";

// The map has its own browser tests; here the card holds a stand-in.
vi.mock("../surfaces/IncidentCop.js", () => ({ IncidentCop: () => <div data-testid="cop" /> }));

afterEach(() => cleanup());

const INCIDENT = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-24T09:42:00-07:00");

const summary: IncidentOverviewSummary = {
  incidentId: INCIDENT,
  period: { revision: 3, label: "OP 03", startsAt: "2026-09-24T06:00:00-07:00", endsAt: "2026-09-24T18:00:00-07:00" },
  openRequests: 24, urgentRequests: 6, activeShelters: 8, shelterOccupants: 312,
  fieldReports: 46, unverifiedFieldReports: 9, tasksDue: 12, participatingOrganizations: 7,
};

function request(overrides: Partial<ResourceRequestSummary>): ResourceRequestSummary {
  return {
    id: "00000000-0000-4000-8000-00000000a001", number: 1027, incidentId: INCIDENT, item: "Clear debris", quantity: 1,
    priority: "routine", state: "submitted", receivingOrganization: { id: "o1", name: "Humboldt County OES" },
    supplyingOrganization: null, assignment: null, resourceKind: null, resourceType: null, costCents: 0,
    neededBy: "2026-09-24T12:00:00-07:00", notes: null, createdAt: "2026-09-24T07:00:00-07:00", updatedAt: "2026-09-24T07:00:00-07:00", requestedByName: null, acceptance: null, ...overrides,
  };
}

const task: IncidentTask = {
  id: "00000000-0000-4000-8000-00000000b001", number: 204, incidentId: INCIDENT, item: "Conduct damage assessment",
  category: "planning", status: "open", dueAt: "2026-09-25T12:00:00-07:00", revision: 1,
  assignment: { kind: "incident_participant", id: "p1", organizationId: "o2", organizationName: "Cal OES", title: "Law enforcement liaison", personId: "x", personName: "M. Alvarez" },
  dependencies: [], completedAt: null, completedBy: null,
};

const requests = [
  request({ id: "r1", number: 1031, item: "Increase shelter capacity", priority: "priority", state: "deployed", neededBy: "2026-09-24T18:00:00-07:00" }),
  request({ id: "r2", number: 1027, item: "Clear US-101 debris", priority: "immediate", state: "deployed", neededBy: "2026-09-24T12:00:00-07:00",
    assignment: { kind: "incident_participant", participantId: "p9", incidentId: INCIDENT, personId: "y", personName: "R. Martinez", incidentPositionTitle: "Caltrans liaison", participantRole: "contributor", organization: { id: "o3", name: "Caltrans District 1" } } }),
  request({ id: "r3", number: 1040, item: "Closed request", state: "closed" }),
];

const energy = {
  id: "e1", incidentId: INCIDENT, lifeline: "energy", definitionVersion: 1, condition: "unstable",
  assessedAt: "2026-09-24T09:35:00-07:00", sourceKind: "native", legacyStatus: null,
  payload: { impactStatement: "Two substations offline.", operationalPeriod: "OP 03" },
  stabilizationObjective: null, nextUpdateAt: null, supersedesAssessmentId: null, legacyBoardId: null, legacyRecordId: null,
  attribution: { personId: "a", personName: "A. Brooks", positionId: null, positionTitle: "Utility liaison", participationId: "g", homeOrganizationId: "o4", homeOrganizationName: "CA Energy Commission", recordedAt: "2026-09-24T09:35:00-07:00" },
} satisfies LifelineAssessmentReport;

const activity: IncidentActivityEntry[] = [
  { id: "a1", at: "2026-09-24T09:28:00-07:00", category: "board.record.updated", subjectTable: "board_records", subjectId: "s1",
    person: "L. Moreno", position: null, organization: "Humboldt County OES",
    payload: { board: "shelters", patch: { occupancy: 187 } }, record: { name: "Arcata Community Center", occupancy: 187, capacity: 240 }, message: null },
  { id: "a2", at: "2026-09-24T09:18:00-07:00", category: "board.record.created", subjectTable: "board_records", subjectId: "s2",
    person: "Taylor Kim", position: null, organization: "Humboldt County OES",
    payload: { board: "field_reports" }, record: { summary: "Flooding on 14th St near Eureka High School. Photos attached." }, message: null },
];

function client(overrides: Partial<ApiClient> = {}) {
  return {
    getIncidentSummary: vi.fn(async () => summary),
    listIncidentLifelineAssessments: vi.fn(async () => ({ states: [{ lifeline: "energy", condition: "unstable", conflict: false, reports: [energy], decision: null }] })),
    listResourceRequests: vi.fn(async () => requests),
    listIncidentTasks: vi.fn(async () => ({ tasks: [task], nextCursor: null })),
    listIncidentActivity: vi.fn(async () => activity),
    composeSitrep: vi.fn(async () => ({ id: "sitrep-1" })),
    ...overrides,
  } as unknown as ApiClient;
}

type Handler = Mock<(...args: unknown[]) => void>;

function Harness(props: { theme: ThemeName; api: ApiClient; handlers: Record<string, Handler>; briefing?: boolean; member?: boolean }) {
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [subtitle, setSubtitle] = useState<HTMLElement | null>(null);
  return (
    <Theme name={props.theme}>
      <header><p ref={setSubtitle} data-testid="subtitle" /><div ref={setActions} data-testid="actions" /></header>
      <PageChromeContext.Provider value={{ actions, subtitle }}>
        <IncidentOverview client={props.api} theme={props.theme} jurisdictionId="j1" incidentId={INCIDENT} incidentName="North Coast Storm"
          periodRevision={3} operationalPeriod="OP 03 · 0600–1800 PDT" collections={[]} member={props.member ?? true} briefing={props.briefing ?? false}
          onBriefing={props.handlers.briefing!} onExitBriefing={props.handlers.exit!} onOpenSitrep={props.handlers.sitrep!}
          onOpenRequests={props.handlers.requests!} onOpenShelters={props.handlers.shelters!} onOpenFieldReports={props.handlers.reports!}
          onOpenTasks={props.handlers.tasks!} onOpenLifeline={props.handlers.lifeline!} onOpenLifelines={props.handlers.lifelines!}
          onOpenChronology={props.handlers.chronology!} />
      </PageChromeContext.Provider>
    </Theme>
  );
}

function handlers(): Record<string, Handler> {
  return Object.fromEntries(["briefing", "exit", "sitrep", "requests", "shelters", "reports", "tasks", "lifeline", "lifelines", "chronology"]
    .map((key) => [key, vi.fn<(...args: unknown[]) => void>()]));
}

describe("incident overview", () => {
  it("orders priority work urgent first, then in progress, then by due time, leaving finished requests out", () => {
    const items = priorityWork(requests, [task], () => undefined, () => undefined);
    expect(items.map((item) => [item.number, item.status])).toEqual([
      ["REQ-1027", "urgent"], ["REQ-1031", "in_progress"], ["TASK-204", "not_started"],
    ]);
    expect(items[0]).toMatchObject({ owner: "Caltrans District 1", ownerPerson: "R. Martinez" });
    expect(items[2]).toMatchObject({ owner: "Cal OES", ownerPerson: "M. Alvarez" });
  });

  it("words activity the way operators say it", () => {
    expect(activityItem(activity[0]!)).toMatchObject({ title: "Shelter update", text: "Arcata Community Center now at 187 occupants (78% capacity)." });
    expect(activityItem(activity[1]!)).toMatchObject({ title: "Field report submitted", text: "Flooding on 14th St near Eureka High School. Photos attached." });
    expect(activityItem({ ...activity[1]!, category: "message.sent", subjectTable: "messages", record: null,
      message: { body: "Caltrans mobilizing additional crews to US-101. ETA 2 hours", thread: "Road status" } }))
      .toMatchObject({ title: "Message", text: "Caltrans mobilizing additional crews to US-101. ETA 2 hours." });
    expect(dayLabel(new Date("2026-09-25T12:00:00-07:00"), NOW)).toBe("Tomorrow");
    expect(dayLabel(new Date("2026-09-24T18:00:00-07:00"), NOW)).toBe("Today");
  });

  for (const theme of ["dark", "light"] as const) {
    it(`shows the counts, lifelines, work and activity in the ${theme} theme and opens each owner`, async () => {
      const api = client();
      const on = handlers();
      const view = render(<Harness theme={theme} api={api} handlers={on} />);
      const requestsCount = await screen.findByRole("button", { name: "Open requests: 24, 6 urgent" });
      expect(screen.getByRole("button", { name: "Active shelters: 8, 312 occupants" })).not.toBeNull();
      expect(screen.getByRole("button", { name: "Field reports: 46, 9 unverified" })).not.toBeNull();
      expect(screen.getByRole("button", { name: "Tasks due: 12, This operational period" })).not.toBeNull();
      fireEvent.click(requestsCount);
      expect(on.requests).toHaveBeenCalledWith();
      fireEvent.click(screen.getByRole("button", { name: "Energy: Disrupted. Open details" }));
      expect(on.lifeline).toHaveBeenCalledWith("energy");
      const work = screen.getByRole("region", { name: "Priority work" });
      await within(work).findByText(theme === "dark" ? "REQ-1027" : "Clear US-101 debris");
      const activityCard = screen.getByRole("region", { name: "Recent activity" });
      await within(activityCard).findByText("Shelter update");
      fireEvent.click(within(activityCard).getByRole("button", { name: "View all" }));
      expect(on.chronology).toHaveBeenCalled();
      expect(within(screen.getByTestId("subtitle")).getByText(/7 participating organizations · Updated/)).not.toBeNull();

      fireEvent.click(within(screen.getByTestId("actions")).getByRole("button", { name: "Create report" }));
      await waitFor(() => expect(on.sitrep).toHaveBeenCalledWith("sitrep-1"));
      expect(api.composeSitrep).toHaveBeenCalledWith("j1", { incidentId: INCIDENT, period: "OP 03" });
      fireEvent.click(within(screen.getByTestId("actions")).getByRole("button", { name: "Briefing view" }));
      expect(on.briefing).toHaveBeenCalled();

      const result = await axe.run(view.container, { rules: { "color-contrast": { enabled: false } } });
      expect(result.violations.map((violation) => violation.id)).toEqual([]);
    }, 30000);
  }

  it("presents the briefing full screen and leaves it on Escape", async () => {
    const on = handlers();
    render(<Harness theme="dark" api={client()} handlers={on} briefing />);
    const dialog = await screen.findByRole("dialog", { name: "North Coast Storm briefing" });
    await within(dialog).findByRole("button", { name: "Open requests: 24, 6 urgent" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(on.exit).toHaveBeenCalled();
  });

  it("tells a participating organization that the owner's record of events is not shared", async () => {
    const api = client();
    render(<Harness theme="light" api={api} handlers={handlers()} member={false} />);
    await screen.findByText(/not shared with participating organizations/);
    expect(api.listIncidentActivity).not.toHaveBeenCalled();
    expect(api.listResourceRequests).not.toHaveBeenCalled();
  });
});
