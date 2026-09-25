// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  IapDocument,
  IapWorkspaceItem,
  Ics204Assignment,
  IncidentAreaRevision,
  IncidentParticipantGrant,
} from "@openeoc/shared";
import type { ApiClient } from "../../app/api/client.js";
import { FormsSurface } from "../../app/surfaces/FormsSurface.js";
import { IapSurface } from "../../app/surfaces/IapSurface.js";
import { Ics204Editor } from "../Ics204Editor.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const INCIDENT_ID = "00000000-0000-4000-8000-000000000001";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000002";

const area: IncidentAreaRevision = {
  incidentId: INCIDENT_ID,
  revision: 4,
  geometry: null,
  operationalPeriod: {
    label: "Operational Period 4",
    startsAt: "2026-09-21T08:00:00.000-07:00",
    endsAt: "2026-09-21T20:00:00.000-07:00",
  },
  reason: "Night shift handoff",
  createdAt: "2026-09-21T07:30:00.000-07:00",
  createdBy: null,
  positionId: null,
  createdByName: null,
  positionTitle: null,
};

const document: IapDocument = {
  incidentName: "Redwood Fire",
  operationalPeriod: "Operational Period 4",
  preparedBy: "Planning Section",
  forms: [],
};

it("assembles from the selected authoritative period revision without inventing a label", async () => {
  const createIap = vi.fn().mockResolvedValue({ id: "iap-4", content: document });
  const onOpenIap = vi.fn();
  const client = {
    getIncidentArea: vi.fn().mockResolvedValue(area),
    incidentAreaHistory: vi.fn().mockResolvedValue([]),
    listIcsComponents: vi.fn().mockResolvedValue([]),
    createIap,
    getIap: vi.fn().mockResolvedValue({ id: "iap-4", operationalPeriod: "Operational Period 4", content: document }),
  } as unknown as ApiClient;
  render(
    <FormsSurface
      client={client}
      incidentId={INCIDENT_ID}
      incidentName="Redwood Fire"
      periodRevision={4}
      operationalPeriod="Operational Period 4"
      isAdmin
      onOpenIap={onOpenIap}
    />,
  );

  const assemble = await screen.findByRole("button", { name: "Assemble draft IAP" });
  await waitFor(() => expect(assemble.hasAttribute("disabled")).toBe(false));
  const context = screen.getByLabelText("ICS form context");
  fireEvent.change(screen.getByLabelText("Operational period revision"), { target: { value: "" } });
  expect(within(context).getByText("No operational period selected")).toBeTruthy();
  expect(within(context).queryByText("Area revision 4")).toBeNull();
  fireEvent.change(screen.getByLabelText("Operational period revision"), { target: { value: "4" } });
  fireEvent.click(assemble);

  await waitFor(() => expect(createIap).toHaveBeenCalledWith(INCIDENT_ID, {
    operationalPeriod: "Operational Period 4",
    periodRevision: 4,
  }));
  expect(screen.queryByText("OP 1")).toBeNull();
  fireEvent.click(await screen.findByText("Review draft in IAP workspace"));
  expect(onOpenIap).toHaveBeenCalledTimes(1);
});

const participant: IncidentParticipantGrant = {
  id: PARTICIPANT_ID,
  incidentId: INCIDENT_ID,
  organizationId: "00000000-0000-4000-8000-000000000003",
  organizationSlug: "mutual-aid",
  organizationName: "Mutual Aid District",
  personId: "00000000-0000-4000-8000-000000000004",
  personEmail: "leader@example.test",
  personName: "Morgan Lee",
  incidentPositionTitle: "Evacuation Group Supervisor",
  role: "coordinator",
  expiresAt: "2099-09-21T20:00:00.000Z",
  revokedAt: null,
  createdAt: "2026-09-21T08:00:00.000Z",
  invitation: null,
};

