// @vitest-environment jsdom
import { STANDARD_TEMPLATES } from "@openeoc/shared";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { BoardSurface, type BoardRecordContext } from "../surfaces/BoardSurface.js";

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
      fields: template.fields,
      views: template.views,
    }),
    boardView: vi.fn((_boardId: string, _viewKey: string, incidentId?: string) => Promise.resolve({
      view: template.views[0]!.key,
      columns: template.views[0]!.columns,
      records: incidentId ? records.slice(0, 1) : records,
    })),
  } as unknown as ApiClient;
}

afterEach(cleanup);

describe("BoardSurface record context seam", () => {
  it("reports only a record present in the authorized incident-scoped board view", async () => {
    const onRecordContext = vi.fn<(state: BoardRecordContext | null) => void>();
    const api = client();
    const view = render(
      <BoardSurface client={api} boardId="board-1" incidentId="incident-1"
        recordId="record-1" onRecordContext={onRecordContext} />,
    );
    await waitFor(() => expect(onRecordContext).toHaveBeenCalledWith({
      status: "ready",
      record: expect.objectContaining({ id: "record-1", name: "Hoopa High Gym" }),
    }));
    expect(api.boardView).toHaveBeenCalledWith("board-1", template.views[0]!.key, "incident-1");

    view.rerender(
      <BoardSurface client={api} boardId="board-1" incidentId="incident-1"
        recordId="record-2" onRecordContext={onRecordContext} />,
    );
    await waitFor(() => expect(onRecordContext).toHaveBeenLastCalledWith({ status: "missing" }));
  });

  it("clears shell record context when no record deep link is present", async () => {
    const onRecordContext = vi.fn<(state: BoardRecordContext | null) => void>();
    render(<BoardSurface client={client()} boardId="board-1" onRecordContext={onRecordContext} />);
    await waitFor(() => expect(onRecordContext).toHaveBeenCalledWith(null));
  });
});
