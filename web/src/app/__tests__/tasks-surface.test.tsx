// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IncidentTask, TaskCompletionReceipt, TaskListQuery, TaskMetadataPatch } from "@openeoc/shared";
import { Theme } from "../../design/components.js";
import { TasksSurface } from "../surfaces/TasksSurface.js";

afterEach(cleanup);
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
const incidentId = "11111111-1111-4111-8111-111111111111";
const task: IncidentTask = { id: "22222222-2222-4222-8222-222222222222", incidentId, item: "Establish command", category: "command", status: "open", dueAt: "2026-09-22T10:00:00.000Z", revision: 1, assignment: { kind: "position", id: "33333333-3333-4333-8333-333333333333", organizationId: "44444444-4444-4444-8444-444444444444", title: "Incident Commander", personId: null }, dependencies: [], completedAt: null, completedBy: null };
function response(tasks: readonly IncidentTask[]) { return { tasks, analytics: { total: tasks.length, byStatus: { open: tasks.filter((item) => item.status === "open").length, in_progress: 0, completed: 0 }, byCategory: { command: tasks.length }, overdue: 0, dueNext24Hours: 1, upcoming: 0, withoutDue: 0 }, filters: {} }; }
function renderSurface(props: { closed?: boolean; nextPage?: readonly IncidentTask[] } = {}) {
  const listIncidentTasks = vi.fn(async (_id: string, _query: TaskListQuery, page?: { cursor?: string }) =>
    page?.cursor ? response(props.nextPage ?? []) : { ...response([task]), nextCursor: props.nextPage ? "next" : null });
  const operationIds: string[] = [];
  const updateInputs: TaskMetadataPatch[] = [];
  const receipt: TaskCompletionReceipt = { operationId: "55555555-5555-4555-8555-555555555555", taskId: task.id, incidentId, status: "completed", revision: 2, completedAt: "2026-09-21T12:00:00.000Z", completedBy: { personId: "66666666-6666-4666-8666-666666666666", positionId: task.assignment!.id, organizationId: task.assignment!.organizationId, participationId: null, title: "Incident Commander" } };
  const completeIncidentTask = vi.fn(async (_incidentId: string, _taskId: string, operationId: string) => { operationIds.push(operationId); return { ...receipt, operationId }; });
  const updateIncidentTask = vi.fn(async (_incidentId: string, _taskId: string, input: TaskMetadataPatch) => { updateInputs.push(input); return { ...task, status: "in_progress" as const, revision: 2 }; });
  const client = { listIncidentTasks, listPositions: vi.fn(async () => []), listIncidentParticipants: vi.fn(async () => []), updateIncidentTask, completeIncidentTask };
  render(<Theme name="light"><TasksSurface client={client as never} incidentId={incidentId} personId="66666666-6666-4666-8666-666666666666" jurisdictionId="44444444-4444-4444-8444-444444444444" canManage closed={props.closed ?? false} onOpenTemplates={() => undefined} /></Theme>);
  return { client, listIncidentTasks, operationIds, updateInputs };
}
describe("tasks surface", () => {
  it("loads the next page of tasks into the table", async () => {
    const { listIncidentTasks } = renderSurface({ nextPage: [{ ...task, id: "77777777-7777-4777-8777-777777777777", item: "Open shelter" }] });
    await screen.findByText("Establish command");
    expect(screen.queryByText("Open shelter")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load more records" }));
    expect(await screen.findByText("Open shelter")).toBeTruthy();
    expect(listIncidentTasks).toHaveBeenCalledWith(incidentId, { assignment: "mine" }, { cursor: "next" });
  });
  it("renders My Tasks and Team Tasks with authoritative category, due, and completion fields", async () => {
    const { listIncidentTasks } = renderSurface();
    expect(await screen.findByText("Establish command")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "My Tasks" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Incident Commander")).toBeTruthy();
    expect(screen.getByText("No completion evidence")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Team Tasks" }));
    await waitFor(() => expect(listIncidentTasks).toHaveBeenLastCalledWith(incidentId, {}));
  });
  it("makes the task table the panel the selected view tab names", async () => {
    renderSurface();
    await screen.findByText("Establish command");
    for (const name of ["My Tasks", "Team Tasks"]) {
      const tab = screen.getByRole("tab", { name });
      fireEvent.click(tab);
      const panel = document.getElementById(tab.getAttribute("aria-controls")!);
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
    }
  });
  it("uses one operation id for a completion attempt and reports the authoritative receipt", async () => {
    const { client, operationIds } = renderSurface();
    await screen.findByText("Establish command");
    await waitFor(() => expect((screen.getByRole("button", { name: "Complete" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(client.completeIncidentTask).toHaveBeenCalledTimes(1));
    expect(operationIds[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText(/Completion reconciled/)).toBeTruthy();
  });
  it("starts an open task without treating its null completion evidence as a receipt", async () => {
    const { client } = renderSurface();
    await screen.findByText("Establish command");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(client.updateIncidentTask).toHaveBeenCalledWith(incidentId, task.id, {
      expectedRevision: task.revision,
      status: "in_progress",
    }));
    expect(await screen.findByText("Updated Establish command to In progress.")).toBeTruthy();
  });
  it("does not offer start or completion actions for team tasks", async () => {
    const { client } = renderSurface();
    await screen.findByText("Establish command");
    fireEvent.click(screen.getByRole("tab", { name: "Team Tasks" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Start" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    expect(client.updateIncidentTask).not.toHaveBeenCalled();
    expect(client.completeIncidentTask).not.toHaveBeenCalled();
  });
  it("does not offer task commands for a closed incident", async () => {
    const { client } = renderSurface({ closed: true });
    await screen.findByText("Establish command");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(client.updateIncidentTask).not.toHaveBeenCalled();
    expect(client.completeIncidentTask).not.toHaveBeenCalled();
  });
  it("keeps an unsaved metadata draft after an authoritative rejection", async () => {
    const { client } = renderSurface();
    client.updateIncidentTask.mockRejectedValueOnce(new Error("task revision changed"));
    await screen.findByText("Establish command");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Task name"), { target: { value: "Revised command" } });
    fireEvent.click(screen.getByRole("button", { name: "Save task details" }));
    expect((await screen.findByRole("alert")).textContent).toContain("task revision changed");
    expect((screen.getByLabelText("Task name") as HTMLInputElement).value).toBe("Revised command");
  });
  it("round-trips an unchanged due instant through the local task editor", async () => {
    const { client, updateInputs } = renderSurface();
    await screen.findByText("Establish command");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save task details" }));
    await waitFor(() => expect(client.updateIncidentTask).toHaveBeenCalledTimes(1));
    expect(updateInputs[0]?.dueAt).toBe(task.dueAt);
  });
  it("states when no incident is selected", () => {
    render(<Theme name="dark"><TasksSurface client={{} as never} incidentId={null} personId={null} jurisdictionId={null} canManage={false} onOpenTemplates={() => undefined} /></Theme>);
    expect(screen.getByText("No incident selected")).toBeTruthy();
  });
});