it("builds a draft assignment with named participant authority", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <Ics204Editor
      revisionKey="draft-1:3:in_progress"
      contentRevision={3}
      incidentId={INCIDENT_ID}
      status="in_progress"
      assignments={[]}
      positions={[]}
      participants={[participant]}
      busy={false}
      onSave={onSave}
      onCreateRevision={vi.fn()}
    />,
  );

  fireEvent.change(await screen.findByLabelText("Assignment 1 name"), { target: { value: "Evacuation Group" } });
  fireEvent.change(screen.getByLabelText("Named supervisor authority"), {
    target: { value: `participant:${PARTICIPANT_ID}` },
  });
  fireEvent.change(screen.getByLabelText("Tactics, one per line"), {
    target: { value: "Clear Zone A\nConfirm transport" },
  });
  view.rerender(
    <Ics204Editor
      revisionKey="draft-1:3:in_progress"
      contentRevision={3}
      incidentId={INCIDENT_ID}
      status="in_progress"
      assignments={[]}
      positions={[]}
      participants={[participant]}
      busy
      onSave={onSave}
      onCreateRevision={vi.fn()}
    />,
  );
  expect((screen.getByLabelText("Assignment 1 name") as HTMLInputElement).value).toBe("Evacuation Group");
  view.rerender(
    <Ics204Editor
      revisionKey="draft-1:3:in_progress"
      contentRevision={3}
      incidentId={INCIDENT_ID}
      status="in_progress"
      assignments={[]}
      positions={[]}
      participants={[participant]}
      busy={false}
      onSave={onSave}
      onCreateRevision={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save ICS-204 assignments" }));

  await waitFor(() => expect(onSave).toHaveBeenCalledWith([{
    name: "Evacuation Group",
    supervisor: {
      kind: "incident_participant",
      incidentId: INCIDENT_ID,
      participantId: PARTICIPANT_ID,
    },
    tactics: ["Clear Zone A", "Confirm transport"],
    resources: [],
  }], 3));
});

const approvedAssignment: Ics204Assignment = {
  id: "00000000-0000-4000-8000-000000000005",
  name: "Evacuation Group",
  supervisor: {
    kind: "incident_participant",
    organizationId: participant.organizationId,
    organizationName: participant.organizationName,
    participantId: participant.id,
    personId: participant.personId,
    personName: participant.personName,
    incidentPositionTitle: participant.incidentPositionTitle,
    participantRole: "coordinator",
    authority: "incident_coordinator",
    actorParticipationId: participant.id,
  },
  tactics: ["Clear Zone A"],
  resources: [],
};

