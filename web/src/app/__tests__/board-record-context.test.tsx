// @vitest-environment jsdom
import { STANDARD_TEMPLATES } from "@openeoc/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { BoardSurface, type BoardRecordContext } from "../surfaces/BoardSurface.js";

vi.mock("../auth/session.js", () => ({
  useSession: () => ({
    me: { person: { id: "person-1" } },
    jurisdictionId: "jurisdiction-1",
  }),
}));
vi.mock("../router.js", () => ({
  useSurface: () => ({ routeContext: {}, navigate: vi.fn() }),
}));

const template = STANDARD_TEMPLATES.find((candidate) => candidate.key === "shelters")!;
const records = [
  { id: "record-1", name: "Hoopa High Gym", status: "normal", capacity: 150, occupancy: 112 },
  { id: "record-2", name: "Closed Hall", status: "closed", capacity: 40, occupancy: 0 },
];

function client(): ApiClient {
  return {
    getBoard: vi.fn().mockResolvedValue({
      id: "board-1",
      title: template.title,
      templateKey: template.key,
      templateVersion: template.version,
      role: "member",
      canContribute: true,
      fields: template.fields,
      views: template.views,
    }),
    boardViewPage: vi.fn((_boardId: string, _viewKey: string, query: { incidentId?: string } = {}) => Promise.resolve({
      view: template.views[0]!.key,
      columns: template.views[0]!.columns,
      records: query.incidentId ? records.slice(0, 1) : records,
    })),
    boardRecordDetail: vi.fn((_boardId: string, recordId: string, incidentId?: string | null) => {
      const record = incidentId ? records.find((candidate) => candidate.id === recordId && recordId === "record-1") : null;
      if (!record) return Promise.reject(new Error("Record unavailable in this view"));
      return Promise.resolve({
        id: recordId,
        incidentId,
        data: record,
        createdAt: "2026-09-21T12:00:00.000Z",
        createdBy: { personId: "person-1", displayName: "Operator", positionId: null, positionTitle: null },
        updatedAt: "2026-09-21T12:00:00.000Z",
        updatedBy: null,
        canEdit: true,
        history: [],
      });
    }),
  } as unknown as ApiClient;
}

afterEach(cleanup);

describe("BoardSurface record context seam", () => {
  it("reports only a record present in the authorized incident-scoped board view", async () => {
    const onRecordContext = vi.fn<(state: BoardRecordContext | null) => void>();
    const api = client();
    const view = render(
      <BoardSurface client={api} boardId="board-1" incidentId="incident-1"
        incidentScoped recordId="record-1" onRecordContext={onRecordContext} />,
    );
    await waitFor(() => expect(onRecordContext).toHaveBeenCalledWith(expect.objectContaining({
      status: "ready",
      record: expect.objectContaining({ id: "record-1", name: "Hoopa High Gym" }),
    })));
    expect(api.boardViewPage).toHaveBeenCalledWith("board-1", template.views[0]!.key, { incidentId: "incident-1" });

    view.rerender(
      <BoardSurface client={api} boardId="board-1" incidentId="incident-1"
        incidentScoped recordId="record-2" onRecordContext={onRecordContext} />,
    );
    await waitFor(() => expect(onRecordContext).toHaveBeenLastCalledWith({ status: "missing" }));
  });

  it("waits for incident board scope before reading a deep-linked record", async () => {
    const onRecordContext = vi.fn<(state: BoardRecordContext | null) => void>();
    const api = client();
    const view = render(
      <BoardSurface client={api} boardId="board-1" incidentId="incident-1"
        incidentScopePending recordId="record-2" onRecordContext={onRecordContext} />,
    );
    await waitFor(() => expect(onRecordContext).toHaveBeenCalledWith({ status: "loading" }));
    expect(api.boardRecordDetail).not.toHaveBeenCalled();

    view.rerender(
      <BoardSurface client={api} boardId="board-1" incidentId="incident-1"
        incidentScoped recordId="record-2" onRecordContext={onRecordContext} />,
    );
    await waitFor(() => expect(api.boardRecordDetail).toHaveBeenCalledWith("board-1", "record-2", "incident-1"));
    await waitFor(() => expect(onRecordContext).toHaveBeenLastCalledWith({ status: "missing" }));
  });

  it("reads the next page under the same refinement", async () => {
    const api = client();
    const boardViewPage = vi.fn((_boardId: string, _viewKey: string, _query: unknown, page: { cursor?: string } = {}) =>
      Promise.resolve(page.cursor
        ? { view: "open", columns: template.views[0]!.columns, nextCursor: null,
          records: [{ id: "record-3", name: "Weitchpec Hall", status: "normal", capacity: 20, occupancy: 4 }] }
        : { view: "open", columns: template.views[0]!.columns, nextCursor: "page-2", records: records.slice(0, 1),
          groups: [{ value: "normal", count: 2 }] }));
    Object.assign(api, { boardViewPage });
    render(<BoardSurface client={api} boardId="board-1" onRecordContext={vi.fn()} />);
    await screen.findByText("Hoopa High Gym");
    fireEvent.click(screen.getByRole("button", { name: "Add sort key" }));
    fireEvent.change(screen.getByLabelText("Sort 1 field"), { target: { value: "capacity" } });
    fireEvent.change(screen.getByLabelText("Sort 1 direction"), { target: { value: "desc" } });
    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "status" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const refinement = { sorts: [{ field: "capacity", dir: "desc" }], groupBy: "status" };
    await waitFor(() => expect(boardViewPage).toHaveBeenLastCalledWith("board-1", "open", refinement));
    expect((await screen.findByRole("region", { name: "Group counts" })).textContent).toContain("normal 2");
    fireEvent.click(await screen.findByRole("button", { name: "Load more records" }));
    await screen.findByText("Weitchpec Hall");
    expect(boardViewPage).toHaveBeenLastCalledWith("board-1", "open", refinement, { cursor: "page-2" });
  });

  it("clears shell record context when no record deep link is present", async () => {
    const onRecordContext = vi.fn<(state: BoardRecordContext | null) => void>();
    render(<BoardSurface client={client()} boardId="board-1" onRecordContext={onRecordContext} />);
    await waitFor(() => expect(onRecordContext).toHaveBeenCalledWith(null));
  });
});