it("creates a successor from an approved snapshot and never calls draft replacement", async () => {
  const onSave = vi.fn();
  const onCreateRevision = vi.fn().mockResolvedValue(undefined);
  render(
    <Ics204Editor
      revisionKey="approved-1:4:approved"
      contentRevision={4}
      incidentId={INCIDENT_ID}
      status="approved"
      assignments={[approvedAssignment]}
      positions={[]}
      participants={[participant]}
      busy={false}
      onSave={onSave}
      onCreateRevision={onCreateRevision}
    />,
  );

  expect(await screen.findByText(/approved revision remains unchanged/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Create draft revision" }));
  await waitFor(() => expect(onCreateRevision).toHaveBeenCalledTimes(1));
  expect(onSave).not.toHaveBeenCalled();
});

const workspaceItem: IapWorkspaceItem = {
  revisionRootId: "00000000-0000-4000-8000-000000000010",
  revisionNumber: 2,
  contentRevision: 7,
  supersedesIapId: "00000000-0000-4000-8000-000000000011",
  id: "00000000-0000-4000-8000-000000000012",
  operationalPeriod: "Operational Period 4",
  period: {
    revision: 4,
    label: "Operational Period 4",
    startsAt: area.operationalPeriod!.startsAt,
    endsAt: area.operationalPeriod!.endsAt,
  },
  status: "in_progress",
  formCount: 7,
  targetForms: 7,
  progress: {
    requiredFormIds: ["ICS-202"],
    completedFormIds: ["ICS-202"],
    missingFormIds: [],
    completed: 1,
    required: 1,
    percent: 100,
  },
  preparedBy: "Taylor Morgan",
  preparedAttribution: {
    organizationId: participant.organizationId,
    organizationName: participant.organizationName,
    roleKey: "planning_section_chief",
    roleLabel: "Planning Section Chief",
    positionId: "00000000-0000-4000-8000-000000000013",
    participationId: null,
  },
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
  createdAt: "2026-09-21T15:00:00.000Z",
};

const otherWorkspaceItem: IapWorkspaceItem = {
  ...workspaceItem,
  revisionRootId: "00000000-0000-4000-8000-000000000014",
  id: "00000000-0000-4000-8000-000000000015",
  supersedesIapId: null,
  preparedBy: "Other Planner",
};

it("uses the selected content revision for draft replacement and exports the exact lineage revision", async () => {
  const replaceIcs204Assignments = vi.fn()
    .mockRejectedValueOnce(new Error("IAP content revision conflict"))
    .mockResolvedValue({ contentRevision: 8, assignments: [] });
  const downloadIapRevisionPdf = vi.fn().mockResolvedValue(new Blob(["pdf"]));
  const queryIapWorkspace = vi.fn().mockResolvedValue({
    iaps: [workspaceItem, otherWorkspaceItem],
    query: { view: "all", periodRevision: 4 },
    summary: {
      total: 2,
      byState: { not_started: 0, in_progress: 2, in_approval: 0, approved: 0, complete: 0 },
      completedForms: 2,
      requiredForms: 2,
    },
    facets: {
      organizations: [{ key: participant.organizationId, label: participant.organizationName, count: 1 }],
      roles: [{ key: "planning_section_chief", label: "Planning Section Chief", count: 1 }],
    },
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:iap") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const client = {
    queryIapWorkspace,
    getIncidentArea: vi.fn().mockResolvedValue(area),
    incidentAreaHistory: vi.fn().mockResolvedValue([]),
    listPositions: vi.fn().mockResolvedValue([{
      id: workspaceItem.preparedAttribution.positionId,
      key: "planning_section_chief",
      title: "Planning Section Chief",
    }]),
    listIncidentParticipants: vi.fn().mockResolvedValue([]),
    getIap: vi.fn().mockResolvedValue({
      id: workspaceItem.id,
      status: "draft",
      operationalPeriod: workspaceItem.operationalPeriod,
      content: document,
    }),
    listIapRevisions: vi.fn().mockResolvedValue([
      {
        id: workspaceItem.supersedesIapId,
        revisionNumber: 1,
        contentRevision: 5,
        status: "approved",
        supersedesIapId: null,
        createdAt: "2026-09-21T14:00:00.000Z",
        preparedBy: "Taylor Morgan",
        approvedBy: "Command Admin",
        approvedAt: "2026-09-21T14:30:00.000Z",
      },
      {
        id: workspaceItem.id,
        revisionNumber: 2,
        contentRevision: 7,
        status: "draft",
        supersedesIapId: workspaceItem.supersedesIapId,
        createdAt: workspaceItem.createdAt,
        preparedBy: workspaceItem.preparedBy,
        approvedBy: null,
        approvedAt: null,
      },
    ]),
    replaceIcs204Assignments,
    downloadIapRevisionPdf,
  } as unknown as ApiClient;

  render(
    <IapSurface
      client={client}
      jurisdictionId={participant.organizationId}
      incidentId={INCIDENT_ID}
      incidentName="Redwood Fire"
      periodRevision={4}
      operationalPeriod="Operational Period 4"
      isAdmin
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Operational Period 4.*Prepared by Taylor Morgan/i }));
  fireEvent.change(await screen.findByLabelText("Assignment 1 name"), { target: { value: "Planning Group" } });
  fireEvent.change(screen.getByLabelText("Named supervisor authority"), {
    target: { value: `position:${workspaceItem.preparedAttribution.positionId}` },
  });
  fireEvent.change(screen.getByLabelText("Tactics, one per line"), { target: { value: "Publish assignments" } });
  fireEvent.click(screen.getByRole("button", { name: /Prepared by Other Planner/i }));
  expect(screen.getByRole("alertdialog", { name: "Unsaved ICS-204 changes" })).toBeTruthy();
  expect((screen.getByLabelText("Assignment 1 name") as HTMLInputElement).value).toBe("Planning Group");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.change(screen.getByLabelText("Operational period"), { target: { value: "" } });
  expect(screen.getByRole("alertdialog", { name: "Unsaved ICS-204 changes" })).toBeTruthy();
  expect(within(screen.getByLabelText("IAP workspace context")).getByText("Operational Period 4")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  const queryCountBeforeFailedSave = queryIapWorkspace.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Save ICS-204 assignments" }));

  await screen.findByText("IAP content revision conflict");
  expect((screen.getByLabelText("Assignment 1 name") as HTMLInputElement).value).toBe("Planning Group");
  expect(queryIapWorkspace.mock.calls.length).toBe(queryCountBeforeFailedSave);
  const queryCountBeforeSave = queryIapWorkspace.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Save ICS-204 assignments" }));
  await waitFor(() => expect(replaceIcs204Assignments).toHaveBeenLastCalledWith(workspaceItem.id, {
    expectedContentRevision: 7,
    assignments: [{
      name: "Planning Group",
      supervisor: { kind: "position", positionId: workspaceItem.preparedAttribution.positionId },
      tactics: ["Publish assignments"],
      resources: [],
    }],
  }));
  await waitFor(() => expect(queryIapWorkspace.mock.calls.length).toBeGreaterThan(queryCountBeforeSave));
  const revisionOne = (await screen.findByText("Revision 1")).closest("li");
  expect(revisionOne).toBeTruthy();
  expect(within(revisionOne!).getByText(/Approved by Command Admin at/)).toBeTruthy();
  fireEvent.click(within(revisionOne!).getByRole("button", { name: "Download exact revision" }));
  await waitFor(() => expect(downloadIapRevisionPdf).toHaveBeenCalledWith(workspaceItem.id, 1));
  fireEvent.change(screen.getByLabelText("Operational period"), { target: { value: "" } });
  expect(within(screen.getByLabelText("IAP workspace context")).getByText("All operational periods")).toBeTruthy();
});
